// ============================================
// ZAMI MART — shared interactions
// ============================================

document.addEventListener('DOMContentLoaded', () => {

  /* --- Profile icon: redirect based on login state --- */
  const navAccount = document.querySelector('.nav-account');
  if (navAccount) {
    navAccount.href = 'login.html'; // default
    // Update once Firebase Auth is ready
    function setNavAccount() {
      if (window.fb && window.fb.auth && window.fb.onAuthStateChanged) {
        window.fb.onAuthStateChanged(window.fb.auth, (user) => {
          navAccount.href = user ? 'profile.html' : 'login.html';
        });
      } else {
        window.addEventListener('fb-ready', setNavAccount, { once: true });
      }
    }
    setNavAccount();
  }

  /* --- Navbar scroll state --- */
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    const onScroll = () => {
      if (window.scrollY > 30) navbar.classList.add('scrolled');
      else navbar.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll);
    onScroll();
  }

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

  /* --- Store open/closed status (Maldives time, UTC+5, no DST) --- */
  const statusEl = document.getElementById('storeStatus');
  const statusTextEl = document.getElementById('storeStatusText');
  if (statusEl && statusTextEl) {
    const HOURS = [
      [9 * 60, 12 * 60],
      [13 * 60 + 30, 18 * 60],
      [20 * 60, 22 * 60]
    ];
    const now = new Date();
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const minutesNow = (utcMinutes + 5 * 60) % (24 * 60); // Maldives = UTC+5, no DST

    const fmt = (mins) => {
      const h24 = Math.floor(mins / 60) % 24;
      const m = mins % 60;
      const h12 = ((h24 + 11) % 12) + 1;
      const ampm = h24 >= 12 ? 'PM' : 'AM';
      return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
    };

    const openBlock = HOURS.find(([start, end]) => minutesNow >= start && minutesNow < end);
    if (openBlock) {
      statusTextEl.textContent = `Open now · closes ${fmt(openBlock[1])}`;
    } else {
      const next = HOURS.find(([start]) => start > minutesNow);
      statusEl.classList.add('is-closed');
      statusTextEl.textContent = next
        ? `Closed · opens ${fmt(next[0])}`
        : `Closed · opens ${fmt(HOURS[0][0])} tomorrow`;
    }
  }

  /* --- Animated stat counters --- */
  const countEls = document.querySelectorAll('.count-num[data-count]');
  if (countEls.length) {
    const animateCount = (el) => {
      const target = parseInt(el.dataset.count, 10) || 0;
      const duration = 1100;
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(eased * target);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const countIo = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          countIo.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    countEls.forEach(el => countIo.observe(el));
  }

  /* --- Hero scroll cue --- */
  const scrollCue = document.getElementById('heroScrollCue');
  const heroSlideshow = document.getElementById('heroSlideshow');
  if (scrollCue && heroSlideshow) {
    scrollCue.addEventListener('click', () => {
      heroSlideshow.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* --- Fix: reset transition if browser restores from bfcache (back button) --- */
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      document.body.classList.remove('is-leaving', 'is-entering');
    }
  });
  requestAnimationFrame(() => {
    document.body.classList.add('is-entering');
    setTimeout(() => {
      document.body.classList.remove('is-entering');
    }, 700);
  });

  /* --- Page transition on internal link click --- */
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const internalLinks = document.querySelectorAll('a[href$=".html"], a[href="/"], a[href="./"]');
  internalLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      // allow new tab / modifier clicks to pass through
      if (e.metaKey || e.ctrlKey || e.shiftKey || link.target === '_blank') return;
      e.preventDefault();

      if (prefersReducedMotion) {
        window.location.href = href;
        return;
      }

      document.body.classList.add('is-leaving');

      let navigated = false;
      const go = () => {
        if (navigated) return;
        navigated = true;
        window.location.href = href;
      };

      // Navigate exactly when the slowest panel finishes its wipe — this
      // self-adjusts to whatever duration/delay the current breakpoint
      // (mobile vs desktop) is using, so the cut never happens mid-animation.
      const lastPanel = document.querySelector('.pt-panel.pt-1');
      if (lastPanel) {
        lastPanel.addEventListener('transitionend', go, { once: true });
      }
      // Safety net in case transitionend never fires for some reason
      setTimeout(go, 900);
    });
  });

});
