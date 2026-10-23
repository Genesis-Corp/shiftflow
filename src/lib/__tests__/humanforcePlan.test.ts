import { describe, it, expect } from 'vitest';
import { planHumanforceSync, SyncEntry, SyncShift } from '../humanforcePlan';
const entry: SyncEntry = { name:'Test Person',department:'Checkouts',start_time:'09:30:00',end_time:'16:10:00',has_break:true,break_duration_minutes:30,status:null,truncated:false };
const staff = [{id:'staff',name:'Test Person',active:true}];
const depts = [{id:'dept',name:'Checkouts'}];
const shift: SyncShift = {id:'shift',assigned_staff_id:'staff',department_id:'dept',start_time:'09:30:00',end_time:'16:10:00',has_break:true,break_duration_minutes:30,status:'covered'};
const plan = (entries = [entry], existing: SyncShift[] = []) => planHumanforceSync(entries,staff,depts,existing);
describe('Authoritative day reconciliation', () => {
  it('adds an unambiguous new assignment with exact break data', () => expect(plan().creates[0]).toMatchObject({staff_id:'staff',has_break:true,break_duration_minutes:30}));
  it('makes exact repeat imports a no-op', () => { expect(plan([entry],[shift])).toMatchObject({creates:[],flags:[],duplicates:1}); });
  it.each([{end_time:'17:00:00'},{start_time:'10:00:00'},{break_duration_minutes:0},{status:'cancelled'}])('replaces obsolete source data: %j', change => {
    const result=plan([entry],[{...shift,...change}]); expect(result.creates).toHaveLength(1); expect(result.removeIds).toEqual(['shift']); expect(result.flags).toEqual([]);
  });
  it('removes shifts missing from the new source', () => {
    const result=plan([entry],[shift,{...shift,id:'missing',assigned_staff_id:'other'}]);
    expect(result.creates).toEqual([]); expect(result.removeIds).toEqual(['missing']); expect(result.canApply).toBe(true);
  });
  it('does not guess full-name matches or create staff', () => {
    for (const people of [[],[...staff,...staff],staff.map(s=>({...s,name:'Test Person Longer'})),staff.map(s=>({...s,active:false}))]) {
      expect(planHumanforceSync([entry],people,depts,[]).creates).toEqual([]);
    }
  });
  it('replaces open shifts, but blocks overlapping source rows', () => {
    expect(plan([entry],[{...shift,assigned_staff_id:null}])).toMatchObject({removeIds:['shift'],canApply:true});
    expect(plan([entry,entry]).canApply).toBe(false);
  });
  it('allows adjacent assignments in different departments for the same person', () => {
    const result=planHumanforceSync([entry,{...entry,department:'Dairy',start_time:'16:10:00',end_time:'20:00:00',has_break:false,break_duration_minutes:0}],staff,[...depts,{id:'dairy',name:'Dairy'}],[]);
    expect(result.desired).toHaveLength(2); expect(result.canApply).toBe(true);
  });
  it('blocks the entire day when even one source person cannot be matched', () => {
    const result=plan([entry,{...entry,name:'Unknown Person'}],[shift]);
    expect(result.canApply).toBe(false); expect(result.flags[0].kind).toBe('unmatched_staff');
  });
  it('removes obsolete departments absent from the source, preserving excluded areas', () => {
    const result=planHumanforceSync([entry],staff,[...depts,{id:'old',name:'Deli'},{id:'clean',name:'Cleaning'}],
      [{...shift,id:'old',department_id:'old'},{...shift,id:'clean',department_id:'clean'}]);
    expect(result.removeIds).toEqual(['old']);
  });
  it('maps Grocery to the existing Grocery Assistant department without fuzzy guessing', () => {
    const grocery={...entry,department:'Grocery'};
    expect(planHumanforceSync([grocery],staff,[{id:'grocery',name:'Grocery Assistant'}],[]).canApply).toBe(true);
    expect(planHumanforceSync([grocery],staff,[{id:'grocery',name:'Grocery Assistant'},{id:'second',name:'Grocery'}],[]).canApply).toBe(false);
  });
  it('requires unique department matching and keeps PDF fallback review-only', () => {
    expect(planHumanforceSync([entry],staff,[...depts,...depts],[]).creates).toEqual([]);
    expect(plan([{...entry,has_break:undefined,break_duration_minutes:undefined}]).creates).toEqual([]);
  });
});
