'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

/**
 * The step an invite link was missing entirely: /auth/callback establishes
 * a session from the email link's token, but an invited manager has never
 * set a password — without this page they land here with a valid session
 * and nothing to do with it, or (before this existed) get bounced to
 * ordinary sign-in asking for a password nobody ever chose.
 */
export default function AcceptInvitePage() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data }) => setHasSession(!!data.user));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setSaving(true);
    const supabase = createSupabaseBrowserClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (err) { setError(err.message); return; }

    router.push('/');
    router.refresh();
  }

  if (hasSession === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="card w-full max-w-sm p-6 text-center">
          <AlertTriangle size={24} className="mx-auto text-amber-500 mb-2" />
          <p className="text-sm font-medium text-slate-800">No active invite session</p>
          <p className="text-xs text-slate-500 mt-1">
            Open this page from the link in your invite email, or ask whoever invited you to resend it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-blue-600" />
          <h1 className="font-semibold text-slate-900">Set your password</h1>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          You&apos;re signed in from your invite. Choose a password to finish setting up your account.
        </p>
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="label">New password</label>
            <input
              type="password" className="input" required autoFocus minLength={8}
              value={password} onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Confirm password</label>
            <input
              type="password" className="input" required minLength={8}
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full justify-center">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Continue
          </button>
        </form>
      </div>
    </div>
  );
}
