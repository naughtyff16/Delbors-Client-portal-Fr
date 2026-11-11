// en-PH formatting, Asia/Manila time zone (docs/02 §9).
export const TZ = 'Asia/Manila';

const php = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-PH');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const formatPhp = (n: number | undefined | null) => (n == null || Number.isNaN(n) ? '—' : php.format(n));
export const formatNumber = (n: number | undefined | null) => (n == null ? '—' : num.format(n));

function parts(iso: string) {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year, m: Number(p.month), d: p.day, hh: p.hour === '24' ? '00' : p.hour, mm: p.minute };
}

/** DD-MMM-YYYY, e.g. 06-Sep-2026 */
export function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const p = parts(iso);
  return `${p.d}-${MONTHS[p.m - 1]}-${p.y}`;
}
/** DD-MMM-YYYY HH:mm (24h) */
export function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  const p = parts(iso);
  return `${p.d}-${MONTHS[p.m - 1]}-${p.y} ${p.hh}:${p.mm}`;
}

/** Whole calendar days between two instants, in Manila time. */
export function daysBetween(fromIso: string, toIso: string) {
  const a = parts(fromIso), b = parts(toIso);
  const da = Date.UTC(Number(a.y), a.m - 1, Number(a.d));
  const db = Date.UTC(Number(b.y), b.m - 1, Number(b.d));
  return Math.round((db - da) / 86_400_000);
}

/** YYYY-MM-DD of an instant in Manila time. Use for date-only fields instead of iso.slice(0, 10), which gives the UTC date (a day early before 08:00 Manila). */
export function manilaDay(iso: string) {
  const p = parts(iso);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${p.d}`;
}

export const addHours =(iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3_600_000).toISOString();
export const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86_400_000).toISOString();
export const toDateInput = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const t = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : '');
  return [h ? ONES[h] + ' HUNDRED' : '', t].filter(Boolean).join(' ');
}
/** "FOURTEEN THOUSAND SEVEN HUNDRED EIGHTY-FOUR PESOS AND 00/100" (docs/12 §1) */
export function amountInWords(amount: number) {
  const pesos = Math.floor(amount), cents = Math.round((amount - pesos) * 100);
  if (pesos === 0) return `ZERO PESOS AND ${String(cents).padStart(2, '0')}/100`;
  const scales = ['', ' THOUSAND', ' MILLION', ' BILLION'];
  const chunks: string[] = [];
  let n = pesos, i = 0;
  while (n > 0) {
    const c = n % 1000;
    if (c) chunks.unshift(below1000(c) + scales[i]);
    n = Math.floor(n / 1000); i++;
  }
  return `${chunks.join(' ')} PESOS AND ${String(cents).padStart(2, '0')}/100`;
}
