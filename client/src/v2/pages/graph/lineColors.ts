/**
 * A colour for each cross-rig line, so one line can be told from its neighbours and followed from
 * its source frame to its target frame. Chosen to stay apart from each other on the cream canvas
 * and from the status colours; assigned by the line's place in the sorted list, so it does not
 * flicker when a count changes.
 */
export const LINE_COLORS = [
  '#2b6cb0', // blue
  '#2f855a', // green
  '#b83280', // magenta
  '#6b46c1', // purple
  '#0987a0', // teal
  '#c53030', // brick
  '#8d5524', // brown
  '#4a5568', // slate
] as const;

export const lineColorIndex = (keys: string[]): Map<string, number> =>
  new Map([...keys].sort().map((k, i) => [k, i % LINE_COLORS.length]));
