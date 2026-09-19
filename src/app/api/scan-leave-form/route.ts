import { NextRequest, NextResponse } from 'next/server';
import { requireUser, unauthorized } from '@/lib/auth';
import { readImage, readImageRequest, readPdf, readPdfRequest, visionErrorResponse } from '@/lib/vision';
import { localDateNow } from '@/lib/sms/config';

/**
 * Reads a photographed or PDF'd leave/day-off form into the fields the
 * Time Off card needs — who it's for, and the date range to exclude them
 * from claim races for. The file itself is still stored as-is by
 * /api/staff-leave regardless of whether this could read it; this only
 * saves typing when it can.
 */

export const maxDuration = 60;

const LEAVE_FORM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['form_type', 'staff_names', 'start_date', 'end_date', 'notes'],
  properties: {
    form_type: {
      type: 'string',
      enum: ['farmer_jacks_leave', 'request_day_off', 'unknown'],
      description:
        'Which printed template this is: "farmer_jacks_leave" for the "Farmer Jack\'s Leave Form" (has the Farmer Jack\'s logo, a Leave Type checkbox table, and From/To date fields), "request_day_off" for the plain "REQUEST DAY OFF FORM" (Name/Date/Dates/Reason fields, no logo), or "unknown" if neither template matches.',
    },
    staff_names: {
      type: 'array',
      items: { type: 'string' },
      description:
        'The name(s) of the staff member(s) this form requests time off for, exactly as handwritten. Almost always one name. A Request Day Off form sometimes names more than one person on the same line (e.g. "Eli and Aria") — split those into separate array entries, one name each. Never include a manager\'s or supervisor\'s name, only the staff requesting leave.',
    },
    start_date: {
      type: 'string',
      description: 'The first date of the requested leave/day off, as YYYY-MM-DD. Empty string if genuinely not written on the form.',
    },
    end_date: {
      type: 'string',
      description: 'The last date of the requested leave/day off, as YYYY-MM-DD (same as start_date for a single day). Empty string if genuinely not written on the form.',
    },
    notes: {
      type: 'string',
      description:
        'Short context for a manager, taken from the form: for a Farmer Jack\'s Leave Form, which Leave Type box was ticked (e.g. "Annual Leave"); for a Request Day Off form, the Reason field. Empty string if none.',
    },
  },
};

interface LeaveFormScan {
  form_type?: string;
  staff_names?: string[];
  start_date?: string;
  end_date?: string;
  notes?: string;
}

function instructionsFor(kind: 'photograph' | 'PDF'): string {
  const currentYear = localDateNow().slice(0, 4);
  return `This is a ${kind} of a staff leave/day-off request form from a supermarket. It is one of two possible printed templates:

1. "Farmer Jack's Leave Form" — has the Farmer Jack's logo and "100% WA OWNED" banner at the top, a "Staff Name" field, a Leave Type checkbox table (Annual Leave / Sick Leave / Annual leave cash out / Time in Lieu - Taken), then an "Annual Leave / Sick Leave" section with handwritten "From" and "To" dates (Australian day.month.year format — e.g. "18.9.26" means 18 September 2026). IMPORTANT: ignore the separate "Date:" field next to the Employee/Store Manager/Supervisor signatures near the bottom — that is only when it was signed, not the leave dates. Use only the From/To fields for start_date and end_date.

2. "REQUEST DAY OFF FORM" — a plain form with NAME, DATE, DATES:, REASON, SIGN and APPROVED BY fields, no logo. The date(s) actually being requested off are usually written next to "DATE" or "DATES:" (sometimes only a day and month with no year, e.g. "26th September" — if no year is written, assume ${currentYear} unless that date has clearly already passed, in which case use the next occurrence). If only one date is given, start_date and end_date are the same day. The NAME field sometimes lists more than one person (e.g. "Eli and Aria") — see staff_names below.

Read the whole form and fill in every field in the schema. If a field is genuinely not legible or not filled in, return an empty string for it (or an empty array for staff_names) rather than guessing.`;
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const isPdf = !!(body && typeof body === 'object' && 'pdf' in body);
  const kind = isPdf ? 'PDF' : 'photo';

  let data: LeaveFormScan;
  try {
    if (isPdf) {
      const request = readPdfRequest(body);
      if (request instanceof NextResponse) return request;
      ({ data } = await readPdf<LeaveFormScan>(request, instructionsFor('PDF'), LEAVE_FORM_SCHEMA));
    } else {
      const request = readImageRequest(body);
      if (request instanceof NextResponse) return request;
      ({ data } = await readImage<LeaveFormScan>(request, instructionsFor('photograph'), LEAVE_FORM_SCHEMA));
    }
  } catch (err) {
    return visionErrorResponse(err, kind);
  }

  const staff_names = Array.isArray(data.staff_names) ? data.staff_names.map(n => n.trim()).filter(Boolean) : [];
  const start_date = data.start_date ?? '';

  if (!staff_names.length && !start_date) {
    return NextResponse.json(
      { error: `Could not read a staff name or date off that ${kind}. Check the whole form is in frame, or fill it in by hand.` },
      { status: 422 }
    );
  }

  return NextResponse.json({
    form_type: data.form_type === 'farmer_jacks_leave' || data.form_type === 'request_day_off' ? data.form_type : 'unknown',
    staff_names,
    start_date,
    end_date: data.end_date ?? '',
    notes: (data.notes ?? '').trim(),
  });
}
