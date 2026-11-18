/**
 * Lumen — baseline landing page behaviour.
 * Progressive enhancement only: everything works without JS.
 */
(() => {
  const root = document.documentElement;
  root.classList.add("js");

  // Gentle reveal as sections enter the viewport.
  const revealables = Array.from(document.querySelectorAll("[data-reveal]"));
  if ("IntersectionObserver" in window && revealables.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    for (const element of revealables) observer.observe(element);
  } else {
    for (const element of revealables) element.classList.add("is-visible");
  }

  // Footer copyright year.
  const year = new Date().getFullYear();
  for (const node of document.querySelectorAll("[data-year]")) {
    node.textContent = String(year);
  }
})();

// fix/mobile-nav — working hamburger menu with escape handling, focus management and scroll state.
(() => {
  const header = document.querySelector("[data-site-header]");
  const toggle = document.querySelector("[data-nav-toggle]");
  const menu = document.querySelector("[data-mobile-menu]");
  const scrim = document.querySelector("[data-menu-scrim]");
  if (!header || !toggle || !menu || !scrim) return;

  const root = document.documentElement;
  let isOpen = false;
  let closeTimer = 0;

  function setExpanded(expanded) {
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Close menu" : "Open menu");
  }

  function focusableItems() {
    return Array.from(header.querySelectorAll("a[href], button:not([disabled])")).filter((element) => {
      return element.offsetParent !== null;
    });
  }

  function onKeydown(event) {
    if (!isOpen) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }

    if (event.key !== "Tab") return;
    const items = focusableItems();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openMenu() {
    if (isOpen) return;
    isOpen = true;
    window.clearTimeout(closeTimer);
    menu.hidden = false;
    scrim.hidden = false;
    menu.inert = false;
    menu.removeAttribute("inert");
    menu.removeAttribute("aria-hidden");
    setExpanded(true);
    root.classList.add("menu-open");
    header.classList.add("nav-open");
    window.requestAnimationFrame(() => {
      menu.classList.add("is-open");
      scrim.classList.add("is-open");
    });
    const firstLink = menu.querySelector("a");
    if (firstLink) firstLink.focus({ preventScroll: true });
    document.addEventListener("keydown", onKeydown);
  }

  function closeMenu(options) {
    const settings = options || {};
    if (!isOpen) return;
    isOpen = false;
    window.clearTimeout(closeTimer);
    menu.classList.remove("is-open");
    scrim.classList.remove("is-open");
    header.classList.remove("nav-open");
    root.classList.remove("menu-open");
    setExpanded(false);
    menu.inert = true;
    menu.setAttribute("inert", "");
    menu.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", onKeydown);
    closeTimer = window.setTimeout(() => {
      if (isOpen) return;
      menu.hidden = true;
      scrim.hidden = true;
    }, 240);
    if (settings.restoreFocus) toggle.focus();
  }

  toggle.addEventListener("click", () => {
    if (isOpen) closeMenu({ restoreFocus: true });
    else openMenu();
  });

  scrim.addEventListener("click", () => closeMenu({ restoreFocus: true }));

  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", (event) => {
    if (!isOpen) return;
    if (header.contains(event.target) || scrim.contains(event.target)) return;
    closeMenu();
  });

  const desktopQuery = window.matchMedia("(min-width: 981px)");
  const handleDesktop = (event) => {
    if (event.matches) closeMenu();
  };
  if (desktopQuery.addEventListener) desktopQuery.addEventListener("change", handleDesktop);

  const updateScrollState = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  updateScrollState();
  window.addEventListener("scroll", updateScrollState, { passive: true });
})();
