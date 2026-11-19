/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Tripica's mark: a sun rising over the horizon, for "the right time to go".
 * Inline SVG so it renders crisply in the app and in the server-rendered guide pages.
 * The same artwork lives in public/logo.svg (and a simplified public/favicon.svg).
 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#1570E8" />
      <path d="M14 40a18 18 0 0 1 36 0z" fill="#FFC94D" />
      <path d="M10 40h44" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M18 47h28" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" opacity=".55" />
      <path d="M32 14v5M19 19l3 3.5M45 19l-3 3.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
