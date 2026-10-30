import { RenderedArt } from './RenderedArt';

export function NdaIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="nda" className={className} />;
}
