import { useState } from 'react';
import { illustrations, type IllustrationId } from '../../data/illustrations';

interface RenderedArtProps {
  id: IllustrationId;
  className?: string;
  /** Hide from assistive tech when the surrounding copy already says the same thing. */
  decorative?: boolean;
  /**
   * Above-the-fold art that is likely the largest paint (the auth slideshow's first
   * slide): fetched at high priority and shown as soon as it decodes, without the fade.
   */
  priority?: boolean;
}

// React 18 doesn't know the camel-cased prop; the lower-case attribute passes through.
const HIGH_PRIORITY = { fetchpriority: 'high' };

/**
 * Rendered 3D illustration from the shared registry. The art sits on a light studio backdrop,
 * so it is framed in a rounded tile that reads intentionally on light and dark themes.
 */
export function RenderedArt({
  id,
  className = '',
  decorative = false,
  priority = false,
}: RenderedArtProps) {
  const [loaded, setLoaded] = useState(priority);
  const art = illustrations[id];
  return (
    <img
      src={art.src}
      alt={decorative ? '' : art.alt}
      aria-hidden={decorative || undefined}
      loading="lazy"
      decoding="async"
      {...(priority ? HIGH_PRIORITY : {})}
      draggable={false}
      onLoad={() => setLoaded(true)}
      style={{ aspectRatio: art.ratio }}
      className={`select-none rounded-xl bg-[#F4F4F5] object-cover ring-1 ring-black/5 transition-opacity duration-200 ease-out ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  );
}
