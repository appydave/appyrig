import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { listRigs, STALE_MS, type FlowEdge } from '@client/domain/fleet/views.js';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { LINE_WIDTH_CAP, lineWidth, relativeWidthLines } from '@client/kit/index.js';
import { page as flowPage } from './index.js';
import { rigPageCtx } from '@client/pages/page-test-kit.js';
import { flowPairs, pairPath } from '@client/domain/flow/flowLines.js';

/** Handoff Flow v2 on the kit's quiet line style (brief 2026-10-19, handoff lines). */

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

const ctxFor = (machines: FleetMachine[], rigName = 'starter') =>
  rigPageCtx(machines, rigName, NOW);

const q = (id: string, createdAt: string): QueueItem => ({
  id,
  source: 'a',
  destination: 'b',
  state: 'pending',
  priority: null,
  tags: [],
  summary: null,
  createdAt,
  updatedAt: createdAt,
});

const edge = (from: string, to: string, count: number, over: Partial<FlowEdge> = {}): FlowEdge => ({
  from,
  to,
  count,
  inFlight: [],
  items: [],
  rework: false,
  ...over,
});

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('flowPairs: one line per pair', () => {
  it('merges both directions, splits waiting from left open, and counts what went back', () => {
    const at = NOW;
    const fresh = new Date(at - 10 * 60_000).toISOString();
    const old = new Date(at - STALE_MS - 60_000).toISOString();
    const pairs = flowPairs(
      [
        edge('build', 'qa', 14, { inFlight: [q('w1', fresh), q('o1', old)] }),
        edge('qa', 'build', 8, { rework: true, inFlight: [q('o2', old)] }),
        edge('lead', 'build', 3),
        edge('qa', 'qa', 2),
      ],
      at
    );

    expect(pairs.map((p) => p.key)).toEqual(['pair:build|qa', 'pair:build|lead']);

    const bq = pairs[0]!;

    expect(bq).toMatchObject({ aToB: 14, bToA: 8, total: 22, waiting: 1, leftOpen: 2, back: 8 });
    expect(bq.edges).toHaveLength(2);
  });

  it('draws a pair from the left box to the right one, straight for neighbours, an arc further apart', () => {
    const ids = ['lead', 'build', 'qa', 'review'];
    const L = {
      x: (id: string) => 100 + ids.indexOf(id) * 200,
      idx: (id: string) => ids.indexOf(id),
      boxW: 120,
    };
    const near = pairPath({ a: 'qa', b: 'build' }, L, 200, 92);

    expect(near.aLeft).toBe(false);
    expect(near.d.startsWith('M360,200 L440,200')).toBe(true);

    const far = pairPath({ a: 'lead', b: 'review' }, L, 200, 92);

    expect(far.d).toContain(' C');
    expect(far.ly).toBeLessThan(200 - 46);
  });
});

describe('Handoff Flow v2 page: quiet lines', () => {
  const Flow = flowPage.component;

  it('one line per pair, width from the absolute count (never over the cap), labelled both ways', () => {
    const { container } = render(<Flow ctx={ctxFor([fleetMachine(snapshot('roamy--blocked'))])} />);
    const lines = screen.getAllByTestId('flow-edge');
    const pairsSeen = lines.map((l) => l.dataset.pair);

    expect(new Set(pairsSeen).size).toBe(pairsSeen.length);
    for (const l of lines) {
      const path = l.querySelector('path.hl-line')!;
      const pill = within(l).getByTestId('flow-count-pill');
      const total = Number(pill.dataset.count);

      expect(Number(path.getAttribute('stroke-width'))).toBe(lineWidth(total));
      expect(Number(path.getAttribute('stroke-width'))).toBeLessThanOrEqual(LINE_WIDTH_CAP);
      // a traffic line is never dotted or dashed: that is planned only
      expect(path.getAttribute('class')).not.toContain('hl-planned');
      expect(path.getAttribute('stroke-dasharray')).toBeNull();
    }

    // starter: dev-build and dev-review hand work both ways, so one line reads "n ⇄ m"
    expect(
      lines.some((l) =>
        /\d+ ⇄ \d+/.test(within(l).getByTestId('flow-count-pill').textContent ?? '')
      )
    ).toBe(true);
    // the kit's legend and explain sentence
    expect(screen.getByTestId('hl-legend')).toBeInTheDocument();
    expect(screen.getByTestId('hl-explain')).toHaveTextContent('Dotted means planned');
    expect(container.querySelector('.flow-edge')).toBeNull();
  });

  it('lines start faint; hovering or focusing a box lights its lines and dims the rest', () => {
    // m2: control and the factory-claude / fliedit-team rigs are busy; pick the busiest rig with 3+ boxes
    const machines = [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];
    const rigs = listRigs(machines).filter((r) => r.handoffs > 0);
    let found = false;

    for (const r of rigs) {
      const { unmount } = render(<Flow ctx={ctxFor(machines, r.name)} />);
      const lines = screen.queryAllByTestId('flow-edge');
      const stages = screen.queryAllByTestId('flow-stage');
      const box = stages.find((s) => {
        const id = s.dataset.stage!;
        const mine = lines.filter((l) => l.dataset.pair!.split('|').includes(id));

        return mine.length > 0 && mine.length < lines.length;
      });

      if (!box) {
        unmount();
        continue;
      }

      found = true;
      expect(lines.every((l) => l.dataset.state === 'faint')).toBe(true);

      const id = box.dataset.stage!;
      const touches = (l: HTMLElement) => l.dataset.pair!.split('|').includes(id);

      fireEvent.pointerEnter(box);
      for (const l of screen.getAllByTestId('flow-edge')) {
        expect(l.dataset.state).toBe(touches(l) ? 'lit' : 'dimmed');
      }

      fireEvent.pointerLeave(box);
      expect(screen.getAllByTestId('flow-edge').every((l) => l.dataset.state === 'faint')).toBe(
        true
      );
      fireEvent.focus(box);
      for (const l of screen.getAllByTestId('flow-edge')) {
        expect(l.dataset.state).toBe(touches(l) ? 'lit' : 'dimmed');
      }

      fireEvent.blur(box);

      // hovering a line lights that line only
      const first = screen.getAllByTestId('flow-edge')[0]!;

      fireEvent.pointerEnter(first);
      for (const l of screen.getAllByTestId('flow-edge')) {
        expect(l.dataset.state).toBe(l === first ? 'lit' : 'dimmed');
      }

      unmount();
      break;
    }

    expect(found, 'a rig with a box that has some but not all lines').toBe(true);
  });

  it('the structure lens draws planned lines dotted, one per pair', () => {
    const planned = [fleetMachine(snapshot('roamy--blocked'))];

    planned[0]!.snapshot.rigs.find((r) => r.name === 'starter')!.edges = [
      { from: 'dev-build@starter', to: 'dev-review@starter', kind: 'delegates_to' },
      { from: 'dev-review@starter', to: 'dev-build@starter', kind: 'can_observe' },
    ];
    render(<Flow ctx={ctxFor(planned)} />);
    fireEvent.click(screen.getByTestId('flow-lens-structure'));

    const lines = screen.getAllByTestId('flow-structure-line');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute('data-kind-text', 'delegates_to · can_observe');
    expect(lines[0]!.querySelector('path')!.getAttribute('class')).toContain('hl-planned');
  });

  it('no width is sized from the busiest pair in the Flow files', () => {
    for (const f of ['HandoffFlow.tsx', '../../domain/flow/flowLines.ts', 'index.tsx']) {
      const src = readFileSync(path.resolve(__dirname, f), 'utf8');

      expect(relativeWidthLines(src), f).toEqual([]);
    }
  });
});
