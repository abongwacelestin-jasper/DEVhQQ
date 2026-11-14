/**
 * The TavetaHQ weaver bird. The artwork is the brand PNG (never redrawn or
 * recoloured); its wing lines are solid white, so it reads on light and dark
 * surfaces alike. Regenerate with `infra/brand/logo-assets.py`.
 */
export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/brand/tavetahq-mark.png"
      width={size}
      height={size}
      alt="TavetaHQ"
      draggable={false}
      className="shrink-0 select-none"
    />
  );
}

/**
 * The name set as in the logo: "Taveta" in ink, "HQ" in brand indigo. Use it
 * beside <BrandLogo>; the lockup PNG's dark wordmark does not work on dark
 * surfaces, this does.
 */
export function BrandName({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight text-ink ${className}`}>
      Taveta<span className="text-accent">HQ</span>
    </span>
  );
}
