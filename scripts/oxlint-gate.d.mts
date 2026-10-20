export type Counts = Record<string, Record<string, number>>;
export interface Report {
  diagnostics?: { filename: string; code?: string }[];
  number_of_files?: number;
  number_of_rules?: number;
}
export interface Change {
  file: string;
  rule: string;
  now: number;
  was: number;
}
export function countFindings(report: Report): Counts;
export function compare(actual: Counts, baseline: Counts): { grown: Change[]; shrunk: Change[] };
export function rulesThatGrew(baseline: Counts, actual: Counts): string[];
export function ruleTotals(counts: Counts): Record<string, number>;
export function findDisableDirectives(text: string): { line: number; text: string }[];
export function reportProblem(report: Report): string | null;
export const NOT_SCANNED: string[];
