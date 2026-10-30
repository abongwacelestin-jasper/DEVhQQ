export const stickerList = [
  { id: 'rocket', label: 'Ship it' },
  { id: 'party', label: 'Party' },
  { id: 'bug', label: 'Bug squashed' },
  { id: 'coffee', label: 'Coffee break' },
  { id: 'thumbs', label: 'Looks good' },
  { id: 'fire', label: 'This is fine' },
  { id: 'brain', label: 'Big brain' },
  { id: 'lock', label: 'Secured' },
] as const;

export type StickerId = (typeof stickerList)[number]['id'];

const ink = '#15171C';

/** Cartoon chat stickers, drawn as vectors so they stay crisp at any size. */
export function Sticker({ id, size = 96 }: { id: string; size?: number }) {
  const label = stickerList.find((s) => s.id === id)?.label ?? 'Sticker';
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={`Sticker: ${label}`}
    >
      <circle cx="50" cy="50" r="46" fill="#FFFFFF" stroke={ink} strokeWidth="2.5" />
      {id === 'rocket' && (
        <g>
          <path
            d="M50 16c14 10 18 28 12 46H38c-6-18-2-36 12-46z"
            fill="#EEEEFD"
            stroke={ink}
            strokeWidth="2.5"
          />
          <circle cx="50" cy="38" r="7" fill="#4F46E5" stroke={ink} strokeWidth="2.5" />
          <path
            d="M38 52l-10 12 12-2M62 52l10 12-12-2"
            fill="#F59E0B"
            stroke={ink}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M44 64c0 8 3 12 6 16 3-4 6-8 6-16z"
            fill="#F97316"
            stroke={ink}
            strokeWidth="2.5"
          />
        </g>
      )}
      {id === 'party' && (
        <g>
          <path
            d="M26 78l14-44 30 30z"
            fill="#F59E0B"
            stroke={ink}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path d="M33 58l14 14M37 46l20 20" stroke="#FFFFFF" strokeWidth="3" />
          <circle cx="66" cy="28" r="4" fill="#4F46E5" />
          <circle cx="76" cy="44" r="3" fill="#EC4899" />
          <circle cx="52" cy="22" r="3" fill="#10B981" />
          <path
            d="M70 18l3 6M80 30l6-2M60 36l4-4"
            stroke={ink}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      )}
      {id === 'bug' && (
        <g>
          <ellipse cx="50" cy="56" rx="16" ry="20" fill="#34D399" stroke={ink} strokeWidth="2.5" />
          <circle cx="50" cy="32" r="9" fill="#34D399" stroke={ink} strokeWidth="2.5" />
          <path
            d="M50 38v38M34 50l-10-4M34 62l-10 4M66 50l10-4M66 62l10 4M45 25l-5-7M55 25l5-7"
            stroke={ink}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path d="M22 22l56 56" stroke="#B42318" strokeWidth="5" strokeLinecap="round" />
        </g>
      )}
      {id === 'coffee' && (
        <g>
          <path
            d="M28 40h38v20a16 16 0 0 1-16 16h-6a16 16 0 0 1-16-16z"
            fill="#FFFFFF"
            stroke={ink}
            strokeWidth="2.5"
          />
          <path d="M30 46h34" stroke="#92400E" strokeWidth="6" />
          <path d="M66 46h6a7 7 0 0 1 0 14h-6" fill="none" stroke={ink} strokeWidth="2.5" />
          <circle cx="40" cy="60" r="1.8" fill={ink} />
          <circle cx="52" cy="60" r="1.8" fill={ink} />
          <path
            d="M43 66c2 2 5 2 7 0"
            stroke={ink}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M40 32c0-4 4-4 4-8M52 32c0-4 4-4 4-8"
            stroke="#A1A1AA"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      )}
      {id === 'thumbs' && (
        <g>
          <path
            d="M34 46h8l10-20c6 0 8 4 7 10l-2 8h14c4 0 7 4 6 8l-4 18c-1 4-4 6-8 6H42"
            fill="#FCD34D"
            stroke={ink}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <rect
            x="24"
            y="44"
            width="12"
            height="34"
            rx="3"
            fill="#4F46E5"
            stroke={ink}
            strokeWidth="2.5"
          />
        </g>
      )}
      {id === 'fire' && (
        <g>
          <path
            d="M50 18c4 12 18 18 18 36a18 18 0 0 1-36 0c0-10 6-14 8-22 4 6 6 8 6 12 2-10 4-18 4-26z"
            fill="#F97316"
            stroke={ink}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path d="M50 52c3 6 8 8 8 14a8 8 0 0 1-16 0c0-6 6-8 8-14z" fill="#FCD34D" />
          <circle cx="44" cy="58" r="1.8" fill={ink} />
          <circle cx="56" cy="58" r="1.8" fill={ink} />
        </g>
      )}
      {id === 'brain' && (
        <g>
          <path
            d="M30 52c-6-6-2-18 6-18 0-8 12-12 16-4 4-6 16-4 16 4 8 0 12 12 6 18 4 8-4 16-10 14-2 6-14 6-16 0-8 2-16-6-12-14z"
            fill="#F9A8D4"
            stroke={ink}
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M50 32v34M40 44c4 0 6 2 6 6M60 44c-4 0-6 2-6 6"
            stroke={ink}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M72 22l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#FBBF24" />
        </g>
      )}
      {id === 'lock' && (
        <g>
          <path d="M38 44v-8a12 12 0 0 1 24 0v8" fill="none" stroke={ink} strokeWidth="4" />
          <rect
            x="30"
            y="44"
            width="40"
            height="32"
            rx="6"
            fill="#4F46E5"
            stroke={ink}
            strokeWidth="2.5"
          />
          <circle cx="50" cy="58" r="4" fill="#FFFFFF" />
          <path d="M50 60v7" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
          <path
            d="M70 28l5-5M76 38h6M24 30l-5-5"
            stroke="#10B981"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}
