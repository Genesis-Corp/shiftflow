# Humanforce daily sync on Windows

The scheduled job uses Node/Playwright, launched by Windows PowerShell at **05:00 AWST** (21:00 UTC on the previous day). Perth has no daylight saving. The task uses the current Windows user's interactive session: the PC must be awake, online and signed in; a locked screen is fine. It catches up after a missed start when the PC is available. It does not require administrator privileges, a Windows password in a script or an execution-policy bypass.

## Import rules

The runner requests CSV first from the existing Humanforce report export menu. If the CSV option/download is unavailable it tries PDF. Invalid CSV content stops the run, rather than silently switching formats. Both endpoints require the automation bearer token and use the same reconciliation service. Requests default to preview unless `dryRun: false` is explicitly supplied.

CSV is validated both locally and on the server: named columns, consistent row widths, a real report date matching the request, weekday, configured site, full names and valid times. Quoted names, BOM, either shift column alone and overnight segments are supported. `tbShift_1` and `tbShift_2` are work segments. For example `09:30–12:30` plus `13:00–16:10` becomes one `09:30–16:10` shift with a 30-minute unpaid break. Reversed/overlapping segments, gaps over 60 minutes and shifts over 16 hours stop the CSV import for review. A single segment does not invent an unpaid break. The same employee may have multiple nonoverlapping assignments, including different departments. Adjacent endpoints are valid; duplicate or overlapping source rows block the day. Overlap uses the full assignment span, including its break.

Excluded department **or role** names are Cleaning, Direct Filling, Direct Ordering, Payroll Officer and Store Cashier. The site defaults to `Phoenix / Spearwood`; set `HUMANFORCE_SITE` on the server and runner if a different site is intended. Export the complete store report. A partial or filtered report is not suitable for replacement. Excluded departments remain outside the deletion scope.

Humanforce is authoritative for each imported date. Identical assignments retain their IDs. Other old shifts on that date are removed and replaced by the CSV, including obsolete shifts in departments absent from the new report and old unassigned shifts. Other dates are untouched. Only active staff with a unique full-name match and unique matching department can receive assignments. Grocery explicitly maps to the existing Grocery Assistant department; ambiguous matches still block. Any unresolved staff/department, invalid break data, empty source or source overlap blocks the entire day before deletions. No staff are created, training is not changed, no incidents are logged, reliability scores are not changed and no SMS is sent.

**PDF fallback is review-only.** The existing vision reader does not expose break segments or role exclusions accurately enough to replace a day. A PDF must contain the requested printed date; otherwise it is rejected. It cannot add or delete shifts and requires `ANTHROPIC_API_KEY` on the server.

The database function locks shift writes and compares a full snapshot to reject concurrent edits. It validates every candidate again, then saves removed shifts and linked claim/extension/reliability history in the restricted `humanforce_roster_snapshots` table. Snapshots, deletions, insertions and audit are one transaction: any failure rolls everything back. Reliability incident records remain, but a deleted shift reference becomes null; old claim/extension rows cascade out of active workflows and are retained in the snapshot. Recovery requires an administrator using those snapshots. Dry runs write no server records. The RPC is executable only by the service role. The `humanforce-replace-v2` protocol prevents older runners/deployments being used accidentally.

## Deploy the server first

1. Merge/deploy this change to the intended ShiftFlow environment.
2. In that environment's Supabase SQL editor, apply `supabase-migrations/20260915_automation_runs.sql` if it is not already installed, then `supabase-migrations/20261023_authoritative_humanforce_roster.sql`. The older additions-only function may remain installed but is no longer used by these endpoints.
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

Saved sessions use the same normal Chromium mode in setup and later runs; Humanforce rejects the headless mode observed during live validation. Previews show the browser, and daily apply runs start it minimized. This still requires the signed-in Windows desktop session. No verification interaction or browser fingerprint modification is automated.

The scripts load the running engine's built-in Security, Management and Utility modules by absolute path. This avoids `Get-Acl`/SecureString autoload failures caused by inheriting an incompatible module search path from another PowerShell version. It does not change the computer's module paths or weaken directory permissions.

First inspect the one-day dry run for correct date/filter/export behavior, then resolve its flags. `Install-SyncTask.ps1` without `-Enable` registers a disabled task. `-Enable` runs a fresh 21-day preview and requires it to finish without errors or flags, with at least one published date validated. The task pins absolute script/runtime paths, hides its console, ignores overlapping starts and has a 90-minute execution cap. It does not update code or install dependencies during daily runs. To update, stop/disable the task, update the installed checkout, install dependencies, validate a dry run and reinstall/enable.

The default installed checkout for this setup is `%LOCALAPPDATA%\ShiftFlowSync\app`. Installation can use another stable checkout; don't delete the checkout referenced by Task Scheduler. You can disable or remove the task in Task Scheduler using its name **ShiftFlow Humanforce Sync**.

## Operations and recovery

The runner scans up to 21 dates starting with today's Perth date; empty/unpublished dates are logged and skipped so a later published date can still be found. Humanforce's read-only date field is handled through its calendar, selecting the cell by year, month and day and verifying the resulting `dd/MM/yyyy` value. It navigates month/year boundaries explicitly. Editable/native date inputs remain supported. The export dropdown is allowed to finish opening before choosing CSV or PDF. Login challenges/MFA, popup/export selector changes and CSV validation failures stop processing further dates.

Logs: `%LOCALAPPDATA%\ShiftFlowSync\logs\YYYY-MM-DD.log` (30-day retention). Machine-readable last outcome: `%LOCALAPPDATA%\ShiftFlowSync\last-status.json`. Logs contain counts, dates and failure stages, not names, full exports, page HTML, screenshots or tokens. Exit 0 means completed, 1 means failed, 2 means completed with review flags, 3 means another local run holds the lock. Preview with review flags also exits 2. A server/database error returns failure instead of claiming success. Do not auto-retry an uncertain import blindly; the next run will recheck existing records.

Dry-run results, including review messages, are saved privately under `%LOCALAPPDATA%\ShiftFlowSync\previews\YYYY-MM-DD.json`, inheriting the restricted state-directory permissions. They contain the endpoint's result and flags, not the original export, credentials or token. Dry runs still write no shifts or audit rows to the server.

The GitHub workflow has **no cron** after merge. The old deployed workflow was disabled separately during setup, and its queued run was cancelled. Keep it disabled unless you want manual diagnostic runs. The manual workflow defaults to preview. Re-enabling it after merge does not restore a cron.

## Validation

`npm test` covers an anonymised copy of the supplied 30-row CSV, lone second-column shifts, break consolidation, bad dates/sites/times, matching/changed/missing/open shifts, authorization, dry-run defaults, deployment readiness and real PostgreSQL function execution via PGlite. The original employee names are not committed. Database tests cover stale duplicate candidates, dry runs, inactive staff, open shifts, denied browser-role execution and transaction rollback when audit insertion fails. They do not simulate multiple real PostgreSQL sessions; the table lock is the production serialization mechanism.

Also run `npm run typecheck`, `npm run build` and the Windows script parser/launcher smoke checks. Automated tests cannot establish that the live Humanforce selectors, WAF login and production credentials work: a local dry run with the actual configuration is required before trusting the daily job.
