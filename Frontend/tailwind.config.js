/** Every colour reads from a CSS variable so light and dark themes share one set of utilities. */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        white: v('white'),
        canvas: v('canvas'),
        surface: v('surface'),
        sunken: v('sunken'),
        ink: v('ink'),
        muted: v('muted'),
        subtle: v('subtle'),
        line: v('line'),
        'line-strong': v('line-strong'),
        accent: { DEFAULT: v('accent'), soft: v('accent-soft'), ink: v('accent-ink') },
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        bad: { DEFAULT: v('bad'), soft: v('bad-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
      },
      fontFamily: {
        sans: ['Inter', '"Inter Fallback"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['11.5px', '16px'],
        sm: ['12.5px', '18px'],
        base: ['13.5px', '20px'],
        lg: ['15px', '22px'],
        xl: ['17px', '24px'],
        '2xl': ['20px', '28px'],
      },
      gap: {
        4: '0.75rem',
        5: '0.875rem',
        6: '1rem',
      },
      space: {
        4: '0.75rem',
        5: '0.875rem',
        6: '1rem',
      },
      borderRadius: {
        xl: '0.6rem',
        '2xl': '0.85rem',
      },
      boxShadow: {
        pop: '0 12px 32px -12px rgba(0,0,0,0.32), 0 2px 6px -2px rgba(0,0,0,0.1)',
      },
    },
  },
};
