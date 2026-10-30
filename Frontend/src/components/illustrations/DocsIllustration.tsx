import { RenderedArt } from './RenderedArt';

export function DocsIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="docs" className={className} />;
}
