import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS classes without conflicts.
 * Combines clsx (conditional classes) with tailwind-merge (deduplication).
 *
 * @example
 * cn('bg-red-500', condition && 'text-white', 'bg-blue-500')
 * // → 'text-white bg-blue-500'  (bg-red-500 is overridden by bg-blue-500)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
