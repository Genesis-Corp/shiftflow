import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The one scenario that cannot be tested by hand: two staff members replying
 * YES within the same instant.
 *
 * Postgres guarantees that only one caller's conditional UPDATE returns a row
 * (see claim_shift_race in supabase-claim-race.sql). What is tested here is
 * OUR half of that contract — that the handler turns "the RPC gave me nothing"
 * into a loss rather than a second winner, and never covers the shift twice.
 */

const state = {
  raceWon: false,
  shiftUpdates: [] as Record<string, unknown>[],
  recipientUpdates: [] as Record<string, unknown>[],
};

const RACE = {
  id: 'race-1', shift_id: 'shift-1', status: 'active',
  winner_staff_id: null, mode: 'console',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
};

const SHIFT = {
  id: 'shift-1', date: '2026-09-15', start_time: '09:00:00', end_time: '17:00:00',
  departments: { id: 'dept-1', name: 'Bakery' },
};

const RECIPIENTS: Record<string, { id: string; race_id: string; staff_id: string; outcome: string | null }> = {
  '4F7K': { id: 'rec-dave',  race_id: 'race-1', staff_id: 'staff-dave',  outcome: null },
  '9XM2': { id: 'rec-sarah', race_id: 'race-1', staff_id: 'staff-sarah', outcome: null },
};

/** Minimal chainable stand-in for the bits of supabase-js that raceService uses. */
function makeQuery(table: string, filters: Record<string, unknown> = {}): any {
  const q: any = {
    select: () => q,
    insert: (rows: unknown) => {
      if (table === 'shift_claim_recipients') state.recipientUpdates.push({ insert: rows });
      return { select: () => ({ single: async () => ({ data: null, error: null }) }), then: undefined, error: null };
    },
    update: (values: Record<string, unknown>) => {
      if (table === 'shifts') state.shiftUpdates.push(values);
      if (table === 'shift_claim_recipients') state.recipientUpdates.push({ ...values, ...filters });
      return makeQuery(table, filters);
    },
    eq: (k: string, v: unknown) => makeQuery(table, { ...filters, [k]: v }),
    neq: () => makeQuery(table, filters),
    is: (k: string, v: unknown) => makeQuery(table, { ...filters, [k]: v }),
    in: () => makeQuery(table, filters),
    order: () => makeQuery(table, filters),
    limit: () => makeQuery(table, filters),
    maybeSingle: async () => ({ data: resolve(table, filters), error: null }),
    single: async () => ({ data: resolve(table, filters), error: null }),
    then: (cb: (r: { data: unknown; error: null }) => unknown) =>
      Promise.resolve(cb({ data: resolveMany(table), error: null })),
  };
  return q;
}

function resolve(table: string, filters: Record<string, unknown>) {
  if (table === 'shift_claim_recipients') {
    const code = filters.claim_code as string | undefined;
    return code ? RECIPIENTS[code] ?? null : null;
  }
  if (table === 'shift_claim_races') return RACE;
  if (table === 'shifts') return SHIFT;
  if (table === 'staff') return { id: filters.id, name: 'Dave', reliability_score: 50 };
  return null;
}

function resolveMany(table: string) {
  if (table === 'shift_claim_recipients') return Object.values(RECIPIENTS);
  if (table === 'staff') return [{ id: 'staff-dave', name: 'Dave' }, { id: 'staff-sarah', name: 'Sarah' }];
  return [];
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeQuery(table),
    // The atomic claim: the first caller gets a row, everyone after gets none.
    rpc: async (_fn: string) => {
      if (state.raceWon) return { data: [], error: null };
      state.raceWon = true;
      return { data: [{ ...RACE, status: 'claimed' }], error: null };
    },
  },
}));

vi.mock('@/lib/sms/send', () => ({
  sendSms: async () => ({ ok: true, status: 'simulated', deliveredTo: null, providerSid: null }),
  logInbound: async () => true,
}));

const { handleInboundReply } = await import('../raceService');

describe('simultaneous YES replies', () => {
  beforeEach(() => {
    state.raceWon = false;
    state.shiftUpdates = [];
    state.recipientUpdates = [];
  });

  it('produces exactly one winner when two replies race', async () => {
    const [dave, sarah] = await Promise.all([
      handleInboundReply({ from: '+61433821798', body: 'YES 4F7K', providerSid: 'SM1' }),
      handleInboundReply({ from: '+61400000001', body: 'YES 9XM2', providerSid: 'SM2' }),
    ]);

    const results = [dave.result, sarah.result].sort();
    expect(results).toEqual(['too_late', 'won']);
  });

  it('covers the shift once, not once per replier', async () => {
    await Promise.all([
      handleInboundReply({ from: '+61433821798', body: 'YES 4F7K', providerSid: 'SM1' }),
      handleInboundReply({ from: '+61400000001', body: 'YES 9XM2', providerSid: 'SM2' }),
    ]);

    const covered = state.shiftUpdates.filter(u => u.status === 'covered');
    expect(covered).toHaveLength(1);
  });

  it('answers the loser rather than leaving them in silence', async () => {
    await handleInboundReply({ from: '+61433821798', body: 'YES 4F7K', providerSid: 'SM1' });
    const late = await handleInboundReply({ from: '+61400000001', body: 'YES 9XM2', providerSid: 'SM2' });

    expect(late.result).toBe('too_late');
    expect(late.reply).toContain('already been covered');
  });

  it('confirms the win to the winner', async () => {
    const first = await handleInboundReply({ from: '+61433821798', body: 'YES 4F7K', providerSid: 'SM1' });
    expect(first.result).toBe('won');
    expect(first.reply).toContain('is yours');
  });

  it('treats a declining reply as a decline, not a claim', async () => {
    const res = await handleInboundReply({ from: '+61433821798', body: 'NO 4F7K', providerSid: 'SM3' });
    expect(res.result).toBe('declined');
    expect(state.shiftUpdates.filter(u => u.status === 'covered')).toHaveLength(0);
  });

  it('ignores a duplicate webhook delivery', async () => {
    const send = await import('@/lib/sms/send');
    vi.spyOn(send, 'logInbound').mockResolvedValueOnce(false);

    const res = await handleInboundReply({ from: '+61433821798', body: 'YES 4F7K', providerSid: 'SM1' });
    expect(res.result).toBe('duplicate');
    expect(res.handled).toBe(false);
    expect(state.shiftUpdates).toHaveLength(0);
  });
});
