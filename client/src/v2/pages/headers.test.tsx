import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { fleetMachine, snapshot } from '../../test/fleetFixtures.js';
import { listRigs } from '../../fleet/views.js';
import { v2PageFor } from '../registry.js';
import type { PageKey } from '../types.js';
import { answeringSocket, pageCtx } from './page-test-kit.js';

/**
 * v2 clean batch, headers unit: the WORK and UNDER THE HOOD pages (and the Agent page) open with the
 * kit's one-line PageHeader; explainer paragraphs sit behind Legend · L (`.v2-explainer` or
 * `.hl-legend`); a mock control in the header is behind the ⋯ MockMenu, never loose in the line.
 */

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    reset() {}
    write() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const PAGES: PageKey[] = ['flow', 'run', 'missions', 'needs-you', 'timeline', 'history', 'agent'];

describe('one-line page headers', () => {
  it.each(PAGES)('%s opens with the one-line PageHeader, and nothing else above it', (key) => {
    const machines = [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];
    const { socket, emitted } = answeringSocket();
    const ctx = pageCtx(machines, socket, NOW);
    const rigs = listRigs(machines);
    ctx.activeRig = rigs.find((r) => r.name === 'starter') ?? null;
    ctx.agentKey = 'roamy/dev-build@starter';
    const Page = v2PageFor(key)!.component;
    const { container } = render(<Page ctx={ctx} />);
    const main = container.querySelector('main')!;
    const heads = main.querySelectorAll('[data-testid="v2-page-head"]');
    expect(heads.length, `${key} has one page header`).toBe(1);
    // no other heading of the old kind above the content
    expect(main.querySelectorAll('h2:not(.v2-page-title)').length, `${key}: no loose h2`).toBe(0);
    // every fake inside the header sits in the ⋯ menu
    for (const f of heads[0]!.querySelectorAll('[data-testid="fake-control"]'))
      expect(f.closest('.v2-mock-menu-pop'), `${key}: a header mock outside the ⋯`).not.toBeNull();
    expect(emitted).toEqual([]);
  });

  it('explainer paragraphs are marked for Legend · L', () => {
    const machines = [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];
    const { socket } = answeringSocket();
    const ctx = pageCtx(machines, socket, NOW);
    for (const [key, text] of [
      ['missions', 'not OpenRig'],
      ['needs-you', 'Everything waiting on David'],
      ['history', 'Each handoff and the state it went into'],
    ] as const) {
      const Page = v2PageFor(key)!.component;
      const { container, unmount } = render(<Page ctx={ctx} />);
      const hit = [...container.querySelectorAll('p')].find((p) => p.textContent?.includes(text))!;
      expect(hit.closest('.v2-explainer, .hl-legend'), `${key}: "${text}"`).not.toBeNull();
      unmount();
    }
  });

  it('Flow keeps one seats line in both modes, so a rig change never changes its height', () => {
    const machines = [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];
    const { socket } = answeringSocket();
    const ctx = pageCtx(machines, socket, NOW);
    ctx.activeRig = listRigs(machines).find((r) => r.name === 'starter') ?? null;
    const Page = v2PageFor('flow')!.component;
    const { container } = render(<Page ctx={ctx} />);
    // starter has no QA or review seat: seats mode, which used to drop the line
    expect(container.querySelectorAll('.flow-legend')).toHaveLength(1);
  });
});
