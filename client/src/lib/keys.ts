/**
 * Keyboard shortcuts (v1.4 S2) never fire while someone is typing: in a text field, a textarea,
 * a select, anything contenteditable (the S8 feedback box), or with Cmd/Ctrl/Alt held.
 * Shift is allowed, so `?` works.
 */
const NOT_TEXT = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color']);

export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    return true;
  }

  return target.tagName === 'INPUT' && !NOT_TEXT.has((target as HTMLInputElement).type);
}

export function isShortcutBlocked(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target);
}

/** A range slider keeps its own arrow keys. */
export function isSlider(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.type === 'range';
}
