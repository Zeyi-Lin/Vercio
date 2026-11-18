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

// feat/aurora-hero adds a light pointer response to the hero glow.
(() => {
  const hero = document.querySelector(".hero--aurora");
  if (!hero) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let frame = 0;
  hero.addEventListener("pointermove", (event) => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const rect = hero.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      hero.style.setProperty("--aurora-x", x.toFixed(3));
      hero.style.setProperty("--aurora-y", y.toFixed(3));
    });
  });
  hero.addEventListener("pointerleave", () => {
    hero.style.removeProperty("--aurora-x");
    hero.style.removeProperty("--aurora-y");
  });
})();
