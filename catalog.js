// ============================================
// ZAMI MART — catalog search & filter
// ============================================

document.addEventListener('DOMContentLoaded', () => {

  const filterBtns = document.querySelectorAll('.filter-btn');
  const catBlocks = document.querySelectorAll('.cat-block');
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
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      applyFilters();

      if (activeFilter !== 'all') {
        const target = document.getElementById(activeFilter);
        if (target) {
          setTimeout(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const pvQtyDec      = document.getElementById('pvQtyDec');
  const pvQtyInc      = document.getElementById('pvQtyInc');
  const pvQtyVal      = document.getElementById('pvQtyVal');

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

  function syncPvCartBtn(productName, productImg) {
    pvCurrentProduct = { name: productName, img: productImg };
    if (!pvAddCartBtn) return;
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

      // Step 1: Loading
      pvAddCartBtn.classList.add('pv-loading');
      pvAddCartBtn.innerHTML = '<div class="pv-btn-spinner zm-loader xs"><span></span><span></span><span></span><span></span></div> Adding...';

      // Step 2: Success after 900ms
      setTimeout(() => {
        window.ZMCart.addItem(pvCurrentProduct.name, pvCurrentProduct.img);
        window.ZMCart.setQty(pvCurrentProduct.name, pendingQty);
        pvAddCartBtn.classList.remove('pv-loading');
        pvAddCartBtn.classList.add('pv-added');
        pvAddCartBtn.innerHTML = '<span class="pv-check-icon"><i class="fa-solid fa-check"></i></span> Added to Cart!';
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

  function openViewer(tag) {
    const img = tag.querySelector('.product-img-wrap img');
    const name = tag.querySelector('.product-name');
    const wrap = tag.querySelector('.product-img-wrap');

    const productName = name ? name.textContent.trim() : '';
    const productImg  = (img && !wrap.classList.contains('no-img')) ? img.src : null;

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

    syncPvCartBtn(productName, productImg);

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
