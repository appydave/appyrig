/**
 * v2 kit · MockMark: the one badge every v2 page puts on a control that is not wired.
 * Quiet (a small dashed pill) but unmistakable, and Explain mode reads the same sentence.
 */
export const MOCK_TEXT = 'Not wired: this control is a mock and changes nothing';

export default function MockMark({ label = 'mock' }: { label?: string }) {
  return (
    <span
      className="ar-mock-mark"
      data-testid="mock-mark"
      title={MOCK_TEXT}
      aria-label={`${label}. ${MOCK_TEXT}`}
    >
      {label}
    </span>
  );
}
