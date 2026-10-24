import Papa from 'papaparse';

export const EXCLUDED_AREAS = ['Cleaning', 'Direct Filling', 'Direct Ordering', 'Payroll Officer', 'Store Cashier'];
const key = value => value.trim().toLowerCase().replace(/\s+/g, ' ');
export const excludedArea = value => EXCLUDED_AREAS.some(area => key(area) === key(value || ''));

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function reportDate(title) {
  const m = title.match(/^Daily Staff Coverage By Role for (\w+) (\d{1,2}) (\w{3}) (\d{4})$/);
  if (!m) throw new Error('Unrecognised CSV report title/date.');
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[3]) + 1;
  const date = `${m[4]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (!validDate(date) || new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }).format(new Date(date)) !== m[1]) {
    throw new Error('Invalid CSV report date.');
  }
  return date;
}

function segment(text) {
  const m = text.trim().match(/^([01]\d|2[0-3]):([0-5]\d)\s*[-–]\s*([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw new Error('Invalid CSV shift time.');
  const start = +m[1] * 60 + +m[2];
  let end = +m[3] * 60 + +m[4];
  if (end <= start) end += 1440;
  if (end - start > 16 * 60) throw new Error('CSV shift exceeds 16 hours.');
  return { start, end };
}

const clock = minutes => `${String(Math.floor(minutes % 1440 / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;

/** Both columns are work segments, not start/end columns. A lone tbShift_2 is valid. */
export function parseHumanforceCsv(csv, expectedDate, expectedSite = 'Phoenix / Spearwood') {
  if (!validDate(expectedDate)) throw new Error('A real expected date is required.');
  if (typeof csv !== 'string' || Buffer.byteLength(csv, 'utf8') > 2_000_000) throw new Error('CSV must be at most 2 MB.');
  const parsed = Papa.parse(csv.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error('Malformed CSV.');
  const [header, ...rows] = parsed.data;
  const required = ['textBox1','titleTextBox','textBox2','tbDetailsMainText','tbDetailsSubText','tbShift_1','tbShift_2'];
  if (!header || required.some(name => header.filter(h => h.trim() === name).length !== 1)) throw new Error('Missing or duplicate Humanforce CSV columns.');
  const index = Object.fromEntries(required.map(name => [name, header.findIndex(h => h.trim() === name)]));
  const entries = [];
  const sourceRanges = new Map();
  let excluded = 0;
  for (const [rowIndex, row] of rows.entries()) {
    if (row.length !== header.length) throw new Error('CSV row width differs from header.');
    const get = name => row[index[name]].trim();
    if (reportDate(get('titleTextBox')) !== expectedDate) throw new Error('CSV report date differs from requested date.');
    if (key(get('textBox1')) !== key(expectedSite)) throw new Error('CSV report site differs from configured site.');
    const department = get('textBox2');
    const role = get('tbDetailsMainText');
    if (excludedArea(department) || excludedArea(role)) { excluded++; continue; }
    const name = get('tbDetailsSubText');
    if (!department || !name || /…|\.{2,}/.test(name)) throw new Error('Missing department or full staff name in CSV.');
    const segments = ['tbShift_1','tbShift_2'].map(get).filter(Boolean).map(segment);
    if (!segments.length) throw new Error(`CSV row ${rowIndex + 2} has no shift time (both shift columns empty).`);
    // Roll a second segment past midnight if the first segment crosses midnight.
    if (segments.length === 2 && segments[0].end > 1440 && segments[1].start < segments[0].start) {
      segments[1].start += 1440; segments[1].end += 1440;
    }
    const start = segments[0].start, end = segments[segments.length - 1].end;
    const gap = segments.length === 2 ? segments[1].start - segments[0].end : 0;
    if (gap < 0 || gap > 60 || end - start > 16 * 60) throw new Error('Overlapping, reversed or split CSV segments require review.');
    // A person may change departments. Adjacent assignments are valid.
    const ranges = sourceRanges.get(key(name)) ?? [];
    if (ranges.some(range => start < range.end && range.start < end)) {
      throw new Error(`${name}: overlapping source assignments require review.`);
    }
    ranges.push({ start, end });
    sourceRanges.set(key(name), ranges);
    entries.push({ name, department, start_time: clock(start), end_time: clock(end),
      has_break: gap > 0, break_duration_minutes: gap, status: null, truncated: false });
  }
  if (!rows.length || !entries.length) throw new Error('No in-scope roster rows in CSV.');
  return { entries, excluded, date: expectedDate };
}
