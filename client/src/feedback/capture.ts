import { toCanvas } from 'html-to-image';
import {
  FEEDBACK_ROUTE,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_SCREENSHOT_MAX_WIDTH,
  FEEDBACK_SNAPSHOT_MAX,
  UI_PRINCIPAL,
  type FeedbackAddInput,
  type FeedbackAddOutput,
} from '@appydave/shared';

/**
 * v1.4 S8: in-app feedback capture, after ImageDrip's Live UAT (FlagButton.tsx): four verdicts,
 * the note as the point, the screen captured with it. The one thing AppyRig writes, and only to its
 * own store through `POST /v1/feedback`.
 *
 * The screenshot is of the app itself, drawn from the page (html-to-image, MIT), so no browser
 * permission prompt. It is taken before the composer opens, of what is in the window now (not the
 * whole page), and scaled to at most 1600 px wide.
 */

export interface Shot {
  /** Base64 PNG, no data: prefix. */
  png: string;
  width: number;
  height: number;
  bytes: number;
}

const decodedBytes = (b64: string) => Math.floor((b64.length * 3) / 4);

/**
 * The page's web fonts as self-contained CSS (font files inlined as data: URLs), so the screenshot
 * draws the brand faces instead of wider fallbacks that re-wrap every label. Only the Latin faces,
 * fetched once per page. Null when they cannot be had (offline, an older hub's CSP): the screenshot
 * then uses fallback fonts rather than failing.
 */
let fontCss: Promise<string | null> | null = null;
const LATIN = /unicode-range:\s*U\+0000-00FF/i;

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function embeddedFonts(): Promise<string | null> {
  fontCss ??= (async () => {
    const link = document.querySelector<HTMLLinkElement>('link[href*="fonts.googleapis.com/css"]');
    if (!link) return null;
    try {
      const css = await (await fetch(link.href)).text();
      const faces = css
        .split('@font-face')
        .slice(1)
        .map((b) => `@font-face${b}`)
        .filter((f) => LATIN.test(f));
      const out = await Promise.all(
        faces.map(async (face) => {
          const url = face.match(/url\((https:[^)]+)\)/)?.[1];
          return url ? face.replace(url, await toDataUrl(url)) : face;
        })
      );
      return out.join('\n');
    } catch {
      return null;
    }
  })();
  return fontCss;
}

/** Elements marked `data-feedback-skip` (the composer, its toast) never appear in a screenshot. */
const keep = (n: HTMLElement) => !(n.dataset && 'feedbackSkip' in n.dataset);

export async function captureScreen(root: HTMLElement): Promise<Shot> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fonts = await embeddedFonts();
  // Most of the time one pass fits; a dense screen at 1600 px can still be too big, so step down.
  for (const width of [FEEDBACK_SCREENSHOT_MAX_WIDTH, 1200, 900]) {
    const ratio = Math.min(1, width / vw);
    const canvas = await toCanvas(root, {
      width: vw,
      height: vh,
      pixelRatio: ratio,
      backgroundColor: '#faf5ec',
      filter: keep,
      // The brand fonts, inlined once (embeddedFonts); without them, fallback fonts.
      ...(fonts ? { fontEmbedCSS: fonts } : { skipFonts: true }),
      style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
    });
    const png = canvas.toDataURL('image/png').split(',')[1] ?? '';
    const bytes = decodedBytes(png);
    if (bytes <= FEEDBACK_SCREENSHOT_MAX_BYTES) {
      return { png, width: canvas.width, height: canvas.height, bytes };
    }
  }
  throw new Error('the screenshot stayed over 3 MB even at 900 px wide');
}

/** The visible screen as plain text, for `snapshot`: legible after the data has moved on. */
export function composeSnapshot(head: string): string {
  const el =
    document.querySelector<HTMLElement>('[data-testid="focus-view"]') ??
    document.querySelector<HTMLElement>('main[data-testid^="view-body"], main[data-testid="wall"]');
  const body = (el?.innerText ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return `${head}\n${body}`.slice(0, FEEDBACK_SNAPSHOT_MAX);
}

/** A region the hub accepts: letters, digits and `:._ -`, at most 64. */
export function regionOf(raw: string): string {
  const r = raw.replace(/[^A-Za-z0-9:._ -]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return (r || 'app').slice(0, 64);
}

export type FileResult = { ok: true; value: FeedbackAddOutput } | { ok: false; message: string };

/** Each refusal in words: the person filing should know what happened and what to do. */
const WORDS: Record<number, string> = {
  400: 'The hub refused the note as written',
  401: 'Not signed in: open AppyRig once with ?token=<hub token>, then try again',
  403: 'Only a person can file feedback from this screen',
  404: 'This hub is older than feedback capture (v1.4 S8); it needs updating first',
  409: 'Feedback is full (500 notes); ask an agent to archive some',
  413: 'Too big for the hub; try again without the screenshot',
  503: 'The hub has nowhere to save notes (no data folder)',
};

export async function fileFeedback(input: FeedbackAddInput): Promise<FileResult> {
  let res: Response;
  try {
    res = await fetch(FEEDBACK_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-fli-principal': UI_PRINCIPAL },
      body: JSON.stringify(input),
    });
  } catch (e) {
    return {
      ok: false,
      message: `Could not reach the hub (${(e as Error).message}). Nothing was filed.`,
    };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // a proxy or old hub may answer with HTML
  }
  const b = body as
    { ok: true; value: FeedbackAddOutput } | { ok: false; error?: { message?: string } } | null;
  if (res.ok && b && b.ok) return { ok: true, value: b.value };
  const detail = b && !b.ok && b.error?.message ? `: ${b.error.message}` : '';
  return {
    ok: false,
    message: `${WORDS[res.status] ?? `The hub answered ${res.status}`}${detail}. Nothing was filed.`,
  };
}
