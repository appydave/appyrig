import { useEffect, useState } from 'react';

/**
 * Where a slide-out may start so it never covers the top bar: the CSS variable `--ar-top-offset`
 * (px, set by the shell, if it sets one), else the bottom edge of the v2 nav, else 0. Measured on
 * open, then again on resize and scroll.
 */
export function measureTopOffset(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--ar-top-offset');
    const px = parseFloat(raw);

    if (Number.isFinite(px) && px > 0) {
      return px;
    }

    // before the shell has published the variable: the whole sticky bar (it can be two rows), not just its nav
    const bar = document.querySelector('.app-header');

    if (bar) {
      return Math.max(0, Math.round(bar.getBoundingClientRect().bottom));
    }

    const nav = document.querySelector('[data-testid="ar-nav"]');

    if (nav) {
      return Math.max(0, Math.round(nav.getBoundingClientRect().bottom));
    }
  } catch {
    // no layout (tests): start at the top
  }

  return 0;
}

export function useTopOffset(): number {
  const [top, setTop] = useState(measureTopOffset);

  useEffect(() => {
    const on = () => setTop(measureTopOffset());

    on();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    // the shell re-measures its bar (it wraps to another row once the page settles) and says so
    window.addEventListener('appyrig:top-offset', on);

    return () => {
      window.removeEventListener('appyrig:top-offset', on);
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, []);

  return top;
}
