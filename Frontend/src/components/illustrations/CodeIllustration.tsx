import { RenderedArt } from './RenderedArt';

export function CodeIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="code" className={className} />;
}
