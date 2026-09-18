import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * End-to-end coverage of the tiered claim race — startRace, advanceRace and
 * handleInboundReply driven together through a full immediate, gather and
 * sequential scenario, exactly the functions /api/claim-race, its lazy
 * advance step, and /api/sms/simulate call in production.
 *
 * findEligibleCandidates (eligibility.ts) is mocked — its own scoring logic
 * is covered elsewhere and pulls in the whole wages/staff schema, which
 * isn't what this file is testing. Everything downstream of it (tier
 * selection, batching, the gather window, manager routing, the atomic
 * claim) runs as real production code against an in-memory stand-in for
 * Supabase, not a reimplementation of the logic under test.
 */

// ── In-memory Supabase stand-in ─────────────────────────────────────────────

type Row = Record<string, any>;

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row[] | Row | null = null;
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private wantSelect = false;
  private selectCols = '';

  constructor(private db: FakeDb, private table: string) {}

  select(cols = '*') { this.wantSelect = true; this.selectCols = cols; return this; }
  eq(col: string, val: unknown) { this.filters.push(r => r[col] === val); return this; }
  neq(col: string, val: unknown) { this.filters.push(r => r[col] !== val); return this; }
  is(col: string, val: null) { this.filters.push(r => (r[col] ?? null) === val); return this; }
  in(col: string, vals: unknown[]) { this.filters.push(r => vals.includes(r[col])); return this; }
  not(col: string, _op: string, val: null) { this.filters.push(r => (r[col] ?? null) !== val); return this; }
  order(col: string, opts?: { ascending?: boolean }) { this.orderCol = col; this.orderAsc = opts?.ascending !== false; return this; }
  limit(n: number) { this.limitN = n; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybeSingle'; return this; }

  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this; }
  delete() { this.op = 'delete'; return this; }

  private matches(rows: Row[]): Row[] {
    let out = rows;
    for (const f of this.filters) out = out.filter(f);
    if (this.orderCol) {
      const col = this.orderCol;
      out = [...out].sort((a, b) => {
        const av = a[col]; const bv = b[col];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN != null) out = out.slice(0, this.limitN);
    return out;
  }

  private withJoins(row: Row): Row {
    if (this.table !== 'shift_claim_recipients' || !this.selectCols.includes('staff')) return row;
    const staff = this.db.tables.staff?.find(s => s.id === row.staff_id) ?? null;
    return { ...row, staff };
  }

  private execute(): { data: unknown; error: { message: string } | null } {
    const table = (this.db.tables[this.table] ??= []);

    if (this.op === 'insert') {
      const rows = (this.payload as Row[]).map(r => {
        const row: Row = { id: this.db.nextId(), created_at: this.db.now().toISOString(), ...r };
        table.push(row);
        return row;
      });
      if (!this.wantSelect) return { data: null, error: null };
      if (this.singleMode === 'single') return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'no row' } };
      if (this.singleMode === 'maybeSingle') return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }

    if (this.op === 'update') {
      const matched = this.matches(table);
      for (const row of matched) Object.assign(row, this.payload as Row);
      if (!this.wantSelect) return { data: null, error: null };
      if (this.singleMode === 'single') return matched[0] ? { data: matched[0], error: null } : { data: null, error: { message: 'no row' } };
      if (this.singleMode === 'maybeSingle') return { data: matched[0] ?? null, error: null };
      return { data: matched, error: null };
    }

    if (this.op === 'delete') {
      const matched = this.matches(table);
      const ids = new Set(matched.map(r => r.id));
      this.db.tables[this.table] = table.filter(r => !ids.has(r.id));
      return { data: null, error: null };
    }

    // select
    const matched = this.matches(table).map(r => this.withJoins(r));
    if (this.singleMode === 'single') return matched[0] ? { data: matched[0], error: null } : { data: null, error: { message: 'no rows' } };
    if (this.singleMode === 'maybeSingle') return { data: matched[0] ?? null, error: null };
    return { data: matched, error: null };
  }

  then<T>(resolve: (v: { data: unknown; error: { message: string } | null }) => T) {
    return Promise.resolve(this.execute()).then(resolve);
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  private idCounter = 0;
  private clock: () => Date = () => new Date();

  nextId(): string { return `id-${++this.idCounter}`; }
  now(): Date { return this.clock(); }
  useClock(fn: () => Date) { this.clock = fn; }

  from(table: string) { return new FakeQuery(this, table); }

  async rpc(name: string, params: Record<string, unknown>) {
    if (name !== 'claim_shift_race') throw new Error(`Unmocked RPC: ${name}`);
    const races = (this.tables.shift_claim_races ??= []);
    const race = races.find(r =>
      r.id === params.p_race_id && r.status === 'active' && r.winner_staff_id == null
      && new Date(r.expires_at).getTime() > this.now().getTime()
    );
    if (!race) return { data: [], error: null };
    race.winner_staff_id = params.p_staff_id;
    race.status = 'claimed';
    race.claimed_at = this.now().toISOString();
    return { data: [race], error: null };
  }

  reset() { this.tables = {}; this.idCounter = 0; }
}

const db = new FakeDb();
db.useClock(() => new Date());

interface SentMessage {
  to: string; body: string; kind: string; staffId: string | null; recipientName?: string;
}
const sentMessages: SentMessage[] = [];

let candidatesForNextRace: any[] = [];

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: { from: (table: string) => db.from(table), rpc: (name: string, params: any) => db.rpc(name, params) },
}));

vi.mock('@/lib/eligibility', () => ({
  findEligibleCandidates: async () => ({
    candidates: candidatesForNextRace, extendable: [], overlapExcluded: [], backup: [],
  }),
}));

vi.mock('@/lib/sms/send', () => ({
  sendSms: async (req: any) => {
    sentMessages.push({ to: req.to, body: req.body, kind: req.kind, staffId: req.staffId ?? null, recipientName: req.recipientName });
    return { ok: true, status: 'sent', deliveredTo: req.to, providerSid: `sim-${sentMessages.length}` };
  },
  logInbound: async () => true,
}));

const { startRace, advanceRace, handleInboundReply } = await import('../raceService');

// ── Fixtures ─────────────────────────────────────────────────────────────

function candidate(id: string, name: string, cost: number) {
  return {
    id, name, age_group: 'senior' as const, role_type: 'all_rounder', reliability_score: 60,
    phone: `04${id}`, phone_e164: `+614${id.padStart(8, '0')}`, sms_opt_out: false,
    computed_score: 60, trained_departments: [], weekly_minutes_before: 0, weekly_minutes_after: 480,
    shift_cost: cost,
  };
}

// 2026-09-18T09:00 in Australia/Perth (UTC+8, no DST) = 2026-09-18T01:00:00Z.
const BASE_NOW = new Date('2026-09-18T01:00:00Z');

function seedShift(id: string, date: string, start_time: string, end_time = '17:00') {
  db.tables.shifts = db.tables.shifts ?? [];
  db.tables.shifts.push({
    id, date, start_time, end_time, status: 'open', department_id: 'dept-1', required_role: null,
    departments: { id: 'dept-1', name: 'Bakery', requires_supervisor: false },
  });
}

function seedManager(userId: string, name: string, phone_e164: string) {
  db.tables.manager_profiles = db.tables.manager_profiles ?? [];
  db.tables.manager_profiles.push({ user_id: userId, name, phone_e164 });
}

function seedStaff(...cands: { id: string; name: string }[]) {
  db.tables.staff = db.tables.staff ?? [];
  for (const c of cands) db.tables.staff.push({ id: c.id, name: c.name, reliability_score: 60, sms_opt_out: false });
}

function messagesTo(phone: string) { return sentMessages.filter(m => m.to === phone); }
function bodyOf(m: SentMessage | undefined) { return m?.body ?? ''; }

beforeEach(() => {
  db.reset();
  sentMessages.length = 0;
  candidatesForNextRace = [];
  vi.useFakeTimers();
  vi.setSystemTime(BASE_NOW);
  db.useClock(() => new Date());
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Immediate tier ───────────────────────────────────────────────────────

describe('immediate tier end-to-end', () => {
  const A = candidate('a', 'Alice', 20);
  const B = candidate('b', 'Bob', 22);
  const C = candidate('c', 'Cara', 25);
  const D = candidate('d', 'Dee', 28);

  it('asks the first batch only, escalates on both declining, and notifies the manager on a win', async () => {
    seedShift('shift-imm', '2026-09-18', '09:10'); // 10 minutes out -> immediate
    seedManager('mgr-1', 'Jamie', '+61400000099');
    candidatesForNextRace = [A, B, C, D];
    seedStaff(A, B, C, D);

    const result = await startRace('shift-imm', { startedBy: 'mgr-1' });
    expect(result.tier).toBe('immediate');
    expect(result.contacted).toBe(2);

    // Only the first batch (cheapest two) is texted, with the manager's name.
    expect(messagesTo(A.phone_e164)).toHaveLength(1);
    expect(messagesTo(B.phone_e164)).toHaveLength(1);
    expect(messagesTo(C.phone_e164)).toHaveLength(0);
    expect(messagesTo(D.phone_e164)).toHaveLength(0);
    expect(bodyOf(messagesTo(A.phone_e164)[0])).toContain("Hey it's Jamie");

    const aCode = messagesTo(A.phone_e164)[0].body.match(/YES ([A-Z0-9]{4})/)?.[1];
    const bCode = messagesTo(B.phone_e164)[0].body.match(/YES ([A-Z0-9]{4})/)?.[1];
    expect(aCode).toBeTruthy();
    expect(bCode).toBeTruthy();

    // Both decline — the batch should advance immediately, without waiting
    // for the 5-minute timeout, straight to the next pair.
    const aReply = await handleInboundReply({ from: A.phone_e164, body: `NO ${aCode}` });
    expect(aReply.result).toBe('declined');
    await advanceRace(result.raceId);
    expect(messagesTo(C.phone_e164)).toHaveLength(0); // Bob hasn't answered yet

    const bReply = await handleInboundReply({ from: B.phone_e164, body: `NO ${bCode}` });
    expect(bReply.result).toBe('declined');
    await advanceRace(result.raceId);
    expect(messagesTo(C.phone_e164)).toHaveLength(1);
    expect(messagesTo(D.phone_e164)).toHaveLength(1);

    const cCode = messagesTo(C.phone_e164)[0].body.match(/YES ([A-Z0-9]{4})/)?.[1];
    const won = await handleInboundReply({ from: C.phone_e164, body: `YES ${cCode}` });
    expect(won.result).toBe('won');

    const race = db.tables.shift_claim_races.find(r => r.id === result.raceId);
    expect(race?.status).toBe('claimed');
    expect(race?.winner_staff_id).toBe('c');

    // The manager finds out who's covering it, unprompted.
    const managerTexts = messagesTo('+61400000099');
    expect(managerTexts).toHaveLength(1);
    expect(managerTexts[0].body).toContain('Cara will cover');
  });

  it('notifies the manager that nobody was available when the whole list is exhausted', async () => {
    seedShift('shift-imm2', '2026-09-18', '09:10');
    seedManager('mgr-1', 'Jamie', '+61400000099');
    candidatesForNextRace = [A, B];
    seedStaff(A, B);

    const result = await startRace('shift-imm2', { startedBy: 'mgr-1' });
    const aCode = messagesTo(A.phone_e164)[0].body.match(/YES ([A-Z0-9]{4})/)?.[1];
    const bCode = messagesTo(B.phone_e164)[0].body.match(/YES ([A-Z0-9]{4})/)?.[1];

    await handleInboundReply({ from: A.phone_e164, body: `NO ${aCode}` });
    await handleInboundReply({ from: B.phone_e164, body: `NO ${bCode}` });
    await advanceRace(result.raceId); // no more batches -> exhausted

    const race = db.tables.shift_claim_races.find(r => r.id === result.raceId);
    expect(race?.status).toBe('expired');

    const managerTexts = messagesTo('+61400000099');
    expect(managerTexts).toHaveLength(1);
    expect(managerTexts[0].body).toContain('nobody was available');
  });
});

// ── Gather tier ──────────────────────────────────────────────────────────

describe('gather tier end-to-end', () => {
  const E = candidate('e', 'Erin', 30);
  const F = candidate('f', 'Finn', 32);
  const G = candidate('g', 'Gus', 35);

  it('asks availability, gathers replies, then lets the manager pick from a numbered list', async () => {
    seedShift('shift-gather', '2026-09-18', '12:00'); // 3 hours out -> gather
    seedManager('mgr-1', 'Jamie', '+61400000099');
    candidatesForNextRace = [E, F, G];
    seedStaff(E, F, G);

    const result = await startRace('shift-gather', { startedBy: 'mgr-1' });
    expect(result.tier).toBe('gather');

    // Everyone is asked at once, with no claim code or "first reply wins".
    for (const c of [E, F, G]) {
      const msgs = messagesTo(c.phone_e164);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].body).toContain('are you available');
      expect(msgs[0].body).not.toContain('claim');
    }

    const erin = await handleInboundReply({ from: E.phone_e164, body: 'YES' });
    expect(erin.result).toBe('available_ack');
    const finn = await handleInboundReply({ from: F.phone_e164, body: 'NO' });
    expect(finn.result).toBe('declined');
    // Gus stays silent.

    // Still within the window — no manager text yet.
    await advanceRace(result.raceId);
    expect(messagesTo('+61400000099')).toHaveLength(0);

    // Past the (2-hour) gather window.
    vi.setSystemTime(new Date(BASE_NOW.getTime() + 130 * 60_000));
    await advanceRace(result.raceId);

    const race = db.tables.shift_claim_races.find(r => r.id === result.raceId);
    expect(race?.status).toBe('awaiting_pick');

    const managerTexts = messagesTo('+61400000099');
    expect(managerTexts).toHaveLength(1);
    expect(managerTexts[0].body).toContain('1. Erin - $30.00');
    expect(managerTexts[0].body).not.toContain('Finn'); // declined — not on the list
    expect(managerTexts[0].body).not.toContain('Gus');  // silent — not on the list either

    // The manager picks option 1 by texting back from her own phone.
    const pick = await handleInboundReply({ from: '+61400000099', body: '1' });
    expect(pick.result).toBe('manager_picked');
    expect(pick.reply).toContain('Erin will cover');

    const resolved = db.tables.shift_claim_races.find(r => r.id === result.raceId);
    expect(resolved?.status).toBe('claimed');
    expect(resolved?.winner_staff_id).toBe('e');
  });

  it('degrades to first-yes-wins when nobody is available at the window close', async () => {
    seedShift('shift-gather2', '2026-09-18', '12:00');
    seedManager('mgr-1', 'Jamie', '+61400000099');
    candidatesForNextRace = [E, F];
    seedStaff(E, F);

    const result = await startRace('shift-gather2', { startedBy: 'mgr-1' });
    await handleInboundReply({ from: E.phone_e164, body: 'NO' });
    // Finn stays silent.

    vi.setSystemTime(new Date(BASE_NOW.getTime() + 130 * 60_000));
    await advanceRace(result.raceId);

    const race = db.tables.shift_claim_races.find(r => r.id === result.raceId);
    expect(race?.status).toBe('active'); // not awaiting_pick — degraded instead
    expect(race?.degraded_at).toBeTruthy();

    // Finn (silent, not declined) gets a fresh, real offer with a claim code.
    const finnMsgs = messagesTo(F.phone_e164);
    expect(finnMsgs.length).toBeGreaterThanOrEqual(1);
    const lastFinnMsg = finnMsgs[finnMsgs.length - 1];
    expect(lastFinnMsg.body).toMatch(/YES [A-Z0-9]{4}/);

    const code = lastFinnMsg.body.match(/YES ([A-Z0-9]{4})/)?.[1];
    const won = await handleInboundReply({ from: F.phone_e164, body: `YES ${code}` });
    expect(won.result).toBe('won');

    // Re-running advanceRace after degrading must not re-blast the offer.
    const countBefore = messagesTo(F.phone_e164).length;
    await advanceRace(result.raceId);
    expect(messagesTo(F.phone_e164)).toHaveLength(countBefore);
  });
});

// ── Sequential tier ──────────────────────────────────────────────────────

describe('sequential tier end-to-end', () => {
  const H = candidate('h', 'Hana', 18);
  const I = candidate('i', 'Ivan', 19);

  it('asks one person at a time, cheapest first, and moves on after a timeout', async () => {
    seedShift('shift-seq', '2026-09-21', '09:00'); // 3 days out -> sequential
    seedManager('mgr-1', 'Jamie', '+61400000099');
    candidatesForNextRace = [H, I];
    seedStaff(H, I);

    const result = await startRace('shift-seq', { startedBy: 'mgr-1' });
    expect(result.tier).toBe('sequential');
    expect(messagesTo(H.phone_e164)).toHaveLength(1);
    expect(messagesTo(I.phone_e164)).toHaveLength(0);

    // Past the 4-hour step, with no reply from Hana.
    vi.setSystemTime(new Date(BASE_NOW.getTime() + 4 * 60 * 60_000 + 60_000));
    await advanceRace(result.raceId);
    expect(messagesTo(I.phone_e164)).toHaveLength(1);

    const code = messagesTo(I.phone_e164)[0].body.match(/YES ([A-Z0-9]{4})/)?.[1];
    const won = await handleInboundReply({ from: I.phone_e164, body: `YES ${code}` });
    expect(won.result).toBe('won');

    const race = db.tables.shift_claim_races.find(r => r.id === result.raceId);
    expect(race?.status).toBe('claimed');
    expect(race?.winner_staff_id).toBe('i');
    expect(messagesTo('+61400000099')[0].body).toContain('Ivan will cover');
  });
});
