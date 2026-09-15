import { ProgressStage } from '@/components/ProgressBar';

/** The steps an upload goes through, from picking a file to the data changing. */
export const STAGES: Record<string, ProgressStage> = {
  preparing: { label: 'Preparing the photo…', detail: 'Shrinking it so it uploads quickly.', from: 4, to: 18, seconds: 4 },
  preparingPdf: { label: 'Preparing the PDF…', detail: 'Getting it ready to upload.', from: 4, to: 18, seconds: 2 },
  reading: { label: 'Reading the sheet…', detail: 'Turning the photo into a spreadsheet. This can take up to a minute — keep this page open.', from: 18, to: 78, seconds: 45 },
  readingPdf: { label: 'Reading the sheet…', detail: 'Turning the PDF into a spreadsheet. This can take up to a minute — keep this page open.', from: 18, to: 78, seconds: 45 },
  readingRoster: { label: 'Reading the roster…', detail: 'Picking out who is on and when. This can take up to a minute — keep this page open.', from: 18, to: 78, seconds: 45 },
  parsing: { label: 'Reading the sheet…', detail: 'Checking the columns and times.', from: 10, to: 60, seconds: 3 },
  comparing: { label: 'Comparing with the staff list…', from: 78, to: 95, seconds: 6 },
  applying: { label: 'Updating the staff list…', from: 20, to: 95, seconds: 8 },
  savingShifts: { label: 'Adding the shifts…', from: 20, to: 95, seconds: 8 },
};
