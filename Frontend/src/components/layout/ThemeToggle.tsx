import { AnimatePresence, motion } from 'framer-motion';
import { MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../contexts/LanguageContext';

/** Light/dark switch. The icon shows the mode you'll switch to. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const { t } = useLanguage();
  const label = theme === 'dark' ? t('theme.light') : t('theme.dark');

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -45, scale: 0.9 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 45, scale: 0.9 }}
          transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
          className="flex"
        >
          {theme === 'dark' ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
