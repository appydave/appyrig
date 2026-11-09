import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { socketWithEvents } from './socketWithEvents.js';

function Listener({ socket }: { socket: ReturnType<typeof socketWithEvents>['raw'] }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    const h = () => setN((x) => x + 1);

    socket.on('tick', h);

    return () => {
      socket.off('tick', h);
    };
  }, [socket]);

  return <p data-testid="n">{n}</p>;
}

describe('socketWithEvents', () => {
  it('fire runs a listener added with on', () => {
    const { raw, fire } = socketWithEvents();
    const h = vi.fn();

    raw.on('a', h);
    fire('a', 1, 'x');

    expect(h).toHaveBeenCalledWith(1, 'x');
  });

  it('does not run a listener after off, and other events keep theirs', () => {
    const { raw, fire } = socketWithEvents();
    const gone = vi.fn();
    const kept = vi.fn();

    raw.on('a', gone);
    raw.on('a', kept);
    raw.off('a', gone);
    fire('a');

    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it('fire with no listener does nothing', () => {
    const { fire } = socketWithEvents();

    expect(() => fire('nobody')).not.toThrow();
  });

  it('runs listeners inside act, so a state update lands before fire returns', () => {
    const { raw, fire } = socketWithEvents();

    render(<Listener socket={raw} />);
    fire('tick');
    fire('tick');

    expect(screen.getByTestId('n').textContent).toBe('2');
  });

  it('on and off return the socket, emit and timeout are inert by default, overrides win', () => {
    const { raw } = socketWithEvents();

    expect(raw.on('a', () => undefined)).toBe(raw);
    expect(raw.off('a', () => undefined)).toBe(raw);
    expect(raw.connected).toBe(true);
    expect((raw.timeout as () => { emit: () => unknown })().emit()).toBeUndefined();

    const emit = vi.fn();

    expect(socketWithEvents({ emit }).raw.emit).toBe(emit);
  });
});
