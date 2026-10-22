import { describe, it, expect } from 'vitest';
import { configuration, perthDate, requestSync, PROTOCOL } from '../../../automation/humanforce-sync.mjs';
const env = { HUMANFORCE_USERNAME:'test',HUMANFORCE_PASSWORD:'test',AUTOMATION_TOKEN:'test',SHIFTFLOW_URL:'https://test.example' };
describe('Windows sync runner contract', () => {
  it('uses Perth date at UTC and month/year boundaries', () => {
    expect(perthDate(0,new Date('2026-12-31T21:00:00Z'))).toBe('2027-01-01');
    expect(perthDate(1,new Date('2026-10-31T12:00:00Z'))).toBe('2026-11-01');
  });
  it('defaults to dry run and bounds the forward scan', () => {
    expect(configuration(env)).toMatchObject({dryRun:true,offset:0,max:21});
    for (const bad of [{MAX_DAYS_AHEAD:'NaN'},{MAX_DAYS_AHEAD:'0'},{TARGET_DATE_OFFSET_DAYS:'-1'},{DRY_RUN:'FALSE'},{SHIFTFLOW_URL:'http://example.com'},{SHIFTFLOW_URL:'https://example.com/path'}]) {
      expect(()=>configuration({...env,...bad})).toThrow();
    }
  });
  it('refuses old/protected/not-ready deployments', async () => {
    for (const result of [{},{protocol:PROTOCOL,ready:false}]) {
      await expect(requestSync(configuration(env),env,'roster-csv',undefined,async()=>new Response(JSON.stringify(result)))).rejects.toThrow();
    }
    await expect(requestSync(configuration(env),env,'roster-csv',undefined,async()=>new Response(JSON.stringify({protocol:PROTOCOL,ready:true})))).resolves.toMatchObject({ready:true});
  });
});
