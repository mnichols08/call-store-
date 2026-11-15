// Text hygiene shared by every place a person's words are stored or shown.

/**
 * `text` trimmed to at most `max` UTF-16 units without cutting a character in two. A character
 * outside the basic plane (most emoji) is two units; cutting between them leaves half a character,
 * which no encoder can represent and which breaks a component render downstream.
 */
export function clip(text, max) {
  let out = String(text ?? '').toWellFormed();
  if (out.length > max) {
    out = out.slice(0, max);
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
  }
  return out;
}

/** Replace any stray half of a surrogate pair with U+FFFD, so the text can be encoded and rendered. */
export const wellFormed = (text) => String(text ?? '').toWellFormed();

/** Whether `text` is a real calendar date written YYYY-MM-DD (2026-02-30 and 2026-13-45 are not). Never throws. */
export function isRealDate(text) {
  const t = String(text ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
}
