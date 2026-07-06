/**
 * Zami Mart Chat System v3
 * Real-time chat + image support via Firebase Firestore.
 * Works across devices/browsers/networks instantly — not just same-browser tabs.
 *
 * Public API is unchanged from v2 (localStorage version) on purpose, so every
 * page that already calls ChatSystem.* keeps working without edits.
 *
 * Firestore layout:
 *   chatSessions/{sessionId}   -> { name, email, createdAt, lastMessageAt, status, inquiryId?, deleted?, deletedAt? }
 *   chatMessages/{messageId}   -> { sessionId, senderType, senderName, text, imageData, timestamp, read, deleted?, deletedAt? }
 *   chatMeta/unreadCounts      -> { admin: number, [sessionId]: number }
 *
 * Recycle Bin: deleting a session or a message is a SOFT delete (deleted:true,
 * deletedAt set) — the original data is kept so it can be restored later from
 * the admin Recycle Bin. Use permanentlyDeleteSession()/permanentlyDeleteMessage()
 * to erase for good (called from the Recycle Bin's "Delete Forever").
 */

const ChatSystem = (function() {
  'use strict';

  // In-memory mirrors kept in sync by Firestore onSnapshot listeners.
  // All synchronous "get" functions read from these — callers don't need to await anything.
  let _messages = [];
  let _sessions = [];
  let _unread   = {};
  let _ready    = false;
  const _readyQueue = [];

  // =============================================
  // EVENT SYSTEM
  // =============================================
  const listeners = {};
  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }
  function notifyListeners(event, data) {
    (listeners[event] || []).forEach(cb => { try { cb(data); } catch (e) { console.warn('Listener error:', e); } });
  }

  function _reportErr(prefix, e) {
    console.warn(prefix, e);
    if (window.zmShowFbError) window.zmShowFbError(prefix + ': ' + (e && e.message ? e.message : e));
  }

  // =============================================
  // FIREBASE READY HELPERS
  // =============================================
  function whenReady(task) {
    if (window.fb && window.fb.db) { task(window.fb); }
    else { _readyQueue.push(task); }
  }
  window.addEventListener('fb-ready', () => {
    while (_readyQueue.length) _readyQueue.shift()(window.fb);
  });

  // Watchdog: if Firebase never shows up at all (blocked script, no internet,
  // ad-blocker, wrong file path, etc.), say so on the page instead of staying silent.
  if (!window._zmFbWatchdogStarted) {
    window._zmFbWatchdogStarted = true;
    setTimeout(() => {
      if (!window.fb || !window.fb.db) {
        const msg = 'Hindi nag-load ang Firebase pagkalipas ng 8 segundo. Posibleng dahilan: walang internet, naka-block ng ad-blocker/extension/firewall ang gstatic.com, o mali ang path ng firebase-init.js sa HTML.';
        if (window.zmShowFbError) {
          window.zmShowFbError(msg);
        } else {
          // firebase-init.js itself never ran — build a minimal banner manually.
          const bar = document.createElement('div');
          bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#d63030;color:#fff;font-family:sans-serif;font-size:13px;padding:10px 16px;';
          bar.textContent = '⚠️ ' + msg;
          (document.body || document.documentElement).appendChild(bar);
        }
      }
    }, 8000);
  }

  function initStorage() {
    whenReady((fb) => {
      const { db, collection, query, orderBy, onSnapshot, doc } = fb;

      onSnapshot(
        query(collection(db, 'chatMessages'), orderBy('timestamp', 'asc')),
        (snap) => {
          _messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          notifyListeners('messages-updated', _messages);
        },
        (err) => _reportErr('ChatSystem: messages listener error', err)
      );

      onSnapshot(
        collection(db, 'chatSessions'),
        (snap) => {
          _sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          notifyListeners('sessions-updated', _sessions);
          if (!_sessionsLoaded) {
            _sessionsLoaded = true;
            _onReadyCbs.forEach(cb => { try { cb(); } catch(e) {} });
            _onReadyCbs.length = 0;
          }
        },
        (err) => _reportErr('ChatSystem: sessions listener error', err)
      );

      onSnapshot(
        doc(db, 'chatMeta', 'unreadCounts'),
        (snap) => {
          _unread = snap.exists() ? (snap.data() || {}) : {};
          notifyListeners('unread-updated', _unread);
        },
        (err) => _reportErr('ChatSystem: unread listener error', err)
      );

      _ready = true;
    });
  }

  function getMessages() { return _messages; }
  function getSessions()  { return _sessions.filter(s => !s.deleted); }
  function getDeletedSessions() { return _sessions.filter(s => s.deleted); }
  function getUnread()    { return _unread; }

  // =============================================
  // SESSION MANAGEMENT
  // =============================================
  function createSession(visitorName, visitorContact = '', linkedSessionId = null) {
    // If a previous session ID is explicitly linked, reuse it
    if (linkedSessionId) {
      const prev = _sessions.find(s => s.id === linkedSessionId);
      if (prev) { if (prev.deleted) restoreSession(prev.id); return prev.id; }
    }

    // Deduplicate by contact (phone/email) if provided
    if (visitorContact) {
      const existing = _sessions.find(s => s.email && s.email.toLowerCase() === visitorContact.toLowerCase());
      if (existing) { if (existing.deleted) restoreSession(existing.id); return existing.id; }
    }

    // Deduplicate by name if no contact (prevents duplicate guest sessions)
    if (!visitorContact && visitorName) {
      const existing = _sessions.find(s => s.name && s.name.toLowerCase() === visitorName.toLowerCase() && !s.email);
      if (existing) { if (existing.deleted) restoreSession(existing.id); return existing.id; }
    }

    const sessionId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const sessionData = {
      name: visitorName,
      email: visitorContact,
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      status: 'active'
    };

    // Optimistic local entry so getSession()/getSessions() work immediately.
    _sessions.push({ id: sessionId, ...sessionData });

    whenReady(({ db, doc, setDoc }) => {
      setDoc(doc(db, 'chatSessions', sessionId), sessionData)
        .catch(e => _reportErr('ChatSystem: createSession error', e));
    });

    return sessionId;
  }

  function getSession(sessionId) { return _sessions.find(s => s.id === sessionId); }

  function updateSessionLastMessage(sessionId) {
    const s = _sessions.find(s => s.id === sessionId);
    if (s) s.lastMessageAt = new Date().toISOString();
    whenReady(({ db, doc, setDoc }) => {
      // Use setDoc with merge:true so it works even if the doc doesn't exist yet in Firestore
      setDoc(doc(db, 'chatSessions', sessionId), { lastMessageAt: new Date().toISOString() }, { merge: true })
        .catch(e => _reportErr('ChatSystem: updateSessionLastMessage error', e));
    });
  }

  // Link an inquiry to a session so admin can reply in the inquiry chat panel
  function linkInquiryToSession(sessionId, inquiryId) {
    const s = _sessions.find(s => s.id === sessionId);
    if (s) s.inquiryId = inquiryId;
    whenReady(({ db, doc, setDoc }) => {
      setDoc(doc(db, 'chatSessions', sessionId), { inquiryId }, { merge: true })
        .catch(e => _reportErr('ChatSystem: linkInquiryToSession error', e));
    });
  }

  // =============================================
  // MESSAGE MANAGEMENT (supports imageData)
  // =============================================
  function sendMessage(sessionId, senderType, senderName, text, imageData, replyTo) {
    const hasText  = text && text.trim();
    const hasImage = imageData && typeof imageData === 'string';
    if (!hasText && !hasImage) return null;

    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const message = {
      id,
      sessionId,
      senderType,             // 'visitor' | 'admin'
      senderName,
      text:       hasText ? text.trim() : '',
      imageData:  hasImage ? imageData : null,   // base64 data-URL
      timestamp:  new Date().toISOString(),
      read:       false,
      // replyTo: { id, senderName, text } — short snapshot of the quoted message, or null
      replyTo:    replyTo || null
    };

    // If this session was moved to the Recycle Bin but the conversation is
    // still active (visitor replying, or admin replying from history), bring
    // it back so it shows up in the normal chat list again.
    const s = _sessions.find(s => s.id === sessionId);
    if (s && s.deleted) restoreSession(sessionId);

    // Optimistic local push (the next Firestore snapshot will reconcile/replace this).
    _messages.push(message);
    notifyListeners('messages-updated', _messages);

    whenReady(({ db, doc, setDoc, updateDoc, increment }) => {
      const { id: _id, ...data } = message;
      setDoc(doc(db, 'chatMessages', id), data)
        .catch(e => _reportErr('ChatSystem: sendMessage error', e));

      // Only increment unread count for visitor messages (so admin gets notified).
      // When admin sends, do NOT increment the session unread — that's the customer's count
      // and incrementing it causes the admin sidebar to show a false notification on their own messages.
      if (senderType === 'visitor') {
        updateDoc(doc(db, 'chatMeta', 'unreadCounts'), { admin: increment(1) })
          .catch(() => {
            setDoc(doc(db, 'chatMeta', 'unreadCounts'), { admin: 1 }, { merge: true }).catch(() => {});
          });
      }
    });

    updateSessionLastMessage(sessionId);

    return message;
  }

  function getSessionMessages(sessionId) { return _messages.filter(m => m.sessionId === sessionId); }

  function markSessionAsRead(sessionId) {
    _messages.forEach(m => { if (m.sessionId === sessionId) m.read = true; });
    _unread[sessionId] = 0;

    whenReady(({ db, doc, updateDoc, setDoc }) => {
      _messages
        .filter(m => m.sessionId === sessionId)
        .forEach(m => { updateDoc(doc(db, 'chatMessages', m.id), { read: true }).catch(() => {}); });
      setDoc(doc(db, 'chatMeta', 'unreadCounts'), { [sessionId]: 0 }, { merge: true }).catch(() => {});
    });
  }

  function markAdminRead() {
    _unread['admin'] = 0;
    whenReady(({ db, doc, setDoc }) => {
      setDoc(doc(db, 'chatMeta', 'unreadCounts'), { admin: 0 }, { merge: true }).catch(() => {});
    });
  }

  function getUnreadCount(sessionId) { return _unread[sessionId] || 0; }
  function getAdminUnreadCount()     { return _unread['admin']   || 0; }

  // Count unread VISITOR messages per session (for admin notification panel)
  // This is how many messages from the customer the admin hasn't read yet.
  function getAdminUnreadBySession(sessionId) {
    return _messages.filter(m =>
      m.sessionId === sessionId &&
      m.senderType === 'visitor' &&
      m.read === false
    ).length;
  }

  // =============================================
  // UTILITY
  // =============================================
  // Soft delete — moves the conversation to the Recycle Bin. Session + its
  // messages are kept in Firestore untouched so it can be restored later.
  function deleteSession(sessionId) {
    const s = _sessions.find(s => s.id === sessionId);
    const deletedAt = new Date().toISOString();
    if (s) { s.deleted = true; s.deletedAt = deletedAt; }
    notifyListeners('sessions-updated', _sessions);

    whenReady(({ db, doc, setDoc }) => {
      setDoc(doc(db, 'chatSessions', sessionId), { deleted: true, deletedAt }, { merge: true }).catch(() => {});
      setDoc(doc(db, 'chatMeta', 'unreadCounts'), { [sessionId]: 0 }, { merge: true }).catch(() => {});
    });
  }

  // Bring a conversation back out of the Recycle Bin.
  function restoreSession(sessionId) {
    const s = _sessions.find(s => s.id === sessionId);
    if (s) { s.deleted = false; s.deletedAt = null; }
    notifyListeners('sessions-updated', _sessions);

    whenReady(({ db, doc, setDoc }) => {
      setDoc(doc(db, 'chatSessions', sessionId), { deleted: false, deletedAt: null }, { merge: true }).catch(() => {});
    });
  }

  // Erase a conversation for good (called from the Recycle Bin's "Delete Forever").
  function permanentlyDeleteSession(sessionId) {
    _sessions = _sessions.filter(s => s.id !== sessionId);
    const toDelete = _messages.filter(m => m.sessionId === sessionId);
    _messages = _messages.filter(m => m.sessionId !== sessionId);
    notifyListeners('sessions-updated', _sessions);
    notifyListeners('messages-updated', _messages);

    whenReady(({ db, doc, deleteDoc, setDoc }) => {
      deleteDoc(doc(db, 'chatSessions', sessionId)).catch(() => {});
      toDelete.forEach(m => deleteDoc(doc(db, 'chatMessages', m.id)).catch(() => {}));
      setDoc(doc(db, 'chatMeta', 'unreadCounts'), { [sessionId]: 0 }, { merge: true }).catch(() => {});
    });
  }

  // Soft delete a single message — original text/image are KEPT so it can be
  // restored; the UI is responsible for hiding/graying it out.
  function deleteMessage(messageId) {
    const m = _messages.find(m => m.id === messageId);
    const deletedAt = new Date().toISOString();
    if (m) { m.deleted = true; m.deletedAt = deletedAt; }
    notifyListeners('messages-updated', _messages);

    whenReady(({ db, doc, updateDoc }) => {
      updateDoc(doc(db, 'chatMessages', messageId), { deleted: true, deletedAt }).catch(() => {});
    });
  }

  // Undo a message delete.
  function restoreMessage(messageId) {
    const m = _messages.find(m => m.id === messageId);
    if (m) { m.deleted = false; m.deletedAt = null; }
    notifyListeners('messages-updated', _messages);

    whenReady(({ db, doc, updateDoc }) => {
      updateDoc(doc(db, 'chatMessages', messageId), { deleted: false, deletedAt: null }).catch(() => {});
    });
  }

  // Erase a single message for good.
  function permanentlyDeleteMessage(messageId) {
    _messages = _messages.filter(m => m.id !== messageId);
    notifyListeners('messages-updated', _messages);

    whenReady(({ db, doc, deleteDoc }) => {
      deleteDoc(doc(db, 'chatMessages', messageId)).catch(() => {});
    });
  }

  function editMessage(messageId, newText) {
    const m = _messages.find(m => m.id === messageId);
    if (!m || m.deleted) return false;
    const trimmed = newText && newText.trim();
    if (!trimmed) return false;
    m.text = trimmed;
    m.edited = true;
    notifyListeners('messages-updated', _messages);

    whenReady(({ db, doc, updateDoc }) => {
      updateDoc(doc(db, 'chatMessages', messageId), { text: trimmed, edited: true }).catch(() => {});
    });
    return true;
  }

  // Toggle an emoji reaction on a message, per reactor. Each side (admin /
  // visitor) owns its own reaction slot on a message — reacting never
  // touches or removes the other side's reaction. Pass the same emoji again
  // (as the same reactorType) to remove your own reaction.
  // reactorType: 'admin' | 'visitor'
  function reactToMessage(messageId, emoji, reactorType) {
    const m = _messages.find(m => m.id === messageId);
    if (!m || m.deleted || !reactorType) return;
    const reactions = Object.assign({}, m.reactions);
    // Migrate any older single-reaction message the first time it's touched,
    // so pre-existing reactions aren't silently dropped.
    if (!m.reactions && m.reaction) reactions.legacy = m.reaction;
    if (reactions[reactorType] === emoji) {
      delete reactions[reactorType];
    } else {
      reactions[reactorType] = emoji;
    }
    m.reactions = reactions;
    m.reaction = null; // fully migrated away from the old single-slot field
    notifyListeners('messages-updated', _messages);

    whenReady(({ db, doc, updateDoc }) => {
      updateDoc(doc(db, 'chatMessages', messageId), { reactions, reaction: null })
        .catch(e => _reportErr('ChatSystem: reactToMessage error', e));
    });
  }

  function clearAllChats() {
    _messages = [];
    _sessions = [];
    _unread = {};
    ['messages-updated', 'sessions-updated', 'unread-updated'].forEach(e => notifyListeners(e, []));

    whenReady(async ({ db, doc, collection, getDocs, deleteDoc, setDoc }) => {
      try {
        const [msgsSnap, sessSnap] = await Promise.all([
          getDocs(collection(db, 'chatMessages')),
          getDocs(collection(db, 'chatSessions'))
        ]);
        msgsSnap.forEach(d => deleteDoc(doc(db, 'chatMessages', d.id)).catch(() => {}));
        sessSnap.forEach(d => deleteDoc(doc(db, 'chatSessions', d.id)).catch(() => {}));
        await setDoc(doc(db, 'chatMeta', 'unreadCounts'), {});
      } catch (e) { _reportErr('ChatSystem: clearAllChats error', e); }
    });
  }

  // =============================================
  // PUBLIC API
  // =============================================
  // onReady: fires callback immediately if already loaded, else queues it
  const _onReadyCbs = [];
  let _sessionsLoaded = false;
  function onReady(cb) {
    if (_sessionsLoaded) { try { cb(); } catch(e) {} }
    else _onReadyCbs.push(cb);
  }

  return {
    init: initStorage, on, onReady,
    createSession, getSession, getSessions, getDeletedSessions, updateSessionLastMessage, linkInquiryToSession,
    deleteSession, restoreSession, permanentlyDeleteSession,
    sendMessage, getSessionMessages, getMessages, deleteMessage, restoreMessage, permanentlyDeleteMessage,
    editMessage, reactToMessage,
    markSessionAsRead, markAdminRead,
    getUnreadCount, getAdminUnreadCount, getAdminUnreadBySession,
    clearAllChats
  };
})();

// Expose on window explicitly — see the matching note in inquiry-system.js.
// inquiry-system.js itself checks `window.ChatSystem` when auto-linking a
// new inquiry to an existing chat session, so without this that link-up
// silently never happens either.
window.ChatSystem = ChatSystem;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ChatSystem.init());
} else {
  ChatSystem.init();
}
