export function DevHQLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="DevHQ"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="#15171C" />
      <circle cx="16" cy="9.5" r="3" fill="#FFFFFF" />
      <circle cx="9" cy="22" r="2.6" fill="#A5B4FC" />
      <circle cx="16" cy="22" r="2.6" fill="#A5B4FC" />
      <circle cx="23" cy="22" r="2.6" fill="#A5B4FC" />
      <path
        d="M16 12.5v7M16 15.5c-4 0-7 1.6-7 4M16 15.5c4 0 7 1.6 7 4"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
