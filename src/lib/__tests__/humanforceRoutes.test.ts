import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import Papa from 'papaparse';
const mocks = vi.hoisted(()=>({rpc:vi.fn(), reconcile:vi.fn(), readPdf:vi.fn()}));
vi.mock('../supabaseAdmin',()=>({supabaseAdmin:{rpc:mocks.rpc,from:()=>({select:()=>({limit:async()=>({error:null})})})}}));
vi.mock('../humanforceSync', async original=>({ ...await original<typeof import('../humanforceSync')>(),reconcileHumanforce:mocks.reconcile }));
vi.mock('../rosterVision',()=>({readRosterPdf:mocks.readPdf}));
import { POST, GET } from '../../app/api/automation/roster-csv/route';
import { POST as pdfPost } from '../../app/api/automation/roster-pdf/route';
const csv=Papa.unparse([{textBox1:'Phoenix / Spearwood',titleTextBox:'Daily Staff Coverage By Role for Friday 23 Oct 2026',textBox2:'Checkouts',tbDetailsMainText:'Checkout Operator',tbDetailsSubText:'Test Person',tbShift_1:'09:00 - 13:00',tbShift_2:''}]);
const req=(body:unknown, token='test-token')=>new NextRequest('https://test.example/api/automation/roster-csv',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();process.env.AUTOMATION_TOKEN='test-token';mocks.rpc.mockResolvedValue({error:null});mocks.reconcile.mockResolvedValue(new Response('{}'));});
describe('automation route boundaries',()=>{
  it('rejects unauthenticated requests before parsing or database access',async()=>{
    expect((await POST(req({},'wrong'))).status).toBe(401);expect(mocks.reconcile).not.toHaveBeenCalled();
    expect((await pdfPost(req({},'wrong'))).status).toBe(401);expect(mocks.readPdf).not.toHaveBeenCalled();
  });
  it('rejects incorrect dates and malformed CSV without writes',async()=>{
    expect((await POST(req({date:'2026-10-24',csv}))).status).toBe(422);
    expect((await POST(req({date:'2026-10-23',csv:'bad'}))).status).toBe(422);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it('defaults to preview and only explicitly applies boolean false',async()=>{
    await POST(req({date:'2026-10-23',csv}));expect(mocks.reconcile.mock.calls[0][2]).toBe(true);
    await POST(req({date:'2026-10-23',csv,dryRun:false}));expect(mocks.reconcile.mock.calls[1][2]).toBe(false);
    expect((await POST(req({date:'2026-10-23',csv,dryRun:'false'}))).status).toBe(422);
  });
  it('preflight checks the database transaction without mutation',async()=>{
    const response=await GET(new NextRequest('https://test.example',{headers:{Authorization:'Bearer test-token'}}));
    expect(response.status).toBe(200);expect(mocks.rpc.mock.calls[0][1].p_dry_run).toBe(true);
    mocks.rpc.mockResolvedValue({error:{message:'missing function'}});
    expect((await GET(new NextRequest('https://test.example',{headers:{Authorization:'Bearer test-token'}}))).status).toBe(503);
  });
});
