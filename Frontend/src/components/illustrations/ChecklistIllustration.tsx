import { RenderedArt } from './RenderedArt';

export function ChecklistIllustration({ className = '' }: { className?: string }) {
  return <RenderedArt id="checklist" className={className} />;
}
