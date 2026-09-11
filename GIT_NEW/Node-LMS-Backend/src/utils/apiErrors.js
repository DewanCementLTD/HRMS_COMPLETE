/**
 * Turning any failure this API produces into one sentence a person can read.
 *
 * The mobile app shows the server's own message to the employee whenever the
 * response carries a readable one. That only helps if every failure carries one,
 * whatever shape it started in: this backend answers with FastAPI's `{detail}`
 * (a string, an object, or Pydantic's list of issues), the middlewares answer
 * with `{detail: {code, message}}`, and an unhandled throw arrives as an Oracle
 * error. `readableMessage` finds the sentence in any of those, and
 * `presentableMessage` makes sure what goes out is fit to show.
 */

/** Longest message the app will render without truncating it itself. */
const MAX_MESSAGE_LENGTH = 300;

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Text that is a diagnostic, not a message: Oracle and PL/SQL codes, stack
 * frames, SQL statements, driver internals, file paths. None of it means
 * anything to an employee, and some of it describes the schema to anyone who
 * captures the response.
 */
const INTERNAL_PATTERNS = [
  /\bORA-\d{3,5}\b/i,
  /\bPLS-\d{3,5}\b/i,
  /\bNJS-\d{3,5}\b/i,
  /\bDPI-\d{3,5}\b/i,
  /\bat\s+[\w$.<>]+\s*\(/,
  /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\b[\s\S]*\b(?:FROM|SET|VALUES|USING)\b/i,
  /node_modules|[A-Za-z]:\\|\/src\/|\.js:\d+/,
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b/,
];

const looksInternal = (text) => INTERNAL_PATTERNS.some((re) => re.test(text));

/**
 * One clean sentence, or the generic fallback when the text is a diagnostic.
 * Never returns an empty string — a blank message is the same to the app as no
 * message at all, and it would fall back to its own wording anyway.
 */
export const presentableMessage = (raw) => {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return GENERIC_MESSAGE;
  if (looksInternal(text)) return GENERIC_MESSAGE;
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  // Cut at a sentence or word boundary rather than mid-word.
  const clipped = text.slice(0, MAX_MESSAGE_LENGTH - 1);
  const cut = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf(' '));
  return `${clipped.slice(0, cut > 60 ? cut : clipped.length).trim()}…`;
};

/**
 * The message hiding inside an error body, wherever this codebase puts it.
 * Returns null when there is nothing readable, so callers can decide whether a
 * generic sentence is warranted.
 */
export const readableMessage = (body) => {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return body.trim() || null;

  if (Array.isArray(body)) {
    // Pydantic-style issue list: [{ type, loc, msg, input }]
    for (const issue of body) {
      const m = readableMessage(issue);
      if (m) return m;
    }
    return null;
  }

  if (typeof body !== 'object') return null;

  for (const key of ['message', 'msg', 'error', 'title', 'reason']) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }

  // One level down: {detail: ...} and {body: {...}} are both shapes in use here.
  for (const key of ['detail', 'body']) {
    if (key in body) {
      const m = readableMessage(body[key]);
      if (m) return m;
    }
  }

  return null;
};

export { GENERIC_MESSAGE, MAX_MESSAGE_LENGTH };
