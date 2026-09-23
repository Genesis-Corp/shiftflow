'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, AlertTriangle } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

/**
 * Lands every Supabase auth email link here — invite, and password recovery
 * if that's ever added — and establishes the session however that link
 * encoded it, before handing off to what happens next.
 *
 * Supabase Auth has sent links in three different shapes across its history
 * (which one a given project sends depends on its own email-template
 * config, not this app), and getting this wrong is exactly how an invite
 * link silently does nothing: the token sits unused in the URL, no session
 * is ever created, and the visitor just bounces to an ordinary sign-in page
 * with a password they were never asked to set. So all three are handled
 * here rather than assumed:
 *   1. #access_token=…&refresh_token=…   (implicit flow, hash-only — never
 *      reaches the server, so this has to run client-side)
 *   2. ?token_hash=…&type=invite          (OTP-style, current default)
 *   3. ?code=…                            (PKCE)
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function run() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error: err } = await supabase.auth.setSession({
          access_token: accessToken, refresh_token: refreshToken,
        });
        if (err) { setError(err.message); return; }
        router.replace('/accept-invite');
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get('token_hash');
      const type = params.get('type');
      if (tokenHash && type) {
        const { error: err } = await supabase.auth.verifyOtp({
          token_hash: tokenHash, type: type as 'invite' | 'recovery' | 'email',
        });
        if (err) { setError(err.message); return; }
        router.replace('/accept-invite');
        return;
      }

      const code = params.get('code');
      if (code) {
        const { error: err } = await supabase.auth.exchangeCodeForSession(code);
        if (err) { setError(err.message); return; }
        router.replace('/accept-invite');
        return;
      }

      setError('This link is missing what it needs to sign you in.');
    }

    run();
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      {error ? (
        <div className="card w-full max-w-sm p-6 text-center">
          <AlertTriangle size={24} className="mx-auto text-amber-500 mb-2" />
          <p className="text-sm font-medium text-slate-800">This link has expired or already been used</p>
          <p className="text-xs text-slate-500 mt-1">{error}</p>
          <p className="text-xs text-slate-400 mt-3">Ask whoever invited you to send a new invite.</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-slate-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> Signing you in…
        </div>
      )}
    </div>
  );
}
