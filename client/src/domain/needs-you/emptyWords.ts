interface EmptyFacts {
  /** The filter's name when it is one nothing real is collected for yet. */
  uncollected: string | null;
  machineCount: number;
  /** Labels of machines asleep, so never read this round. */
  asleep: string[];
  /** A running rig's gates could not be read, or are still being read. */
  gatesUnread: boolean;
}

/** What Needs You says with an empty list. "Nothing" only when everything really was read. */
export function emptyWords({ uncollected, machineCount, asleep, gatesUnread }: EmptyFacts): string {
  if (uncollected) {
    return `Nothing real is collected for ${uncollected} yet; the sample cards below show the shape.`;
  }

  if (machineCount === 0) {
    return 'No machine is reporting, so this cannot say what is waiting (not the same as nothing waiting).';
  }

  if (asleep.length > 0) {
    return `Nothing found so far, but ${asleep.join(', ')} ${asleep.length === 1 ? 'is' : 'are'} asleep and could not be read: that is not the same as nothing waiting.`;
  }

  return gatesUnread
    ? 'Nothing found so far, but not every rig could be read for gates (see above): that is not the same as nothing waiting.'
    : 'Nothing is waiting on David.';
}
