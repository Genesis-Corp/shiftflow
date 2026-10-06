#!/usr/bin/env node
/**
 * Pulls the Humanforce "Daily Coverage By Role" roster PDF for each day
 * starting at TARGET_DATE_OFFSET_DAYS and hands every populated one to
 * ShiftFlow's automation endpoint (/api/automation/roster-pdf), which reads
 * it and applies whatever shifts it can straight away.
 *
 * Keeps scanning forward one day at a time and stops at the first date
 * Humanforce hasn't published a roster for yet — its report viewer shows
 * "The current data set presented in the report did not produce any
 * significant content..." for those instead of a populated grid. Running
 * this daily means a day that wasn't published yet on one run gets picked
 * up automatically once it's confirmed, without a separate schedule entry
 * per day.
 *
 * Runs as a fresh headless login every time, so Humanforce's inactivity
 * logout is a non-issue here: there is no long-lived session to time out.
 *
 * Known caveats — not yet exercised by a real run:
 *  - Department selection isn't touched here at all; it assumes Humanforce
 *    remembers the usual filter (everything except Cleaning, Direct
 *    Filling, Direct Ordering, Payroll Officer, Store Cashier) across date
 *    changes. Worth confirming against a live run before trusting it
 *    unattended — a silent revert to "all departments" or "none" would
 *    misreport who's rostered.
 *  - The day is picked by clicking the calendar link matching its
 *    day-of-month text (e.g. "11"), which is unambiguous for two-digit
 *    days but can collide with a leading/trailing day from an adjacent
 *    month shown in the same calendar grid once a single-digit day (1-9)
 *    comes up. Untested across a month boundary.
 */

import { chromium } from 'playwright';

const {
  HUMANFORCE_URL = 'https://fjspearwood.humanforce.com/Account/LogOn?ReturnUrl=%2fReporting%2fRosterDailyCoverageReportByRole',
  HUMANFORCE_USERNAME,
  HUMANFORCE_PASSWORD,
  SHIFTFLOW_URL,
  AUTOMATION_TOKEN,
  // 0 = today, 1 = tomorrow, etc. — where the forward scan starts.
  TARGET_DATE_OFFSET_DAYS = '0',
  // Safety cap so a report viewer change that breaks the "no content"
  // detection can't turn this into an infinite loop.
  MAX_DAYS_AHEAD = '21',
} = process.env;

for (const [name, value] of Object.entries({ HUMANFORCE_USERNAME, HUMANFORCE_PASSWORD, SHIFTFLOW_URL, AUTOMATION_TOKEN })) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

function dateAtOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function isoDate(d) {
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

async function main() {
  const startOffset = Number(TARGET_DATE_OFFSET_DAYS);
  const maxDays = Number(MAX_DAYS_AHEAD);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  let settingsOpened = false;
  let daysApplied = 0;

  try {
    // ── 1. Log in ──────────────────────────────────────────────────────────
    await page.goto(HUMANFORCE_URL);
    await page.getByRole('textbox', { name: 'Employee code or email' }).fill(HUMANFORCE_USERNAME);
    await page.getByRole('textbox', { name: 'Password' }).fill(HUMANFORCE_PASSWORD);
    await page.getByRole('textbox', { name: 'Password' }).press('Enter');
    await page.waitForURL('**/Reporting/**');

    for (let i = 0; i < maxDays; i++) {
      const d = dateAtOffset(startOffset + i);
      const date = isoDate(d);
      const dayOfMonth = String(d.getDate());

      console.log(`Checking roster for ${date}...`);

      // ── 2. Set the report date under Settings ──────────────────────────
      // The Settings panel stays open once expanded, so only open it once.
      if (!settingsOpened) {
        await page.getByText('Settings').click();
        settingsOpened = true;
      }
      await page.locator('#reportDate').click();
      await page.getByRole('link', { name: dayOfMonth, exact: true }).click();

      const popupPromise = page.waitForEvent('popup');
      await page.getByText('Print Preview').click();
      const popup = await popupPromise;
      await popup.waitForLoadState();

      // ── 3. Tell "not published yet" from "populated" ────────────────────
      const emptyBanner = popup.getByText('did not produce any significant content');
      const populatedHeading = popup.getByText('Daily Staff Coverage By Role');

      const outcome = await Promise.race([
        emptyBanner.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'empty'),
        populatedHeading.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'populated'),
      ]).catch(() => 'unknown');

      if (outcome === 'unknown') {
        await popup.close();
        throw new Error(
          `${date}: could not tell whether the roster had loaded — neither the "no content" ` +
          'message nor the report heading showed up within 20s. Stopping rather than guessing.'
        );
      }

      if (outcome === 'empty') {
        console.log(`${date}: no roster published yet — stopping here.`);
        await popup.close();
        break;
      }

      // ── 4. Export/download the PDF ───────────────────────────────────────
      const pdfLink = popup.getByRole('link', { name: 'Acrobat (PDF) file' });
      if (!(await pdfLink.isVisible().catch(() => false))) {
        await popup.getByRole('menuitem', { name: 'Export' }).getByTitle('Export').click();
      }
      const downloadPromise = popup.waitForEvent('download');
      await pdfLink.click();
      const download = await downloadPromise;
      const pdfPath = await download.path();
      const pdfBuffer = await (await import('node:fs/promises')).readFile(pdfPath);
      await popup.close();

      // ── 5. Hand it to ShiftFlow ───────────────────────────────────────────
      const pdfBase64 = pdfBuffer.toString('base64');
      const res = await fetch(`${SHIFTFLOW_URL}/api/automation/roster-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AUTOMATION_TOKEN}` },
        body: JSON.stringify({ date, pdf: pdfBase64 }),
      });
      const result = await res.json();
      if (!res.ok) {
        console.error(`${date}: ShiftFlow rejected the import:`, result);
        process.exitCode = 1;
        break;
      }

      console.log(`${date}: applied ${result.shifts_created} shift(s) across ${result.departments_applied} department(s).`);
      if (result.flags?.length) {
        console.log(`${date}: ${result.flags.length} flag(s) — also visible in the ShiftFlow banner:`);
        for (const f of result.flags) console.log(`  - ${f.department ? f.department + ': ' : ''}${f.message}`);
      }
      daysApplied += 1;
    }
  } finally {
    await browser.close();
  }

  console.log(`Done — ${daysApplied} day(s) applied this run.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
