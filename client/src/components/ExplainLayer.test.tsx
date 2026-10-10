import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ExplainLayer from './ExplainLayer.js';
import { GLOSSARY } from '../learn/glossary.js';

const hover = async (el: Element) => {
  fireEvent.pointerOver(el);
  await act(() => new Promise((r) => setTimeout(r, 200)));
};

describe('ExplainLayer', () => {
  it('hovering a marked element shows its term, the live context and the OpenRig fact', async () => {
    render(
      <>
        <ExplainLayer enabled />
        <button data-explain="seat" data-explain-ctx="dev-hub · opus 5.5 · stopped">
          <b>dev-hub</b>
        </button>
      </>
    );
    await hover(screen.getByText('dev-hub'));
    const card = screen.getByTestId('explain-card');
    expect(card).toHaveTextContent('Seat');
    expect(card).toHaveTextContent('dev-hub · opus 5.5 · stopped');
    expect(card).toHaveTextContent('seen in code');
  });

  it('shows nothing when Explain mode is off, and Escape hides an open card', async () => {
    const { rerender } = render(
      <>
        <ExplainLayer enabled={false} />
        <span data-explain="rework">12 back</span>
      </>
    );
    await hover(screen.getByText('12 back'));
    expect(screen.queryByTestId('explain-card')).toBeNull();

    rerender(
      <>
        <ExplainLayer enabled />
        <span data-explain="rework">12 back</span>
      </>
    );
    await hover(screen.getByText('12 back'));
    expect(screen.getByTestId('explain-card')).toHaveTextContent('Rework');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('explain-card')).toBeNull();
  });

  it('every glossary entry says what it is and why it matters', () => {
    for (const [id, t] of Object.entries(GLOSSARY)) {
      expect(t.what.length, id).toBeGreaterThan(20);
      expect(t.why.length, id).toBeGreaterThan(10);
    }
  });
});
