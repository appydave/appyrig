import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  HandoffLegend,
  LINE_EXPLAIN,
  LINE_HEAVY_FROM,
  LINE_LEGEND,
  LINE_MEDIUM_FROM,
  LINE_WIDTH,
  LINE_WIDTH_CAP,
  LeftOpenBadgeSvg,
  LineMarksChips,
  PLANNED_DASH,
  WaitingBadgeSvg,
  arrowHeads,
  lineClass,
  lineFocusId,
  lineFocusState,
  lineMarks,
  lineStep,
  lineWidth,
  mergePairs,
  pairLabel,
  podRail,
  relativeWidthLines,
  useLineFocus,
} from './index.js';

describe('width steps are absolute counts', () => {
  it('thin 1–9, medium 10–49, heavy 50+ (the cut-offs are the named constants)', () => {
    expect([LINE_MEDIUM_FROM, LINE_HEAVY_FROM]).toEqual([10, 50]);
    for (const [n, step] of [
      [0, 'thin'],
      [1, 'thin'],
      [9, 'thin'],
      [10, 'medium'],
      [49, 'medium'],
      [50, 'heavy'],
      [71, 'heavy'],
      [5000, 'heavy'],
    ] as const)
      expect(lineStep(n), `count ${n}`).toBe(step);
  });

  it('a high count/max ratio on a low count stays thin: 3 of a max of 3 is thin', () => {
    // the old formula made the busiest pair of every rig fat, however few handoffs it had
    const counts = [3, 2, 1];
    const max = Math.max(...counts);
    expect(counts[0]! / max).toBe(1);
    expect(lineStep(counts[0]!)).toBe('thin');
    expect(lineWidth(3)).toBe(LINE_WIDTH.thin);
    // and the same count is the same width in a rig where it is NOT the busiest
    expect(lineWidth(3)).toBe(lineWidth(3));
  });

  it('widths are thin 1.5, medium 2.2, heavy 3, and nothing exceeds the cap', () => {
    expect(LINE_WIDTH).toEqual({ thin: 1.5, medium: 2.2, heavy: 3 });
    expect(LINE_WIDTH_CAP).toBe(3);
    for (const n of [0, 1, 9, 10, 49, 50, 71, 1e6])
      expect(lineWidth(n)).toBeLessThanOrEqual(LINE_WIDTH_CAP);
  });
});

describe('mergePairs: one entry per unordered pair', () => {
  const edges = [
    { from: 'b', to: 'a', count: 8, open: 1, stale: 0 },
    { from: 'a', to: 'b', count: 14, open: 0, stale: 2 },
    { from: 'a', to: 'c', count: 3 },
    { from: 'c', to: 'c', count: 9 }, // a line to itself is not a pair
    { from: 'a', to: 'd', count: 0, planned: true },
  ];

  it('merges both directions with the split kept, and sums the marks', () => {
    const pairs = mergePairs(edges);
    expect(pairs.map((p) => `${p.a}-${p.b}`)).toEqual(['a-b', 'a-c', 'a-d']);
    expect(pairs[0]).toEqual({
      a: 'a',
      b: 'b',
      aToB: 14,
      bToA: 8,
      total: 22,
      waiting: 1,
      leftOpen: 2,
      planned: false,
    });
    expect(pairs[1]).toMatchObject({ aToB: 3, bToA: 0, total: 3, planned: false });
  });

  it('planned only when the pair has no handoff at all', () => {
    const pairs = mergePairs(edges);
    expect(pairs.find((p) => p.b === 'd')).toMatchObject({ planned: true, total: 0 });
    // a planned edge on a pair that also has real handoffs is not dotted
    expect(
      mergePairs([...edges, { from: 'a', to: 'b', count: 0, planned: true }])[0]!.planned
    ).toBe(false);
  });

  it('the same pair has the same entry whichever way round it is given', () => {
    expect(mergePairs([{ from: 'x', to: 'y', count: 2 }])).toEqual(
      mergePairs([{ from: 'y', to: 'x', count: 2 }]).map((p) => ({
        ...p,
        aToB: p.bToA,
        bToA: p.aToB,
      }))
    );
  });
});

describe('labels and arrowheads', () => {
  it('"14 ⇄ 8" both ways, "14 →" one way, "← 8" the other, nothing when planned', () => {
    expect(pairLabel({ aToB: 14, bToA: 8 })).toBe('14 ⇄ 8');
    expect(pairLabel({ aToB: 14, bToA: 0 })).toBe('14 →');
    expect(pairLabel({ aToB: 0, bToA: 8 })).toBe('← 8');
    expect(pairLabel({ aToB: 0, bToA: 0 })).toBe('');
  });

  it('arrowheads sit at the end(s) the handoffs went to', () => {
    expect(arrowHeads({ aToB: 14, bToA: 8 })).toEqual({ atA: true, atB: true });
    expect(arrowHeads({ aToB: 14, bToA: 0 })).toEqual({ atA: false, atB: true });
    expect(arrowHeads({ aToB: 0, bToA: 8 })).toEqual({ atA: true, atB: false });
    expect(arrowHeads({ aToB: 0, bToA: 0 })).toEqual({ atA: false, atB: false });
  });
});

describe('status as marks', () => {
  it('lineMarks reads the counts; dotted is the planned pattern only', () => {
    expect(lineMarks({ waiting: 2, leftOpen: 1 })).toEqual({ waiting: 2, leftOpen: 1 });
    expect(PLANNED_DASH).toBe('1 4');
    expect(lineClass('faint', true)).toContain('hl-planned');
    expect(lineClass('faint')).not.toContain('hl-planned');
    // no other line class carries a dash: waiting and left-open are never line styles
    expect(lineClass('lit')).toBe('hl-line hl-lit');
  });

  it('the badges render only when there is something to say', () => {
    const { container, rerender } = render(
      <svg>
        <WaitingBadgeSvg x={10} y={10} n={0} />
        <LeftOpenBadgeSvg x={30} y={10} n={0} />
      </svg>
    );
    expect(container.querySelector('.hl-badge')).toBeNull();
    rerender(
      <svg>
        <WaitingBadgeSvg x={10} y={10} n={3} />
        <LeftOpenBadgeSvg x={30} y={10} n={2} />
      </svg>
    );
    expect(screen.getByTestId('hl-waiting')).toHaveTextContent('3');
    expect(screen.getByTestId('hl-left-open').querySelector('title')).toHaveTextContent(
      '2 left open over 2 h'
    );
    rerender(<LineMarksChips waiting={4} leftOpen={0} />);
    expect(screen.getByTestId('hl-waiting-chip')).toHaveTextContent('4 waiting');
    expect(screen.queryByTestId('hl-open-chip')).toBeNull();
  });

  it('podRail: one rail per pair of pods with a total, both directions together, none inside a pod', () => {
    const rails = podRail([
      { fromPod: 'dev', toPod: 'qa', count: 14, open: 1 },
      { fromPod: 'qa', toPod: 'dev', count: 8, stale: 1 },
      { fromPod: 'dev', toPod: 'review', count: 5 },
      { fromPod: 'dev', toPod: 'dev', count: 20 },
    ]);
    expect(rails).toHaveLength(2);
    expect(rails[0]).toMatchObject({
      a: 'dev',
      b: 'qa',
      aToB: 14,
      bToA: 8,
      total: 22,
      waiting: 1,
      leftOpen: 1,
    });
    expect(rails[1]).toMatchObject({ a: 'dev', b: 'review', total: 5 });
  });
});

describe('calm / lit / dimmed', () => {
  it('faint with nothing focused; focusing a node lights its lines and dims the rest', () => {
    expect(lineFocusState(null, 'a', 'b')).toBe('faint');
    expect(lineFocusState('a', 'a', 'b')).toBe('lit');
    expect(lineFocusState('b', 'a', 'b')).toBe('lit');
    expect(lineFocusState('c', 'a', 'b')).toBe('dimmed');
  });

  it('focusing a line lights only that line (whichever way round its ends are given)', () => {
    const f = lineFocusId('a', 'b');
    expect(lineFocusState(f, 'a', 'b')).toBe('lit');
    expect(lineFocusState(f, 'b', 'a')).toBe('lit');
    expect(lineFocusState(f, 'a', 'c')).toBe('dimmed');
  });

  it('useLineFocus: pointer hover and keyboard focus both light, leaving and blur both clear', () => {
    const { result } = renderHook(() => useLineFocus());
    expect(result.current.stateOf('a', 'b')).toBe('faint');
    const p = result.current.focusProps('a');
    act(() => p.onPointerEnter());
    expect(result.current.stateOf('a', 'b')).toBe('lit');
    expect(result.current.stateOf('c', 'd')).toBe('dimmed');
    act(() => p.onPointerLeave());
    expect(result.current.stateOf('a', 'b')).toBe('faint');
    act(() => p.onFocus()); // keyboard focus counts
    expect(result.current.stateOf('a', 'b')).toBe('lit');
    act(() => p.onBlur());
    expect(result.current.focus).toBeNull();
  });

  it('the focus handlers spread onto a real element and respond to focus events', () => {
    function Probe() {
      const f = useLineFocus();
      return (
        <div>
          <button data-testid="agent" {...f.focusProps('x')}>
            x
          </button>
          <span data-testid="state">{f.stateOf('x', 'y')}</span>
        </div>
      );
    }
    render(<Probe />);
    expect(screen.getByTestId('state')).toHaveTextContent('faint');
    fireEvent.focus(screen.getByTestId('agent'));
    expect(screen.getByTestId('state')).toHaveTextContent('lit');
    fireEvent.blur(screen.getByTestId('agent'));
    expect(screen.getByTestId('state')).toHaveTextContent('faint');
  });

  it('the css is calm by default: a faint ink, lit at full, dimmed nearly gone, no glow, dotted for planned', () => {
    const css = readFileSync(path.resolve(__dirname, 'handoffLines.css'), 'utf8');
    expect(css).toMatch(/\.hl-faint \{\s*stroke-opacity: 0\.32/);
    expect(css).toMatch(/\.hl-lit \{\s*stroke-opacity: 1/);
    expect(css).toMatch(/\.hl-dimmed \{\s*stroke-opacity: 0\.1/);
    expect(css).toMatch(/\.hl-planned \{\s*stroke-dasharray: 1 4/);
    expect(css).not.toMatch(/glow|drop-shadow|prefers-color-scheme/);
  });
});

describe('one legend, one explain sentence', () => {
  it('the legend and the sentence are exported once and say the cut-offs the module uses', () => {
    expect(LINE_LEGEND.map((e) => e.key)).toEqual([
      'thin',
      'medium',
      'heavy',
      'both',
      'waiting',
      'leftOpen',
      'planned',
      'calm',
    ]);
    expect(LINE_EXPLAIN).toContain('14 ⇄ 8');
    expect(LINE_EXPLAIN).toContain(`${LINE_HEAVY_FROM}+`);
    expect(LINE_EXPLAIN).toContain('Dotted means planned and nothing else');
  });

  it('every screen renders the same words from the HandoffLegend component', () => {
    const a = render(<HandoffLegend />);
    const first = screen.getByTestId('hl-explain').textContent;
    expect(first).toBe(LINE_EXPLAIN);
    expect(a.container.querySelectorAll('li')).toHaveLength(LINE_LEGEND.length);
    // the "14 ⇄ 8" sample is the label: it appears once in the legend, not twice
    const both = a.container.querySelector('[data-legend="both"]')!;
    expect(both.textContent!.match(/14 ⇄ 8/g)).toHaveLength(1);
    a.unmount();
    render(<HandoffLegend compact />);
    expect(screen.getByTestId('hl-explain').textContent).toBe(first);
  });
});

describe('guard: no screen sizes a line by a share of the busiest pair', () => {
  it('the detector flags the old formulas and ignores comments', () => {
    const old = [
      'strokeWidth={1.2 + (pl.edge.count / max) * 4}',
      'strokeWidth={1.8 + (p.count / maxCount) * 4.5}',
      'const w = 1.5 + (e.count / Math.max(1, ...counts)) * 6; // stroke width',
    ];
    for (const l of old) expect(relativeWidthLines(l), l).toHaveLength(1);
    expect(
      relativeWidthLines('// stroke width: count / max is what we stopped doing')
    ).toHaveLength(0);
    expect(relativeWidthLines('strokeWidth={lineWidth(count)}')).toHaveLength(0);
    expect(relativeWidthLines('const share = done / maxItems; // unrelated')).toHaveLength(0);
  });

  // On since the three screens (Rig Map, Handoff Flow, Graph) all use this module.
  it('no file under client/src sizes a stroke by a division by a max', () => {
    const root = path.resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const f = path.join(dir, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) && n !== 'handoffLines.ts')
          files.push(f);
      }
    };
    walk(root);
    const hits = files.flatMap((f) =>
      relativeWidthLines(readFileSync(f, 'utf8')).map(
        (l) => `${path.relative(root, f)}: ${l.trim()}`
      )
    );
    expect(hits, 'relative width formulas left').toEqual([]);
  });
});
