// ============================================
// ZAMI MART — catalog search & filter
// ============================================

document.addEventListener('DOMContentLoaded', () => {

  // ============================================
  // Injected styles + helper: "Added to cart" toast
  // and the Add-button <-> quantity-stepper swap.
  // ============================================
  (function injectCartCtrlStyles() {
    if (document.getElementById('zmCartCtrlStyle')) return;
    const s = document.createElement('style');
    s.id = 'zmCartCtrlStyle';
    s.textContent = `
      .product-cart-ctrl{ display:flex; align-items:center; gap:8px; margin-left:auto; }
      .product-add-btn:disabled{ opacity:.5; cursor:not-allowed; }
      .product-add-btn:disabled:hover{ transform:none; }
      .item-tag[data-price] .product-cart-ctrl{ margin-left:0; }

      @keyframes zmCtrlPopIn{
        0%{ transform:scale(.4); opacity:0; }
        60%{ transform:scale(1.12); opacity:1; }
        100%{ transform:scale(1); }
      }
      .product-qty-stepper{
        display:none; align-items:center; gap:2px;
        background: var(--teal);
        border-radius:100px;
        padding:4px;
      }
      .product-qty-stepper.pop-in{ animation: zmCtrlPopIn .32s cubic-bezier(.34,1.56,.64,1); }
      .pq-btn{
        width:24px; height:24px; border-radius:50%;
        background:transparent; border:none; color:#fff;
        display:flex; align-items:center; justify-content:center;
        font-size:.62rem; cursor:pointer;
        transition: background .2s, transform .15s;
      }
      .pq-btn:hover{ background: rgba(255,255,255,.2); }
      .pq-btn:active{ transform: scale(.82); }
      .pq-val{
        min-width:18px; text-align:center;
        font-size:.8rem; font-weight:800; color:#fff;
        font-family: var(--font-display);
      }

      #zmAddToast{
        position:fixed; left:50%; bottom:28px;
        transform:translateX(-50%) translateY(16px);
        z-index:999999;
        display:flex; align-items:center; gap:10px;
        background: var(--teal);
        color:#fff;
        padding:11px 18px 11px 12px;
        border-radius:100px;
        box-shadow:0 16px 40px -10px rgba(6,59,63,.5);
        font-family:'Poppins',sans-serif;
        font-size:.82rem; font-weight:600;
        opacity:0; pointer-events:none;
        max-width:min(360px,90vw);
        transition: opacity .25s ease, transform .3s cubic-bezier(.34,1.56,.64,1);
      }
      #zmAddToast.show{ opacity:1; transform:translateX(-50%) translateY(0); }
      #zmAddToast .zat-icon{
        width:24px; height:24px; border-radius:50%; flex-shrink:0;
        background: linear-gradient(135deg,#2ecc71,#0a9a60);
        display:flex; align-items:center; justify-content:center;
      }
      #zmAddToast.show .zat-icon{ animation: zmCtrlPopIn .4s cubic-bezier(.34,1.56,.64,1) .05s both; }
      #zmAddToast .zat-icon i{ font-size:.62rem; color:#fff; }
      #zmAddToast .zat-text{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      @media (max-width:480px){ #zmAddToast{ bottom:18px; font-size:.78rem; } }
    `;
    document.head.appendChild(s);
  })();

  let zmAddToastTimer = null;
  function showAddedToast(productName) {
    let toast = document.getElementById('zmAddToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zmAddToast';
      toast.innerHTML = '<span class="zat-icon"><i class="fa-solid fa-check"></i></span><span class="zat-text"></span>';
      document.body.appendChild(toast);
    }
    toast.querySelector('.zat-text').textContent = `Added "${productName}" to cart`;
    toast.classList.remove('show');
    // force reflow so the animation restarts if triggered again quickly
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(zmAddToastTimer);
    zmAddToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  // ============================================
  // Admin-linked stock lookup. Reads the same localStorage
  // key the admin dashboard (admin.html) saves products to
  // ('zm_products'), matches by product name, and applies
  // the exact same thresholds admin uses:
  //   qty > 10  -> in stock
  //   qty 1-10  -> low stock
  //   qty === 0 -> out of stock
  //   qty blank/unset -> no badge shown
  // Falls back to a manual data-stock="in|low|out" attribute
  // on the .item-tag (if present) when no admin match is found,
  // so the badge still works for hand-authored product tags.
  // ============================================
  function getAdminStockStatus(productName) {
    try {
      const raw = localStorage.getItem('zm_products');
      if (!raw) return null;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return null;
      const norm = s => (s || '').toString().trim().toLowerCase();
      const match = list.find(p => norm(p.name) === norm(productName));
      if (!match) return null;
      if (match.stock === '' || match.stock === undefined || match.stock === null) return null;
      const qty = parseInt(match.stock);
      if (isNaN(qty)) return null;
      if (qty <= 0) return 'out';
      if (qty <= 10) return 'low';
      return 'in';
    } catch (e) {
      return null;
    }
  }

  // ============================================
  // Enhance product cards: category label + structured
  // body (SKU / price / stock badge render only once that
  // data exists — set via data-sku / data-price / data-unit /
  // data-stock="in|low" attributes on the .item-tag element)
  // ============================================
  document.querySelectorAll('.cat-block').forEach(block => {
    const catNameEl = block.querySelector('.cat-block-head h2');
    const catName = catNameEl ? catNameEl.textContent.trim() : '';

    block.querySelectorAll('.item-tag').forEach(tag => {
      if (tag.querySelector('.product-body')) return; // already enhanced

      const imgWrap = tag.querySelector('.product-img-wrap');
      const nameEl = tag.querySelector('.product-name');
      if (!nameEl) return;

      const body = document.createElement('div');
      body.className = 'product-body';

      const catLabel = document.createElement('div');
      catLabel.className = 'product-cat';
      catLabel.textContent = catName;
      body.appendChild(catLabel);

      body.appendChild(nameEl);

      const skuEl = document.createElement('div');
      skuEl.className = 'product-sku';
      if (tag.dataset.sku) skuEl.textContent = `SKU ${tag.dataset.sku}`;
      body.appendChild(skuEl);

      const footer = document.createElement('div');
      footer.className = 'product-footer';

      // ---- Add button <-> quantity stepper control ----
      const productName = nameEl.textContent.trim();

      // Stock status — driven by the admin-set stock quantity
      // (falls back to a manual data-stock attribute if no admin record found).
      const stockStatus = getAdminStockStatus(productName) || tag.dataset.stock || null;

      if (stockStatus === 'out') {
        // Out of stock: just one centered "Unavailable" pill, no badge,
        // no Add/quantity controls (there's nothing to add to cart).
        footer.classList.add('is-unavailable');
        const unavailableEl = document.createElement('div');
        unavailableEl.className = 'product-unavailable';
        unavailableEl.innerHTML = '<i class="fa-solid fa-ban"></i><span>Unavailable</span>';
        footer.appendChild(unavailableEl);
        body.appendChild(footer);
        tag.appendChild(body);
        return;
      }

      const footerLeft = document.createElement('div');
      footerLeft.className = 'product-footer-left';

      const priceEl = document.createElement('div');
      priceEl.className = 'product-price';
      if (tag.dataset.price) {
        priceEl.innerHTML = `MVR ${tag.dataset.price}` + (tag.dataset.unit ? `<span> / ${tag.dataset.unit}</span>` : '');
      }
      footerLeft.appendChild(priceEl);

      // Stock badge — sits on the left of the footer, directly across
      // from the Add button.
      if (stockStatus === 'in' || stockStatus === 'low') {
        const stockBadge = document.createElement('span');
        stockBadge.className = 'stock-badge stock-' + stockStatus;
        stockBadge.textContent = stockStatus === 'low' ? 'Low Stock' : 'In Stock';
        footerLeft.appendChild(stockBadge);
      }

      footer.appendChild(footerLeft);

      const ctrl = document.createElement('div');
      ctrl.className = 'product-cart-ctrl';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'product-add-btn';
      addBtn.innerHTML = '<span>Add</span><i class="fa-solid fa-cart-plus"></i>';

      const stepper = document.createElement('div');
      stepper.className = 'product-qty-stepper';
      stepper.innerHTML =
        '<button type="button" class="pq-btn pq-dec" aria-label="Decrease quantity"><i class="fa-solid fa-minus"></i></button>' +
        '<span class="pq-val">1</span>' +
        '<button type="button" class="pq-btn pq-inc" aria-label="Increase quantity"><i class="fa-solid fa-plus"></i></button>';

      ctrl.appendChild(addBtn);
      ctrl.appendChild(stepper);
      footer.appendChild(ctrl);

      const decBtn = stepper.querySelector('.pq-dec');
      const incBtn = stepper.querySelector('.pq-inc');
      const valEl = stepper.querySelector('.pq-val');

      function syncCtrl() {
        const item = window.ZMCart ? window.ZMCart.getItem(productName) : null;
        if (item) {
          valEl.textContent = item.qty;
          stepper.style.display = 'flex';
          addBtn.style.display = 'none';
        } else {
          stepper.style.display = 'none';
          addBtn.style.display = 'flex';
        }
      }

      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!window.ZMCart) return;
        const img = imgWrap ? imgWrap.querySelector('img') : null;
        const productImg = (img && !imgWrap.classList.contains('no-img')) ? img.src : null;
        const ok = window.ZMCart.addItem(productName, productImg);
        if (ok) {
          showAddedToast(productName);
          syncCtrl();
          stepper.classList.add('pop-in');
          setTimeout(() => stepper.classList.remove('pop-in'), 320);
        }
      });

      decBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!window.ZMCart) return;
        const item = window.ZMCart.getItem(productName);
        if (!item) return;
        window.ZMCart.setQty(productName, item.qty - 1);
        syncCtrl();
      });

      incBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!window.ZMCart) return;
        const item = window.ZMCart.getItem(productName);
        if (!item) return;
        window.ZMCart.setQty(productName, item.qty + 1);
        syncCtrl();
      });

      syncCtrl();

      body.appendChild(footer);
      tag.appendChild(body);
    });
  });

  const filterBtns = document.querySelectorAll('.filter-btn');
  const catBlocks = document.querySelectorAll('.cat-block');

  // Sticky category panel — done manually via scroll listener because
  // overflow-x:hidden on html/body (used site-wide for page transitions)
  // breaks native position:sticky in most browsers.
  (function initStickySidebar() {
    const panel = document.getElementById('catFilterPanel');
    const sidebar = document.querySelector('.catalog-sidebar');
    const main = document.querySelector('.catalog-main');
    if (!panel || !sidebar || !main) return;

    const TOP_OFFSET = 100;
    let ticking = false;

    function update() {
      ticking = false;

      if (window.innerWidth <= 980) {
        panel.style.position = '';
        panel.style.top = '';
        panel.style.left = '';
        panel.style.width = '';
        return;
      }

      const sidebarRect = sidebar.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const panelHeight = panel.offsetHeight;

      const sidebarTopAbs = sidebarRect.top + window.scrollY;
      const mainBottomAbs = mainRect.bottom + window.scrollY;
      const scrollTop = window.scrollY + TOP_OFFSET;

      if (scrollTop >= sidebarTopAbs && scrollTop + panelHeight < mainBottomAbs) {
        panel.style.position = 'fixed';
        panel.style.top = TOP_OFFSET + 'px';
        panel.style.left = sidebarRect.left + 'px';
        panel.style.width = sidebarRect.width + 'px';
      } else if (scrollTop + panelHeight >= mainBottomAbs) {
        panel.style.position = 'absolute';
        panel.style.left = '0px';
        panel.style.top = (mainBottomAbs - sidebarTopAbs - panelHeight) + 'px';
        panel.style.width = sidebarRect.width + 'px';
      } else {
        panel.style.position = '';
        panel.style.top = '';
        panel.style.left = '';
        panel.style.width = '';
      }
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    update();
  })();

  // Mobile Categories drawer (slide-in, like the Outright sample)
  const catFilterPanel = document.getElementById('catFilterPanel');
  const catFilterToggle = document.getElementById('catFilterToggle');
  const zmCatDrawerOverlay = document.getElementById('zmCatDrawerOverlay');
  const zmCatDrawerClose = document.getElementById('zmCatDrawerClose');
  const zmCatDrawerBody = document.getElementById('zmCatDrawerBody');
  const catFiltersList = document.getElementById('catFilters');

  function openCatDrawer() {
    if (catFiltersList && zmCatDrawerBody && catFiltersList.parentElement !== zmCatDrawerBody) {
      zmCatDrawerBody.appendChild(catFiltersList);
    }
    if (zmCatDrawerOverlay) zmCatDrawerOverlay.classList.add('open');
    if (catFilterPanel) catFilterPanel.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeCatDrawer() {
    if (zmCatDrawerOverlay) zmCatDrawerOverlay.classList.remove('open');
    if (catFilterPanel) catFilterPanel.classList.remove('open');
    document.body.style.overflow = '';
  }

  function restoreCatFiltersList() {
    if (catFiltersList && catFilterPanel && catFiltersList.parentElement !== catFilterPanel) {
      catFilterPanel.appendChild(catFiltersList);
    }
  }

  if (catFilterToggle && zmCatDrawerOverlay) {
    catFilterToggle.addEventListener('click', () => {
      if (window.innerWidth > 760) return;
      if (zmCatDrawerOverlay.classList.contains('open')) {
        closeCatDrawer();
      } else {
        openCatDrawer();
      }
    });
    if (zmCatDrawerClose) zmCatDrawerClose.addEventListener('click', closeCatDrawer);
    zmCatDrawerOverlay.addEventListener('click', e => {
      if (e.target === zmCatDrawerOverlay) closeCatDrawer();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeCatDrawer();
    });

    const catDrawerMq = window.matchMedia('(max-width: 760px)');
    catDrawerMq.addEventListener('change', e => {
      if (!e.matches) {
        closeCatDrawer();
        restoreCatFiltersList();
      }
    });
  }

  // On mobile, the search box + Categories toggle sit together in a
  // toolbar placed right after the currently-visible category's header
  // (icon/title/description), just above that category's products.
  const mobileToolbarSidebar = document.querySelector('.catalog-layout > .catalog-sidebar');
  const mobileToolbarLayout = document.querySelector('.catalog-layout');
  const mobileToolbarMain = document.querySelector('.catalog-layout > .catalog-main');
  const mobileToolbarFirstBlock = document.querySelector('#personal-care');
  const mobileToolbarSearch = document.querySelector('.cat-search');
  const mobileToolbarHeroContainer = document.querySelector('.page-hero .container');

  let catMobileToolbar = document.getElementById('catMobileToolbar');
  if (!catMobileToolbar) {
    catMobileToolbar = document.createElement('div');
    catMobileToolbar.id = 'catMobileToolbar';
    catMobileToolbar.className = 'cat-mobile-toolbar';
  }

  const mobileToolbarMq = window.matchMedia('(max-width: 980px)');
  let isCurrentlyMobileToolbar = null;

  // Finds whichever category block is currently on screen (not filtered
  // out) and drops the toolbar right after its header, before its
  // product grid — so it always follows that block's title, wherever
  // it happens to be in the filtered list.
  function repositionMobileToolbarInline() {
    if (!isCurrentlyMobileToolbar) return;
    const activeBlock = document.querySelector('.cat-block:not(.cat-hidden)') || mobileToolbarFirstBlock;
    if (!activeBlock) return;
    const head = activeBlock.querySelector('.cat-block-head');
    const inner = activeBlock.querySelector('.cat-block-inner') || activeBlock;
    if (head && head.parentNode) {
      head.insertAdjacentElement('afterend', catMobileToolbar);
    } else {
      inner.insertBefore(catMobileToolbar, inner.firstChild);
    }
  }

  function placeMobileToolbar(isMobile) {
    if (isCurrentlyMobileToolbar === isMobile) return;
    isCurrentlyMobileToolbar = isMobile;

    if (isMobile) {
      catMobileToolbar.appendChild(mobileToolbarSidebar);
      if (mobileToolbarSearch) catMobileToolbar.appendChild(mobileToolbarSearch);
      repositionMobileToolbarInline();
      mobileToolbarSidebar.classList.add('cat-filter-inline');
    } else {
      mobileToolbarLayout.insertBefore(mobileToolbarSidebar, mobileToolbarMain);
      mobileToolbarSidebar.classList.remove('cat-filter-inline');
      if (mobileToolbarSearch && mobileToolbarHeroContainer) mobileToolbarHeroContainer.appendChild(mobileToolbarSearch);
    }
  }

  if (mobileToolbarSidebar && mobileToolbarLayout && mobileToolbarMain && mobileToolbarFirstBlock) {
    placeMobileToolbar(mobileToolbarMq.matches);
    mobileToolbarMq.addEventListener('change', e => placeMobileToolbar(e.matches));
  }
  const searchInput = document.getElementById('productSearch');
  const noResults = document.getElementById('noResults');

  let activeFilter = 'all';

  function applyFilters() {
    const query = (searchInput.value || '').trim().toLowerCase();
    let anyVisible = false;

    catBlocks.forEach(block => {
      const cat = block.dataset.cat;
      const tags = block.querySelectorAll('.item-tag');
      let visibleInBlock = 0;

      tags.forEach(tag => {
        const nameEl = tag.querySelector('.product-name');
        const text = nameEl ? nameEl.textContent : tag.textContent;
        const matchesSearch = !query || text.toLowerCase().includes(query);
        if (matchesSearch) {
          tag.classList.remove('tag-hidden');
          visibleInBlock++;
        } else {
          tag.classList.add('tag-hidden');
        }
      });

      const matchesFilter = activeFilter === 'all' || activeFilter === cat;
      const showBlock = matchesFilter && visibleInBlock > 0;

      block.classList.toggle('cat-hidden', !showBlock);
      if (showBlock) anyVisible = true;
    });

    noResults.classList.toggle('show', !anyVisible);
    repositionMobileToolbarInline();
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      applyFilters();

      if (window.innerWidth <= 760) {
        closeCatDrawer();
      }

      if (activeFilter !== 'all') {
        const target = document.getElementById(activeFilter);
        // On mobile, the search+Categories toolbar sits right above whichever
        // category block is currently visible (hidden blocks collapse to
        // zero height). Scroll to the TOOLBAR instead of the block itself so
        // the search bar + Categories toggle stay visible together with the
        // category header, instead of getting scrolled out of view.
        const toolbarEl = document.getElementById('catMobileToolbar');
        const isMobileToolbar = window.innerWidth <= 980 && toolbarEl;
        const scrollTarget = isMobileToolbar ? toolbarEl : target;
        if (scrollTarget) {
          setTimeout(() => {
            scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 60);
        }
      }
    });
  });

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFilters, 120);
  });

  /* ============================================
     Product Viewer (zoom modal)
  ============================================ */
  const pvOverlay     = document.getElementById('pvOverlay');
  const pvStage       = document.getElementById('pvStage');
  const pvImgWrap     = document.getElementById('pvImgWrap');
  const pvImg         = document.getElementById('pvImg');
  const pvName        = document.getElementById('pvName');
  const pvClose       = document.getElementById('pvClose');
  const pvZoomIn      = document.getElementById('pvZoomIn');
  const pvZoomOut     = document.getElementById('pvZoomOut');
  const pvAddCartBtn  = document.getElementById('pvAddCartBtn');
  const pvRemoveBtn   = document.getElementById('pvRemoveBtn');
  const pvQtyCtrl     = document.getElementById('pvQtyCtrl');
  const pvUnavailable = document.getElementById('pvUnavailable');
  const pvQtyDec      = document.getElementById('pvQtyDec');
  const pvQtyInc      = document.getElementById('pvQtyInc');
  const pvQtyVal      = document.getElementById('pvQtyVal');
  const pvCartLoading = document.getElementById('pvCartLoading');
  const pvClBarFill   = document.getElementById('pvClBarFill');
  const pvBox         = document.querySelector('.pv-box');
  const pvSimilarGrid = document.getElementById('pvSimilarGrid');

  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;
  const ZOOM_STEP = 0.5;

  let scale = 1;
  let posX = 0, posY = 0;
  let dragging = false;
  let startX = 0, startY = 0;

  function setTransform() {
    pvImg.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
  }

  function resetView() {
    scale = 1;
    posX = 0;
    posY = 0;
    setTransform();
    pvStage.classList.remove('dragging');
    pvZoomOut.disabled = true;
    pvZoomIn.disabled = false;
  }

  function clampPos() {
    const maxOffset = (scale - 1) * (pvStage.offsetWidth / 2);
    posX = Math.max(-maxOffset, Math.min(maxOffset, posX));
    const maxOffsetY = (scale - 1) * (pvStage.offsetHeight / 2);
    posY = Math.max(-maxOffsetY, Math.min(maxOffsetY, posY));
  }

  function zoomBy(delta) {
    const newScale = Math.round((scale + delta) * 100) / 100;
    scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
    if (scale === ZOOM_MIN) { posX = 0; posY = 0; }
    clampPos();
    setTransform();
    pvZoomOut.disabled = scale <= ZOOM_MIN;
    pvZoomIn.disabled = scale >= ZOOM_MAX;

  }

  // Track current product open in viewer
  let pvCurrentProduct = { name: null, img: null };
  let pendingQty = 1; // quantity chosen before the item is actually added to cart

  function getPvQty() {
    if (!window.ZMCart || !pvCurrentProduct.name) return 0;
    const item = window.ZMCart.getItem(pvCurrentProduct.name);
    return item ? item.qty : 0;
  }

  function updatePvQtyDisplay(qty) {
    pvQtyVal.textContent = qty;
  }

  function syncPvCartBtn(productName, productImg, stockStatus) {
    pvCurrentProduct = { name: productName, img: productImg };
    if (!pvAddCartBtn) return;

    // Out of stock: hide Add/Remove/Qty controls entirely and show
    // the "Unavailable" pill instead, same as the product card.
    if (stockStatus === 'out') {
      pvAddCartBtn.style.display = 'none';
      pvRemoveBtn.style.display = 'none';
      if (pvQtyCtrl) pvQtyCtrl.style.display = 'none';
      if (pvUnavailable) pvUnavailable.style.display = '';
      return;
    }
    if (pvUnavailable) pvUnavailable.style.display = 'none';

    const qty = getPvQty();
    if (qty > 0) {
      pvAddCartBtn.style.display = 'none';
      pvRemoveBtn.style.display = '';
      updatePvQtyDisplay(qty);
    } else {
      pvAddCartBtn.style.display = '';
      pvAddCartBtn.innerHTML = '<i class="fa-solid fa-cart-plus"></i> Add to Cart';
      pvAddCartBtn.classList.remove('pv-added');
      pvRemoveBtn.style.display = 'none';
      pendingQty = 1;
      updatePvQtyDisplay(pendingQty);
    }
  }

  if (pvAddCartBtn) {
    pvAddCartBtn.addEventListener('click', () => {
      if (!window.ZMCart || !pvCurrentProduct.name) return;
      if (pvAddCartBtn.classList.contains('pv-loading') || pvAddCartBtn.classList.contains('pv-added')) return;

      // Check login first before showing loading animation
      const loggedIn = !!(window.fb && window.fb.auth && window.fb.auth.currentUser);
      if (!loggedIn) {
        // Let ZMCart.addItem handle the toast (it checks too), but call it to trigger the toast
        window.ZMCart.addItem(pvCurrentProduct.name, pvCurrentProduct.img);
        return;
      }

      // Step 1: Loading — full panel, same style as the "Sending your inquiry" loader
      pvAddCartBtn.classList.add('pv-loading');
      if (pvCartLoading) {
        pvCartLoading.classList.add('show');
        if (pvClBarFill) {
          pvClBarFill.style.transition = 'none';
          pvClBarFill.style.width = '0%';
          requestAnimationFrame(() => {
            pvClBarFill.style.transition = 'width .8s linear';
            pvClBarFill.style.width = '100%';
          });
        }
      }

      // Step 2: Success after 900ms
      setTimeout(() => {
        window.ZMCart.addItem(pvCurrentProduct.name, pvCurrentProduct.img);
        window.ZMCart.setQty(pvCurrentProduct.name, pendingQty);
        pvAddCartBtn.classList.remove('pv-loading');
        pvAddCartBtn.classList.add('pv-added');
        pvAddCartBtn.innerHTML = '<span class="pv-check-icon"><i class="fa-solid fa-check"></i></span> Added to Cart!';
        if (pvCartLoading) pvCartLoading.classList.remove('show');
        syncPvCartBtn(pvCurrentProduct.name, pvCurrentProduct.img);
        // Show centered success modal
        if (window.zmShowCartSuccess) window.zmShowCartSuccess(pvCurrentProduct.name);
      }, 900);
    });
  }

  if (pvRemoveBtn) {
    pvRemoveBtn.addEventListener('click', () => {
      if (!window.ZMCart || !pvCurrentProduct.name) return;
      window.ZMCart.removeItem(pvCurrentProduct.name);
      syncPvCartBtn(pvCurrentProduct.name, pvCurrentProduct.img);
    });
  }

  if (pvQtyDec) {
    pvQtyDec.addEventListener('click', () => {
      if (!pvCurrentProduct.name) return;
      const qty = getPvQty();
      if (qty > 0) {
        // Already in cart — adjust the live cart quantity
        if (qty <= 1) {
          window.ZMCart.removeItem(pvCurrentProduct.name);
        } else {
          window.ZMCart.setQty(pvCurrentProduct.name, qty - 1);
        }
        syncPvCartBtn(pvCurrentProduct.name, pvCurrentProduct.img);
      } else {
        // Not yet added — just adjust the quantity to add
        pendingQty = Math.max(1, pendingQty - 1);
        updatePvQtyDisplay(pendingQty);
      }
    });
  }

  if (pvQtyInc) {
    pvQtyInc.addEventListener('click', () => {
      if (!pvCurrentProduct.name) return;
      const qty = getPvQty();
      if (qty > 0) {
        // Already in cart — adjust the live cart quantity
        window.ZMCart.setQty(pvCurrentProduct.name, qty + 1);
        syncPvCartBtn(pvCurrentProduct.name, pvCurrentProduct.img);
      } else {
        // Not yet added — just adjust the quantity to add
        pendingQty = pendingQty + 1;
        updatePvQtyDisplay(pendingQty);
      }
    });
  }

  // Stopwords ignored when comparing product names for similarity —
  // sizes, units, and generic filler words don't tell us much about
  // what the product actually is.
  const SIMILAR_STOPWORDS = new Set([
    'and','or','the','with','for','of','a','an','in','ml','g','kg','l',
    'pcs','pc','pack','set','x','no','new'
  ]);

  function similarKeywords(name) {
    return (name || '')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')       // drop "(250ML / 400ML)" style size notes
      .replace(/[^a-z0-9\s]/g, ' ')     // strip punctuation
      .split(/\s+/)
      .filter(w => w && !SIMILAR_STOPWORDS.has(w) && !/^\d+$/.test(w) && !/^\d+(ml|g|kg|l|oz)$/.test(w));
  }

  function similarBrand(name) {
    const words = similarKeywords(name);
    return words.length ? words[0] : '';
  }

  function renderSimilarProducts(currentTag) {
    if (!pvSimilarGrid) return;
    pvSimilarGrid.innerHTML = '';

    const block = currentTag.closest('.cat-block');
    if (!block) return;

    const others = Array.from(block.querySelectorAll('.item-tag')).filter(t => t !== currentTag);
    if (!others.length) return;

    const currentName = currentTag.querySelector('.product-name');
    const currentText = currentName ? currentName.textContent.trim() : '';
    const currentBrand = similarBrand(currentText);
    const currentKeywords = new Set(similarKeywords(currentText).slice(1)); // brand word already scored separately

    // Score each candidate: same brand counts most, then shared keywords
    // (product type, e.g. "shower gel", "shampoo") — actually similar
    // items float to the top instead of a plain random pick.
    const scored = others.map(simTag => {
      const nameEl = simTag.querySelector('.product-name');
      const name = nameEl ? nameEl.textContent.trim() : '';
      const brand = similarBrand(name);
      const keywords = similarKeywords(name).slice(1);

      let score = 0;
      if (brand && currentBrand && brand === currentBrand) score += 10;
      keywords.forEach(w => { if (currentKeywords.has(w)) score += 3; });

      return { tag: simTag, score, rand: Math.random() };
    });

    // Sort by score first; use a random value as the tiebreaker so
    // equally-similar picks still feel fresh on each open.
    scored.sort((a, b) => (b.score - a.score) || (a.rand - b.rand));

    scored.slice(0, 10).map(s => s.tag).forEach(simTag => {
      const nameEl = simTag.querySelector('.product-name');
      const wrap = simTag.querySelector('.product-img-wrap');
      const img = wrap ? wrap.querySelector('img') : null;
      const alreadyBroken = wrap && wrap.classList.contains('no-img');
      const name = nameEl ? nameEl.textContent.trim() : '';

      const card = document.createElement('div');
      card.className = 'pv-similar-card';

      const imgBox = document.createElement('div');
      imgBox.className = 'pv-similar-img' + ((img && !alreadyBroken) ? '' : ' no-img');
      if (img && !alreadyBroken) {
        const cloneImg = document.createElement('img');
        cloneImg.src = img.src;
        cloneImg.alt = '';
        cloneImg.loading = 'lazy';
        // The original card may not have attempted to load this image yet
        // (lazy-loaded, off-screen) — fall back gracefully if it 404s.
        cloneImg.addEventListener('error', () => {
          imgBox.classList.add('no-img');
          cloneImg.remove();
        });
        imgBox.appendChild(cloneImg);
      }
      if (simTag.dataset.stock === 'low') {
        const badge = document.createElement('span');
        badge.className = 'pv-similar-stock';
        badge.textContent = 'Low Stock';
        imgBox.appendChild(badge);
      }
      card.appendChild(imgBox);

      const body = document.createElement('div');
      body.className = 'pv-similar-body';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'pv-similar-name';
      nameDiv.textContent = name;
      body.appendChild(nameDiv);

      if (simTag.dataset.price) {
        const priceDiv = document.createElement('div');
        priceDiv.className = 'pv-similar-price';
        priceDiv.textContent = `MVR ${simTag.dataset.price}`;
        body.appendChild(priceDiv);
      }
      card.appendChild(body);

      card.addEventListener('click', () => {
        openViewer(simTag);
        if (pvBox) pvBox.scrollTop = 0;
      });

      pvSimilarGrid.appendChild(card);
    });
  }

  function openViewer(tag) {
    const img = tag.querySelector('.product-img-wrap img');
    const name = tag.querySelector('.product-name');
    const wrap = tag.querySelector('.product-img-wrap');

    const productName = name ? name.textContent.trim() : '';
    const productImg  = (img && !wrap.classList.contains('no-img')) ? img.src : null;
    const stockStatus = getAdminStockStatus(productName) || tag.dataset.stock || null;

    pvName.textContent = productName;
    resetView();

    if (img && !wrap.classList.contains('no-img')) {
      pvImg.src = img.src;
      pvImg.classList.remove('pv-hidden');
      pvStage.classList.remove('no-img');
    } else {
      pvImg.src = '';
      pvImg.classList.add('pv-hidden');
      pvStage.classList.add('no-img');
    }

    if (pvQtyCtrl) pvQtyCtrl.style.display = '';
    syncPvCartBtn(productName, productImg, stockStatus);
    renderSimilarProducts(tag);

    if (pvBox) pvBox.scrollTop = 0;
    pvOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeViewer() {
    pvOverlay.classList.remove('open');
    document.body.style.overflow = '';

  }

  document.querySelectorAll('.item-tag').forEach(tag => {
    tag.addEventListener('click', () => openViewer(tag));
  });

  pvClose.addEventListener('click', closeViewer);
  pvOverlay.addEventListener('click', (e) => {
    if (e.target === pvOverlay) closeViewer();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pvOverlay.classList.contains('open')) closeViewer();
  });

  pvZoomIn.addEventListener('click', () => zoomBy(ZOOM_STEP));
  pvZoomOut.addEventListener('click', () => zoomBy(-ZOOM_STEP));

  pvStage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }, { passive: false });

  pvStage.addEventListener('mousedown', (e) => {
    if (scale <= ZOOM_MIN) return;
    dragging = true;
    pvStage.classList.add('dragging');
    startX = e.clientX - posX;
    startY = e.clientY - posY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    posX = e.clientX - startX;
    posY = e.clientY - startY;
    clampPos();
    setTransform();
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    pvStage.classList.remove('dragging');
  });

  pvStage.addEventListener('touchstart', (e) => {
    if (scale <= ZOOM_MIN || e.touches.length !== 1) return;
    dragging = true;
    startX = e.touches[0].clientX - posX;
    startY = e.touches[0].clientY - posY;
  }, { passive: true });
  pvStage.addEventListener('touchmove', (e) => {
    if (!dragging || e.touches.length !== 1) return;
    posX = e.touches[0].clientX - startX;
    posY = e.touches[0].clientY - startY;
    clampPos();
    setTransform();
  }, { passive: true });
  pvStage.addEventListener('touchend', () => { dragging = false; });

});
