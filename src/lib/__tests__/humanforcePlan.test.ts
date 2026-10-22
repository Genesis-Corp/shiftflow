import { describe, it, expect } from 'vitest';
import { planHumanforceSync, SyncEntry, SyncShift } from '../humanforcePlan';
const entry: SyncEntry = { name:'Test Person',department:'Checkouts',start_time:'09:30:00',end_time:'16:10:00',has_break:true,break_duration_minutes:30,status:null,truncated:false };
const staff = [{id:'staff',name:'Test Person',active:true}];
const depts = [{id:'dept',name:'Checkouts'}];
const shift: SyncShift = {id:'shift',assigned_staff_id:'staff',department_id:'dept',start_time:'09:30:00',end_time:'16:10:00',has_break:true,break_duration_minutes:30,status:'covered'};
const plan = (entries = [entry], existing: SyncShift[] = []) => planHumanforceSync(entries,staff,depts,existing);
describe('Safe reconciliation', () => {
  it('adds an unambiguous new assignment with exact break data', () => expect(plan().creates[0]).toMatchObject({staff_id:'staff',has_break:true,break_duration_minutes:30}));
  it('makes exact repeat imports a no-op', () => { expect(plan([entry],[shift])).toMatchObject({creates:[],flags:[],duplicates:1}); });
  it.each([{end_time:'17:00:00'},{start_time:'10:00:00'},{department_id:'other'},{break_duration_minutes:0},{status:'cancelled'}])('flags changed shifts without adding or overwriting: %j', change => {
    const result=plan([entry],[{...shift,...change}]); expect(result.creates).toEqual([]); expect(result.flags.length).toBeGreaterThan(0);
  });
  it('flags missing shifts and leaves them untouched', () => {
    const result=plan([entry],[shift,{...shift,id:'missing',assigned_staff_id:'other'}]);
    expect(result.creates).toEqual([]); expect(result.flags[0].message).toContain('missing');
  });
  it('does not guess full-name matches or create staff', () => {
    for (const people of [[],[...staff,...staff],staff.map(s=>({...s,name:'Test Person Longer'})),staff.map(s=>({...s,active:false}))]) {
      expect(planHumanforceSync([entry],people,depts,[]).creates).toEqual([]);
    }
  });
  it('blocks additions against open shifts and multiple source rows', () => {
    expect(plan([entry],[{...shift,assigned_staff_id:null}]).creates).toEqual([]);
    expect(plan([entry,entry]).creates).toEqual([]);
  });
  it('requires unique department matching and keeps PDF fallback review-only', () => {
    expect(planHumanforceSync([entry],staff,[...depts,...depts],[]).creates).toEqual([]);
    expect(plan([{...entry,has_break:undefined,break_duration_minutes:undefined}]).creates).toEqual([]);
  });
});
