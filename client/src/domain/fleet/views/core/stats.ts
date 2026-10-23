export function median(xs: number[]): number | null {
  if (!xs.length) {
    return null;
  }

  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);

  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
