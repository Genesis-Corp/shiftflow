import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { requireAutomationToken } from '../auth';

function reqWith(auth: string | null): Request {
  const headers = new Headers();
  if (auth !== null) headers.set('authorization', auth);
  return new Request('http://localhost/api/automation/roster-pdf', { headers });
}

describe('requireAutomationToken', () => {
  const original = process.env.AUTOMATION_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.AUTOMATION_TOKEN;
    else process.env.AUTOMATION_TOKEN = original;
  });

  it('rejects every request when no token is configured', () => {
    delete process.env.AUTOMATION_TOKEN;
    expect(requireAutomationToken(reqWith('Bearer anything'))).toBe(false);
    expect(requireAutomationToken(reqWith(null))).toBe(false);
  });

  it('accepts a matching bearer token', () => {
    process.env.AUTOMATION_TOKEN = 'sekret-123';
    expect(requireAutomationToken(reqWith('Bearer sekret-123'))).toBe(true);
  });

  it('is case-insensitive on the Bearer prefix', () => {
    process.env.AUTOMATION_TOKEN = 'sekret-123';
    expect(requireAutomationToken(reqWith('bearer sekret-123'))).toBe(true);
  });

  it('rejects a missing or wrong token', () => {
    process.env.AUTOMATION_TOKEN = 'sekret-123';
    expect(requireAutomationToken(reqWith(null))).toBe(false);
    expect(requireAutomationToken(reqWith('Bearer wrong'))).toBe(false);
    expect(requireAutomationToken(reqWith('Bearer '))).toBe(false);
  });

  it('also accepts the raw token with no "Bearer " prefix', () => {
    process.env.AUTOMATION_TOKEN = 'sekret-123';
    expect(requireAutomationToken(reqWith('sekret-123'))).toBe(true);
  });

  it('rejects a token that only differs in length', () => {
    process.env.AUTOMATION_TOKEN = 'sekret-123';
    expect(requireAutomationToken(reqWith('Bearer sekret-1234'))).toBe(false);
    expect(requireAutomationToken(reqWith('Bearer sekret-12'))).toBe(false);
  });
});
