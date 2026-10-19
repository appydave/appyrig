import { useEffect, useState } from 'react';

/**
 * Where a slide-out may start so it never covers the top bar: the CSS variable `--v2-top-offset`
 * (px, set by the shell, if it sets one), else the bottom edge of the v2 nav, else 0. Measured on
 * open, then again on resize and scroll.
 */
export function measureTopOffset(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--v2-top-offset');
    const px = parseFloat(raw);
    if (Number.isFinite(px) && px > 0) return px;
    const nav = document.querySelector('[data-testid="v2-nav"]');
    if (nav) return Math.max(0, Math.round(nav.getBoundingClientRect().bottom));
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
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
    };
  }, []);
  return top;
}
