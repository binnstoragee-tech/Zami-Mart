/**
 * Zami Mart — Customer Quotation Module
 * Renders a "Quotation" document (view / print / download) from the items
 * that were just submitted via the cart inquiry, replacing the old
 * "Keep Browsing" single button on the thank-you screen.
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
  // Quotation History — a lightweight local log of quotations the
  // shopper has generated, so the cart can show "past orders" without
  // needing a server round-trip. Newest first, capped at 20 entries.
  // Scoped per logged-in account (uid/email) so it survives refresh,
  // disappears on logout, and comes back when that same account logs
  // back in. Signed-out visitors get their own separate "guest" bucket.
  // ---------------------------------------------------------------
  var HISTORY_MAX = 20;
  var LEGACY_HISTORY_KEY = 'zm_quote_history'; // pre-account-scoping key

  function getUserKey() {
    try {
      var u = window.fb && window.fb.auth ? window.fb.auth.currentUser : null;
      if (u) return u.uid || u.email || 'guest';
    } catch (e) {}
    return 'guest';
  }
  function historyKey() { return 'zm_quote_history__' + getUserKey(); }

  function loadHistoryList() {
    try {
      var key = historyKey();
      var raw = localStorage.getItem(key);
      if (raw == null) {
        // One-time migration: move any old, unscoped history into the
        // guest bucket so nobody loses quotations from before this update.
        var legacy = localStorage.getItem(LEGACY_HISTORY_KEY);
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
  function addToHistory(entry) {
    try {
      var list = loadHistoryList();
      list.unshift(entry);
      if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
      saveHistoryList(list);
      window.dispatchEvent(new CustomEvent('zm-quote-history-updated'));
    } catch (e) {}
  }
  function getHistory() { return loadHistoryList(); }
  function findHistoryEntry(quoteNumber) {
    var list = loadHistoryList();
    for (var i = 0; i < list.length; i++) { if (list[i].quoteNumber === quoteNumber) return list[i]; }
    return null;
  }
  function viewHistoryEntry(quoteNumber) {
    var entry = findHistoryEntry(quoteNumber);
    if (!entry) return;
    state = {
      quoteNumber: entry.quoteNumber,
      items: entry.items,
      customerName: entry.customerName,
      customerContact: entry.customerContact,
      dateStr: entry.dateStr,
      genStr: entry.genStr
    };
    init();
    bodyEl.innerHTML = buildDocHTML();
    overlayEl.classList.add('open');
  }

  // Re-render whatever's listening (cart drawers) the moment the login
  // state changes, so history swaps to the right account instantly —
  // no page refresh needed.
  (function watchAuthForHistory() {
    var lastKey = null;
    function notifyIfChanged() {
      var k = getUserKey();
      if (k === lastKey) return;
      lastKey = k;
      try { window.dispatchEvent(new CustomEvent('zm-quote-history-updated')); } catch (e) {}
    }
    function attach() {
      try { window.fb.onAuthStateChanged(window.fb.auth, notifyIfChanged); } catch (e) {}
    }
    if (window.fb && window.fb.auth) attach();
    else window.addEventListener('fb-ready', attach, { once: true });
  })();

  // Look up a display "code" for a product by name from the seeded catalog.
  // Falls back to a stable pseudo-code derived from the name so the column
  // always has something consistent to show.
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

  function nextQuoteNumber() {
    const year = new Date().getFullYear();
    const KEY = 'zm_quote_counter_' + year;
    let n = 1;
    try { n = parseInt(localStorage.getItem(KEY) || '0', 10) + 1; } catch (e) {}
    try { localStorage.setItem(KEY, String(n)); } catch (e) {}
    return 'ZM/QUO/' + year + '/' + pad(n, 4);
  }

  let state = null; // { quoteNumber, items, customerName, customerContact, dateStr, genStr }

  function setData(data) {
    const now = new Date();
    state = {
      quoteNumber: nextQuoteNumber(),
      items: (data.items || []).map(function (it) { return { name: it.name, qty: it.qty }; }),
      customerName: (data.customerName && data.customerName !== 'Guest') ? data.customerName : 'Guest Customer',
      customerContact: data.customerContact || '',
      dateStr: now.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }),
      genStr: now.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    };
    addToHistory({
      quoteNumber: state.quoteNumber,
      items: state.items,
      customerName: state.customerName,
      customerContact: state.customerContact,
      dateStr: state.dateStr,
      genStr: state.genStr,
      itemCount: state.items.reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0)
    });
    return state.quoteNumber;
  }

  function buildDocHTML() {
    if (!state) return '';
    const rows = state.items.map(function (it, i) {
      return (
        '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + escapeHtml(it.name) + '</td>' +
          '<td>' + getProductCode(it.name) + '</td>' +
          '<td>' + it.qty + '</td>' +
          '<td class="zmq-pending">Pending</td>' +
          '<td class="zmq-pending">Pending</td>' +
        '</tr>'
      );
    }).join('');

    return (
      '<div class="zmq-doc">' +
        '<div class="zmq-head">' +
          '<div>' +
            '<div class="zmq-title">Quotation</div>' +
            '<div class="zmq-badge">PENDING APPROVAL</div>' +
          '</div>' +
          '<div class="zmq-brand">' +
            '<div class="zmq-logo"><img src="img/logo.png" alt="Zami Mart" /></div>' +
            '<div>' +
              '<div class="zmq-brandname">ZamiMart</div>' +
              '<div class="zmq-brandsub">Male&#39;, Maldives &middot; Zamimart.g3@gmail.com</div>' +
              '<div class="zmq-brandsub">+960 9906025</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="zmq-meta">' +
          '<div>' +
            '<div class="zmq-label">DETAILS</div>' +
            '<div class="zmq-row"><span>Number</span><b>' + escapeHtml(state.quoteNumber) + '</b></div>' +
            '<div class="zmq-row"><span>Date</span><b>' + escapeHtml(state.dateStr) + '</b></div>' +
            '<div class="zmq-row"><span>Status</span><b>Pending</b></div>' +
          '</div>' +
          '<div>' +
            '<div class="zmq-label">CUSTOMER</div>' +
            '<div class="zmq-row"><span>Name</span><b>' + escapeHtml(state.customerName) + '</b></div>' +
            '<div class="zmq-row"><span>Contact</span><b>' + (state.customerContact ? escapeHtml(state.customerContact) : '&mdash;') + '</b></div>' +
          '</div>' +
        '</div>' +
        '<div class="zmq-table-wrap"><table class="zmq-table">' +
          '<thead><tr><th>#</th><th>DESCRIPTION</th><th>CODE</th><th>QTY</th><th>UNIT PRICE</th><th>TOTAL</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
        '<div class="zmq-notice">' +
          '<i class="fa-solid fa-circle-exclamation"></i>' +
          '<div>' +
            '<b>Awaiting admin approval</b>' +
            '<div>Pricing will be added once our team reviews and confirms this order. You\'ll be notified once it\'s ready.</div>' +
          '</div>' +
        '</div>' +
        '<div class="zmq-terms">' +
          '<div class="zmq-label">TERMS &amp; CONDITIONS</div>' +
          '<ul>' +
            '<li>This document confirms the items and quantities you requested. Please check details carefully.</li>' +
            '<li>Pricing and availability will be confirmed by our team before this quotation is finalized.</li>' +
            '<li>Please review item quantities and specifications before confirming your order.</li>' +
            '<li>This quotation is considered accepted if no concerns are raised upon confirmation.</li>' +
            '<li>Contact us at +960 9906025 for any questions.</li>' +
          '</ul>' +
        '</div>' +
        '<div class="zmq-footer">' +
          '<span>Generated automatically by Zami Mart</span>' +
          '<span>Generated ' + escapeHtml(state.genStr) + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------
  // Styles + modal (injected once)
  // ---------------------------------------------------------------
  let inited = false;
  let overlayEl, bodyEl;

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = [
      '.ty-actions{display:flex;flex-direction:column;align-items:center;gap:.6rem;width:100%;}',
      '.ty-secondary-row{display:flex;gap:.6rem;}',
      '.ty-secondary-btn{padding:9px 20px;background:#fff;color:var(--teal,#063B3F);border:1.5px solid rgba(6,59,63,.18);border-radius:12px;font-family:var(--font-body,inherit);font-size:.82rem;font-weight:700;cursor:pointer;transition:all .18s;}',
      '.ty-secondary-btn:hover{background:rgba(6,59,63,.06);border-color:var(--teal,#063B3F);}',
      '.zmq-overlay{position:fixed;inset:0;z-index:99999;background:rgba(6,20,20,.55);display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px);}',
      '.zmq-overlay.open{display:flex;}',
      '.zmq-panel{background:#f4f6f5;border-radius:16px;max-width:560px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px -12px rgba(0,0,0,.35);overflow:hidden;}',
      '.zmq-panel-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#fff;border-bottom:1px solid rgba(6,59,63,.08);}',
      '.zmq-panel-head span{font-weight:800;color:var(--teal,#063B3F);font-size:.95rem;}',
      '.zmq-close{background:rgba(6,59,63,.08);border:none;width:30px;height:30px;border-radius:50%;color:var(--teal,#063B3F);cursor:pointer;font-size:.85rem;}',
      '.zmq-close:hover{background:rgba(6,59,63,.16);}',
      '.zmq-panel-body{overflow-y:auto;padding:18px;}',
      '.zmq-panel-actions{display:flex;gap:10px;padding:14px 18px;background:#fff;border-top:1px solid rgba(6,59,63,.08);}',
      '.zmq-panel-actions button{flex:1;padding:10px;border-radius:10px;border:none;font-weight:700;font-size:.85rem;cursor:pointer;font-family:var(--font-body,inherit);}',
      '.zmq-panel-actions .zmq-print-btn{background:#fff;border:1.5px solid rgba(6,59,63,.18);color:var(--teal,#063B3F);}',
      '.zmq-panel-actions .zmq-print-btn:hover{background:rgba(6,59,63,.06);}',
      '.zmq-panel-actions .zmq-download-btn{background:linear-gradient(135deg,#063b3f,#0a5a62);color:#fff;}',
      '.zmq-panel-actions .zmq-download-btn:hover{opacity:.92;}',
      '.zmq-doc{background:#fff;border-radius:12px;padding:26px;font-family:var(--font-body,-apple-system,sans-serif);color:#1e2b2b;box-shadow:0 1px 3px rgba(0,0,0,.08);}',
      '.zmq-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid rgba(6,59,63,.1);padding-bottom:16px;margin-bottom:16px;}',
      '.zmq-title{font-size:1.3rem;font-weight:800;color:var(--teal,#063B3F);border-left:4px solid #fd4d02;padding-left:10px;margin-bottom:6px;}',
      '.zmq-badge{display:inline-block;margin-left:14px;background:#fff2e8;color:#c9530a;font-size:.68rem;font-weight:800;letter-spacing:.03em;padding:3px 10px;border-radius:100px;}',
      '.zmq-brand{display:flex;align-items:center;gap:10px;}',
      '.zmq-logo{width:34px;height:34px;border-radius:9px;background:#fff;border:1px solid rgba(6,59,63,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;}',
      '.zmq-logo img{width:100%;height:100%;object-fit:contain;}',
      '.zmq-brandname{font-weight:800;color:var(--teal,#063B3F);font-size:.95rem;}',
      '.zmq-brandsub{font-size:.68rem;color:#7a8f8f;}',
      '.zmq-meta{display:flex;justify-content:space-between;gap:24px;margin-bottom:18px;flex-wrap:wrap;}',
      '.zmq-label{font-size:.66rem;font-weight:800;letter-spacing:.06em;color:#8a9f9f;margin-bottom:6px;}',
      '.zmq-row{display:flex;gap:8px;font-size:.78rem;color:#4a5f5f;margin-bottom:3px;}',
      '.zmq-row span{min-width:56px;color:#8a9f9f;}',
      '.zmq-row b{color:#1e2b2b;font-weight:700;}',
      '.zmq-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:16px;}',
      '.zmq-table{width:100%;border-collapse:collapse;font-size:.78rem;}',
      '.zmq-table thead th{text-align:left;background:rgba(6,59,63,.04);color:#5a7070;font-size:.65rem;letter-spacing:.04em;padding:8px 8px;border-bottom:1px solid rgba(6,59,63,.08);}',
      '.zmq-table td{padding:8px 8px;border-bottom:1px solid rgba(6,59,63,.06);vertical-align:top;}',
      '.zmq-pending{color:#c9530a;font-style:italic;}',
      '.zmq-notice{display:flex;gap:10px;background:#fff8ee;border-left:3px solid #f0b429;border-radius:8px;padding:12px 14px;font-size:.75rem;color:#6a5a30;margin-bottom:18px;}',
      '.zmq-notice i{color:#e09a12;margin-top:2px;}',
      '.zmq-notice b{display:block;color:#4a3f1c;margin-bottom:2px;}',
      '.zmq-terms ul{margin:6px 0 0;padding-left:18px;}',
      '.zmq-terms li{font-size:.72rem;color:#6a8080;margin-bottom:4px;line-height:1.5;}',
      '.zmq-footer{display:flex;justify-content:space-between;font-size:.66rem;color:#a0b0b0;border-top:1px solid rgba(6,59,63,.08);margin-top:18px;padding-top:12px;}',
      '@media (max-width: 480px) {',
        '.zmq-overlay{padding:0;}',
        '.zmq-panel{max-width:100%;width:100%;height:100%;max-height:100%;border-radius:0;}',
        '.zmq-panel-head{padding:12px 14px;}',
        '.zmq-panel-body{padding:14px;}',
        '.zmq-panel-actions{padding:12px 14px;}',
        '.zmq-doc{padding:16px;border-radius:8px;}',
        '.zmq-head{flex-direction:column;align-items:flex-start;gap:12px;}',
        '.zmq-badge{margin-left:0;}',
        '.zmq-meta{flex-direction:column;gap:14px;}',
        '.zmq-table{font-size:.7rem;}',
        '.zmq-table thead th{padding:6px;}',
        '.zmq-table td{padding:6px;}',
        '.zmq-footer{flex-direction:column;gap:4px;}',
      '}'
    ].join('\n');
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

  function init() {
    if (inited) return;
    inited = true;
    injectStyles();
    injectModal();
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
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + escapeHtml(state.quoteNumber) + '</title>' +
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">' +
      '<style>body{margin:0;padding:24px;background:#fff;}' +
      '.zmq-doc{max-width:640px;margin:0 auto;font-family:-apple-system,sans-serif;color:#1e2b2b;}' +
      '.zmq-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #d8e2e2;padding-bottom:16px;margin-bottom:16px;}' +
      '.zmq-title{font-size:1.3rem;font-weight:800;color:#063B3F;border-left:4px solid #fd4d02;padding-left:10px;margin-bottom:6px;}' +
      '.zmq-badge{display:inline-block;margin-left:14px;background:#fff2e8;color:#c9530a;font-size:.68rem;font-weight:800;letter-spacing:.03em;padding:3px 10px;border-radius:100px;}' +
      '.zmq-brand{display:flex;align-items:center;gap:10px;}' +
      '.zmq-logo{width:34px;height:34px;border-radius:9px;background:#fff;border:1px solid rgba(6,59,63,.1);display:flex;align-items:center;justify-content:center;overflow:hidden;}' +
      '.zmq-logo img{width:100%;height:100%;object-fit:contain;}' +
      '.zmq-brandname{font-weight:800;color:#063B3F;font-size:.95rem;}' +
      '.zmq-brandsub{font-size:.68rem;color:#7a8f8f;}' +
      '.zmq-meta{display:flex;justify-content:space-between;gap:24px;margin-bottom:18px;}' +
      '.zmq-label{font-size:.66rem;font-weight:800;letter-spacing:.06em;color:#8a9f9f;margin-bottom:6px;}' +
      '.zmq-row{display:flex;gap:8px;font-size:.78rem;color:#4a5f5f;margin-bottom:3px;}' +
      '.zmq-row span{min-width:56px;color:#8a9f9f;}' +
      '.zmq-row b{color:#1e2b2b;font-weight:700;}' +
      '.zmq-table-wrap{overflow-x:auto;margin-bottom:16px;}' +
      '.zmq-table{width:100%;border-collapse:collapse;font-size:.78rem;}' +
      '.zmq-table thead th{text-align:left;background:#f2f6f5;color:#5a7070;font-size:.65rem;letter-spacing:.04em;padding:8px;border-bottom:1px solid #e0e8e8;}' +
      '.zmq-table td{padding:8px;border-bottom:1px solid #eef2f2;}' +
      '.zmq-pending{color:#c9530a;font-style:italic;}' +
      '.zmq-notice{display:flex;gap:10px;background:#fff8ee;border-left:3px solid #f0b429;border-radius:8px;padding:12px 14px;font-size:.75rem;color:#6a5a30;margin-bottom:18px;}' +
      '.zmq-notice b{display:block;color:#4a3f1c;margin-bottom:2px;}' +
      '.zmq-terms ul{margin:6px 0 0;padding-left:18px;}' +
      '.zmq-terms li{font-size:.72rem;color:#6a8080;margin-bottom:4px;line-height:1.5;}' +
      '.zmq-footer{display:flex;justify-content:space-between;font-size:.66rem;color:#a0b0b0;border-top:1px solid #e0e8e8;margin-top:18px;padding-top:12px;}' +
      '@media print{body{padding:0;}}' +
      '</style></head><body>' + buildDocHTML() + '</body></html>'
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

    const holder = document.createElement('div');
    holder.style.position = 'fixed';
    holder.style.left = '-9999px';
    holder.style.top = '0';
    holder.style.width = '640px';
    holder.innerHTML = buildDocHTML();
    document.body.appendChild(holder);

    loadLibs().then(function () {
      return global.html2canvas(holder.firstChild, { scale: 2, backgroundColor: '#ffffff' });
    }).then(function (canvas) {
      const imgData = canvas.toDataURL('image/png');
      const jsPDFCtor = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
      const pdf = new jsPDFCtor({ unit: 'px', format: [canvas.width, canvas.height] });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(state.quoteNumber.replace(/\//g, '-') + '.pdf');
    }).catch(function (e) {
      console.warn('Quotation download failed:', e);
    }).finally(function () {
      if (holder.parentNode) holder.parentNode.removeChild(holder);
    });
  }

  global.ZamiQuotation = {
    setData: setData,
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
  function boot() { try { init(); } catch (e) { console.warn('ZamiQuotation init failed:', e); } }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
