// Is the shop open, and when does it open next? Pure: give it a moment, a time zone, the week's hours
// and any closures, and it answers in the shop's own local time (so daylight saving takes care of itself).

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** `7:30 AM`, `6 PM`: minutes after midnight in words. */
export function clock(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** `07:30` to minutes, or null. */
export function minutesOf(text) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The local date, weekday (0 = Sunday) and minutes after midnight, in `zone`, for a moment. */
export function localParts(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, dow: new Date(`${date}T00:00:00Z`).getUTCDay(), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** A calendar date moved by some days (calendar arithmetic only, so no time zone is involved). */
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
}

/** What a day looks like: `{ open, close, note }`, or `{ closed: true, note }`. */
export function dayHours(date, dow, week, closures = []) {
  const special = closures.find((c) => c.date === date);
  if (special) {
    const open = minutesOf(special.open);
    const close = minutesOf(special.close);
    return open != null && close != null && close > open ? { open, close, note: special.note ?? '' } : { closed: true, note: special.note ?? '' };
  }
  const normal = week[DAYS[dow]];
  return normal ? { open: normal[0], close: normal[1], note: '' } : { closed: true, note: '' };
}

/**
 * Where the shop stands: `{ open, text, closesAt, next }`. `text` is for people ("Open until 6 PM",
 * "Closed. Opens tomorrow at 7:30 AM"); `next` is the day and time it next opens.
 */
export function shopState(ms, zone, week, closures = []) {
  const now = localParts(ms, zone);
  const today = dayHours(now.date, now.dow, week, closures);
  if (!today.closed && now.minutes >= today.open && now.minutes < today.close) {
    return { open: true, text: `Open until ${clock(today.close)}`, closesAt: today.close, next: null };
  }
  const reason = today.closed && today.note ? ` today (${today.note})` : '';
  if (!today.closed && now.minutes < today.open) {
    return { open: false, text: `Closed. Opens today at ${clock(today.open)}`, closesAt: null, next: { date: now.date, minutes: today.open } };
  }
  for (let n = 1; n <= 21; n += 1) {
    const day = addDays(now.date, n);
    const h = dayHours(day.date, day.dow, week, closures);
    if (h.closed) continue;
    const when = n === 1 ? 'tomorrow' : NAMES[day.dow];
    return { open: false, text: `Closed${reason}. Opens ${when} at ${clock(h.open)}`, closesAt: null, next: { date: day.date, minutes: h.open } };
  }
  return { open: false, text: 'Closed. Please call to ask when we’ll open.', closesAt: null, next: null };
}

/** The week laid out for a table, starting Monday, with today marked. */
export function weekTable(ms, zone, week) {
  const today = localParts(ms, zone).dow;
  return [1, 2, 3, 4, 5, 6, 0].map((dow) => ({ day: NAMES[dow], dow, today: dow === today, hours: week[DAYS[dow]] ? `${clock(week[DAYS[dow]][0])} to ${clock(week[DAYS[dow]][1])}` : 'Closed' }));
}

/** Schema.org's opening hours, for search engines. */
export function openingSpec(week) {
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return Object.entries(week).map(([day, [open, close]]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: NAMES[DAYS.indexOf(day)], opens: hhmm(open), closes: hhmm(close) }));
}
