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

  // Max size for any chat image/file upload (Firebase Storage, not Firestore —
  // Firestore documents cap out at ~1MB so anything beyond a tiny thumbnail
  // has to live in Storage with just the download URL saved on the message).
  const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15MB

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
  function createSession(visitorName, visitorContact = '', linkedSessionId = null, profileMeta = null) {
    // If a previous session ID is explicitly linked, reuse it
    if (linkedSessionId) {
      const prev = _sessions.find(s => s.id === linkedSessionId);
      if (prev) { if (prev.deleted) restoreSession(prev.id); updateSessionProfile(prev.id, profileMeta); return prev.id; }
    }

    // Deduplicate by contact (phone/email) if provided
    if (visitorContact) {
      const existing = _sessions.find(s => s.email && s.email.toLowerCase() === visitorContact.toLowerCase());
      if (existing) { if (existing.deleted) restoreSession(existing.id); updateSessionProfile(existing.id, profileMeta); return existing.id; }
    }

    // Deduplicate by name if no contact (prevents duplicate guest sessions)
    if (!visitorContact && visitorName) {
      const existing = _sessions.find(s => s.name && s.name.toLowerCase() === visitorName.toLowerCase() && !s.email);
      if (existing) { if (existing.deleted) restoreSession(existing.id); updateSessionProfile(existing.id, profileMeta); return existing.id; }
    }

    const sessionId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const sessionData = {
      name: visitorName,
      email: visitorContact,
      avatarPhoto: (profileMeta && profileMeta.avatarPhoto) || null,
      avatarColor: (profileMeta && profileMeta.avatarColor) || null,
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

  // Keep a session's avatar/color synced with the customer's current profile —
  // called whenever a chat is (re)opened, so profile edits reflect on admin's side.
  function updateSessionProfile(sessionId, profileMeta) {
    if (!sessionId || !profileMeta) return;
    const s = _sessions.find(s => s.id === sessionId);
    const patch = {};
    if ('avatarPhoto' in profileMeta && profileMeta.avatarPhoto !== (s && s.avatarPhoto)) patch.avatarPhoto = profileMeta.avatarPhoto || null;
    if ('avatarColor' in profileMeta && profileMeta.avatarColor !== (s && s.avatarColor)) patch.avatarColor = profileMeta.avatarColor || null;
    if (!Object.keys(patch).length) return;
    if (s) Object.assign(s, patch);
    whenReady(({ db, doc, setDoc }) => {
      setDoc(doc(db, 'chatSessions', sessionId), patch, { merge: true })
        .catch(e => _reportErr('ChatSystem: updateSessionProfile error', e));
    });
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
  function sendMessage(sessionId, senderType, senderName, text, imageData, replyTo, attachment) {
    const hasText       = text && text.trim();
    const hasImage      = imageData && typeof imageData === 'string';
    const hasAttachment = attachment && attachment.url;
    if (!hasText && !hasImage && !hasAttachment) return null;

    const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const message = {
      id,
      sessionId,
      senderType,             // 'visitor' | 'admin'
      senderName,
      text:       hasText ? text.trim() : '',
      imageData:  hasImage ? imageData : null,   // base64 data-URL (legacy) OR a Storage image URL
      // attachment: non-image file uploaded to Firebase Storage — { url, name, type, size }
      attachment: hasAttachment ? {
        url:  attachment.url,
        name: attachment.name || 'file',
        type: attachment.type || 'application/octet-stream',
        size: attachment.size || 0
      } : null,
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

    // Optimistic local unread bump — same idea as the message push above, so the
    // relevant badge (admin sidebar or the customer's chat button) lights up
    // immediately instead of waiting on the Firestore round-trip.
    if (senderType === 'visitor') {
      _unread['admin'] = (_unread['admin'] || 0) + 1;
      notifyListeners('unread-updated', _unread);
    } else if (senderType === 'admin') {
      _unread[sessionId] = (_unread[sessionId] || 0) + 1;
      notifyListeners('unread-updated', _unread);
    }

    whenReady(({ db, doc, setDoc, updateDoc, increment }) => {
      const { id: _id, ...data } = message;
      setDoc(doc(db, 'chatMessages', id), data)
        .catch(e => _reportErr('ChatSystem: sendMessage error', e));

      // Only increment unread count for visitor messages (so admin gets notified).
      // When admin sends, do NOT increment the *admin* unread counter — that's the
      // admin sidebar's own count and incrementing it there causes a false notification
      // on their own messages. Instead, bump the *per-session* counter so the customer's
      // chat button badge lights up for the admin's reply.
      if (senderType === 'visitor') {
        updateDoc(doc(db, 'chatMeta', 'unreadCounts'), { admin: increment(1) })
          .catch(() => {
            setDoc(doc(db, 'chatMeta', 'unreadCounts'), { admin: 1 }, { merge: true }).catch(() => {});
          });
      } else if (senderType === 'admin') {
        updateDoc(doc(db, 'chatMeta', 'unreadCounts'), { [sessionId]: increment(1) })
          .catch(() => {
            setDoc(doc(db, 'chatMeta', 'unreadCounts'), { [sessionId]: 1 }, { merge: true }).catch(() => {});
          });
      }
    });

    updateSessionLastMessage(sessionId);

    return message;
  }

  function getSessionMessages(sessionId) { return _messages.filter(m => m.sessionId === sessionId); }

  // =============================================
  // FILE / IMAGE UPLOAD (Cloudinary)
  // =============================================
  // Uploads any file (image or otherwise) to Cloudinary under
  // chatUploads/{sessionId}/... and resolves with { url, name, type, size }
  // ready to pass into sendMessage() as imageData (images) or attachment (files).
  // Rejects with Error('SIZE_LIMIT') if the file is over MAX_ATTACHMENT_SIZE,
  // or Error('TIMEOUT') if the upload genuinely stalls.
  //
  // Uploads via Cloudinary's unsigned upload endpoint (no Firebase Storage /
  // Blaze plan dependency). Uses XMLHttpRequest (not fetch) so we still get
  // real upload-progress events, and keeps the same STALL watchdog behavior
  // as before: the timeout resets every time real progress is reported, and
  // only fires if NO bytes have moved for STALL_MS.
  const CLOUDINARY_CLOUD_NAME = 'vx6n3jdc';
  const CLOUDINARY_UPLOAD_PRESET = 'zamimart_chat';

  function uploadAttachment(file, sessionId, onProgress) {
    return new Promise((resolve, reject) => {
      if (!file) { reject(new Error('NO_FILE')); return; }
      if (file.size > MAX_ATTACHMENT_SIZE) { reject(new Error('SIZE_LIMIT')); return; }

      const STALL_MS = 20000;
      let settled = false;
      let stallTimer = null;

      const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const xhr = new XMLHttpRequest();

      function armStallTimer() {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { xhr.abort(); } catch (e) {}
          _reportErr('ChatSystem: uploadAttachment timeout', new Error('Upload stalled (no progress for 20s)'));
          reject(new Error('TIMEOUT'));
        }, STALL_MS);
      }

      const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      formData.append('folder', `chatUploads/${sessionId}`);

      xhr.open('POST', url, true);
      armStallTimer();

      xhr.upload.onprogress = (e) => {
        if (settled) return;
        armStallTimer(); // bytes are still moving — push the stall deadline out
        if (typeof onProgress === 'function' && e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          try { onProgress(pct); } catch (err) {}
        }
      };

      xhr.onload = () => {
        if (settled) return;
        clearTimeout(stallTimer);
        settled = true;
        let data;
        try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.secure_url) {
          resolve({ url: data.secure_url, name: file.name || safeName, type: file.type || 'application/octet-stream', size: file.size });
        } else {
          const e = new Error((data && data.error && data.error.message) || ('Cloudinary upload failed (' + xhr.status + ')'));
          _reportErr('ChatSystem: uploadAttachment error', e);
          reject(e);
        }
      };

      xhr.onerror = () => {
        if (settled) return;
        settled = true; clearTimeout(stallTimer);
        const e = new Error('NETWORK_ERROR');
        _reportErr('ChatSystem: uploadAttachment error', e);
        reject(e);
      };

      xhr.onabort = () => {
        // Handled by the stall-timeout path (rejects with TIMEOUT already).
      };

      xhr.send(formData);
    });
  }

  // =============================================
  // SHARED RENDERING HELPERS (used by chat-widget.html + admin.html)
  // =============================================
  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function _fileIconClass(type, name) {
    const ext = ((name || '').split('.').pop() || '').toLowerCase();
    type = type || '';
    if (type.indexOf('pdf') > -1 || ext === 'pdf') return 'fa-file-pdf';
    if (/word/.test(type) || ['doc', 'docx'].includes(ext)) return 'fa-file-word';
    if (/sheet|excel/.test(type) || ['xls', 'xlsx', 'csv'].includes(ext)) return 'fa-file-excel';
    if (/presentation|powerpoint/.test(type) || ['ppt', 'pptx'].includes(ext)) return 'fa-file-powerpoint';
    if (/zip|compressed|rar|7z/.test(type) || ['zip', 'rar', '7z'].includes(ext)) return 'fa-file-zipper';
    if (/^video\//.test(type)) return 'fa-file-video';
    if (/^audio\//.test(type)) return 'fa-file-audio';
    if (/^text\//.test(type) || ext === 'txt') return 'fa-file-lines';
    return 'fa-file';
  }

  // Renders a small clickable file card for a non-image attachment.
  function renderAttachmentHtml(att) {
    if (!att || !att.url) return '';
    const name = att.name || 'file';
    const safeName = String(name).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const icon = _fileIconClass(att.type, name);
    const size = formatFileSize(att.size);
    return `<a href="${att.url}" target="_blank" rel="noopener noreferrer" class="zm-file-attach" title="${safeName}">` +
      `<i class="fa-solid ${icon}"></i>` +
      `<span class="zm-file-attach-info"><span class="zm-file-attach-name">${safeName}</span>` +
      `<span class="zm-file-attach-size">${size}${size ? ' · ' : ''}Download</span></span>` +
      `</a>`;
  }

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
    createSession, updateSessionProfile, getSession, getSessions, getDeletedSessions, updateSessionLastMessage, linkInquiryToSession,
    deleteSession, restoreSession, permanentlyDeleteSession,
    sendMessage, getSessionMessages, getMessages, deleteMessage, restoreMessage, permanentlyDeleteMessage,
    editMessage, reactToMessage,
    markSessionAsRead, markAdminRead,
    getUnreadCount, getAdminUnreadCount, getAdminUnreadBySession,
    clearAllChats,
    uploadAttachment, formatFileSize, renderAttachmentHtml,
    MAX_ATTACHMENT_SIZE
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
