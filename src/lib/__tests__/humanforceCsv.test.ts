import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { parseHumanforceCsv, validDate } from '../humanforceCsv.mjs';
const fixture = readFileSync('src/lib/__tests__/fixtures/humanforce-anonymised.csv', 'utf8');
const date = '2026-10-23';
function csv(first: string, second: string, overrides: Record<string,string> = {}) {
  return Papa.unparse([{ textBox1: 'Phoenix / Spearwood', titleTextBox: 'Daily Staff Coverage By Role for Friday 23 Oct 2026',
    textBox2: 'Checkouts', tbDetailsMainText: 'Checkout Operator', tbDetailsSubText: 'Test Person', tbShift_1: first, tbShift_2: second, ...overrides }]);
}
describe('Humanforce CSV', () => {
  it('reads the anonymised sample with all original column positions/segments', () => {
    const parsed = parseHumanforceCsv(fixture, date);
    expect(parsed.entries).toHaveLength(27);
    expect(parsed.excluded).toBe(3);
    expect(parsed.entries.filter(e => e.has_break)).toHaveLength(14);
  });
  it('accepts either column alone without inventing a break', () => {
    for (const pair of [['17:30 - 21:00',''],['','17:30 - 21:00']]) {
      expect(parseHumanforceCsv(csv(...pair as [string,string]), date).entries[0]).toMatchObject({ start_time:'17:30:00',end_time:'21:00:00',has_break:false,break_duration_minutes:0 });
    }
  });
  it('combines ordered segments and retains the exact unpaid gap', () => {
    expect(parseHumanforceCsv(csv('09:30 - 12:30','13:00 - 16:10'), date).entries[0]).toMatchObject({ start_time:'09:30:00',end_time:'16:10:00',has_break:true,break_duration_minutes:30 });
  });
  it('handles quoting, BOM and reordered columns', () => {
    expect(parseHumanforceCsv('\uFEFF'+csv('07:00 - 11:00','', {tbDetailsSubText:'Test, Person'}),date).entries[0].name).toBe('Test, Person');
  });
  it.each([['12:30 - 16:10','09:30 - 12:00'],['09:30 - 12:30','12:00 - 16:00'],['09:30 - 12:30','14:00 - 16:00'],['99:00 - 12:30',''],['',''],['09:00 - 09:00','']])('rejects unsafe segments %s / %s', (a,b) => {
    expect(()=>parseHumanforceCsv(csv(a,b),date)).toThrow();
  });
  it('supports a shift across midnight', () => {
    expect(parseHumanforceCsv(csv('22:00 - 02:00','02:30 - 06:00'),date).entries[0]).toMatchObject({start_time:'22:00:00',end_time:'06:00:00',break_duration_minutes:30});
  });
  it('fails the whole file on date/site/header/row corruption', () => {
    for (const text of [fixture.replaceAll('23 Oct','24 Oct'), fixture.replaceAll('Phoenix / Spearwood','Other site'), fixture.replace('tbShift_2','wrong'), fixture+'\r\nbad,row']) {
      expect(()=>parseHumanforceCsv(text,date)).toThrow();
    }
    expect(()=>parseHumanforceCsv(fixture,'2026-10-24')).toThrow();
  });
  it('rejects duplicate names in one department and invalid calendar dates', () => {
    const rows = Papa.parse<string[]>(csv('07:00 - 11:00','')).data;
    expect(()=>parseHumanforceCsv(Papa.unparse([...rows, rows[1]]),date)).toThrow();
    expect(validDate('2026-02-30')).toBe(false);
  });
});
