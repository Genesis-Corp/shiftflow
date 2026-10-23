import { describe, it, expect } from 'vitest';
import { configuration, perthDate, requestSync, PROTOCOL, setDate } from '../../../automation/humanforce-sync.mjs';
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
  it('selects a read-only calendar date across the year boundary using month/year metadata', async () => {
    let value = '31/12/2026', shown = 2026 * 12 + 11, filled = false;
    const input = { waitFor:async()=>{},getAttribute:async(name:string)=>name==='type'?'text':'true',inputValue:async()=>value,click:async()=>{},fill:async()=>{filled=true;} };
    const calendar = { locator:(selector:string) => {
      if(selector==='.ui-datepicker-title') return {innerText:async()=>new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(Math.floor(shown/12),shown%12,1)))};
      if(selector==='.ui-datepicker-next'||selector==='.ui-datepicker-prev') return {click:async()=>{shown+=selector.endsWith('next')?1:-1;}};
      const parts=selector.match(/data-year="(\d+)".*data-month="(\d+)".*data-date="(\d+)"/)!;
      return {count:async()=>shown===+parts[1]*12 + +parts[2]?1:0,click:async()=>{value=`${parts[3].padStart(2,'0')}/${String(+parts[2]+1).padStart(2,'0')}/${parts[1]}`;}};
    }};
    await setDate({locator:(selector:string)=>selector==='#reportDate'?input:calendar},'2027-01-03');
    expect(value).toBe('03/01/2027');expect(filled).toBe(false);
  });
  it('does not reopen the calendar when the requested date is already selected',async()=>{
    const input={waitFor:async()=>{},getAttribute:async()=> 'text',inputValue:async()=> '23/10/2026'};
    await expect(setDate({locator:()=>input},'2026-10-23')).resolves.toBeUndefined();
  });
});
