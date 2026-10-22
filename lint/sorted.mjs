/** A copy of `counts` with its keys in alphabetical order, so a rewritten baseline diffs cleanly. */
export function sortedByKey(counts, mapValue = (value) => value) {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((key) => [key, mapValue(counts[key])])
  );
}
