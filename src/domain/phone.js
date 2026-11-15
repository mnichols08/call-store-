// Phone numbers: stored as typed, searched by digits, so formatting never stops a match.

/** Only the digits. A leading US country code is dropped from an 11-digit number. */
export function digitsOf(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** (304) 555-0142 for ten digits; anything else as it was typed. */
export function formatPhone(text) {
  const digits = digitsOf(text);
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : String(text ?? '').trim();
}

/** Whether the digits typed so far are enough to search by phone (the last four count). */
export const searchableDigits = (text) => digitsOf(text).length >= 4;
