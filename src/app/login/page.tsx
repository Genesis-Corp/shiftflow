'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

/**
 * Two modes, decided by whether any account exists yet:
 *  - no accounts  -> "set up the first account" (email + password, no invite
 *    needed — there is nobody to invite you)
 *  - accounts exist -> ordinary sign-in. New accounts beyond the first are
 *    created only via an existing manager's invite (Managers page), not here.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(r => r.json())
      .then(d => setHasUsers(!!d.hasUsers))
      .catch(() => setHasUsers(true)); // fail safe: assume accounts exist
  }, []);

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }

    setLoading(true);
    const res = await fetch('/api/auth/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Could not create account'); setLoading(false); return; }

    await signIn();
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    await signIn();
  }

  async function signIn() {
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) { setError(signInError.message); return; }
    router.push(next);
    router.refresh();
  }

  if (hasUsers === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  const isBootstrap = !hasUsers;

  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={20} className="text-blue-600" />
          <h1 className="text-lg font-bold text-slate-900">ShiftFlow</h1>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          {isBootstrap
            ? 'No account exists yet — set up the first one.'
            : 'Sign in to continue'}
        </p>

        <form onSubmit={isBootstrap ? handleBootstrap : handleSignIn} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input
              type="email" required autoFocus className="input"
              value={email} onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password" required minLength={isBootstrap ? 8 : undefined} className="input"
              value={password} onChange={e => setPassword(e.target.value)}
            />
          </div>
          {isBootstrap && (
            <div>
              <label className="label">Confirm password</label>
              <input
                type="password" required className="input"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
            {loading
              ? <Loader2 size={15} className="animate-spin" />
              : isBootstrap ? 'Create account & sign in' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
