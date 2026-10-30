import { RenderedArt } from './RenderedArt';

export function IdeIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="ide" className={className} />;
}
