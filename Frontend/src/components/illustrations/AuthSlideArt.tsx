import { motion, useReducedMotion } from 'framer-motion';
import { RenderedArt } from './RenderedArt';
import type { IllustrationId } from '../../data/illustrations';

export type SlideArt = 'secure' | 'ship' | 'products' | 'volunteer';

const art: Record<SlideArt, IllustrationId> = {
  secure: 'signIn',
  ship: 'ship',
  products: 'products',
  volunteer: 'volunteer',
};

/** Rendered scenes for the auth slideshow, with a slow float so the panel feels alive. */
export function AuthSlideArt({
  variant,
  className = '',
}: {
  variant: SlideArt;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      animate={reduce ? undefined : { y: [0, -4, 0] }}
      transition={reduce ? undefined : { duration: 5, repeat: Infinity, ease: 'easeInOut' }}
    >
      <RenderedArt id={art[variant]} className="h-auto w-full" decorative />
    </motion.div>
  );
}
