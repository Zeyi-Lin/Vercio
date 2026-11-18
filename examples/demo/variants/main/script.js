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
