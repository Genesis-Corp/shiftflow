import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const person='00000000-0000-4000-8000-000000000001', dept='00000000-0000-4000-8000-000000000002';
const candidate={staff_id:person,department_id:dept,start_time:'09:00:00',end_time:'17:00:00',has_break:true,break_duration_minutes:30};
async function apply(shifts: unknown[], dryRun=false) {
  const result = await db.query<{ result: { shifts_created:number; flags:unknown[] } }>(
    'select apply_humanforce_sync($1::date,$2::jsonb,$3::jsonb,$4::boolean) as result',
    ['2026-10-23',JSON.stringify(shifts),'[]',dryRun]);
  return result.rows[0].result;
}
beforeAll(async()=>{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync('supabase-schema.sql','utf8'));
  await db.exec(readFileSync('supabase-migrations/20260915_automation_runs.sql','utf8'));
  await db.exec(readFileSync('supabase-migrations/20261022_safe_humanforce_sync.sql','utf8'));
});
beforeEach(async()=>{
  await db.exec('truncate shifts, staff, departments, automation_runs cascade');
  await db.query("insert into staff(id,name,age_group,role_type) values($1,'Test Person','senior','department_only')",[person]);
  await db.query("insert into departments(id,name) values($1,'Checkouts')",[dept]);
});
afterAll(()=>db.close());
describe('PostgreSQL safe-sync transaction',()=>{
  it('dry run writes neither shifts nor audit rows',async()=>{
    expect((await apply([candidate],true)).shifts_created).toBe(0);
    expect((await db.query('select * from automation_runs')).rows).toHaveLength(0);
    expect((await db.query('select * from shifts')).rows).toHaveLength(0);
  });
  it('rechecks a repeated/stale candidate at write time and audits it',async()=>{
    expect((await apply([candidate])).shifts_created).toBe(1);
    expect((await apply([{...candidate,end_time:'18:00:00'}])).shifts_created).toBe(0);
    expect((await db.query('select * from shifts')).rows).toHaveLength(1);
    expect((await db.query('select * from automation_runs')).rows).toHaveLength(2);
  });
  it('keeps unassigned shifts and inactive staff unchanged',async()=>{
    await db.query("insert into shifts(date,start_time,end_time,department_id) values('2026-10-23','09:00','17:00',$1)",[dept]);
    expect((await apply([candidate])).shifts_created).toBe(0);
    await db.exec('delete from shifts; update staff set active=false');
    expect((await apply([candidate])).shifts_created).toBe(0);
  });
  it('rolls back shift writes when audit insertion fails',async()=>{
    await db.exec("alter table automation_runs add constraint reject_test_run check (source <> 'humanforce')");
    await expect(apply([candidate])).rejects.toThrow();
    expect((await db.query('select * from shifts')).rows).toHaveLength(0);
    await db.exec('alter table automation_runs drop constraint reject_test_run');
  });
  it('denies direct execution to browser and unauthenticated roles',async()=>{
    const result=await db.query<{anon:boolean; authenticated:boolean}>("select has_function_privilege('anon','apply_humanforce_sync(date,jsonb,jsonb,boolean)','EXECUTE') as anon, has_function_privilege('authenticated','apply_humanforce_sync(date,jsonb,jsonb,boolean)','EXECUTE') as authenticated");
    expect(result.rows[0]).toEqual({anon:false,authenticated:false});
  });
});
