'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Loader2, UserCircle } from 'lucide-react';

interface Profile {
  name: string | null;
  phone: string | null;
}

/**
 * Blocks the app behind a "who are you" prompt until a manager has filled in
 * their name and mobile number — collected from them, not from whoever
 * invited them, the first time they sign in. No close button: incomplete
 * means blocked, not dismissible.
 */
export default function CompleteProfileGate() {
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null | 'loading'>('loading');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (pathname === '/login') return;
    let cancelled = false;
    fetch('/api/managers/profile', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: Profile | null) => { if (!cancelled) setProfile(data); })
      .catch(() => { if (!cancelled) setProfile(null); });
    return () => { cancelled = true; };
  }, [pathname]);

  if (pathname === '/login' || profile === 'loading' || profile === null) return null;
  if (profile.name && profile.phone) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const res = await fetch('/api/managers/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone }),
    });
    setSaving(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Could not save your details.'); return; }
    const data = await res.json();
    setProfile(data);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative card w-full max-w-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <UserCircle size={18} className="text-blue-500" />
          <h2 className="font-semibold text-slate-900">Welcome — a couple of details first</h2>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Your name and mobile number, so staff know who they&apos;re texting with and cover requests reach the
          right phone.
        </p>
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Name</label>
            <input className="input" required value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Mobile number</label>
            <input
              className="input" required placeholder="0433 821 798" value={phone}
              onChange={e => setPhone(e.target.value)}
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
