import type React from 'react';
import type { ChatBackground } from '../types/messaging';

const svg = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

export const chatBackgrounds: { id: ChatBackground; label: string }[] = [
  { id: 'plain', label: 'Plain' },
  { id: 'dots', label: 'Dots' },
  { id: 'grid', label: 'Blueprint' },
  { id: 'waves', label: 'Waves' },
  { id: 'doodles', label: 'Doodles' },
  { id: 'paper', label: 'Paper' },
];

/** Subtle, tiled pattern backgrounds for the chat timeline. Patterns only — no gradients. */
export function chatBackgroundStyle(bg: ChatBackground): React.CSSProperties {
  switch (bg) {
    case 'dots':
      return {
        backgroundColor: '#FFFFFF',
        backgroundImage: svg("<circle cx='2' cy='2' r='1.3' fill='#D9D9E3'/>", 18, 18),
      };
    case 'grid':
      return {
        backgroundColor: '#FBFBFF',
        backgroundImage: svg(
          "<path d='M24 0H0V24' fill='none' stroke='#E6E6F5' stroke-width='1'/>",
          24,
          24,
        ),
      };
    case 'waves':
      return {
        backgroundColor: '#FFFFFF',
        backgroundImage: svg(
          "<path d='M0 10c10 0 10-6 20-6s10 6 20 6' fill='none' stroke='#E4E7F2' stroke-width='1.4'/>",
          40,
          16,
        ),
      };
    case 'doodles':
      return {
        backgroundColor: '#FFFFFF',
        backgroundImage: svg(
          "<g fill='none' stroke='#E6E3F7' stroke-width='1.6' stroke-linecap='round'><path d='M12 14l4 4 7-8'/><circle cx='62' cy='16' r='6'/><path d='M96 10l3 6 6 1-5 4 1 6-5-3-5 3 1-6-5-4 6-1z'/><path d='M20 62c4-6 10-6 14 0'/><rect x='56' y='56' width='12' height='10' rx='2'/><path d='M94 58l8 8M102 58l-8 8'/><path d='M36 96l6-6 6 6'/><circle cx='86' cy='96' r='3'/></g>",
          120,
          112,
        ),
      };
    case 'paper':
      return {
        backgroundColor: '#FFFDF7',
        backgroundImage: svg("<path d='M0 27.5H32' stroke='#F1ECDD' stroke-width='1'/>", 32, 28),
      };
    default:
      return { backgroundColor: '#FFFFFF' };
  }
}
