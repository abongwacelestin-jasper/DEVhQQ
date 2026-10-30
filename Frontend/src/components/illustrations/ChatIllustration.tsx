import { RenderedArt } from './RenderedArt';

export function ChatIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="chat" className={className} />;
}
