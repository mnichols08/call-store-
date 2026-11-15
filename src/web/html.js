// Escaping and small helpers for writing HTML by hand. Everything a person typed goes through esc().
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').toWellFormed().replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** "5 min ago", "yesterday 3:12 PM": for a timestamp, in the business's zone. */
export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function when(ms, zone) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

export const money = (cents) => (cents == null ? '' : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** "45 s", "4 min", "1 h 12 m": how long something took. Null (nothing to measure) is a dash. */
export function duration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} m`;
}
