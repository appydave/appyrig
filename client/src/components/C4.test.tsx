import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FleetSocket } from '../fleet/useFleet.js';
import FeedbackNotes from './FeedbackNotes.js';
import { SCREEN } from './KeysHelp.js';

function socketAnswering(value: unknown) {
  return {
    emit: vi.fn(),
    timeout: () => ({
      emit: (_e: string, _r: unknown, ack: (e: null, a: unknown) => void) =>
        queueMicrotask(() => ack(null, { ok: true, value })),
    }),
  } as unknown as FleetSocket;
}

const note = (id: string, over: object = {}) => ({
  id,
  createdAt: '2026-10-12T11:04:32.668Z',
  viewer: 'human:ui',
  verdict: 'question',
  region: 'flow:kernel',
  note: "When I see 3.1-minute medium handoff what's that really telling me?",
  route: '/',
  view: 'flow',
  selectedRig: 'roamy:kernel',
  hasScreenshot: true,
  appVersion: '0.1.0',
  ...over,
});

describe('C4 · F23: filed notes are listed in the app', () => {
  it('newest first, with verdict, view, rig, note and screenshot', async () => {
    const socket = socketAnswering({
      total: 2,
      notes: [note('fb-0002'), note('fb-0001', { verdict: 'down', hasScreenshot: false })],
      indexFile: null,
    });
    render(<FeedbackNotes socket={socket} onClose={vi.fn()} />);
    const rows = await screen.findAllByTestId('note-row');
    expect(rows.map((r) => r.dataset.noteId)).toEqual(['fb-0002', 'fb-0001']);
    expect(rows[0]).toHaveTextContent('flow · roamy:kernel · flow:kernel');
    expect(rows[0]).toHaveTextContent('3.1-minute medium handoff');
    expect(rows[0]!.querySelector('img')?.getAttribute('src')).toBe(
      '/v1/feedback/fb-0002/screenshot.png'
    );
    expect(rows[1]).toHaveTextContent('No screenshot with this note.');
    expect(screen.getByTestId('feedback-notes')).toHaveTextContent('2 in all, newest first');
  });

  it('none filed yet says how to file one', async () => {
    render(
      <FeedbackNotes
        socket={socketAnswering({ total: 0, notes: [], indexFile: null })}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByTestId('notes-empty')).toHaveTextContent('Press F');
  });
});

describe('C4 · F16: the keys overlay lists the Flow keys', () => {
  it('Tab, Enter, Esc and the arrows are there for the Flow', () => {
    const keys = SCREEN.flow.map(([k]) => k);
    for (const k of ['Tab', 'Enter', 'Esc', '← →']) expect(keys).toContain(k);
  });
});
