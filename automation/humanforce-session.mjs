import { spawnSync } from 'node:child_process';
import path from 'node:path';

export class HumanVerificationRequired extends Error {
  constructor() { super('Humanforce requires human verification. Run the Windows launcher with -SetupSession and complete verification in its browser window.'); this.name = 'HumanVerificationRequired'; }
}

/** Save only DPAPI ciphertext. Session JSON travels over stdin, never command arguments or logs. */
export function saveEncryptedSession(state, file) {
  if (!file || process.platform !== 'win32') throw new Error('Windows encrypted session destination is required.');
  const script = "$ErrorActionPreference='Stop'; foreach($moduleName in @('Microsoft.PowerShell.Security','Microsoft.PowerShell.Utility')) { Import-Module ([IO.Path]::Combine($PSHOME,'Modules',$moduleName,($moduleName+'.psd1'))) }; $sessionText=[Console]::In.ReadToEnd(); ConvertTo-SecureString $sessionText -AsPlainText -Force | Export-Clixml -LiteralPath $env:SHIFTFLOW_SESSION_FILE";
  const result = spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { input: JSON.stringify(state), encoding: 'utf8', windowsHide: true,
      timeout: 15000, env: { ...process.env, SHIFTFLOW_SESSION_FILE: file } });
  if (result.error || result.status !== 0) throw new Error('Could not save the encrypted Humanforce session.');
}

export function sessionOptions(env) {
  if (!env.HUMANFORCE_STORAGE_STATE) return {};
  const state = JSON.parse(env.HUMANFORCE_STORAGE_STATE);
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error('Invalid encrypted browser session.');
  return { storageState: state };
}

/** The interactive mode waits for the human. It never clicks or solves verification controls. */
export async function loginHumanforce(page, config, env, interactive = false) {
  const timeout = interactive ? 15 * 60 * 1000 : 60000;
  await page.goto(config.humanforce, { timeout: 60000 });
  if (new URL(page.url()).pathname.startsWith('/Reporting/')) return;
  if (!interactive && /human verification/i.test(await page.title())) throw new HumanVerificationRequired();
  const username = page.getByRole('textbox', { name: 'Employee code or email' });
  const outcome = await Promise.any([
    page.waitForURL('**/Reporting/**', { timeout }).then(() => 'authenticated'),
    username.waitFor({ state: 'visible', timeout }).then(() => 'login'),
  ]);
  if (outcome === 'authenticated') return;
  await username.fill(env.HUMANFORCE_USERNAME);
  const password = page.locator('input[type="password"]');
  if (await password.count() !== 1) throw new Error('No unique Humanforce password input.');
  await password.fill(env.HUMANFORCE_PASSWORD);
  await password.press('Enter');
  await page.waitForURL('**/Reporting/**', { timeout });
}
