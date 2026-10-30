import type { ProductId } from '../../types/portfolio';

interface ProductMarkProps {
  product: ProductId;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const dims = { sm: 16, md: 22, lg: 30, xl: 44 };

export function ProductMark({ product, size = 'md' }: ProductMarkProps) {
  const d = dims[size];
  if (product === 'renewberry') {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white"
        style={{ width: d, height: d }}
      >
        <img
          src="/renewberry.png"
          alt="RenewBerry"
          className="h-full w-full object-contain p-[12%]"
        />
      </span>
    );
  }
  if (product === 'blog') {
    return (
      <svg
        width={d}
        height={d}
        viewBox="0 0 32 32"
        role="img"
        aria-label="Blog"
        className="shrink-0"
      >
        <rect width="32" height="32" rx="7" fill="#1F2937" />
        <path d="M9 8h10l5 5v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="#F9FAFB" />
        <path d="M19 8v4a1 1 0 0 0 1 1h4" fill="#D1D5DB" />
        <rect x="11" y="15" width="10" height="1.8" rx=".9" fill="#1F2937" />
        <rect x="11" y="18.6" width="7" height="1.8" rx=".9" fill="#9CA3AF" />
        <circle cx="21.5" cy="21.5" r="2" fill="#F59E0B" />
      </svg>
    );
  }
  return (
    <svg
      width={d}
      height={d}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Mirror Acture"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="7" fill="#312E81" />
      <path d="M15.2 8 7 24h8.2z" fill="#A5B4FC" />
      <path d="M16.8 8 25 24h-8.2z" fill="#FFFFFF" />
      <rect x="15.4" y="6.5" width="1.2" height="19" rx=".6" fill="#C7D2FE" />
    </svg>
  );
}
