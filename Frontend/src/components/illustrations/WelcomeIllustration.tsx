import { RenderedArt } from './RenderedArt';

export function WelcomeIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="welcome" className={className} />;
}
