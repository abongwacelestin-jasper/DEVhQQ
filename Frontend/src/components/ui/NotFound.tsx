import { Link } from 'react-router-dom';
import { EmptyIllustration } from '../illustrations/EmptyIllustration';

export function NotFound({
  what,
  backTo,
  backLabel,
}: {
  what: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-16 text-center">
      <EmptyIllustration className="h-28 w-auto" />
      <h1 className="mt-4 text-base font-semibold text-ink">{what} not found</h1>
      <p className="mt-1 max-w-sm text-sm text-muted">
        It may have been removed, or you don’t have access to it. Access is scoped per product.
      </p>
      <Link
        to={backTo}
        className="mt-4 inline-flex h-8 items-center rounded-md bg-ink px-3 text-[12.5px] font-medium text-white hover:bg-ink/90"
      >
        {backLabel}
      </Link>
    </div>
  );
}
