import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import { listRigs } from '../domain/fleet/views.js';
import { pageFor } from '../app/registry.js';
import type { PageKey } from '../app/types.js';
import { answeringSocket, pageCtx } from './page-test-kit.js';

/**
 * v2 clean batch, headers unit: the WORK and UNDER THE HOOD pages (and the Agent page) open with the
 * kit's one-line PageHeader; explainer paragraphs sit behind Legend · L (`.ar-explainer` or
 * `.hl-legend`); a mock control in the header is behind the ⋯ MockMenu, never loose in the line.
 */

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

    const Page = pageFor(key)!.component;
    const { container } = render(<Page ctx={ctx} />);
    const main = container.querySelector('main')!;
    const heads = main.querySelectorAll('[data-testid="ar-page-head"]');

    expect(heads.length, `${key} has one page header`).toBe(1);
    // no other heading of the old kind above the content
    expect(main.querySelectorAll('h2:not(.ar-page-title)').length, `${key}: no loose h2`).toBe(0);
    // every fake inside the header sits in the ⋯ menu
    for (const f of heads[0]!.querySelectorAll('[data-testid="fake-control"]')) {
      expect(f.closest('.ar-mock-menu-pop'), `${key}: a header mock outside the ⋯`).not.toBeNull();
    }

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
      const Page = pageFor(key)!.component;
      const { container, unmount } = render(<Page ctx={ctx} />);
      const hit = [...container.querySelectorAll('p')].find((p) => p.textContent?.includes(text))!;

      expect(hit.closest('.ar-explainer, .hl-legend'), `${key}: "${text}"`).not.toBeNull();
      unmount();
    }
  });

  it('Flow keeps one seats line in both modes, so a rig change never changes its height', () => {
    const machines = [fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))];
    const { socket } = answeringSocket();
    const ctx = pageCtx(machines, socket, NOW);

    ctx.activeRig = listRigs(machines).find((r) => r.name === 'starter') ?? null;

    const Page = pageFor('flow')!.component;
    const { container } = render(<Page ctx={ctx} />);

    // starter has no QA or review seat: seats mode, which used to drop the line
    expect(container.querySelectorAll('.flow-legend')).toHaveLength(1);
  });
});
