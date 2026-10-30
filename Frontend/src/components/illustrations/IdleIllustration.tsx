import { RenderedArt } from './RenderedArt';

export function IdleIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="idle" className={className} />;
}
