const SEP = '|';

/** One exemption: where it is read from, what kind, and the path or rule it exempts. */
export const make = ({ source, where = '', kind, pattern }) => ({
  key: [source, ...(where ? [where] : []), kind, pattern].join(SEP),
  source,
  where,
  kind,
  pattern,
});
