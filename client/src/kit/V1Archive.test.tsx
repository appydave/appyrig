import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import V1Archive from './V1Archive.js';
import { V1_ARCHIVE_ROWS, v1ArchiveSlides } from './v1ArchiveManifest.js';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ files: ['v1-01-wall-by-rig.png', 'v1-01-wall-by-machine.png'] }),
    }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('V1 archive manifest', () => {
  it('has the 32 parity rows, in order, with V1-safe file names', () => {
    expect(V1_ARCHIVE_ROWS.map((r) => r.row)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    for (const f of V1_ARCHIVE_ROWS.flatMap((r) => r.files))
      expect(f).toMatch(/^v1-[a-z0-9-]+\.png$/);
    expect(v1ArchiveSlides().length).toBeGreaterThanOrEqual(32);
  });
});

describe('V1 archive viewer', () => {
  it('shows the first screen, steps with the buttons and arrow keys, and Esc closes', async () => {
    const onClose = vi.fn();
    render(<V1Archive onClose={onClose} />);
    expect(screen.getByTestId('v1-archive-title').textContent).toContain('1. The Wall');
    await waitFor(() =>
      expect(screen.getByTestId('v1-archive-img').getAttribute('src')).toBe(
        '/api/v1-archive/v1-01-wall-by-rig.png'
      )
    );
    expect(screen.getByTestId('v1-archive-text').textContent).toContain('In V2:');
    // the counter counts rows, like the strip, and names the picture within the row
    expect(screen.getByTestId('v1-archive-count').textContent).toBe(
      'V1 archive · screen 1 of 32 · picture 1 of 3'
    );
    fireEvent.click(screen.getByTestId('v1-archive-next'));
    expect(screen.getByTestId('v1-archive-img').getAttribute('src')).toContain('by-machine');
    expect(screen.getByTestId('v1-archive-count').textContent).toBe(
      'V1 archive · screen 1 of 32 · picture 2 of 3'
    );
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    // third Wall screen is not on this hub
    expect(screen.getByTestId('v1-archive-missing').textContent).toBe('screenshot not on this hub');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('v1-archive-img')).toBeTruthy();
    fireEvent.click(screen.getByTestId('v1-archive-jump-27'));
    expect(screen.getByTestId('v1-archive-title').textContent).toContain('27. Waiting on David');
    expect(screen.getByTestId('v1-archive-count').textContent).toMatch(
      /^V1 archive · screen 27 of 32/
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when a row never had a screenshot', async () => {
    render(<V1Archive onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('v1-archive-jump-32'));
    expect(screen.getByTestId('v1-archive-missing').textContent).toBe('screenshot not on this hub');
    // a row with one picture (or none) has no picture count
    expect(screen.getByTestId('v1-archive-count').textContent).toBe('V1 archive · screen 32 of 32');
    expect(screen.getByTestId('v1-archive-next').hasAttribute('disabled')).toBe(true);
  });
});
