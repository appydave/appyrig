import type { PageKey } from '../app/types.js';
import { PAGE_PURPOSE } from './legendData.js';

/** An ⓘ whose tooltip says, in plain words, what a page is for. Same words as its Legend's first section. */
export default function PageInfo({ page }: { page: PageKey }) {
  const text = PAGE_PURPOSE[page];
  if (!text) {
    return null;
  }

  return (
    <span
      className="page-info"
      role="img"
      tabIndex={0}
      title={text}
      aria-label={`What this page is for: ${text}`}
      data-testid="page-info"
    >
      ⓘ
    </span>
  );
}
