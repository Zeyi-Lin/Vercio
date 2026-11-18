export function LogoMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="vercio-mark" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#a8a8a8" />
        </linearGradient>
      </defs>
      <path d="M2.5 5.5h6.9L16 19.8 22.6 5.5h6.9L16 29.5 2.5 5.5Z" fill="url(#vercio-mark)" />
      <circle cx="26.5" cy="6" r="2.7" fill="#0070f3" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <LogoMark />
      <span className="brand-name">Vercio</span>
      {!compact && <span className="brand-version">alpha</span>}
    </span>
  );
}
