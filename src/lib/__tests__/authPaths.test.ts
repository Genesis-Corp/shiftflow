import { describe, it, expect } from 'vitest';
import { isPublicPath, isApiPath } from '../supabase/middleware';

/**
 * These two functions decide who gets past the login wall without a session.
 * Getting either wrong is a real security bug, not a UX one — hence tests,
 * not just eyeballing it.
 */
describe('isPublicPath', () => {
  it('allows the login page and its own assets', () => {
    expect(isPublicPath('/login')).toBe(true);
  });

  it("allows Twilio's webhook — it has no session, only its own signature check", () => {
    expect(isPublicPath('/api/sms/inbound')).toBe(true);
  });

  it('allows the auth API routes (login/bootstrap/status/logout)', () => {
    expect(isPublicPath('/api/auth/status')).toBe(true);
    expect(isPublicPath('/api/auth/bootstrap')).toBe(true);
    expect(isPublicPath('/api/auth/logout')).toBe(true);
  });

  it('does not allow real app pages or data routes', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/staff')).toBe(false);
    expect(isPublicPath('/api/staff')).toBe(false);
    expect(isPublicPath('/settings')).toBe(false);
  });

  it('does not treat a path merely starting with a public prefix as public', () => {
    // /loginish is not /login. A startsWith-without-a-boundary check would
    // wrongly let this through.
    expect(isPublicPath('/loginish')).toBe(false);
    expect(isPublicPath('/api/smsinbound')).toBe(false);
  });

  it("does not let Twilio's own path escape to something unrelated", () => {
    expect(isPublicPath('/api/sms/simulate')).toBe(false);
    expect(isPublicPath('/api/sms/config')).toBe(false);
  });
});

describe('isApiPath', () => {
  it('is true for anything under /api/', () => {
    expect(isApiPath('/api/staff')).toBe(true);
    expect(isApiPath('/api/sms/inbound')).toBe(true);
  });

  it('is false for real pages, so those still get the redirect UX', () => {
    expect(isApiPath('/')).toBe(false);
    expect(isApiPath('/staff')).toBe(false);
    expect(isApiPath('/login')).toBe(false);
  });
});
