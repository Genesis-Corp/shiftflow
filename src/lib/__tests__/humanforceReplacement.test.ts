import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const person='00000000-0000-4000-8000-000000000001', dept='00000000-0000-4000-8000-000000000002';
const other='00000000-0000-4000-8000-000000000003', cleaning='00000000-0000-4000-8000-000000000004';
const candidate={staff_id:person,department_id:dept,start_time:'06:00:00',end_time:'15:30:00',has_break:true,break_duration_minutes:30};
async function snapshot() {
  // JSON preserves Postgres microseconds, as PostgREST does; JS Date does not.
  return (await db.query<{items:Record<string,unknown>[]}>("select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') as items from shifts s where date='2026-10-23'")).rows[0].items;
}
async function apply(shifts: unknown[], dryRun=false, flags: unknown[]=[], expected?: unknown[]) {
  const result=await db.query<{result:{shifts_created:number;shifts_deleted:number;proposed_deletions:number;can_apply:boolean;flags:unknown[];snapshot_id:string|null}}>(
    'select replace_humanforce_roster($1::date,$2::jsonb,$3::jsonb,$4::jsonb,$5::boolean) as result',
    ['2026-10-23',JSON.stringify(shifts),JSON.stringify(flags),JSON.stringify(expected ?? await snapshot()),dryRun]);
  return result.rows[0].result;
}
async function oldShift(date='2026-10-23', department=dept) {
  return (await db.query<{id:string}>("insert into shifts(date,start_time,end_time,department_id,assigned_staff_id,status) values($1,'06:00','11:00',$2,$3,'covered') returning id",[date,department,person])).rows[0].id;
}
beforeAll(async()=>{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync('supabase-schema.sql','utf8'));
  await db.exec(readFileSync('supabase-migrations/20260915_automation_runs.sql','utf8'));
  await db.exec(readFileSync('supabase-migrations/20261023_authoritative_humanforce_roster.sql','utf8'));
  // Real FK semantics, including records cascaded by a removed shift.
  await db.exec(`create table shift_claim_races(id uuid primary key default gen_random_uuid(),shift_id uuid references shifts on delete cascade);
    create table shift_claim_recipients(id uuid primary key default gen_random_uuid(),race_id uuid references shift_claim_races on delete cascade);
    create table shift_extend_requests(id uuid primary key default gen_random_uuid(),shift_id uuid references shifts on delete cascade,existing_shift_id uuid references shifts on delete cascade);`);
});
beforeEach(async()=>{
  await db.exec('truncate shifts, staff, departments, automation_runs, humanforce_roster_snapshots cascade');
  await db.query("insert into staff(id,name,age_group,role_type) values($1,'Test Person','senior','department_only')",[person]);
  await db.query("insert into departments(id,name) values($1,'Dairy'),($2,'Deli'),($3,'Cleaning')",[dept,other,cleaning]);
});
afterAll(()=>db.close());
describe('Atomic authoritative roster replacement',()=>{
  it('previews replacement without modifying data, audit or snapshots',async()=>{
    await oldShift();const before=await snapshot();
    expect(await apply([candidate],true)).toMatchObject({shifts_created:0,shifts_deleted:0,proposed_deletions:1,can_apply:true});
    expect(await snapshot()).toEqual(before);
    for(const table of ['automation_runs','humanforce_roster_snapshots']) expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
  });
  it('replaces the first-segment-only import and snapshots the original',async()=>{
    const id=await oldShift(); const result=await apply([candidate]);
    expect(result).toMatchObject({shifts_created:1,shifts_deleted:1,can_apply:true});
    expect((await snapshot())[0]).toMatchObject({end_time:'15:30:00',has_break:true,break_duration_minutes:30});
    const rows=await db.query<{old_shifts:{id:string}[];run_id:string}>('select * from humanforce_roster_snapshots');
    expect(rows.rows[0].old_shifts[0].id).toBe(id); expect(rows.rows[0].run_id).toBeTruthy();
  });
  it('removes obsolete rows from absent departments while keeping other dates and exclusions',async()=>{
    await oldShift('2026-10-23',other);const excluded=await oldShift('2026-10-23',cleaning);const yesterday=await oldShift('2026-10-22');
    expect((await apply([candidate])).shifts_deleted).toBe(1);
    const ids=(await db.query<{id:string}>('select id from shifts')).rows.map(r=>r.id);
    expect(ids).toContain(excluded);expect(ids).toContain(yesterday);expect(ids).toHaveLength(3);
  });
  it('keeps exact IDs on repeat imports and creates no extra snapshot',async()=>{
    await apply([candidate]);const before=await snapshot();
    expect(await apply([candidate])).toMatchObject({shifts_created:0,shifts_deleted:0,snapshot_id:null});
    expect(await snapshot()).toEqual(before);expect((await db.query('select * from humanforce_roster_snapshots')).rows).toHaveLength(1);
  });
  it('allows adjacent assignments for one employee across departments',async()=>{
    expect((await apply([candidate,{...candidate,department_id:other,start_time:'15:30:00',end_time:'20:00:00',has_break:false,break_duration_minutes:0}])).shifts_created).toBe(2);
  });
  it('rejects overlapping and overnight-overlapping source assignments before deleting',async()=>{
    await oldShift();const before=await snapshot();
    for(const rows of [[candidate,{...candidate,department_id:other}],
      [{...candidate,start_time:'22:00:00',end_time:'06:00:00'},{...candidate,department_id:other,start_time:'23:00:00',end_time:'02:00:00'}]]) {
      await expect(apply(rows)).rejects.toThrow('Overlapping');expect(await snapshot()).toEqual(before);
    }
  });
  it('does not clear a day for an empty or flagged source',async()=>{
    await oldShift();const before=await snapshot();
    expect((await apply([])).can_apply).toBe(false);
    expect((await apply([candidate],false,[{kind:'unmatched_staff'}])).can_apply).toBe(false);
    expect(await snapshot()).toEqual(before);
  });
  it('rejects stale previews including manual edits, not just additions',async()=>{
    await oldShift();const before=await snapshot();await db.exec("update shifts set notes='Edited meanwhile'");
    await expect(apply([candidate],false,[],before)).rejects.toThrow('Roster changed');
    expect((await snapshot())[0].notes).toBe('Edited meanwhile');
  });
  it('blocks inactive staff and invalid break information before any removal',async()=>{
    await oldShift();const before=await snapshot();await db.exec('update staff set active=false');
    await expect(apply([candidate])).rejects.toThrow('inactive');await db.exec('update staff set active=true');
    await expect(apply([{...candidate,break_duration_minutes:0}])).rejects.toThrow('duration/break');
    expect(await snapshot()).toEqual(before);
  });
  it('rolls back deletions, inserts and snapshot if audit fails',async()=>{
    await oldShift();const before=await snapshot();
    await db.exec("alter table automation_runs add constraint reject_test_run check (source <> 'humanforce')");
    try { await expect(apply([candidate])).rejects.toThrow();expect(await snapshot()).toEqual(before);expect((await db.query('select * from humanforce_roster_snapshots')).rows).toHaveLength(0); }
    finally {await db.exec('alter table automation_runs drop constraint reject_test_run');}
  });
  it('saves linked claim/extension history and keeps reliability records',async()=>{
    const id=await oldShift();
    await db.query("insert into reliability_incidents(staff_id,incident_type,shift_id,date) values($1,'covered',$2,'2026-10-23')",[person,id]);
    const race=(await db.query<{id:string}>('insert into shift_claim_races(shift_id) values($1) returning id',[id])).rows[0].id;
    await db.query('insert into shift_claim_recipients(race_id) values($1)',[race]);
    await db.query('insert into shift_extend_requests(shift_id,existing_shift_id) values($1,$1)',[id]);
    await apply([candidate]);
    const related=(await db.query<{related_records:Record<string,unknown[]>}>('select related_records from humanforce_roster_snapshots')).rows[0].related_records;
    for(const table of ['reliability_incidents','shift_claim_races','shift_claim_recipients','shift_extend_requests']) expect(related[table]).toHaveLength(1);
    expect((await db.query('select * from reliability_incidents')).rows).toHaveLength(1);
  });
  it('denies browser roles both replacement access and snapshot reads',async()=>{
    const result=await db.query<{execute:boolean;read:boolean}>("select has_function_privilege('authenticated','replace_humanforce_roster(date,jsonb,jsonb,jsonb,boolean)','EXECUTE') as execute, has_table_privilege('anon','humanforce_roster_snapshots','SELECT') as read");
    expect(result.rows[0]).toEqual({execute:false,read:false});
  });
});
