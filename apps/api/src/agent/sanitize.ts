/**
 * Deterministic defences applied to everything that reaches the model from
 * outside our own code: shopper messages and catalog text.
 *
 * The catalog is the surface that actually matters here. Titles, descriptions
 * and tags come from a third-party API and are echoed into tool results, so a
 * seller-controlled description is an injection vector even though the shopper
 * never typed it. Wrapping that text in a labelled block only helps if the text
 * cannot close the block, which is what `neutralizeMarkup` guarantees.
 */

/** Longest shopper message forwarded to the model, in characters. */
export const MAX_SHOPPER_INPUT = 2000;

// Everything in C0/C1 except tab and newline, plus the bidi and zero-width
// characters used to hide instructions inside otherwise innocent text.
const CONTROL_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Normalises a shopper message: NFKC folds lookalike characters onto their
 * plain forms, control and bidi characters are dropped, and the result is
 * capped so a wall of text cannot push the instructions out of context.
 */
export function sanitizeShopperInput(content: string): string {
  const normalized = content
    .normalize('NFKC')
    .replace(CONTROL_CHARS, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return normalized.length > MAX_SHOPPER_INPUT
    ? `${normalized.slice(0, MAX_SHOPPER_INPUT).trimEnd()}…`
    : normalized;
}

/** Escapes the angle brackets untrusted text would need to close its own block. */
export function neutralizeMarkup(value: string): string {
  return value.replace(/[<>]/g, (bracket) => (bracket === '<' ? '&lt;' : '&gt;'));
}

/**
 * Wraps untrusted content in a labelled block the system prompt tells the model
 * to read as data. The body is neutralised first so nothing inside can forge
 * the closing tag — or a `trust="trusted"` opening one — and continue as if it
 * were prompt.
 */
export function dataBlock(tag: string, body: string): string {
  return `<${tag} trust="untrusted">\n${neutralizeMarkup(body)}\n</${tag}>`;
}
