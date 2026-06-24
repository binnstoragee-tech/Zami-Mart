/**
 * Zami Mart Inquiry System v1
 * Real-time "Send Inquiry" cart submissions, backed by Firebase Firestore.
 */

const InquirySystem = (function() {
  'use strict';

  let _inquiries = [];
  const _readyQueue = [];
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

  function whenReady(task) {
    if (window.fb && window.fb.db) { task(window.fb); }
    else { _readyQueue.push(task); }
  }
  window.addEventListener('fb-ready', () => {
    while (_readyQueue.length) _readyQueue.shift()(window.fb);
  });

  function init() {
    whenReady(({ db, collection, query, orderBy, onSnapshot }) => {
      onSnapshot(
        query(collection(db, 'inquiries'), orderBy('sentAt', 'desc')),
        (snap) => {
          _inquiries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          notifyListeners('inquiries-updated', _inquiries);
        },
        (err) => _reportErr('InquirySystem: listener error', err)
      );
    });
  }

  function getInquiries() { return _inquiries; }

  function submitInquiry({ name, email, items, chatSessionId }) {
    const id = 'inq_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    // 1) Use the provided chatSessionId or try to find it from localStorage
    let linkedSessionId = chatSessionId || null;
    if (!linkedSessionId) {
      try {
        const s = JSON.parse(localStorage.getItem('zm_cv_session') || 'null');
        if (s && s.id) linkedSessionId = s.id;
      } catch(e) {}
    }

    // 2) Fallback to scanning existing inquiries by email
    if (!linkedSessionId && email) {
      const existingInquiry = _inquiries.find(i => i.email && i.email.toLowerCase() === email.toLowerCase());
      linkedSessionId = existingInquiry
        ? (window.ChatSystem && ChatSystem.getSessions
            ? (ChatSystem.getSessions().find(s => s.inquiryId === existingInquiry.id) || {}).id || null
            : null)
        : null;
    }

    const data = {
      name: name || 'Guest',
      email: email || '',
      items: items || [],
      sentAt: new Date().toISOString(),
      status: 'new',
      linkedSessionId: linkedSessionId || null
    };

    // Optimistic local entry
    _inquiries.unshift({ id, ...data });
    notifyListeners('inquiries-updated', _inquiries);

    whenReady(({ db, doc, setDoc }) => {
      setDoc(doc(db, 'inquiries', id), data)
        .catch(e => _reportErr('InquirySystem: submitInquiry error', e));
      
      // Also tag the chat session with this inquiry ID if we have a session
      if (linkedSessionId && window.ChatSystem && ChatSystem.linkInquiryToSession) {
        ChatSystem.linkInquiryToSession(linkedSessionId, id);
      }
    });

    return id;
  }

  function getInquiriesByEmail(email) {
    if (!email) return [];
    return _inquiries.filter(i => i.email && i.email.toLowerCase() === email.toLowerCase())
      .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  }

  function getCustomers() {
    const map = {};
    _inquiries.forEach(inq => {
      const key = inq.email ? inq.email.toLowerCase() : ('_guest_' + inq.name);
      if (!map[key]) {
        map[key] = {
          name: inq.name || 'Guest',
          email: inq.email || '',
          inquiryCount: 0,
          lastSentAt: inq.sentAt,
          hasNew: false
        };
      }
      map[key].inquiryCount++;
      if (new Date(inq.sentAt) > new Date(map[key].lastSentAt)) map[key].lastSentAt = inq.sentAt;
      if (inq.status === 'new') map[key].hasNew = true;
    });
    return Object.values(map).sort((a, b) => new Date(b.lastSentAt) - new Date(a.lastSentAt));
  }

  function markRead(id) {
    const inq = _inquiries.find(i => i.id === id);
    if (inq) inq.status = 'read';
    notifyListeners('inquiries-updated', _inquiries);
    whenReady(({ db, doc, updateDoc }) => {
      updateDoc(doc(db, 'inquiries', id), { status: 'read' }).catch(() => {});
    });
  }

  function markAllRead() {
    _inquiries.forEach(i => { if (i.status === 'new') i.status = 'read'; });
    notifyListeners('inquiries-updated', _inquiries);
    whenReady(({ db, doc, updateDoc }) => {
      _inquiries.forEach(i => {
        updateDoc(doc(db, 'inquiries', i.id), { status: 'read' }).catch(() => {});
      });
    });
  }

  function deleteInquiry(id) {
    _inquiries = _inquiries.filter(i => i.id !== id);
    notifyListeners('inquiries-updated', _inquiries);
    whenReady(({ db, doc, deleteDoc }) => {
      deleteDoc(doc(db, 'inquiries', id)).catch(e => _reportErr('InquirySystem: deleteInquiry error', e));
    });
  }

  return { init, on, getInquiries, submitInquiry, getInquiriesByEmail, getCustomers, markRead, markAllRead, deleteInquiry };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => InquirySystem.init());
} else {
  InquirySystem.init();
}
