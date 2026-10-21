import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { allPages } from '../app/registry.js';
import Legend2 from './Legend2.js';
import PageInfo from './PageInfo.js';
import { LEGEND_PAGES, PAGE_PURPOSE, legendSections } from './legendData.js';

describe('the V2 Legend', () => {
  const pages = allPages().map((p) => p.key);

  it('every V2 page has a plain-words purpose and a legend of its own', () => {
    for (const k of pages) {
      expect(PAGE_PURPOSE[k], `${k}: purpose`).toBeTruthy();
      expect(LEGEND_PAGES, `${k}: legend section`).toContain(k);
      expect(PAGE_PURPOSE[k]!.length).toBeLessThan(300);
    }
  });

  it.each(pages)('%s: purpose first, then its marks, then Everywhere', (k) => {
    render(<Legend2 page={k} onClose={() => undefined} />);

    const sections = screen.getAllByTestId('legend2-section');

    expect(within(sections[0]!).getByTestId('legend2-purpose')).toHaveTextContent(PAGE_PURPOSE[k]!);
    expect(sections.at(-1)).toBeDefined();
    expect(screen.getByText(/Everywhere · the top bar/)).toBeInTheDocument();
    expect(screen.getByText(/Everywhere · the Agent panel/)).toBeInTheDocument();
  });

  it('the Run board says what it is in words a non-user can follow', () => {
    expect(PAGE_PURPOSE.run).toMatch(/list of jobs/);
    expect(PAGE_PURPOSE.map).toMatch(/One rig, full screen/);
    expect(PAGE_PURPOSE.graph).toMatch(/handoffs between rigs/);
  });

  it('draws the real marks: status pips, the real card, the machine-order toggle wording', () => {
    render(<Legend2 page="wall" onClose={() => undefined} />);
    expect(document.querySelectorAll('.state-badge[data-pip]').length).toBeGreaterThanOrEqual(6);
    expect(screen.getAllByTestId('wall-card').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.wcard[data-frosted]')).not.toBeNull();
    expect(screen.getByText(/Order: By machine · Busiest first/)).toBeInTheDocument();
    expect(screen.getByText(/frosted/i, { selector: 'b' })).toBeInTheDocument();
  });

  it('Graph, Flow and Rig Map show the handoff-line key once, here', () => {
    for (const k of ['graph', 'flow', 'map'] as const) {
      const { unmount } = render(<Legend2 page={k} onClose={() => undefined} />);

      expect(screen.getAllByTestId('hl-legend')).toHaveLength(1);
      unmount();
    }

    const css = readFileSync(path.resolve(__dirname, 'legend2.css'), 'utf8');

    expect(css).toMatch(/\.ar-app \.hl-legend:not\(\.legend2 \.hl-legend\)/);
  });

  it('keeps no V1-only entries', () => {
    const text = pages
      .flatMap((k) => legendSections(k))
      .flatMap((s) => s.entries.map((e) => `${e.mark} ${e.means}`))
      .join('\n');

    for (const stale of [
      /IDLE TEAMS/i,
      /show \d+ as tiles/i,

      /no OpenRig/i,
      /Click for the Machines view/i,
    ]) {
      expect(text).not.toMatch(stale);
    }
  });

  it('the app renders only the V2 legend; the page ⓘ carries the same words', () => {
    const app = readFileSync(path.resolve(__dirname, '../app/App.tsx'), 'utf8');

    expect(app).toMatch(/legendOpen && <Legend2/);
    expect(app).not.toMatch(/<Legend /);
    render(<PageInfo page="run" />);
    expect(screen.getByTestId('page-info')).toHaveAttribute('title', PAGE_PURPOSE.run);
  });

  it('Rig Map entries match the shipped page: WallCard cards, a PEOPLE pod, labelled lines', () => {
    const inside = readFileSync(path.resolve(__dirname, '../pages/graph/RigInside.tsx'), 'utf8');

    expect(inside).toMatch(/WallCard/);
    expect(inside).toMatch(/g2-humans/);

    const text = legendSections('map')
      .flatMap((s) => s.entries.map((e) => `${e.mark} ${e.means}`))
      .join('\n');

    expect(text).toMatch(/PEOPLE/);
    expect(text).toMatch(/V1-style cards/);
    expect(text).toMatch(/Dotted line/);
    expect(legendSections('map').some((s) => s.show === 'handoff-lines')).toBe(true);
  });

  it('Run board purpose says its files are a D09 convention, not OpenRig data', () => {
    expect(PAGE_PURPOSE.run).toMatch(/D09 convention, not OpenRig structures/);
  });

  it('Hide closes it', () => {
    let closed = 0;

    render(<Legend2 page="wall" onClose={() => closed++} />);
    fireEvent.click(screen.getByTestId('legend2-close'));
    expect(closed).toBe(1);
  });
});
