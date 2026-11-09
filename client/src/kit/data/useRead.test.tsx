import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { callVerb } from '@client/domain/fleet/coreCall.js';
import { socketWithEvents } from '@client/test/socketWithEvents.js';
import { useRead } from './index.js';

type CallAnswer = Awaited<ReturnType<typeof callVerb>>;

interface Asked {
  request: { verb: string; input: unknown };
  answer: (a: CallAnswer) => Promise<void>;
}

/** A socket that records each verb call and answers only when the test says so. */
function holdingSocket() {
  const asked: Asked[] = [];
  const emit = (
    _event: string,
    request: Asked['request'],
    cb: (err: null, a: CallAnswer) => void
  ) => {
    asked.push({ request, answer: (a) => act(async () => cb(null, a)) });
  };

  const { socket } = socketWithEvents({ timeout: vi.fn(() => ({ emit })) });

  return { asked, getSocket: () => socket };
}

const OK = { ok: true, value: { n: 1 } } as CallAnswer;
const ERR = { failureMode: 'rig-not-found', message: 'no such rig' };

describe('useRead: one verb call, four states', () => {
  it('loading, then ok with the value', async () => {
    const { asked, getSocket } = holdingSocket();
    const { result } = renderHook(() => useRead(getSocket, 'rig.files', { rig: 'a' }));

    expect(result.current).toEqual({ state: 'loading' });
    expect(asked.map((a) => a.request)).toEqual([{ verb: 'rig.files', input: { rig: 'a' } }]);

    await asked[0]!.answer(OK);

    expect(result.current).toEqual({ state: 'ok', value: { n: 1 } });
  });

  it('a refusal carries the error', async () => {
    const { asked, getSocket } = holdingSocket();
    const { result } = renderHook(() => useRead(getSocket, 'rig.files', { rig: 'a' }));

    await asked[0]!.answer({ ok: false, error: ERR } as CallAnswer);

    expect(result.current).toEqual({
      state: 'refused',
      error: ERR,
    });
  });

  it('null input is na from the first render and never asks the socket', async () => {
    const { asked, getSocket } = holdingSocket();
    const { result, rerender } = renderHook(() => useRead(getSocket, 'rig.files', null));

    expect(result.current).toEqual({ state: 'na' });

    rerender();

    expect(result.current).toEqual({ state: 'na' });
    expect(asked).toHaveLength(0);
  });

  it('null input is na on the very first render, not one loading render first', () => {
    const { getSocket } = holdingSocket();
    const seen: string[] = [];

    renderHook(() => {
      const got = useRead(getSocket, 'rig.files', null);

      seen.push(got.state);

      return got;
    });

    expect(seen[0]).toBe('na');
  });

  it('a different getter (another socket) asks again; the same getter does not', () => {
    const first = holdingSocket();
    const second = holdingSocket();
    const { rerender } = renderHook(
      ({ getSocket }) => useRead(getSocket, 'rig.files', { rig: 'a' }),
      { initialProps: { getSocket: first.getSocket } }
    );

    rerender({ getSocket: first.getSocket });

    expect(first.asked).toHaveLength(1);

    rerender({ getSocket: second.getSocket });

    expect(second.asked).toHaveLength(1);
  });

  it('an equal input on a new object is not asked again; a changed input is', async () => {
    const { asked, getSocket } = holdingSocket();
    const { result, rerender } = renderHook(({ rig }) => useRead(getSocket, 'rig.files', { rig }), {
      initialProps: { rig: 'a' },
    });

    await asked[0]!.answer(OK);
    rerender({ rig: 'a' });

    expect(asked).toHaveLength(1);
    expect(result.current.state).toBe('ok');

    rerender({ rig: 'b' });

    expect(result.current).toEqual({ state: 'loading' });
    expect(asked.map((a) => a.request.input)).toEqual([{ rig: 'a' }, { rig: 'b' }]);
  });

  it('a late answer to an earlier input is ignored', async () => {
    const { asked, getSocket } = holdingSocket();
    const { result, rerender } = renderHook(({ rig }) => useRead(getSocket, 'rig.files', { rig }), {
      initialProps: { rig: 'a' },
    });

    rerender({ rig: 'b' });
    await asked[0]!.answer({ ok: true, value: 'stale' } as CallAnswer);

    expect(result.current).toEqual({ state: 'loading' });

    await asked[1]!.answer({ ok: true, value: 'fresh' } as CallAnswer);

    expect(result.current).toEqual({ state: 'ok', value: 'fresh' });
  });

  it('input going to null becomes na and ignores the answer that was in flight', async () => {
    const { asked, getSocket } = holdingSocket();
    const { result, rerender } = renderHook(
      ({ input }: { input: { rig: string } | null }) => useRead(getSocket, 'rig.files', input),
      { initialProps: { input: { rig: 'a' } as { rig: string } | null } }
    );

    rerender({ input: null });
    await asked[0]!.answer(OK);

    expect(result.current).toEqual({ state: 'na' });
  });
});
