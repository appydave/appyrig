import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import RigPicker from './RigPicker.js';
import { rigFacts } from './RigInfo.js';
import type { RigRef } from '@client/domain/fleet/views/core/types.js';

const rig = (over: Partial<RigRef> = {}): RigRef => ({
  key: 'm2:appyrig-v14',
  machineId: 'm2',
  machineLabel: 'M2',
  name: 'appyrig-v14',
  status: 'running',
  state: 'working',
  seatCount: 5,
  handoffs: 19,
  lastActivity: '2026-10-11T11:40:00Z',
  ...over,
});

describe('rigFacts (S3)', () => {
  it('says each unknown honestly, and never guesses', () => {
    expect(rigFacts(rig()).spec).toMatch(/^Not reported/);
    expect(rigFacts(rig({ specStatus: 'not-found' })).spec).toBe(
      'Spec not found in the configured spec folders.'
    );
    expect(rigFacts(rig({ specStatus: 'found', specPath: '/x/rig.yaml' })).spec).toBe(
      '/x/rig.yaml'
    );
    expect(rigFacts(rig({ specStatus: 'found', summary: null })).summary).toBe(
      'No summary: line in its rig.yaml.'
    );
    expect(rigFacts(rig()).owner).toBe('No owner set in AppyRig config.');
  });
});

describe('<RigPicker> with S3 fields', () => {
  const rigs = [
    rig({
      displayName: 'AppyRig v1.4 team',
      owner: 'openrig-orch-m4',
      summary: 'Builds AppyRig v1.4 from David’s feedback.',
      specStatus: 'found',
      specPath: '/Users/davidcruwys/dev/ad/brains/north-star/appyrig-v1.4/team/rig.yaml',
    }),
    rig({ key: 'm2:flicut-ab', name: 'flicut-ab', status: 'stopped', specStatus: 'not-found' }),
  ];

  it('chips show the display name and machine; the summary floats in the tooltip (C5); the rig id stays the key', () => {
    render(<RigPicker rigs={rigs} selected="m2:appyrig-v14" onSelect={() => {}} />);

    const chip = screen.getAllByTestId('rig-chip')[0]!;

    expect(chip).toHaveAttribute('data-rig-key', 'm2:appyrig-v14');
    expect(within(chip).getByTestId('rig-chip-name')).toHaveTextContent('AppyRig v1.4 team');
    expect(chip).toHaveTextContent('· m2');
    expect(chip.getAttribute('title')).toContain('Builds AppyRig');
  });

  it('C5 (F12): no two entries read the same; the dropdown jumps to a rig', () => {
    const kernels = ['m2', 'm4', 'roamy'].map((m) =>
      rig({
        key: `${m}:kernel`,
        machineId: m,
        machineLabel: m.toUpperCase(),
        name: 'kernel',
        displayName: undefined,
      })
    );
    let picked = '';

    render(<RigPicker rigs={kernels} selected="m2:kernel" onSelect={(k) => (picked = k)} />);

    const chipTexts = screen.getAllByTestId('rig-chip').map((c) => c.textContent);

    expect(new Set(chipTexts).size).toBe(3);

    const options = [...screen.getByTestId('rig-select').querySelectorAll('option')].map(
      (o) => o.textContent
    );

    expect(new Set(options).size).toBe(3);
    expect(options.join('|')).toMatch(/kernel · m4/);
    fireEvent.change(screen.getByTestId('rig-select'), { target: { value: 'roamy:kernel' } });
    expect(picked).toBe('roamy:kernel');
  });

  it('the chosen rig shows summary, owner and spec path; hovering another never swaps the panel (B1 fb-0002)', () => {
    render(<RigPicker rigs={rigs} selected="m2:appyrig-v14" onSelect={() => {}} />);

    const info = () => screen.getByTestId('rig-info');

    expect(info()).toHaveAttribute('data-rig-key', 'm2:appyrig-v14');
    expect(screen.getByTestId('rig-info-id')).toHaveTextContent('appyrig-v14');
    expect(screen.getByTestId('rig-info-owner')).toHaveTextContent('openrig-orch-m4');
    expect(screen.getByTestId('rig-info-spec')).toHaveTextContent('appyrig-v1.4/team/rig.yaml');

    const other = screen.getAllByTestId('rig-chip')[1]!;

    fireEvent.pointerEnter(screen.getByTestId('rig-picker'));
    fireEvent.pointerEnter(other);
    // The panel stays on the chosen rig; the hovered rig's facts float in the chip's own tooltip.
    expect(info()).toHaveAttribute('data-rig-key', 'm2:appyrig-v14');
    expect(other.getAttribute('title')).toMatch(/Spec: .*not found/i);
    expect(screen.getByTestId('rig-picker')).toHaveAttribute('data-frozen', 'true');
    fireEvent.pointerLeave(screen.getByTestId('rig-picker'));
    expect(screen.getByTestId('rig-picker')).not.toHaveAttribute('data-frozen');
  });
});

describe('B2 (fb-0001): every rig chip shows its state as glyph + word + colour', () => {
  it('renders the state on each chip, never colour alone', () => {
    render(
      <RigPicker
        rigs={[
          rig({ key: 'a', name: 'a', state: 'working' }),
          rig({ key: 'b', name: 'b', state: 'attention' }),
          rig({ key: 'c', name: 'c', status: 'stopped', state: 'stopped' }),
        ]}
        selected="a"
        onSelect={() => {}}
      />
    );

    const states = screen.getAllByTestId('rig-state').map((e) => e.textContent);

    expect(states).toEqual(['● working', '▲ needs attention', '✕ stopped']);

    const chip = screen.getAllByTestId('rig-chip')[1]!;

    expect(chip).toHaveAttribute('data-state', 'attention');
    expect(chip.getAttribute('title')).toMatch(/^▲ needs attention/);
  });
});
