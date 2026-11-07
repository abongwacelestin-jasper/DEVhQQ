import { useRef } from 'react';

interface CodeInputProps {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  invalid?: boolean;
  autoFocus?: boolean;
}

/** Six separate digit boxes. Typing advances, Backspace goes back, pasting a full code fills every box. */
export function CodeInput({
  value,
  onChange,
  length = 6,
  invalid = false,
  autoFocus = true,
}: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  // A cleared box is kept as a space so later digits never shift left (F-FE-6).
  const digits = Array.from({ length }, (_, i) => (/\d/.test(value[i] ?? '') ? value[i] : ''));

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(
      next
        .map((x) => x || ' ')
        .join('')
        .trimEnd(),
    );
  };

  return (
    <div className="flex gap-1.5 sm:gap-2" role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          autoFocus={autoFocus && i === 0}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) return setAt(i, '');
            setAt(i, v[v.length - 1]);
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) {
              setAt(i - 1, '');
              refs.current[i - 1]?.focus();
            }
            if (e.key === 'ArrowLeft') refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight') refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
            if (!text) return;
            e.preventDefault();
            onChange(text);
            refs.current[Math.min(text.length, length - 1)]?.focus();
          }}
          className={`h-11 w-full min-w-0 rounded-lg border text-center font-mono text-[18px] font-semibold text-ink outline-none transition-colors duration-150 focus:border-accent focus:ring-2 focus:ring-accent/20 ${
            invalid ? 'border-bad bg-bad-soft/40' : 'border-line-strong'
          }`}
        />
      ))}
    </div>
  );
}

/** True when every box holds a digit (a cleared middle box is a space, not a shorter code). */
export function isCompleteCode(value: string, length = 6): boolean {
  return value.length === length && /^\d+$/.test(value);
}
