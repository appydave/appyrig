import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Legend from './Legend.js';
import { legendFor, type LegendScreen } from '../learn/legend.js';
import { GLOSSARY } from '../learn/glossary.js';

const VIEWS: LegendScreen[] = ['wall', 'map', 'flow', 'focus', 'accounts', 'machines', 'learn'];
const marks = (v: LegendScreen) => legendFor(v).flatMap((s) => s.entries.map((e) => e.mark));

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

  it('QA S1 rework: the Flow legend says what the code draws (D1, D2, D5, text fixes)', () => {
    const all = legendFor('flow')
      .flatMap((s) => s.entries.map((e) => `${e.mark} ${e.means}`))
      .join(' | ');
    for (const want of [
      'Solid arc above', // D1: a forward brief that skips a stage
      'Anything sent back to an earlier stage other than the Lead: rework, verdicts (PASS or FAIL), answers', // D2
      'Going back to the Lead', // D2: dashed = to the lead
      'median handoff → close', // D5
      'queue builds at QA',
      '▸ Consoles',
      'Dark chip = the rig shown',
      '▲ needs attention', // B2: the rig state on every chip, not a trailing "· running"
      'Panel shows: On click | Follow pointer', // B1: the panel says how it works
      'orch-boss@control as Lead', // D5: "no seat" can still show waiting
      'name@rig · name@machine', // text fix: test-team@m2
    ]) {
      expect(all).toContain(want);
    }
    const map = legendFor('map')
      .flatMap((s) => s.entries.map((e) => `${e.mark} ${e.means}`))
      .join(' | ');
    expect(map).toContain('POD · SEATS only gathers the outside seats'); // text fix
    expect(map).toContain('rig flicut-ab · stopped'); // D5
    expect(marks('wall').join(' ')).not.toContain('Black box'); // seat panel marks moved to Focus
  });

  it('every linked glossary term exists, and the amber arc links to the one "Sent back" meaning', () => {
    for (const v of VIEWS) {
      for (const e of legendFor(v).flatMap((s) => s.entries)) {
        if (e.term) expect(GLOSSARY[e.term], `${v}: ${e.mark} → ${e.term}`).toBeDefined();
      }
    }
    const amber = legendFor('flow')
      .flatMap((s) => s.entries)
      .find((e) => e.swatch === 'flow-rework')!;
    expect(GLOSSARY[amber.term!]!.term).toBe('Sent back');
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
