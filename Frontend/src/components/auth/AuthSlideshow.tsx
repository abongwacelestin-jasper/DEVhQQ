import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from 'lucide-react';
import { AuthSlideArt, type SlideArt } from '../illustrations/AuthSlideArt';
import { useLanguage } from '../../contexts/LanguageContext';

export interface AuthSlide {
  art: SlideArt;
  title: string;
  body: string;
}

const DURATION = 6000;
const ease = [0.23, 1, 0.32, 1] as const;

/** Auto-advancing illustration carousel. Pauses on hover/focus and when the user presses pause. */
export function AuthSlideshow({ slides }: { slides: AuthSlide[] }) {
  const { t } = useLanguage();
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [hover, setHover] = useState(false);
  const [stopped, setStopped] = useState(false);
  const paused = hover || stopped;
  const slide = slides[index] ?? slides[0];

  const go = (next: number) => {
    setDir(next > index || (index === slides.length - 1 && next === 0) ? 1 : -1);
    setIndex((next + slides.length) % slides.length);
  };

  useEffect(() => {
    if (paused || slides.length < 2) return undefined;
    const id = window.setTimeout(() => {
      setDir(1);
      setIndex((i) => (i + 1) % slides.length);
    }, DURATION);
    return () => window.clearTimeout(id);
  }, [index, paused, slides.length]);

  const shift = reduce ? 0 : 28;

  return (
    <div
      className="w-full"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-roledescription="carousel"
    >
      <div className="relative mx-auto aspect-[4/3] w-full max-w-[400px] overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={index}
            custom={dir}
            initial={{ opacity: 0, x: dir * shift, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -dir * shift, scale: 0.98 }}
            transition={{ duration: 0.3, ease }}
            className="absolute inset-0"
          >
            <AuthSlideArt variant={slide.art} className="h-full w-full" />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative mt-4 min-h-[96px]" aria-live="polite">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease }}
          >
            <h2 className="text-[19px] font-semibold leading-snug tracking-tight text-ink lg:text-[21px]">
              {slide.title}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{slide.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={`${s.art}-${i}`}
              onClick={() => go(i)}
              aria-label={t('slide.goto', undefined, { n: i + 1 })}
              aria-current={i === index}
              className={`relative h-1.5 overflow-hidden rounded-full transition-[width] duration-200 ease-out ${i === index ? 'w-8 bg-ink/15' : 'w-1.5 bg-ink/20 hover:bg-ink/40'}`}
            >
              {i === index && (
                <motion.span
                  key={`${index}-${paused}`}
                  className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-ink"
                  initial={{ scaleX: paused ? 1 : 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: paused ? 0 : DURATION / 1000, ease: 'linear' }}
                />
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => go(index - 1)}
            className="rounded-md p-1.5 text-muted hover:bg-white/70 hover:text-ink"
            aria-label={t('slide.prev')}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => setStopped((v) => !v)}
            className="rounded-md p-1.5 text-muted hover:bg-white/70 hover:text-ink"
            aria-label={stopped ? t('slide.play') : t('slide.pause')}
          >
            {stopped ? <PlayIcon className="h-3.5 w-3.5" /> : <PauseIcon className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => go(index + 1)}
            className="rounded-md p-1.5 text-muted hover:bg-white/70 hover:text-ink"
            aria-label={t('slide.next')}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
