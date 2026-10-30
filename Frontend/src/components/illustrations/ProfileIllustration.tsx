import { RenderedArt } from './RenderedArt';

export function ProfileIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="profile" className={className} />;
}
