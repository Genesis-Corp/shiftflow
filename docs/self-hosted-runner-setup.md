# Self-hosted runner setup (Windows) — Humanforce roster sync

The `humanforce-sync.yml` workflow runs on a self-hosted runner instead of
GitHub's hosted runners, because Humanforce's login sits behind AWS WAF bot
protection that challenges GitHub's shared datacenter IP ranges with an
interactive CAPTCHA. An ordinary residential/business IP (your PC) doesn't
trigger it.

## 1. Fix PowerShell's execution policy first

The runner executes each workflow step as a generated `.ps1` script. If this
machine's execution policy is `Restricted` (the default on many Windows
installs — the same thing that blocked `npx playwright codegen` earlier),
the runner's own scripts will fail the same way, including when it's running
unattended as a service under a different account than yours. Fix it at the
machine level, not just your user account, so it covers whatever account the
service ends up running as:

Open PowerShell **as Administrator** and run:

```powershell
Set-ExecutionPolicy -Scope LocalMachine RemoteSigned
```

## 2. Register the runner

1. Go to **github.com/Genesis-Corp/shiftflow → Settings → Actions → Runners
   → New self-hosted runner**.
2. Choose **Windows** / **x64**.
3. Follow the four commands it shows you (download the zip, extract it,
   then `config.cmd` with the URL and registration token it generates —
   the token is time-limited, so copy the commands straight from that page
   rather than reusing one from here).
4. When `config.cmd` asks for runner labels, you can accept the defaults —
   it automatically tags itself `self-hosted`, `Windows`, and `X64`, which
   is what the workflow's `runs-on: [self-hosted, Windows]` matches on.

## 3. Install it as a service (don't just leave `run.cmd` in a window)

`run.cmd` only works while that terminal window stays open and you stay
logged in. For a 4am scheduled run to actually fire, install it as a proper
Windows service instead, from the same folder, **as Administrator**:

```powershell
.\svc.cmd install
.\svc.cmd start
```

This keeps the runner listening in the background across logout and reboot
(it still won't run while the machine is fully asleep or powered off).

## 4. The overnight-uptime tradeoff

The workflow's schedule (`20:00 UTC` = `4:00am AWST`) assumes something is
online to pick up the job at that moment. A personal Windows PC usually
isn't powered on overnight unless you deliberately leave it on or set it to
wake on schedule. Options, pick whichever matches how this PC is actually
used:

- **Leave it on overnight** (disable sleep, or set a Task Scheduler wake
  timer for just before 4am) — the scheduled run fires as originally
  intended.
- **Move the cron time** in `humanforce-sync.yml` to whenever this PC is
  reliably on and logged in during the day instead — trade a few hours of
  lead time for reliability. Say if you want this changed and to what time.
- **Leave the schedule as-is and rely on manual catch-up** — run the
  workflow by hand (Actions → Humanforce roster sync → Run workflow) each
  morning once the PC is on; a missed scheduled run just sits queued until
  the runner reconnects, or you trigger it yourself.

## 5. Confirm it's working

Once the service is running, trigger the workflow manually once (Actions →
Humanforce roster sync → Run workflow) and watch it pick up the job — the
run's job log will show which runner it landed on, and should get past the
AWS WAF challenge this time since it's coming from this machine's IP.
