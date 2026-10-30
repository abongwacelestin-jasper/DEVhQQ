import { FileIcon as GenericFileIcon, FlaskConicalIcon } from 'lucide-react';

const glyphs: Record<string, { label: string; color: string }> = {
  ts: { label: 'TS', color: '#3178C6' },
  tsx: { label: 'TSX', color: '#3178C6' },
  js: { label: 'JS', color: '#CBCB41' },
  mjs: { label: 'JS', color: '#CBCB41' },
  jsx: { label: 'JSX', color: '#CBCB41' },
  json: { label: '{}', color: '#CBCB41' },
  md: { label: 'M↓', color: '#519ABA' },
  yml: { label: 'Y', color: '#A074C4' },
  yaml: { label: 'Y', color: '#A074C4' },
  css: { label: '#', color: '#42A5F5' },
  html: { label: '<>', color: '#E37933' },
  py: { label: 'Py', color: '#3572A5' },
};

/** File-type glyph in the style of VS Code's Seti icons. */
export function FileIcon({ path, className = '' }: { path: string; className?: string }) {
  if (/\.(test|spec)\.(ts|js)$/.test(path))
    return (
      <FlaskConicalIcon className={`h-3.5 w-4 shrink-0 text-[#22A06B] ${className}`} aria-hidden />
    );
  const g = glyphs[path.split('.').pop()?.toLowerCase() ?? ''];
  if (!g)
    return (
      <GenericFileIcon
        className={`h-3.5 w-4 shrink-0 text-[var(--vs-fg-dim)] ${className}`}
        aria-hidden
      />
    );
  return (
    <span
      className={`inline-flex w-4 shrink-0 justify-center font-mono text-[9px] font-bold leading-none tracking-tighter ${className}`}
      style={{ color: g.color }}
      aria-hidden
    >
      {g.label}
    </span>
  );
}
