import React from 'react';
import { LockIcon, ShieldCheckIcon } from 'lucide-react';
import { DevHQLogo } from '../ui/DevHQLogo';
import { AuthSlideshow, type AuthSlide } from './AuthSlideshow';
import { LanguageMenu } from '../layout/LanguageMenu';
import { ThemeToggle } from '../layout/ThemeToggle';
import { useLanguage } from '../../contexts/LanguageContext';
import type { SlideArt } from '../illustrations/AuthSlideArt';

interface AuthLayoutProps {
  /** Shown above the form on phones, where the slideshow column is hidden. */
  illustration?: React.ReactNode;
  aside: { title: string; body: string };
  step?: { index: number; total: number; label: string };
  /** Wider form column for multi-section screens (NDA, profile). */
  wide?: boolean;
  children: React.ReactNode;
}

const order: SlideArt[] = ['secure', 'ship', 'products', 'volunteer'];

/** Split layout for sign-in, recovery and onboarding: slideshow + form from tablet up, single column on phones. */
export function AuthLayout({ illustration, aside, step, wide = false, children }: AuthLayoutProps) {
  const { t } = useLanguage();
  const lead: SlideArt =
    step?.index === 2 ? 'volunteer' : step?.index === 3 ? 'products' : 'secure';
  const slides: AuthSlide[] = [
    { art: lead, title: aside.title, body: aside.body },
    ...order
      .filter((a) => a !== lead)
      .map((a) => ({ art: a, title: t(`slide.${a}.title`), body: t(`slide.${a}.body`) })),
  ];

  return (
    <div
      className={`grid min-h-screen w-full bg-white ${
        wide
          ? 'md:grid-cols-[minmax(260px,4fr)_minmax(0,8fr)] xl:grid-cols-[minmax(0,4fr)_minmax(0,9fr)]'
          : 'md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'
      }`}
    >
      <aside className="relative hidden flex-col justify-between gap-6 overflow-hidden border-r border-line bg-accent-soft/50 p-6 md:flex lg:p-10">
        <div className="flex items-center gap-2">
          <DevHQLogo size={26} />
          <span className="text-[14px] font-semibold tracking-tight text-ink">DevHQ</span>
        </div>
        <div className={`mx-auto w-full ${wide ? 'max-w-sm' : 'max-w-md'}`}>
          <AuthSlideshow slides={slides} />
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink">
          <li className="flex items-center gap-1">
            <ShieldCheckIcon className="h-3.5 w-3.5 text-ok" /> {t('auth.mfa')}
          </li>
          <li className="flex items-center gap-1">
            <LockIcon className="h-3.5 w-3.5 text-ok" /> {t('auth.audited')}
          </li>
        </ul>
      </aside>

      <main className="flex min-w-0 flex-col px-4 py-5 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:invisible">
            <DevHQLogo size={24} />
            <span className="text-[13.5px] font-semibold text-ink">DevHQ</span>
          </div>
          <div className="flex items-center gap-2">
            {step && (
              <div
                className="mr-1 flex items-center gap-2"
                aria-label={`Step ${step.index} of ${step.total}: ${step.label}`}
              >
                <span className="hidden text-[11.5px] font-medium text-muted sm:inline">
                  {step.label}
                </span>
                <span className="flex gap-1" aria-hidden>
                  {Array.from({ length: step.total }, (_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-6 rounded-full ${i < step.index ? 'bg-ink' : 'bg-line'}`}
                    />
                  ))}
                </span>
              </div>
            )}
            <LanguageMenu />
            <ThemeToggle />
          </div>
        </div>
        <div
          className={`mx-auto flex w-full flex-1 flex-col justify-center py-6 ${wide ? 'max-w-[880px]' : 'max-w-[480px]'}`}
        >
          {illustration && (
            <div className="mx-auto mb-4 w-full max-w-[180px] md:hidden">{illustration}</div>
          )}
          {children}
        </div>
        <p className="text-center text-[11px] text-muted">{t('auth.demo')}</p>
      </main>
    </div>
  );
}
