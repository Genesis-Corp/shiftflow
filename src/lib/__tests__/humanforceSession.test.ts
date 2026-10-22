import { describe, it, expect, vi } from 'vitest';
import { sessionOptions, loginHumanforce, HumanVerificationRequired } from '../../../automation/humanforce-session.mjs';
const config={humanforce:'https://test.humanforce.com/Account/LogOn'};
const env={HUMANFORCE_USERNAME:'fake-user',HUMANFORCE_PASSWORD:'fake-password'};
describe('verified Humanforce session',()=>{
  it('loads a saved session and rejects malformed state',()=>{
    expect(sessionOptions({})).toEqual({});
    expect(sessionOptions({HUMANFORCE_STORAGE_STATE:'{"cookies":[],"origins":[]}'})).toEqual({storageState:{cookies:[],origins:[]}});
    expect(()=>sessionOptions({HUMANFORCE_STORAGE_STATE:'{}'})).toThrow();
  });
  it('stops immediately at human verification without clicking controls',async()=>{
    const page={goto:vi.fn(),url:()=>config.humanforce,title:async()=>'Human Verification',getByRole:vi.fn()};
    await expect(loginHumanforce(page,config,env)).rejects.toBeInstanceOf(HumanVerificationRequired);
    expect(page.getByRole).not.toHaveBeenCalled();
  });
  it('reuses an authenticated session without entering credentials',async()=>{
    const page={goto:vi.fn(),url:()=>'https://test.humanforce.com/Reporting/Roster',getByRole:vi.fn()};
    await loginHumanforce(page,config,env);
    expect(page.getByRole).not.toHaveBeenCalled();
  });
  it('lets the human complete verification and uses a password input afterward',async()=>{
    const username={waitFor:vi.fn().mockResolvedValue(undefined),fill:vi.fn()};
    const password={count:async()=>1,fill:vi.fn(),press:vi.fn()};
    const page={goto:vi.fn(),url:()=>config.humanforce,title:async()=>'Human Verification',getByRole:vi.fn(()=>username),locator:vi.fn(()=>password),
      waitForURL:vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValue(undefined)};
    await loginHumanforce(page,config,env,true);
    expect(username.fill).toHaveBeenCalledWith('fake-user');
    expect(page.locator).toHaveBeenCalledWith('input[type="password"]');
    expect(password.fill).toHaveBeenCalledWith('fake-password');
  });
});
