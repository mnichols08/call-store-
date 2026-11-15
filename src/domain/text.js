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
