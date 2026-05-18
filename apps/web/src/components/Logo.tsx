/** Priceobo mark — the gradient target/bullseye used in the sidebar,
 *  auth pages, and (as a static SVG) the favicon. Single source of truth. */
export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="poLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1f47e5" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#poLogoGrad)" />
      <circle cx="16" cy="16" r="10" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="16" r="4" fill="#fff" />
    </svg>
  );
}
