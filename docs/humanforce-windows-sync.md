# Humanforce daily sync on Windows

The scheduled job uses Node/Playwright, launched by Windows PowerShell at **05:00 AWST** (21:00 UTC on the previous day). Perth has no daylight saving. The task uses the current Windows user's interactive session: the PC must be awake, online and signed in; a locked screen is fine. It catches up after a missed start when the PC is available. It does not require administrator privileges, a Windows password in a script or an execution-policy bypass.

## Import rules

The runner requests CSV first from the existing Humanforce report export menu. If the CSV option/download is unavailable it tries PDF. Invalid CSV content stops the run, rather than silently switching formats. Both endpoints require the automation bearer token and use the same reconciliation service. Requests default to preview unless `dryRun: false` is explicitly supplied.

CSV is validated both locally and on the server: named columns, consistent row widths, a real report date matching the request, weekday, configured site, full names and valid times. Quoted names, BOM, either shift column alone and overnight segments are supported. `tbShift_1` and `tbShift_2` are work segments. For example `09:30–12:30` plus `13:00–16:10` becomes one `09:30–16:10` shift with a 30-minute unpaid break. Reversed/overlapping segments, gaps over 60 minutes, shifts over 16 hours and repeated staff/department rows stop the CSV import for review. A single segment does not invent an unpaid break.

Excluded department **or role** names are Cleaning, Direct Filling, Direct Ordering, Payroll Officer and Store Cashier. The site defaults to `Phoenix / Spearwood`; set `HUMANFORCE_SITE` on the server and runner if a different site is intended. These exclusions are applied to exported rows, so correctness does not depend on Humanforce remembering its department filter. Missing departments in a filtered export cannot establish that their shifts were removed.

An exact shift match (staff, department, start, end, break, covered status) is a no-op. Only active staff with a unique full-name match and unique matching department can receive new assignments. Existing shifts for the person, changed times/department/break, inactive/unknown/ambiguous people, duplicate source rows and unassigned department shifts become flags. Existing shifts in departments present in the report that were not confirmed also become flags. Nothing is deleted or overwritten. No staff are created, training is not changed, no incidents are logged, reliability is not changed and no SMS is sent. Review flags in the existing ShiftFlow banner, then make any corrections through the normal app.

**PDF fallback is review-only for new assignments.** The existing vision reader does not expose break segments or role exclusions accurately enough to auto-create shifts. A PDF must contain the requested printed date; otherwise it is rejected. PDF reads can identify existing matches and record review flags, but cannot add shifts. It also requires `ANTHROPIC_API_KEY` on the server.

The database function locks shift writes while it rechecks candidates, preventing overlapping syncs or stale plans from adding a second assignment. Shift additions and the audit record are one transaction: audit failure rolls everything back. Dry runs write neither shifts nor audit records. It never updates or deletes existing records. The RPC is executable only by the service role. The runner checks the new endpoint protocol and migration readiness before logging in, so an old deployment cannot receive an export from this runner.

## Deploy the server first

1. Merge/deploy this change to the intended ShiftFlow environment.
2. In that environment's Supabase SQL editor, apply `supabase-migrations/20260915_automation_runs.sql` if it is not already installed, then `supabase-migrations/20261022_safe_humanforce_sync.sql`.
3. Set `AUTOMATION_TOKEN` on that deployment to the same strong random token used locally. The server also needs its existing Supabase service-role configuration. No database key belongs on this Windows runner.

GitHub Actions secret values cannot be downloaded. If the existing automation token is unknown, replace it on the deployment and enter the same new value locally. Do not put credentials in chat, repository files, task arguments or shell history.

## Local installation

Use Node 22 or newer and run these commands in the installed checkout:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
.\automation\windows\Set-SyncConfiguration.ps1
.\automation\windows\Run-HumanforceSync.ps1 -DryRun -Days 1
.\automation\windows\Install-SyncTask.ps1 -Enable
```

The configuration command prompts privately for Humanforce username/password, the deployed ShiftFlow HTTPS origin and automation token. SecureStrings are saved with Windows DPAPI to `%LOCALAPPDATA%\ShiftFlowSync\configuration.clixml`. They can be decrypted only by the same Windows account on this PC. The directory ACL grants access to that user and SYSTEM. Secrets are passed to the child process only as temporary environment variables, restored/removed afterward, and redacted from captured logs.

If Humanforce presents Human Verification, run `Run-HumanforceSync.ps1 -SetupSession`. A visible browser waits up to 15 minutes for you to complete verification. The script never interacts with challenge controls. After sign-in it saves cookies/local storage with Windows DPAPI in `humanforce-session.clixml` alongside the configuration. Plain session JSON is passed through a local process pipe and is never written to disk or logged. Session setup imports no rosters. Subsequent syncs load the encrypted session and refresh it after login. Run a one-day dry run before enabling the task. Humanforce can require verification again later; if so the job stops for a person and remains unable to sync until verification is completed again. Delete the encrypted session file to stop reusing it.

The scripts load the running engine's built-in Security, Management and Utility modules by absolute path. This avoids `Get-Acl`/SecureString autoload failures caused by inheriting an incompatible module search path from another PowerShell version. It does not change the computer's module paths or weaken directory permissions.

First inspect the one-day dry run for correct date/filter/export behavior, then resolve its flags. `Install-SyncTask.ps1` without `-Enable` registers a disabled task. `-Enable` requires a successful server readiness check. The task pins absolute script/runtime paths, hides its console, ignores overlapping starts and has a 90-minute execution cap. It does not update code or install dependencies during daily runs. To update, stop/disable the task, update the installed checkout, install dependencies, validate a dry run and reinstall/enable.

The default installed checkout for this setup is `%LOCALAPPDATA%\ShiftFlowSync\app`. Installation can use another stable checkout; don't delete the checkout referenced by Task Scheduler. You can disable or remove the task in Task Scheduler using its name **ShiftFlow Humanforce Sync**.

## Operations and recovery

The runner scans up to 21 dates starting with today's Perth date; empty/unpublished dates are logged and skipped so a later published date can still be found. Dates are filled explicitly in the report field instead of selecting ambiguous day numbers in a calendar. The native field uses ISO date; text fields use `dd/MM/yyyy` and must retain that value. If the live Humanforce viewer uses a different format/selector, the job stops for correction. A fresh headless login occurs each run. Login challenges/MFA, popup/export selector changes and CSV validation failures stop processing further dates.

Logs: `%LOCALAPPDATA%\ShiftFlowSync\logs\YYYY-MM-DD.log` (30-day retention). Machine-readable last outcome: `%LOCALAPPDATA%\ShiftFlowSync\last-status.json`. Logs contain counts, dates and failure stages, not names, full exports, page HTML, screenshots or tokens. Exit 0 means completed, 1 means failed, 2 means completed with review flags, 3 means another local run holds the lock. Preview with review flags also exits 2. A server/database error returns failure instead of claiming success. Do not auto-retry an uncertain import blindly; the next run will recheck existing records.

The GitHub workflow has **no cron** after merge. The old deployed workflow was disabled separately during setup, and its queued run was cancelled. Keep it disabled unless you want manual diagnostic runs. The manual workflow defaults to preview. Re-enabling it after merge does not restore a cron.

## Validation

`npm test` covers an anonymised copy of the supplied 30-row CSV, lone second-column shifts, break consolidation, bad dates/sites/times, matching/changed/missing/open shifts, authorization, dry-run defaults, deployment readiness and real PostgreSQL function execution via PGlite. The original employee names are not committed. Database tests cover stale duplicate candidates, dry runs, inactive staff, open shifts, denied browser-role execution and transaction rollback when audit insertion fails. They do not simulate multiple real PostgreSQL sessions; the table lock is the production serialization mechanism.

Also run `npm run typecheck`, `npm run build` and the Windows script parser/launcher smoke checks. Automated tests cannot establish that the live Humanforce selectors, WAF login and production credentials work: a local dry run with the actual configuration is required before trusting the daily job.
