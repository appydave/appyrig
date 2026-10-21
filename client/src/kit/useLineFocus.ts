import { useCallback, useMemo, useState } from 'react';
import { lineFocusState } from '../domain/lines/handoffLines.js';

/** Handlers that set the focus on pointer hover AND keyboard focus (a keyboard user gets the same). */
export interface FocusHandlers {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Tracks which node (an agent or a rig id) or line the pointer or keyboard is on. A screen spreads
 * `focusProps(id)` on a card, a rig box or a line, and asks `stateOf(a, b)` for each line it draws.
 */
export function useLineFocus() {
  const [focus, setFocus] = useState<string | null>(null);
  const focusProps = useCallback(
    (id: string): FocusHandlers => ({
      onPointerEnter: () => setFocus(id),
      onPointerLeave: () => setFocus(null),
      onFocus: () => setFocus(id),
      onBlur: () => setFocus(null),
    }),
    []
  );
  const stateOf = useCallback((a: string, b: string) => lineFocusState(focus, a, b), [focus]);
  return useMemo(() => ({ focus, setFocus, focusProps, stateOf }), [focus, focusProps, stateOf]);
}
