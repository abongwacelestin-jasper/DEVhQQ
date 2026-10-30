import { memberById } from '../../utils/status';

interface AvatarProps {
  id: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  ring?: boolean;
}

const sizes = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

export function Avatar({ id, size = 'sm', ring = false }: AvatarProps) {
  const m = memberById(id);
  return (
    <span
      title={m.name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-[#fff] ${sizes[size]} ${ring ? 'ring-2 ring-surface' : ''}`}
      style={{ backgroundColor: m.color }}
    >
      {m.initials}
      <span className="sr-only">{m.name}</span>
    </span>
  );
}
