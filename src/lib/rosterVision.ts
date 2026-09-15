import { parseRoster, RosterEntry, ScannedRosterRow } from './roster';
import { readImage, readPdf, ImageRequest, PdfRequest } from './vision';

/**
 * Reading a roster source (screenshot or PDF) into entries — shared by the
 * interactive scan-roster route (one manager, one source, reviewed before
 * anything is written) and the unattended automation pipeline
 * (/api/automation/roster-pdf, applied straight away). Same schema, same
 * instructions, so a source reads the same way either way it arrives.
 */

const TEXT = { type: 'string' } as const;

export const ROSTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    dept: { ...TEXT, description: 'The heading naming the department or area, only when the whole source is for one department.' },
    date: { ...TEXT, description: 'Only if a date is printed on the source, as YYYY-MM-DD.' },
    rows: {
      type: 'array',
      description: 'One entry per person listed, top to bottom.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 's', 'e'],
        properties: {
          n: { ...TEXT, description: 'Name as shown, including a trailing ellipsis if it is cut off.' },
          s: { ...TEXT, description: 'Rostered start time.' },
          e: { ...TEXT, description: 'Rostered end time.' },
          st: { ...TEXT, description: 'Status chip, if one is shown.' },
          d: { ...TEXT, description: "This row's own department or role section heading, only when the source lists more than one department." },
        },
      },
    },
  },
};

export function rosterInstructionsFor(kind: 'screenshot' | 'PDF'): string {
  return `This is a ${kind === 'screenshot' ? 'screenshot' : 'PDF export'} from a staff rostering app, showing one day's roster.

It may cover a single department, or it may be a whole-store report broken into several sections — one per department or role (for example "Bakery", "Checkouts", "Dairy", "Duty Manager") — each introduced by its own heading above the people in it. Read it row by row, exactly as shown, and do not merge separate sections together — a person can genuinely appear under more than one section on the same day (an early shift in one department, a later one in another), and each occurrence is a real, separate shift.

For each person listed return:
- n: their name exactly as displayed. If the app has cut the name off, keep the ellipsis (for example "Md Mozammal…") rather than guessing the rest.
- s and e: the rostered start and end time for that person, from the "Rostered time" line (for example "11:00 - 18:00" means s is "11:00" and e is "18:00"). Copy the digits as shown and do not convert between 12- and 24-hour time.
- st: the status shown against them, if any — for example Working, Finished, No show, Late start, Waiting for start.
- d: the department or role heading for THIS row's section — for example "Bakery" or "Checkouts". Only leave this out when the whole source is a single department already given in dept below.

Also return:
- dept: the heading naming the department or area, only when the WHOLE source is for one department. For a whole-store report broken into multiple sections, leave this out and rely on d on each row instead.
- date: only if an actual date is printed somewhere. Leave it out otherwise — do not infer one.

Ignore employee numbers in brackets, job titles, site names, column headings such as hour labels or "Total Hours", and buttons such as Call or Replace.

If a time is not clearly legible, use "?" rather than guessing.`;
}

export interface RosterReadResult {
  department: string | null;
  date: string | null;
  entries: RosterEntry[];
  warnings: string[];
  model: string;
  seconds: number;
}

type RawRoster = { dept?: string; date?: string; rows?: ScannedRosterRow[] };

function toResult(data: RawRoster, seconds: number, model: string): RosterReadResult {
  const { entries, warnings } = parseRoster(data.rows ?? []);
  return { department: data.dept ?? null, date: data.date ?? null, entries, warnings, model, seconds };
}

export async function readRosterImage(request: ImageRequest): Promise<RosterReadResult> {
  const { data, seconds, model } = await readImage<RawRoster>(request, rosterInstructionsFor('screenshot'), ROSTER_SCHEMA);
  return toResult(data, seconds, model);
}

export async function readRosterPdf(request: PdfRequest): Promise<RosterReadResult> {
  const { data, seconds, model } = await readPdf<RawRoster>(request, rosterInstructionsFor('PDF'), ROSTER_SCHEMA);
  return toResult(data, seconds, model);
}
