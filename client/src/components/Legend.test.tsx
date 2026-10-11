import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Legend from './Legend.js';
import { legendFor } from '../learn/legend.js';
import type { View } from '../App.js';

const VIEWS: View[] = ['wall', 'map', 'flow', 'accounts', 'learn'];
const marks = (v: View) => legendFor(v).flatMap((s) => s.entries.map((e) => e.mark));

describe('legend data (S1)', () => {
  it('every screen names the six seat states by glyph as well as colour', () => {
    for (const v of VIEWS) {
      const m = marks(v).join(' ');
      for (const g of ['● working', '○ idle', '▲ blocked', '✕ stopped', '? unknown', '◌ asleep']) {
        expect(m).toContain(g);
      }
    }
  });

  it('Rig Map names every mark from the feedback: width, count, amber, dashed, box, band, panel', () => {
    const all = legendFor('map')
      .flatMap((s) => s.entries.map((e) => `${e.mark} ${e.means}`))
      .join(' | ');
    for (const want of [
      'Thicker = more',
      'Number on a line',
      'Amber line',
      'more than 2 hours',
      'White box',
      'Grey band · POD',
      'Outer panel',
      '✕ stopped',
    ]) {
      expect(all).toContain(want);
    }
  });

  it('Handoff Flow names stage words vs name@rig, back arcs, dashed reports and dots', () => {
    const all = legendFor('flow')
      .flatMap((s) => s.entries.map((e) => `${e.mark} ${e.means}`))
      .join(' | ');
    for (const want of [
      'LEAD · BUILDERS · QA · REVIEWER',
      'guessed from seat names',
      'name@rig',
      'another rig',
      'N back',
      'Dashed arc above',
      'from other rigs',
      'Yellow dot',
      'N waiting',
      'no seat',
    ]) {
      expect(all).toContain(want);
    }
  });

  it('no screen lists the same mark twice', () => {
    for (const v of VIEWS) {
      const keys = legendFor(v).flatMap((s) => s.entries.map((e) => `${e.swatch}:${e.mark}`));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('<Legend>', () => {
  it('draws a swatch for every entry', () => {
    for (const v of VIEWS) {
      const { unmount } = render(<Legend view={v} onClose={() => {}} />);
      const entries = screen.getAllByTestId('legend-entry');
      expect(entries).toHaveLength(marks(v).length);
      for (const e of entries) {
        expect(e.querySelector('.legend-swatch')!.childElementCount).toBeGreaterThan(0);
      }
      unmount();
    }
  });
});
