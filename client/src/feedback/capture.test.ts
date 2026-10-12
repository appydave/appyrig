import { describe, expect, it } from 'vitest';
import { inlineSvgPaint } from './capture.js';

describe('B4: SVG paint is inlined for the screenshot and then fully undone', () => {
  it('writes computed paint onto each SVG shape and restores the original style exactly', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<svg><path class="a"></path><text class="b" style="font-size: 9px">x</text></svg><p>not svg</p>';
    document.body.appendChild(root);
    const path = root.querySelector('path')!;
    const text = root.querySelector('text')!;
    const restore = inlineSvgPaint(root);
    expect(path.getAttribute('style')).toMatch(/fill:.*paint-order:/);
    expect(text.getAttribute('style')).toMatch(/^font-size: 9px;fill:/);
    expect(root.querySelector('p')!.hasAttribute('style')).toBe(false);
    restore();
    expect(path.hasAttribute('style')).toBe(false);
    expect(text.getAttribute('style')).toBe('font-size: 9px');
    root.remove();
  });
});
