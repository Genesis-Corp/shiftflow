'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Home, PhoneCall, CalendarDays, Users, Menu, X, Settings, LogOut } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

/** The four destinations a manager actually lives in day to day — one tap
 *  each from a thumb resting at the bottom of the phone. Everything else
 *  (Availability, Departments, Reliability, Settings) is one tap further,
 *  behind More, rather than crowding a bar that only fits four comfortably. */
const primaryTabs = [
  { href: '/',            label: 'Dashboard',   icon: Home },
  { href: '/cover-shift', label: 'Cover Shift', icon: PhoneCall },
  { href: '/shifts',      label: 'Shifts',      icon: CalendarDays },
  { href: '/staff',       label: 'Staff',       icon: Users },
];

const moreLinks = [
  { href: '/availability', label: 'Availability' },
  { href: '/departments',  label: 'Departments' },
  { href: '/reliability',  label: 'Reliability' },
];

/**
 * Bottom tab bar for phones (hidden from lg up, where the top Navbar's full
 * link row takes over). Fixed to the viewport bottom, safe-area aware for
 * the iPhone home-indicator strip.
 */
export default function MobileTabBar({ userEmail, userName }: { userEmail: string | null; userName?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const onLoginPage = pathname === '/login';
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('keydown', handler);
    // Same reasoning as Modal: without this, flicking past the end of the
    // sheet's own content scrolls the page underneath it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = previousOverflow;
    };
  }, [moreOpen]);

  async function logOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (onLoginPage || !userEmail) return null;

  const moreActive = moreLinks.some(l => l.href === pathname) || pathname === '/settings';

  return (
    <>
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMoreOpen(false)} />
      )}

      {/* The sheet itself sits above the tab bar (z-50, same layer a Modal
          uses) so it's never mistaken for part of the bar underneath it. */}
      {moreOpen && (
        <div
          className="lg:hidden fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl shadow-lg overflow-hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-xs text-slate-400 truncate" title={userEmail}>{userName ?? userEmail}</span>
            <button onClick={() => setMoreOpen(false)} className="btn-ghost p-1.5 rounded-md" aria-label="Close menu">
              <X size={18} />
            </button>
          </div>
          <div className="p-2">
            {moreLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`block px-4 py-3 rounded-lg text-base font-medium transition-colors ${
                  pathname === href ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {label}
              </Link>
            ))}
            <Link
              href="/settings"
              className={`flex items-center gap-2.5 px-4 py-3 rounded-lg text-base font-medium transition-colors ${
                pathname === '/settings' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Settings size={17} /> Settings
            </Link>
            <button
              onClick={logOut}
              className="w-full flex items-center gap-2.5 px-4 py-3 rounded-lg text-base font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <LogOut size={17} /> Log out
            </button>
          </div>
        </div>
      )}

      <nav
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-slate-200"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="grid grid-cols-5">
          {primaryTabs.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                  active ? 'text-blue-600' : 'text-slate-500'
                }`}
              >
                <Icon size={20} />
                {label}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen(o => !o)}
            aria-expanded={moreOpen}
            className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
              moreOpen || moreActive ? 'text-blue-600' : 'text-slate-500'
            }`}
          >
            <Menu size={20} />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
