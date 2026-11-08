import { z } from 'zod';

/**
 * The few fields of a Claude Code transcript the history reader uses. The format is Claude Code's,
 * not ours, so each row is parsed where it is read. A field of the wrong type is read as absent
 * (`.catch(undefined)`), so one odd field never costs the whole line; a row or block that is not
 * an object at all is skipped.
 */

const text = z.string().optional().catch(undefined);

/** A transcript row: its type, timestamp and message content (a string or a list of blocks). */
export const TranscriptRow = z.object({
  type: text,
  timestamp: text,
  message: z.object({ content: z.unknown().optional() }).optional(),
});

/** The first-line row that names the seat a transcript belongs to. */
export const TitleRow = z.object({ type: z.literal('custom-title'), customTitle: z.string() });

const Block = z.object({ type: text, text, name: text, input: z.unknown().optional() });

export type TranscriptBlock = z.output<typeof Block>;

/** The well-formed blocks of a message's content; content that is not a list has none. */
export function blocksOf(content: unknown): TranscriptBlock[] {
  const list = z.array(z.unknown()).safeParse(content);

  if (!list.success) {
    return [];
  }

  return list.data.flatMap((raw) => {
    const block = Block.safeParse(raw);

    return block.success ? [block.data] : [];
  });
}

/** Where a tool call says what it did, first non-empty one wins. */
export const ToolInput = z.object({
  command: text,
  file_path: text,
  path: text,
  pattern: text,
  url: text,
  query: text,
  description: text,
  prompt: text,
});
