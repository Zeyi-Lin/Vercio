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

// feat/pricing-v2 — monthly / annual billing toggle.
(() => {
  const section = document.querySelector(".pricing-v2");
  if (!section) return;
  const toggle = section.querySelector("[data-billing-toggle]");
  if (!toggle) return;

  const buttons = Array.from(toggle.querySelectorAll("[data-billing]"));
  const priceValues = Array.from(section.querySelectorAll("[data-monthly]"));
  const billedLabels = Array.from(section.querySelectorAll("[data-billed]"));
  const note = section.querySelector("[data-billing-note]");
  const grid = section.querySelector(".price-grid");
  const NOTES = {
    monthly: "Billed monthly. Cancel anytime.",
    annual: "Billed annually. Two months free compared with monthly.",
  };

  function render(period) {
    const isAnnual = period === "annual";
    section.classList.toggle("is-annual", isAnnual);
    toggle.dataset.active = period;

    for (const button of buttons) {
      const active = button.dataset.billing === period;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    for (const value of priceValues) {
      const next = value.dataset[period];
      if (next !== undefined) value.textContent = next;
    }

    for (const label of billedLabels) {
      const next = isAnnual ? label.dataset.annualLabel : label.dataset.monthlyLabel;
      if (next) label.textContent = next;
    }

    if (note) note.textContent = NOTES[period];

    if (grid) {
      grid.classList.remove("is-updating");
      void grid.offsetWidth;
      grid.classList.add("is-updating");
      window.setTimeout(() => grid.classList.remove("is-updating"), 380);
    }
  }

  toggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-billing]");
    if (!button) return;
    render(button.dataset.billing);
  });

  // Left/right arrows move between billing options when the toggle has focus.
  toggle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = toggle.dataset.active === "annual" ? 1 : 0;
    const next = buttons[(current + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
    if (!next) return;
    render(next.dataset.billing);
    next.focus();
  });

  render("monthly");
})();
