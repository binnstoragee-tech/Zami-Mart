/**
 * Zami Mart — Customer Quotation Module
 * Renders a "Quotation" document (view / print / download) for a cart
 * inquiry. Unlike a static receipt, this is LIVE: once an inquiry has an
 * `inquiryId`, every render reads the current record straight out of
 * InquirySystem (Firestore-backed). So the moment admin sets item prices
 * or approves the quotation, the customer's document — on the thank-you
 * screen, in "Quotation History", or reopened on a later visit — shows
 * the real, current pricing and status. No page refresh needed.
 */
(function (global) {
  'use strict';

  function pad(num, size) {
    let s = String(Math.abs(Math.trunc(num)));
    while (s.length < size) s = '0' + s;
    return s;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (s) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s];
    });
  }

  function fmtMoney(n) {
    return 'MVR ' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Short customer-facing reference derived from the inquiry id, shown
  // until admin opens the inquiry and an official "ZM/QUO/YYYY/NNNN"
  // number gets assigned — at which point the document swaps to it
  // automatically on the next render.
  function shortRef(id) {
    if (!id) return '—';
    const s = String(id).replace(/[^a-zA-Z0-9]/g, '');
    return 'INQ-' + s.slice(-6).toUpperCase();
  }

  // ---------------------------------------------------------------
  // Fresh, modern "quotation/receipt" icon — reused for the thank-you
  // screen's action button, the document letterhead, and the cart's
  // Quotation History rows so the icon language stays consistent.
  // ---------------------------------------------------------------
  function quoteIconSVG(size) {
    size = size || 18;
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M6 2.75h8.5L19 7.25V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="M14.5 2.75V6a1 1 0 0 0 1 1h3.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="M7.4 11.4h6M7.4 14.4h6M7.4 17.1h3.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
      '<circle cx="17.3" cy="17.3" r="4.3" fill="#fd4d02" stroke="#fff" stroke-width="1"/>' +
      '<path d="M15.35 17.35l1.2 1.15 2.15-2.45" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  }

  // ---------------------------------------------------------------
  // Live lookup — reads the real inquiry record (active or in the
  // Recycle Bin) straight from InquirySystem's Firestore-backed cache.
  // ---------------------------------------------------------------
  function getLiveInquiry(inquiryId) {
    if (!inquiryId || !global.InquirySystem) return null;
    try {
      const active = InquirySystem.getInquiries ? InquirySystem.getInquiries() : [];
      let found = active.find(function (i) { return i.id === inquiryId; });
      if (found) return found;
      const deleted = InquirySystem.getDeletedInquiries ? InquirySystem.getDeletedInquiries() : [];
      return deleted.find(function (i) { return i.id === inquiryId; }) || null;
    } catch (e) { return null; }
  }

  // Grand total counting only items admin has actually priced —
  // mirrors the same rule used in the admin panel.
  function quoteTotal(items) {
    const priced = (items || []).filter(function (it) { return it.price != null && it.price !== ''; });
    if (!priced.length) return null;
    return priced.reduce(function (sum, it) { return sum + (Number(it.price) || 0) * (Number(it.qty) || 0); }, 0);
  }

  function statusInfo(inq, items) {
    const total = quoteTotal(items);
    if (total == null) {
      return { key: 'none', label: 'Awaiting Review', total: null };
    }
    if (inq && inq.quoteStatus === 'approved') {
      return { key: 'approved', label: 'Approved', total: total };
    }
    return { key: 'pending', label: 'Pending Approval', total: total };
  }

  // ---------------------------------------------------------------
  // Quotation History — a lightweight local index of quotations the
  // shopper has generated, so the cart can show "past orders" without
  // a server round-trip just to list them. Only ids + light display
  // fields are stored; the actual pricing/status is always re-read
  // live when a history entry is opened. Newest first, capped at 20.
  // Scoped per logged-in account (uid/email) so it survives refresh,
  // disappears on logout, and comes back when that same account logs
  // back in. Signed-out visitors get their own separate "guest" bucket.
  // ---------------------------------------------------------------
  const HISTORY_MAX = 20;
  const LEGACY_HISTORY_KEY = 'zm_quote_history'; // pre-account-scoping key

  function getUserKey() {
    try {
      const u = global.fb && global.fb.auth ? global.fb.auth.currentUser : null;
      if (u) return u.uid || u.email || 'guest';
    } catch (e) {}
    return 'guest';
  }
  function historyKey() { return 'zm_quote_history__' + getUserKey(); }

  function loadHistoryList() {
    try {
      const key = historyKey();
      let raw = localStorage.getItem(key);
      if (raw == null) {
        // One-time migration: move any old, unscoped history into the
        // guest bucket so nobody loses quotations from before this update.
        const legacy = localStorage.getItem(LEGACY_HISTORY_KEY);
        if (legacy != null) {
          if (key === 'zm_quote_history__guest') localStorage.setItem(key, legacy);
          localStorage.removeItem(LEGACY_HISTORY_KEY);
          raw = localStorage.getItem(key);
        }
      }
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveHistoryList(list) {
    try { localStorage.setItem(historyKey(), JSON.stringify(list)); } catch (e) {}
  }
  function addToHistoryIndex(entry) {
    try {
      let list = loadHistoryList();
      // Same inquiry re-opened/re-submitted — move to top instead of duplicating.
      list = list.filter(function (h) { return h.inquiryId !== entry.inquiryId; });
      list.unshift(entry);
      if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
      saveHistoryList(list);
      global.dispatchEvent(new CustomEvent('zm-quote-history-updated'));
    } catch (e) {}
  }

  // Active-only lookup — unlike getLiveInquiry, this does NOT fall back to
  // the Recycle Bin. Used for the customer-facing history so a quotation
  // admin has soft-deleted disappears from the shopper's cart the moment
  // it's moved to the bin, and reappears automatically if admin restores it.
  function getActiveInquiry(inquiryId) {
    if (!inquiryId || !global.InquirySystem) return null;
    try {
      const active = InquirySystem.getInquiries ? InquirySystem.getInquiries() : [];
      return active.find(function (i) { return i.id === inquiryId; }) || null;
    } catch (e) { return null; }
  }

  // Returns the history list enriched with LIVE status pulled from
  // InquirySystem right now — so a badge like "Approved" always
  // reflects reality, even if it changed since the entry was added.
  // Entries admin has moved to the Recycle Bin (or permanently deleted)
  // are left out entirely, so the customer's cart never shows a quotation
  // that no longer exists on admin's side.
  function getHistory() {
    const list = loadHistoryList();
    return list.reduce(function (out, h) {
      const inq = getActiveInquiry(h.inquiryId);
      if (!inq) return out; // deleted / recycled / not yet synced — hide from customer
      const info = statusInfo(inq, inq.items);
      // Always derive the count live from the inquiry's current items —
      // never from the snapshot saved when the quotation was first sent —
      // so it updates immediately after items are added/removed/edited.
      const liveItemCount = (inq.items || []).reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0);
      out.push({
        inquiryId: h.inquiryId,
        quoteNumber: inq.quoteNumber || h.quoteNumber || shortRef(h.inquiryId),
        dateStr: h.dateStr,
        itemCount: liveItemCount,
        statusKey: info.key,
        statusLabel: info.label,
        // Whether admin has explicitly marked the ORDER (not just the
        // quotation pricing) as completed/fulfilled. This — not the
        // pricing status — is what puts an entry in "Completed Orders".
        completed: !!inq.completed
      });
      return out;
    }, []);
  }

  function viewHistoryEntry(inquiryId) {
    if (!inquiryId) return;
    const list = loadHistoryList();
    const entry = list.find(function (h) { return h.inquiryId === inquiryId; });
    // Fall back to the live inquiry record if the local history entry is
    // missing or stale (e.g. cleared storage, different device/browser,
    // or an account switch) — as long as the inquiry itself still exists,
    // the document should still open instead of silently doing nothing.
    const inq = getActiveInquiry(inquiryId);
    // If admin has moved this quotation to the Recycle Bin (or it no longer
    // exists at all), treat it as gone from the customer's side — don't open it.
    if (!inq) return;

    state = {
      inquiryId: inquiryId,
      items: (entry && entry.items) || (inq && inq.items) || [],
      customerName: (entry && entry.customerName) || (inq && inq.name) || 'Guest Customer',
      customerContact: (entry && entry.customerContact) || (inq && inq.email) || '',
      customerPhone: (entry && entry.customerPhone) || (inq && inq.phone) || '',
      customerLocation: (entry && entry.customerLocation) || (inq && inq.location) || '',
      dateStr: (entry && entry.dateStr) || (inq
        ? new Date(inq.sentAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
        : new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }))
    };
    try {
      init();
      bodyEl.innerHTML = buildDocHTML();
      overlayEl.classList.add('open');
    } catch (e) { console.warn('ZamiQuotation viewHistoryEntry failed:', e); }
  }

  // Re-render whatever's listening (cart drawers) the moment the login
  // state changes, so history swaps to the right account instantly —
  // no page refresh needed.
  (function watchAuthForHistory() {
    let lastKey = null;
    function notifyIfChanged() {
      const k = getUserKey();
      if (k === lastKey) return;
      lastKey = k;
      try { global.dispatchEvent(new CustomEvent('zm-quote-history-updated')); } catch (e) {}
    }
    function attach() {
      try { global.fb.onAuthStateChanged(global.fb.auth, notifyIfChanged); } catch (e) {}
    }
    if (global.fb && global.fb.auth) attach();
    else global.addEventListener('fb-ready', attach, { once: true });
  })();

  // Look up a display "code" for a product by name from the seeded catalog.
  // Falls back to a stable pseudo-code derived from the name so the column
  // always has something consistent to show. Same scheme the admin panel uses.
  function getProductCode(name) {
    try {
      const products = JSON.parse(localStorage.getItem('zm_products') || '[]');
      const p = products.find(function (p) { return p.name === name; });
      if (p && p.id != null) return pad(p.id, 5);
    } catch (e) {}
    let hash = 0;
    const str = String(name || '');
    for (let i = 0; i < str.length; i++) { hash = (hash * 31 + str.charCodeAt(i)) >>> 0; }
    return pad(hash % 100000, 5);
  }

  let state = null; // { inquiryId, items, customerName, customerContact, dateStr }

  // Called right after InquirySystem.submitInquiry() returns an id.
  function setData(data) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    state = {
      inquiryId: data.inquiryId || null,
      items: (data.items || []).map(function (it) { return { name: it.name, qty: it.qty }; }),
      customerName: (data.customerName && data.customerName !== 'Guest') ? data.customerName : 'Guest Customer',
      customerContact: data.customerContact || '',
      customerPhone: data.customerPhone || '',
      customerLocation: data.customerLocation || '',
      dateStr: dateStr
    };
    addToHistoryIndex({
      inquiryId: state.inquiryId,
      quoteNumber: shortRef(state.inquiryId),
      items: state.items,
      customerName: state.customerName,
      customerContact: state.customerContact,
      customerPhone: state.customerPhone,
      customerLocation: state.customerLocation,
      dateStr: dateStr,
      itemCount: state.items.reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0)
    });
    return state.inquiryId;
  }

  // ---------------------------------------------------------------
  // Admin-side loader — points the SAME renderer (buildDocHTML) at a
  // given inquiry, straight from the live record, without touching
  // the customer's local "Quotation History" index. This is what lets
  // the admin panel's View/Print/Download buttons produce the exact
  // document the customer sees, always in sync.
  // ---------------------------------------------------------------
  function loadFromInquiry(inquiryId) {
    const inq = getLiveInquiry(inquiryId);
    if (!inq) return false;
    state = {
      inquiryId: inq.id,
      items: (inq.items || []).map(function (it) { return { name: it.name, qty: it.qty, price: it.price }; }),
      customerName: (inq.name && inq.name !== 'Guest') ? inq.name : 'Guest Customer',
      customerContact: inq.email || '',
      customerPhone: inq.phone || '',
      customerLocation: inq.location || '',
      dateStr: new Date(inq.sentAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    };
    return true;
  }

  function buildDocHTML() {
    if (!state) return '';

    // Pull the live record if we have an id — this is what makes the
    // document real: admin's pricing/status show up here automatically.
    const inq = getLiveInquiry(state.inquiryId);
    const items = (inq && inq.items && inq.items.length) ? inq.items : state.items;
    const info = statusInfo(inq, items);
    const quoteNumber = (inq && inq.quoteNumber) || shortRef(state.inquiryId);
    const genStr = new Date().toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });

    const isCompleted = !!(inq && inq.completed);
    const badgeClass = isCompleted ? 'zmq-badge-completed' : (info.key === 'approved' ? 'zmq-badge-approved' : (info.key === 'pending' ? 'zmq-badge-pending' : 'zmq-badge-none'));
    const badgeText = isCompleted ? 'COMPLETED' : (info.key === 'approved' ? 'APPROVED' : (info.key === 'pending' ? 'PENDING APPROVAL' : 'AWAITING REVIEW'));
    const statusPlain = isCompleted ? 'Completed' : (info.key === 'approved' ? 'Approved' : (info.key === 'pending' ? 'Pending' : 'Awaiting Review'));

    const rows = items.map(function (it, i) {
      const hasPrice = it.price != null && it.price !== '';
      const priceCell = hasPrice ? escapeHtml(fmtMoney(it.price)) : '<span class="zmq-pending">Pending</span>';
      const lineTotal = hasPrice ? escapeHtml(fmtMoney((Number(it.price) || 0) * (Number(it.qty) || 0))) : '<span class="zmq-pending">—</span>';
      return (
        '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td class="zmq-desc">' + escapeHtml(it.name) + '</td>' +
          '<td>' + it.qty + '</td>' +
          '<td class="zmq-right">' + priceCell + '</td>' +
          '<td class="zmq-right zmq-linetotal">' + lineTotal + '</td>' +
        '</tr>'
      );
    }).join('');

    let notice;
    if (isCompleted) {
      notice =
        '<div class="zmq-notice zmq-notice-completed">' +
          '<i class="fa-solid fa-circle-check"></i>' +
          '<div>' +
            '<b>Order completed</b>' +
            '<div>This order has been fulfilled and marked complete by our team. Thank you for shopping with Zami Mart!</div>' +
          '</div>' +
        '</div>';
    } else if (info.key === 'approved') {
      notice =
        '<div class="zmq-notice zmq-notice-approved">' +
          '<i class="fa-solid fa-circle-check"></i>' +
          '<div>' +
            '<b>Quotation approved</b>' +
            '<div>Your order has been confirmed at the total below. Our team will reach out to arrange payment and delivery/pickup.</div>' +
          '</div>' +
        '</div>';
    } else if (info.key === 'pending') {
      notice =
        '<div class="zmq-notice">' +
          '<i class="fa-solid fa-circle-info"></i>' +
          '<div>' +
            '<b>Pricing added — awaiting final approval</b>' +
            '<div>Our team has priced this order. It\'ll be marked Approved once confirmed, and this document updates automatically — no need to resubmit.</div>' +
          '</div>' +
        '</div>';
    } else {
      notice =
        '<div class="zmq-notice">' +
          '<i class="fa-solid fa-circle-info"></i>' +
          '<div>' +
            '<b>Awaiting admin review</b>' +
            '<div>Pricing will be added once our team reviews this order. You\'ll be notified once it\'s ready — this document updates automatically.</div>' +
          '</div>' +
        '</div>';
    }

    const totalRow = info.total != null
      ? '<div class="zmq-total-row' + (info.key === 'approved' ? ' zmq-total-row-approved' : '') + '"><span>Grand Total</span><span class="zmq-total-amt">' + escapeHtml(fmtMoney(info.total)) + '</span></div>'
      : '<div class="zmq-total-row zmq-total-row-pending"><span>Grand Total</span><span class="zmq-total-amt zmq-pending">Pending</span></div>';

    return (
      '<div class="zmq-doc">' +
        '<div class="zmq-topbar"></div>' +
        '<div class="zmq-head">' +
          '<div class="zmq-brand">' +
            '<div class="zmq-logo"><img src="img/logo.png" alt="Zami Mart" /></div>' +
            '<div class="zmq-title">Quotation</div>' +
            '<span class="zmq-badge ' + badgeClass + '"><i class="zmq-badge-dot"></i>' + badgeText + '</span>' +
          '</div>' +
          '<div class="zmq-head-info">' +
            '<div class="zmq-brandsub"><i class="fa-solid fa-location-dot"></i>Male&#39;, Maldives</div>' +
            '<div class="zmq-brandsub"><i class="fa-solid fa-envelope"></i>Zamimart.g3@gmail.com</div>' +
            '<div class="zmq-brandsub"><i class="fa-solid fa-phone"></i>+960 9906025</div>' +
          '</div>' +
        '</div>' +
        '<div class="zmq-meta">' +
          '<div class="zmq-meta-col">' +
            '<div class="zmq-label"><i class="fa-solid fa-file-invoice"></i>Details</div>' +
            '<div class="zmq-row"><span>Ref No.</span><b>' + escapeHtml(quoteNumber) + '</b></div>' +
            '<div class="zmq-row"><span>Date</span><b>' + escapeHtml(state.dateStr) + '</b></div>' +
            '<div class="zmq-row"><span>Status</span><b>' + statusPlain + '</b></div>' +
          '</div>' +
          '<div class="zmq-meta-col">' +
            '<div class="zmq-label"><i class="fa-solid fa-user"></i>Customer</div>' +
            '<div class="zmq-row"><span>Name</span><b>' + escapeHtml(state.customerName) + '</b></div>' +
            '<div class="zmq-row"><span>Phone</span><b>' + (state.customerPhone ? escapeHtml(state.customerPhone) : '&mdash;') + '</b></div>' +
            '<div class="zmq-row"><span>Location</span><b>' + (state.customerLocation ? escapeHtml(state.customerLocation) : '&mdash;') + '</b></div>' +
            '<div class="zmq-row"><span>Email</span><b>' + (state.customerContact ? escapeHtml(state.customerContact) : '&mdash;') + '</b></div>' +
          '</div>' +
        '</div>' +
        '<div class="zmq-table-wrap"><table class="zmq-table">' +
          '<thead><tr><th>#</th><th>Description</th><th>Qty</th><th class="zmq-right">Price</th><th class="zmq-right">Total</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
        totalRow +
        notice +
        '<div class="zmq-terms">' +
          '<div class="zmq-label"><i class="fa-solid fa-circle-info"></i>Terms &amp; Conditions</div>' +
          '<ul>' +
            '<li>This document confirms the items and quantities you requested. Please check details carefully.</li>' +
            '<li>Pricing and availability are confirmed by our team before a quotation is marked Approved.</li>' +
            '<li>This quotation is considered accepted if no concerns are raised upon confirmation.</li>' +
            '<li>Contact us at +960 9906025 for any questions.</li>' +
          '</ul>' +
        '</div>' +
        '<div class="zmq-footer">' +
          '<span class="zmq-footer-thanks">Thank you for choosing Zami Mart!</span>' +
          '<span>' + escapeHtml(genStr) + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------
  // Styles + modal (injected once)
  // ---------------------------------------------------------------
  let inited = false;
  let overlayEl, bodyEl;
  let injectedStyleText = '';

  function injectStyles() {
    injectedStyleText = [
      '.ty-actions{display:flex;flex-direction:column;align-items:center;gap:.6rem;width:100%;}',
      '.ty-secondary-row{display:flex;gap:.6rem;}',
      '.ty-secondary-btn{padding:9px 20px;background:#fff;color:var(--teal,#063B3F);border:1.5px solid rgba(6,59,63,.18);border-radius:12px;font-family:var(--font-body,inherit);font-size:.82rem;font-weight:700;cursor:pointer;transition:all .18s;}',
      '.ty-secondary-btn:hover{background:rgba(6,59,63,.06);border-color:var(--teal,#063B3F);}',
      '.zmq-overlay{position:fixed;inset:0;z-index:99999;background:rgba(6,20,20,.65);display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px);}',
      '.zmq-overlay.open{display:flex;}',
      '.zmq-panel{background:#eef2f1;border-radius:20px;max-width:600px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 24px 70px -14px rgba(0,0,0,.4);overflow:hidden;}',
      '.zmq-panel-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:#fff;border-bottom:1px solid rgba(6,59,63,.08);}',
      '.zmq-panel-head span{font-weight:800;color:var(--teal,#063B3F);font-size:.95rem;letter-spacing:-.01em;}',
      '.zmq-close{background:rgba(6,59,63,.07);border:none;width:32px;height:32px;border-radius:50%;color:var(--teal,#063B3F);cursor:pointer;font-size:.85rem;transition:background .15s;}',
      '.zmq-close:hover{background:rgba(6,59,63,.15);}',
      '.zmq-panel-body{overflow-y:auto;padding:20px;}',
      '.zmq-panel-actions{display:flex;gap:10px;padding:14px 20px;background:#fff;border-top:1px solid rgba(6,59,63,.08);}',
      '.zmq-panel-actions button{flex:1;padding:11px;border-radius:11px;border:none;font-weight:700;font-size:.85rem;cursor:pointer;font-family:var(--font-body,inherit);transition:all .15s;}',
      '.zmq-panel-actions .zmq-print-btn{background:#fff;border:1.5px solid rgba(6,59,63,.16);color:var(--teal,#063B3F);}',
      '.zmq-panel-actions .zmq-print-btn:hover{background:rgba(6,59,63,.06);}',
      '.zmq-panel-actions .zmq-download-btn{background:linear-gradient(135deg,#063b3f,#0a5a62);color:#fff;box-shadow:0 6px 16px -6px rgba(6,59,63,.45);}',
      '.zmq-panel-actions .zmq-download-btn:hover{opacity:.92;transform:translateY(-1px);}',
      '.zmq-doc{position:relative;background:#fff;border-radius:18px;padding:34px 32px 28px;font-family:var(--font-body,-apple-system,sans-serif);color:#1e2b2b;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden;}',
      '.zmq-topbar{position:absolute;top:0;left:0;right:0;height:6px;background:linear-gradient(90deg,#063b3f,#0a5a62 55%,#fd4d02);}',
      '.zmq-head{display:flex;justify-content:space-between;align-items:center;padding-bottom:22px;margin-bottom:24px;gap:16px;flex-wrap:wrap;position:relative;}',
      '.zmq-head::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,rgba(6,59,63,.14),rgba(6,59,63,.02));}',
      '.zmq-kicker{font-size:.62rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#fd4d02;margin-bottom:6px;}',
      '.zmq-title{font-size:1.5rem;font-weight:800;color:var(--teal,#063B3F);letter-spacing:-.02em;margin:10px 0 10px;line-height:1;}',
      '.zmq-badge{display:inline-flex;align-items:center;gap:6px;font-size:.65rem;font-weight:800;letter-spacing:.06em;padding:6px 13px 6px 11px;border-radius:100px;}',
      '.zmq-badge-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0;}',
      '.zmq-badge-none{background:#eef2f2;color:#6d8080;}',
      '.zmq-badge-pending{background:#fff2e8;color:#c9530a;}',
      '.zmq-badge-approved{background:#e3f8ee;color:#0a9a60;}',
      '.zmq-badge-completed{background:#e6efee;color:#063b3f;}',
      '.zmq-head-info{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;}',
      '.zmq-brand{display:flex;flex-direction:column;align-items:flex-start;}',
      '.zmq-logo{width:76px;height:76px;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;}',
      '.zmq-logo img{width:100%;height:100%;object-fit:contain;}',
      '.zmq-brandsub{display:flex;align-items:center;justify-content:flex-start;gap:6px;font-size:.68rem;color:#7a8f8f;line-height:1.6;white-space:nowrap;}',
      '.zmq-brandsub i{color:#fd4d02;font-size:.62rem;width:11px;text-align:center;flex-shrink:0;}',
      '.zmq-meta{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;}',
      '.zmq-meta-col{flex:1;min-width:180px;padding:16px 18px;background:linear-gradient(155deg,rgba(6,59,63,.035),rgba(6,59,63,.015));border:1px solid rgba(6,59,63,.06);border-radius:14px;border-left:3px solid rgba(6,59,63,.35);}',
      '.zmq-label{display:flex;align-items:center;gap:6px;font-size:.62rem;font-weight:800;letter-spacing:.08em;color:#8a9f9f;margin-bottom:10px;text-transform:uppercase;}',
      '.zmq-label i{color:#fd4d02;font-size:.68rem;}',
      '.zmq-row{display:flex;gap:8px;font-size:.8rem;color:#4a5f5f;margin-bottom:7px;}',
      '.zmq-row:last-child{margin-bottom:0;}',
      '.zmq-row span{min-width:58px;color:#8a9f9f;flex-shrink:0;}',
      '.zmq-row b{color:#1e2b2b;font-weight:700;}',
      '.zmq-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:18px;border:1px solid rgba(6,59,63,.08);border-radius:14px;box-shadow:0 1px 2px rgba(6,59,63,.04);}',
      '.zmq-table{width:100%;border-collapse:collapse;font-size:.8rem;}',
      '.zmq-table thead th{text-align:left;background:linear-gradient(135deg,#063b3f,#0a5a62);color:#fff;font-size:.64rem;font-weight:800;letter-spacing:.06em;padding:12px 14px;white-space:nowrap;}',
      '.zmq-table thead th:first-child{border-radius:14px 0 0 0;}',
      '.zmq-table thead th:last-child{border-radius:0 14px 0 0;}',
      '.zmq-table td{padding:11px 14px;border-bottom:1px solid rgba(6,59,63,.06);vertical-align:middle;}',
      '.zmq-table tbody tr:nth-child(even){background:rgba(6,59,63,.02);}',
      '.zmq-table tr:last-child td{border-bottom:none;}',
      '.zmq-right{text-align:right;}',
      '.zmq-desc{color:#1e2b2b;font-weight:600;}',
      '.zmq-muted{color:#9aacac;}',
      '.zmq-linetotal{font-weight:700;color:var(--teal,#063B3F);}',
      '.zmq-pending{color:#c9530a;font-style:italic;font-weight:400;}',
      '.zmq-total-row{display:flex;justify-content:space-between;align-items:center;background:var(--cream,#f6f1e7);border-radius:14px;padding:16px 20px;font-size:.86rem;font-weight:800;color:var(--teal,#063B3F);margin:0 0 20px;transition:background .2s,color .2s;}',
      '.zmq-total-row-approved{background:linear-gradient(135deg,#0a5a62,#063b3f);color:#fff;box-shadow:0 8px 20px -8px rgba(6,59,63,.45);}',
      '.zmq-total-amt{font-size:1.2rem;letter-spacing:-.01em;}',
      '.zmq-total-row-pending{background:#f4f6f5;color:#6d8080;}',
      '.zmq-notice{display:flex;gap:11px;background:#fff8ee;border-radius:12px;padding:13px 15px;font-size:.76rem;color:#6a5a30;margin-bottom:20px;align-items:flex-start;}',
      '.zmq-notice i{color:#e09a12;margin-top:2px;background:#fff1d6;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:.7rem;}',
      '.zmq-notice b{display:block;color:#4a3f1c;margin-bottom:2px;}',
      '.zmq-notice-approved{background:#eafaf1;color:#1e5c40;}',
      '.zmq-notice-approved i{color:#0a9a60;background:#d3f5e4;}',
      '.zmq-notice-approved b{color:#0a5a3a;}',
      '.zmq-notice-completed{background:#e6efee;color:#0e2f2f;}',
      '.zmq-notice-completed i{color:#063b3f;background:#d3e3e1;}',
      '.zmq-notice-completed b{color:#063b3f;}',
      '.zmq-terms{background:rgba(6,59,63,.02);border-radius:12px;padding:14px 16px;}',
      '.zmq-terms ul{margin:6px 0 0;padding-left:18px;}',
      '.zmq-terms li{font-size:.72rem;color:#6a8080;margin-bottom:4px;line-height:1.5;}',
      '.zmq-footer{display:flex;justify-content:space-between;align-items:center;font-size:.66rem;color:#a0b0b0;border-top:1px solid rgba(6,59,63,.08);margin-top:20px;padding-top:14px;}',
      '.zmq-footer-thanks{font-weight:700;color:var(--teal,#063B3F);font-size:.72rem;}',
      '@media screen and (max-width: 480px) {',
        '.zmq-overlay{padding:0;}',
        '.zmq-panel{max-width:100%;width:100%;height:100%;max-height:100%;border-radius:0;}',
        '.zmq-panel-head{padding:12px 14px;}',
        '.zmq-panel-head span{font-size:.88rem;}',
        '.zmq-panel-body{padding:12px;}',
        '.zmq-panel-actions{padding:12px 14px;gap:8px;}',
        '.zmq-doc{padding:20px 14px;border-radius:14px;}',
        '.zmq-head{flex-direction:row;align-items:flex-start;justify-content:space-between;text-align:left;gap:10px;padding-bottom:16px;margin-bottom:16px;}',
        '.zmq-title{font-size:1.2rem;margin:8px 0 8px;}',
        '.zmq-badge{font-size:.58rem;padding:5px 10px 5px 9px;}',
        '.zmq-head-info{align-items:flex-start;text-align:left;gap:6px;}',
        '.zmq-brand{align-items:flex-start;}',
        '.zmq-logo{width:56px;height:56px;}',
        '.zmq-brandsub{justify-content:flex-start;font-size:.62rem;white-space:normal;text-align:left;line-height:1.5;}',
        '.zmq-meta{flex-direction:column;gap:10px;margin-bottom:18px;}',
        '.zmq-meta-col{padding:13px 14px;min-width:0;}',
        '.zmq-row{font-size:.76rem;}',
        '.zmq-row span{min-width:50px;}',
        '.zmq-table-wrap{margin-bottom:14px;}',
        '.zmq-table{font-size:.7rem;}',
        '.zmq-table thead th{padding:9px 8px;font-size:.6rem;}',
        '.zmq-table td{padding:9px 8px;}',
        '.zmq-total-row{padding:13px 16px;margin-bottom:16px;}',
        '.zmq-total-amt{font-size:1.05rem;}',
        '.zmq-notice{padding:11px 12px;font-size:.72rem;}',
        '.zmq-terms{padding:12px 13px;}',
        '.zmq-terms li{font-size:.68rem;}',
        '.zmq-footer{flex-direction:column;align-items:flex-start;gap:6px;margin-top:16px;padding-top:12px;}',
      '}'
    ].join('\n');
    const style = document.createElement('style');
    style.textContent = injectedStyleText;
    document.head.appendChild(style);
  }

  function injectModal() {
    overlayEl = document.createElement('div');
    overlayEl.className = 'zmq-overlay';
    overlayEl.id = 'zmqOverlay';
    overlayEl.innerHTML =
      '<div class="zmq-panel">' +
        '<div class="zmq-panel-head"><span>Quotation Preview</span><button class="zmq-close" id="zmqCloseBtn"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="zmq-panel-body" id="zmqBody"></div>' +
        '<div class="zmq-panel-actions">' +
          '<button class="zmq-print-btn" id="zmqPanelPrintBtn"><i class="fa-solid fa-print" style="margin-right:6px;"></i>Print</button>' +
          '<button class="zmq-download-btn" id="zmqPanelDownloadBtn"><i class="fa-solid fa-download" style="margin-right:6px;"></i>Download</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlayEl);
    bodyEl = overlayEl.querySelector('#zmqBody');

    overlayEl.querySelector('#zmqCloseBtn').addEventListener('click', closeView);
    overlayEl.addEventListener('click', function (e) { if (e.target === overlayEl) closeView(); });
    overlayEl.querySelector('#zmqPanelPrintBtn').addEventListener('click', printDoc);
    overlayEl.querySelector('#zmqPanelDownloadBtn').addEventListener('click', downloadDoc);
  }

  // While the doc is open, keep it live: re-render the instant admin's
  // edits arrive (same tab or another), so price/status never go stale.
  // Also: (1) tell the cart to re-render its Quotation History list right
  // away, so a quotation admin just deleted disappears immediately instead
  // of waiting for the next cart open; (2) if the document the customer
  // currently has open just got deleted, close it on the spot.
  function attachLiveSync() {
    if (!global.InquirySystem || !global.InquirySystem.on) return;
    InquirySystem.on('inquiries-updated', function () {
      if (state && overlayEl && overlayEl.classList.contains('open')) {
        const stillActive = getActiveInquiry(state.inquiryId);
        if (!stillActive) { closeView(); }
        else { bodyEl.innerHTML = buildDocHTML(); }
      }
      try { global.dispatchEvent(new CustomEvent('zm-quote-history-updated')); } catch (e) {}
    });
  }

  function init() {
    if (inited) return;
    inited = true;
    injectStyles();
    injectModal();
    attachLiveSync();
  }

  function openView() {
    init();
    if (!state) return;
    bodyEl.innerHTML = buildDocHTML();
    overlayEl.classList.add('open');
  }

  function closeView() {
    if (overlayEl) overlayEl.classList.remove('open');
  }

  // ---------------------------------------------------------------
  // Print — via a hidden iframe so we don't fight popup blockers
  // ---------------------------------------------------------------
  function printDoc() {
    init();
    if (!state) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    const docHtml = buildDocHTML();
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation</title>' +
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">' +
      '<style>' +
        '@page{size:A4;margin:14mm;}' +
        '*{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}' +
        'html,body{margin:0;padding:0;background:#fff;}' +
        'body{padding:24px;}' +
        '.zmq-doc{max-width:720px;margin:0 auto;box-shadow:none;}' +
        '@media print{body{padding:0;}.zmq-doc{padding:26px 24px;}}' +
      '</style>' +
      '<style>' + injectedStyleText + '</style>' +
      '</head><body>' + docHtml + '</body></html>'
    );
    doc.close();

    setTimeout(function () {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) {}
      setTimeout(function () { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1000);
    }, 300);
  }

  // ---------------------------------------------------------------
  // Download — render to canvas then save as PDF
  // ---------------------------------------------------------------
  let libsLoading = null;
  function loadLibs() {
    if (global.html2canvas && global.jspdf) return Promise.resolve();
    if (libsLoading) return libsLoading;
    function loadScript(src) {
      return new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    libsLoading = loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js')
      .then(function () { return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'); });
    return libsLoading;
  }

  function downloadDoc() {
    init();
    if (!state) return;

    const inq = getLiveInquiry(state.inquiryId);
    const quoteNumber = (inq && inq.quoteNumber) || shortRef(state.inquiryId);

    // Render inside a fixed-width iframe (like Print) so the desktop
    // letterhead layout is always used for the PDF, regardless of the
    // actual device/screen width the user is downloading from.
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.top = '0';
    iframe.style.width = '760px';
    iframe.style.height = '600px';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Quotation</title>' +
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">' +
      '<style>' +
        'html,body{margin:0;padding:0;background:#fff;}' +
        'body{padding:24px;}' +
        '.zmq-doc{max-width:720px;margin:0 auto;box-shadow:none;}' +
      '</style>' +
      '<style>' + injectedStyleText + '</style>' +
      '</head><body>' + buildDocHTML() + '</body></html>'
    );
    doc.close();

    function cleanup() { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }

    setTimeout(function () {
      loadLibs().then(function () {
        const target = doc.querySelector('.zmq-doc');
        return global.html2canvas(target, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      }).then(function (canvas) {
        const jsPDFCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;

        // Real, correctly-sized A4 page (mm), with margins — the image is
        // scaled to fit the page width, and sliced across multiple pages
        // automatically if the document is taller than one A4 page.
        const pageWidthMM = 210, pageHeightMM = 297, marginMM = 10;
        const usableWidthMM = pageWidthMM - marginMM * 2;
        const usableHeightMM = pageHeightMM - marginMM * 2;
        const pxToMM = usableWidthMM / canvas.width;
        const imgHeightMM = canvas.height * pxToMM;

        const pdf = new jsPDFCtor({ unit: 'mm', format: 'a4' });

        if (imgHeightMM <= usableHeightMM) {
          const imgData = canvas.toDataURL('image/png');
          pdf.addImage(imgData, 'PNG', marginMM, marginMM, usableWidthMM, imgHeightMM);
        } else {
          const pageCanvasHeightPx = Math.floor(usableHeightMM / pxToMM);
          let renderedPx = 0;
          let first = true;
          while (renderedPx < canvas.height) {
            const sliceHeightPx = Math.min(pageCanvasHeightPx, canvas.height - renderedPx);
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = canvas.width;
            pageCanvas.height = sliceHeightPx;
            pageCanvas.getContext('2d').drawImage(
              canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx
            );
            const sliceData = pageCanvas.toDataURL('image/png');
            const sliceHeightMM = sliceHeightPx * pxToMM;
            if (!first) pdf.addPage();
            pdf.addImage(sliceData, 'PNG', marginMM, marginMM, usableWidthMM, sliceHeightMM);
            renderedPx += sliceHeightPx;
            first = false;
          }
        }

        pdf.save(String(quoteNumber).replace(/\//g, '-') + '.pdf');
      }).catch(function (e) {
        console.warn('Quotation download failed:', e);
      }).finally(cleanup);
    }, 200);
  }

  // ---------------------------------------------------------------
  // Customer-side "your quotation was updated" alert — a toast + sound,
  // fired the moment admin approves or re-prices a quotation, no matter
  // where on the site the shopper currently is (not just while the
  // document itself is open). This runs on every customer-facing page
  // since quotation.js is loaded on all of them; it's skipped on the
  // admin panel itself (detected via the #inqChatPanel element that only
  // exists in admin.html), which already sees its own changes directly.
  // ---------------------------------------------------------------
  function isAdminPage() {
    return !!document.getElementById('inqChatPanel');
  }

  function seenStatusKey() { return 'zm_quote_seen__' + getUserKey(); }
  function loadSeenStatus() {
    try { return JSON.parse(localStorage.getItem(seenStatusKey()) || '{}'); } catch (e) { return {}; }
  }
  function saveSeenStatus(map) {
    try { localStorage.setItem(seenStatusKey(), JSON.stringify(map)); } catch (e) {}
  }

  // Same two-tone chime used elsewhere on the site for new chat replies,
  // kept self-contained here so the alert works even on pages that don't
  // define their own sound helper.
  function playStatusChime() {
    try {
      const ctx = new (global.AudioContext || global.webkitAudioContext)();
      [880, 1100].forEach(function (freq, i) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
        g.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
        g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.25);
        o.start(ctx.currentTime + i * 0.12);
        o.stop(ctx.currentTime + i * 0.12 + 0.25);
      });
    } catch (e) {}
  }

  let toastWrapEl = null;
  function injectToastStyles() {
    if (document.getElementById('zmq-toast-style')) return;
    const s = document.createElement('style');
    s.id = 'zmq-toast-style';
    s.textContent =
      '.zmq-toast-wrap{position:fixed;top:16px;right:16px;z-index:100000;display:flex;flex-direction:column;gap:10px;max-width:340px;}' +
      '@media (max-width:520px){.zmq-toast-wrap{left:12px;right:12px;top:12px;max-width:none;}}' +
      '.zmq-toast{display:flex;align-items:flex-start;gap:11px;background:#fff;border:1px solid rgba(6,59,63,.1);' +
        'border-left:4px solid #FD4D02;border-radius:12px;padding:13px 14px;box-shadow:0 10px 30px -8px rgba(6,59,63,.28);' +
        'font-family:"Poppins",sans-serif;cursor:pointer;animation:zmqToastIn .35s cubic-bezier(.34,1.56,.64,1);}' +
      '.zmq-toast.zmq-approved{border-left-color:#0a9a60;}' +
      '.zmq-toast.zmq-completed{border-left:none;color:#fff;background:linear-gradient(135deg,#0a9a60,#063b3f,#FD4D02,#063b3f,#0a9a60);background-size:300% 300%;' +
        'animation:zmqToastIn .35s cubic-bezier(.34,1.56,.64,1),zmqCompletedGradient 6s ease infinite;box-shadow:0 10px 34px -8px rgba(6,59,63,.5);}' +
      '@keyframes zmqCompletedGradient{0%{background-position:0% 50%;}50%{background-position:100% 50%;}100%{background-position:0% 50%;}}' +
      '@keyframes zmqToastIn{from{transform:translateX(24px);opacity:0;}to{transform:translateX(0);opacity:1;}}' +
      '.zmq-toast-icon{width:34px;height:34px;border-radius:9px;flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
        'background:#fff2e8;color:#FD4D02;font-size:.95rem;}' +
      '.zmq-toast.zmq-approved .zmq-toast-icon{background:#eafaf1;color:#0a9a60;}' +
      '.zmq-toast.zmq-completed .zmq-toast-icon{background:rgba(255,255,255,.22);color:#fff;animation:zmqCheckPop .5s cubic-bezier(.34,1.56,.64,1) .1s both;}' +
      '@keyframes zmqCheckPop{0%{transform:scale(.4);opacity:0;}60%{transform:scale(1.18);opacity:1;}100%{transform:scale(1);}}' +
      '.zmq-toast-title{font-size:.82rem;font-weight:700;color:#063b3f;margin-bottom:2px;}' +
      '.zmq-toast-sub{font-size:.74rem;color:#6a8080;line-height:1.4;}' +
      '.zmq-toast-close{background:none;border:none;color:#b0c4c4;cursor:pointer;font-size:.8rem;padding:2px;flex-shrink:0;}' +
      '.zmq-toast-close:hover{color:#063b3f;}' +
      '.zmq-toast.zmq-completed .zmq-toast-title{color:#fff;}' +
      '.zmq-toast.zmq-completed .zmq-toast-sub{color:rgba(255,255,255,.88);}' +
      '.zmq-toast.zmq-completed .zmq-toast-close{color:rgba(255,255,255,.75);}' +
      '.zmq-toast.zmq-completed .zmq-toast-close:hover{color:#fff;}';
    document.head.appendChild(s);
  }

  function showStatusToast(entry, kind) {
    // kind: 'approved' | 'pending' | 'completed'
    injectToastStyles();
    if (!toastWrapEl || !toastWrapEl.parentNode) {
      toastWrapEl = document.createElement('div');
      toastWrapEl.className = 'zmq-toast-wrap';
      document.body.appendChild(toastWrapEl);
    }
    const qn = escapeHtml(entry.quoteNumber || '');
    const config = {
      approved:  { cls: 'zmq-approved',  icon: 'fa-circle-check', title: 'Quotation Approved!', sub: 'Your quotation ' + qn + ' has been approved. Tap to view.' },
      pending:   { cls: '',              icon: 'fa-clock',        title: 'Quotation Updated',   sub: 'Your quotation ' + qn + ' is pending review. Tap to view.' },
      completed: { cls: 'zmq-completed', icon: 'fa-circle-check', title: 'Order Completed!', sub: 'Your order ' + qn + ' has been marked as completed. Tap to view.' }
    };
    const c = config[kind] || config.pending;
    const el = document.createElement('div');
    el.className = 'zmq-toast' + (c.cls ? ' ' + c.cls : '');
    el.innerHTML =
      '<div class="zmq-toast-icon"><i class="fa-solid ' + c.icon + '"></i></div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div class="zmq-toast-title">' + c.title + '</div>' +
        '<div class="zmq-toast-sub">' + c.sub + '</div></div>' +
      '<button class="zmq-toast-close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>';
    el.querySelector('.zmq-toast-close').addEventListener('click', function (ev) {
      ev.stopPropagation(); el.remove();
    });
    el.addEventListener('click', function () { viewHistoryEntry(entry.inquiryId); el.remove(); });
    toastWrapEl.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 8000);
  }

  function checkStatusChanges() {
    if (isAdminPage() || !global.InquirySystem) return;
    const seen = loadSeenStatus();
    const list = getHistory();
    let changed = false;
    list.forEach(function (entry) {
      const prevRaw = seen[entry.inquiryId];
      const prevKnown = prevRaw !== undefined;
      // Old format stored just the statusKey as a plain string — treat that
      // as "completed not yet tracked" so upgrading never misfires a toast.
      const prev = (prevRaw && typeof prevRaw === 'object') ? prevRaw : { statusKey: prevRaw, completed: false };

      // Only alert on a real transition into a priced state (pending/approved)
      // that we've genuinely seen change since last time — never on the very
      // first time we notice an entry, so opening the site fresh never spams.
      if (prevKnown && prev.statusKey !== entry.statusKey &&
          (entry.statusKey === 'approved' || entry.statusKey === 'pending')) {
        showStatusToast(entry, entry.statusKey === 'approved' ? 'approved' : 'pending');
        playStatusChime();
      }

      // Order-completed transition is tracked separately from pricing status —
      // fires once, the moment admin flips the order to Completed.
      if (prevKnown && !prev.completed && entry.completed) {
        showStatusToast(entry, 'completed');
        playStatusChime();
      }

      if (!prevKnown || prev.statusKey !== entry.statusKey || prev.completed !== entry.completed) {
        seen[entry.inquiryId] = { statusKey: entry.statusKey, completed: entry.completed };
        changed = true;
      }
    });
    if (changed) saveSeenStatus(seen);
  }

  let _statusWatchStarted = false;
  function startStatusWatch() {
    if (_statusWatchStarted || isAdminPage()) return;
    _statusWatchStarted = true;
    setTimeout(checkStatusChanges, 1500); // give the first Firestore snapshot a moment to land
    if (global.InquirySystem && global.InquirySystem.on) {
      global.InquirySystem.on('inquiries-updated', function () {
        setTimeout(checkStatusChanges, 300);
      });
    }
  }

  global.ZamiQuotation = {
    setData: setData,
    loadFromInquiry: loadFromInquiry,
    openView: openView,
    closeView: closeView,
    print: printDoc,
    download: downloadDoc,
    icon: quoteIconSVG,
    getHistory: getHistory,
    viewHistoryEntry: viewHistoryEntry
  };

  // Inject styles + modal shell right away so the thank-you screen's
  // buttons are styled correctly even before any of them is clicked.
  function boot() { try { init(); startStatusWatch(); } catch (e) { console.warn('ZamiQuotation init failed:', e); } }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
