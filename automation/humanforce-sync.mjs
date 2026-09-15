#!/usr/bin/env node
/**
 * Pulls the Humanforce "Daily Coverage By Role" roster PDF for one date and
 * hands it to ShiftFlow's automation endpoint (/api/automation/roster-pdf),
 * which reads it and applies whatever shifts it can straight away.
 *
 * THIS FILE IS A SKELETON. Everything under "Humanforce-specific steps"
 * below is a placeholder — the real selectors have to come from watching an
 * actual login, since Humanforce's DOM isn't something to guess at. Record
 * them with:
 *
 *   npx playwright codegen https://fjspearwood.humanforce.com/Reporting/RosterDailyCoverageReportByRole
 *
 * That opens a real browser and a second window showing the script as you
 * click. Walk through exactly what you do by hand today: log in -> open
 * Settings -> set the date -> confirm the department selection (everything
 * except Cleaning, Direct Filling, Direct Ordering, Payroll Officer, Store
 * Cashier) -> trigger the PDF export/download. Then copy the relevant
 * `page.fill(...)` / `page.click(...)` lines into the matching TODO block
 * below, in place of the comments there.
 *
 * The script deliberately throws before doing anything once it hits the
 * first unfilled TODO, rather than silently skipping steps — a half-wired
 * run should fail loudly, not post a wrong or empty roster.
 *
 * Runs as a fresh headless login every time, so Humanforce's inactivity
 * logout is a non-issue here: there is no long-lived session to time out.
 */

import { chromium } from 'playwright';

const {
  HUMANFORCE_URL = 'https://fjspearwood.humanforce.com/Reporting/RosterDailyCoverageReportByRole',
  HUMANFORCE_USERNAME,
  HUMANFORCE_PASSWORD,
  SHIFTFLOW_URL,
  AUTOMATION_TOKEN,
  // 0 = today, 1 = tomorrow, etc. Pick whatever lead time actually matches
  // when you want shifts in ShiftFlow relative to when this runs.
  TARGET_DATE_OFFSET_DAYS = '0',
} = process.env;

for (const [name, value] of Object.entries({ HUMANFORCE_USERNAME, HUMANFORCE_PASSWORD, SHIFTFLOW_URL, AUTOMATION_TOKEN })) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

function targetDate() {
  const d = new Date();
  d.setDate(d.getDate() + Number(TARGET_DATE_OFFSET_DAYS));
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

async function main() {
  const date = targetDate();
  console.log(`Fetching the Humanforce roster for ${date}...`);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(HUMANFORCE_URL);

    // ── 1. Log in ──────────────────────────────────────────────────────────
    // TODO: replace with the real login flow from codegen, e.g.:
    //   await page.fill('#username', HUMANFORCE_USERNAME);
    //   await page.fill('#password', HUMANFORCE_PASSWORD);
    //   await page.click('button[type=submit]');
    //   await page.waitForURL('**/Reporting/**');
    throw new Error(
      'humanforce-sync.mjs is unwired — replace the TODO blocks with real selectors ' +
      'from `npx playwright codegen` before running this for real.'
    );

    // ── 2. Set the report date under Settings ────────────────────────────
    // TODO: replace with the real date-picker flow, e.g.:
    //   await page.click('text=Settings');
    //   await page.fill('input[name=reportDate]', date); // match whatever format the field wants
    //   await page.click('text=Apply');

    // ── 3. Confirm the department selection ──────────────────────────────
    // Check explicitly rather than assume Humanforce remembered last time's
    // selection — a report that silently reverts to "all departments" or
    // "none" would misreport who's rostered. Excluded: Cleaning, Direct
    // Filling, Direct Ordering, Payroll Officer, Store Cashier.
    // TODO: fill in once you've seen whether the selection persists.

    // ── 4. Export/download the PDF ───────────────────────────────────────
    // TODO: replace with the real export flow, e.g.:
    //   const [download] = await Promise.all([
    //     page.waitForEvent('download'),
    //     page.click('text=Export'), // or whatever the actual export/print control is
    //   ]);
    //   const pdfPath = await download.path();
    //   const pdfBuffer = await (await import('node:fs/promises')).readFile(pdfPath);

    // ── 5. Hand it to ShiftFlow ───────────────────────────────────────────
    // const pdfBase64 = pdfBuffer.toString('base64');
    // const res = await fetch(`${SHIFTFLOW_URL}/api/automation/roster-pdf`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTOMATION_TOKEN}` },
    //   body: JSON.stringify({ date, pdf: pdfBase64 }),
    // });
    // const result = await res.json();
    // if (!res.ok) {
    //   console.error('ShiftFlow rejected the import:', result);
    //   process.exit(1);
    // }
    // console.log(`Applied ${result.shifts_created} shift(s) across ${result.departments_applied} department(s).`);
    // if (result.flags?.length) {
    //   console.log(`${result.flags.length} flag(s) — also visible in the ShiftFlow banner:`);
    //   for (const f of result.flags) console.log(`  - ${f.department ? f.department + ': ' : ''}${f.message}`);
    // }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
