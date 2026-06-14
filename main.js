// ============================================
// ZAMI MART — shared interactions
// ============================================

document.addEventListener('DOMContentLoaded', () => {

  /* --- Navbar scroll state --- */
  const navbar = document.querySelector('.navbar');
  const onScroll = () => {
    if (window.scrollY > 30) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  };
  window.addEventListener('scroll', onScroll);
  onScroll();

  /* --- Mobile nav toggle --- */
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  const closeBtn = document.querySelector('.nav-close');

  function closeNav() {
    toggle.classList.remove('open');
    links.classList.remove('open');
  }

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      links.classList.toggle('open');
    });
    if (closeBtn) closeBtn.addEventListener('click', closeNav);
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', closeNav);
    });
  }

  /* --- Scroll reveal --- */
  const revealEls = document.querySelectorAll('.reveal, .reveal-stagger');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach(el => io.observe(el));

  /* --- Entering animation (on load) --- */
  requestAnimationFrame(() => {
    document.body.classList.add('is-entering');
    setTimeout(() => {
      document.body.classList.remove('is-entering');
    }, 700);
  });

  /* --- Page transition on internal link click --- */
  const internalLinks = document.querySelectorAll('a[href$=".html"], a[href="/"], a[href="./"]');
  internalLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      // allow new tab / modifier clicks to pass through
      if (e.metaKey || e.ctrlKey || e.shiftKey || link.target === '_blank') return;
      e.preventDefault();
      document.body.classList.add('is-leaving');
      setTimeout(() => {
        window.location.href = href;
      }, 480);
    });
  });

});
