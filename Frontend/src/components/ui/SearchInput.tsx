import { SearchIcon, XIcon } from 'lucide-react';

/**
 * The one-line filter that sits under a panel header.
 *
 * Every section that lists records filters locally over the rows it already
 * has, so typing never re-queries the API and the scope stays exactly what the
 * server authorized.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="relative flex min-w-0 items-center">
      <SearchIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-subtle" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-7 w-full min-w-0 rounded-md border border-line bg-white pl-7 pr-7 text-[12px] text-ink outline-none transition-colors duration-150 placeholder:text-subtle focus:border-line-strong"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 grid h-[18px] w-[18px] place-items-center rounded text-subtle hover:text-ink"
        >
          <XIcon className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
