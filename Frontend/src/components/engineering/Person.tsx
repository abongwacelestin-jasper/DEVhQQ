import { Link } from 'react-router-dom';
import { Avatar } from '../ui/Avatar';
import { person } from './format';

/**
 * Author / reviewer chip. Members link to their profile with their avatar;
 * an unmapped GitHub login is shown as-is rather than attributed to someone.
 */
export function Person({
  id,
  showName = true,
  link = true,
}: {
  id: string | undefined;
  showName?: boolean;
  link?: boolean;
}) {
  const p = person(id);
  if (!p) return <span className="text-muted">—</span>;
  if (!p.member)
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5" title={`GitHub: ${p.id}`}>
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[9px] font-semibold text-muted"
        >
          {p.id.slice(0, 2).toUpperCase()}
        </span>
        {showName ? (
          <span className="truncate font-mono">{p.id}</span>
        ) : (
          <span className="sr-only">{p.id}</span>
        )}
      </span>
    );
  const body = (
    <>
      <Avatar id={p.id} size="xs" />
      {showName && <span className="truncate">{p.name}</span>}
    </>
  );
  return link ? (
    <Link to={`/team/${p.id}`} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
      {body}
    </Link>
  ) : (
    <span className="inline-flex min-w-0 items-center gap-1.5">{body}</span>
  );
}
