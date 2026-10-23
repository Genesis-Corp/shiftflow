#!/usr/bin/env node
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseHumanforceCsv } from '../src/lib/humanforceCsv.mjs';
import { loginHumanforce, sessionOptions, saveEncryptedSession, HumanVerificationRequired } from './humanforce-session.mjs';

export const PROTOCOL = 'humanforce-safe-v1';
export function perthDate(offset = 0, now = new Date()) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const date = new Date(`${local}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function configuration(env) {
  for (const name of ['HUMANFORCE_USERNAME','HUMANFORCE_PASSWORD','SHIFTFLOW_URL','AUTOMATION_TOKEN']) {
    if (!env[name]?.trim()) throw new Error(`Missing configuration: ${name}`);
  }
  const integer = (name, fallback, max) => {
    const raw = env[name] ?? fallback;
    if (!/^\d+$/.test(raw) || +raw > max) throw new Error(`Invalid configuration: ${name}`);
    return +raw;
  };
  const app = new URL(env.SHIFTFLOW_URL);
  const humanforce = new URL(env.HUMANFORCE_URL || 'https://fjspearwood.humanforce.com/Account/LogOn?ReturnUrl=%2fReporting%2fRosterDailyCoverageReportByRole');
  if (app.protocol !== 'https:' || app.username || app.password || app.pathname !== '/' || app.search || app.hash) throw new Error('SHIFTFLOW_URL must be an HTTPS origin.');
  if (humanforce.protocol !== 'https:' || humanforce.username || humanforce.password || !humanforce.hostname.endsWith('.humanforce.com')) throw new Error('Invalid Humanforce HTTPS URL.');
  if (env.DRY_RUN !== undefined && !['true','false'].includes(env.DRY_RUN)) throw new Error('DRY_RUN must be true or false.');
  const max = integer('MAX_DAYS_AHEAD', '21', 60);
  if (max < 1) throw new Error('MAX_DAYS_AHEAD must be at least 1.');
  return { app: app.origin, humanforce: humanforce.href, offset: integer('TARGET_DATE_OFFSET_DAYS','0',60), max,
    dryRun: env.DRY_RUN !== 'false', site: env.HUMANFORCE_SITE || 'Phoenix / Spearwood' };
}

const log = (event, fields = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }));
export async function requestSync(config, env, path, body, fetcher = fetch) {
  const res = await fetcher(`${config.app}/api/automation/${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.AUTOMATION_TOKEN}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || result?.protocol !== PROTOCOL || (!body && result.ready !== true)) throw new Error(`ShiftFlow readiness/import failed (HTTP ${res.status}).`);
  return result;
}

async function setDate(page, date) {
  const input = page.locator('#reportDate');
  const type = await input.getAttribute('type');
  const [year, month, day] = date.split('-');
  const text = type === 'date' ? date : `${day}/${month}/${year}`;
  await input.fill(text);
  await input.press('Tab');
  if ((await input.inputValue()).trim() !== text) throw new Error('Humanforce did not retain the requested report date.');
}

async function exportReport(popup, format) {
  const name = format === 'csv' ? /CSV|comma.?separated/i : /Acrobat.*PDF/i;
  let link = popup.getByRole('link', { name });
  if (!(await link.isVisible().catch(() => false))) {
    await popup.getByRole('menuitem', { name: 'Export', exact: true }).getByTitle('Export').click();
  }
  if (await link.count() !== 1) throw new Error(`No unique ${format} export option.`);
  const [download] = await Promise.all([popup.waitForEvent('download', { timeout: 30000 }), link.click()]);
  if (await download.failure()) throw new Error(`${format} download failed.`);
  const file = await download.path();
  if (!file) throw new Error('Download file unavailable.');
  const bytes = await readFile(file);
  if (!bytes.length || bytes.length > (format === 'csv' ? 2_000_000 : 14_000_000)) throw new Error('Invalid export size.');
  if (format === 'pdf' && bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('Export is not a PDF.');
  return bytes;
}

export async function main(env = process.env) {
  const config = configuration(env);
  // Never send exports to an old deployment with the unsafe PDF importer.
  await requestSync(config, env, 'roster-csv');
  if (env.PREFLIGHT_ONLY === 'true') { log('preflight_ok'); return; }
  const setupSession = env.SESSION_SETUP === 'true';
  if (setupSession && !env.HUMANFORCE_SESSION_FILE) throw new Error('Encrypted session destination is required.');
  // Keep a verified session in the same normal browser mode used at setup.
  // No verification controls, user agents or browser fingerprints are altered.
  const savedSession = Boolean(env.HUMANFORCE_STORAGE_STATE);
  const browser = await chromium.launch({ headless: !setupSession && !savedSession,
    ...(savedSession && !setupSession && !config.dryRun ? { args: ['--start-minimized'] } : {}) });
  let stage = 'login';
  let review = false, checked = 0;
  try {
    const context = await browser.newContext({ acceptDownloads: true, ...sessionOptions(env) });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    if (setupSession) log('verification_window_open', { message: 'Complete Humanforce verification in the browser. Session setup does not import rosters.' });
    await loginHumanforce(page, config, env, setupSession);
    if (env.HUMANFORCE_SESSION_FILE) saveEncryptedSession(await context.storageState(), env.HUMANFORCE_SESSION_FILE);
    if (setupSession) { log('encrypted_session_saved'); return; }
    await page.getByText('Settings', { exact: true }).click();
    for (let i = 0; i < config.max; i++) {
      const date = perthDate(config.offset + i);
      log('checking', { date });
      stage = 'report_date';
      await setDate(page, date);
      const [popup] = await Promise.all([page.waitForEvent('popup'), page.getByText('Print Preview', { exact: true }).click()]);
      try {
        await popup.waitForLoadState();
        const state = await Promise.any([
          popup.getByText(/did not produce any significant content/i).waitFor({ state: 'visible', timeout: 30000 }).then(() => 'empty'),
          popup.getByText(/Daily Staff Coverage By Role/).first().waitFor({ state: 'visible', timeout: 30000 }).then(() => 'populated'),
        ]);
        if (state === 'empty') { log('unpublished', { date }); continue; }
        stage = 'export';
        let format = 'csv', bytes;
        try { bytes = await exportReport(popup, 'csv'); }
        catch { log('csv_export_unavailable', { date }); format = 'pdf'; bytes = await exportReport(popup, 'pdf'); }
        // Invalid CSV data stops the run; it must never silently become a PDF import.
        stage = 'validation';
        if (format === 'csv') parseHumanforceCsv(bytes.toString('utf8'), date, config.site);
        stage = 'reconciliation';
        const result = await requestSync(config, env, `roster-${format}`, {
          date, dryRun: config.dryRun, ...(format === 'csv' ? { csv: bytes.toString('utf8') } : { pdf: bytes.toString('base64') }),
        });
        review ||= !!result.flags?.length;
        checked++;
        log('day_complete', { date, format, dry_run: config.dryRun, shifts_created: result.shifts_created,
          proposed_shifts: result.proposed_shifts, duplicates: result.duplicates, flags: result.flags?.length ?? 0 });
      } finally { await popup.close(); }
    }
    log('complete', { days_checked: checked, needs_review: review, dry_run: config.dryRun });
    if (review) process.exitCode = 2;
  } catch (error) {
    // Do not write page HTML, screenshots, roster data or credentials to diagnostics.
    if (error instanceof HumanVerificationRequired) throw error;
    throw new Error(`Humanforce sync stopped at ${stage}; no further dates processed.`);
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { log('failed', { message: error.message }); process.exitCode = 1; });
}
