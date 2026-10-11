// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Reading what a chat model wrote, shared by every text provider (OpenAI and Claude) so a
 * mnemonic means the same thing whoever wrote it. Moved out of openaiProvider.ts without
 * changing the logic.
 */

/** Models sometimes emit markdown emphasis despite plain-text instructions;
 *  the mnemonic panel renders plain text, so students would see the symbols. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}
