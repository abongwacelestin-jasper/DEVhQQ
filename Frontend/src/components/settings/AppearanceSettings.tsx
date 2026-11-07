import { useId } from 'react';
import { MoonIcon, SunIcon } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { inputClass } from '../ui/Modal';
import { useTheme, type Theme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';
import type { Lang } from '../../data/translations';

const themes: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
];

const languages: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
];

/** Theme and language apply at once and are remembered in this browser (same as the account menu). */
export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const { lang, setLang } = useLanguage();
  const id = useId();

  return (
    <Panel title="Appearance & language" meta={<span>Saved in this browser</span>}>
      <div className="grid gap-4 px-3.5 py-3 sm:grid-cols-2">
        <fieldset>
          <legend className="text-[12px] font-medium text-ink">Theme</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {themes.map((t) => (
              <label key={t.value} className="relative block">
                <input
                  type="radio"
                  name={`${id}-theme`}
                  value={t.value}
                  checked={theme === t.value}
                  onChange={() => setTheme(t.value)}
                  className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none opacity-0"
                />
                <span className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-line-strong text-[12.5px] font-medium text-ink transition-colors duration-150 peer-hover:bg-sunken/60 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-1">
                  <t.icon className="h-3.5 w-3.5" aria-hidden />
                  {t.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={`${id}-lang`} className="text-[12px] font-medium text-ink">
            Language
          </label>
          <select
            id={`${id}-lang`}
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className={`${inputClass} mt-1.5`}
          >
            {languages.map((l) => (
              <option key={l.value} value={l.value} lang={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Panel>
  );
}
