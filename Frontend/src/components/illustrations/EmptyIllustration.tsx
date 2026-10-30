import { RenderedArt } from './RenderedArt';

export function EmptyIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="empty" className={className} decorative />;
}
