import { useState } from 'react';
import { illustrations, type IllustrationId } from '../../data/illustrations';

interface RenderedArtProps {
  id: IllustrationId;
  className?: string;
  /** Hide from assistive tech when the surrounding copy already says the same thing. */
  decorative?: boolean;
}

/**
 * Rendered 3D illustration from the shared registry. The art sits on a light studio backdrop,
 * so it is framed in a rounded tile that reads intentionally on light and dark themes.
 */
export function RenderedArt({ id, className = '', decorative = false }: RenderedArtProps) {
  const [loaded, setLoaded] = useState(false);
  const art = illustrations[id];
  return (
    <img
      src={art.src}
      alt={decorative ? '' : art.alt}
      aria-hidden={decorative || undefined}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      style={{ aspectRatio: art.ratio }}
      className={`select-none rounded-xl bg-[#F4F4F5] object-cover ring-1 ring-black/5 transition-opacity duration-200 ease-out ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
    />
  );
}
