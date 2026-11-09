const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const STALE_AFTER_MS = 3 * HOUR;

export function isStale(updatedAt: string, now: number) {
  return now - Date.parse(updatedAt) > STALE_AFTER_MS;
}

export function timeAgo(iso: string, now: number) {
  const minutes = Math.floor((now - Date.parse(iso)) / MINUTE);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

// Relative on purpose: the server doesn't know the phone's time zone, so a
// clock time would differ between the server render and the browser.
export function etaText(iso: string, now: number) {
  const minutes = Math.ceil((Date.parse(iso) - now) / MINUTE);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
}

export function isFuture(iso: string | null, now: number): iso is string {
  return iso !== null && Date.parse(iso) > now;
}

export function etaFromChip(minutes: number | null) {
  if (minutes !== null) return new Date(Date.now() + minutes * MINUTE).toISOString();

  // "Tonight" is 21:00 on the phone's clock, or 23:59 if that has passed.
  const now = new Date();
  const tonight = new Date(now);
  tonight.setHours(21, 0, 0, 0);
  if (tonight <= now) tonight.setHours(23, 59, 0, 0);
  return tonight.toISOString();
}
