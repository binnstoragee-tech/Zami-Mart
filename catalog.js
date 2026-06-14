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

});
