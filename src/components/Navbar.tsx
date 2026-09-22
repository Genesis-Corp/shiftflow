'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut, Settings, Menu, X } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const links = [
  { href: '/',             label: 'Dashboard' },
  { href: '/cover-shift',  label: 'Cover Shift' },
  { href: '/shifts',       label: 'Shifts' },
  { href: '/availability', label: 'Availability' },
  { href: '/staff',        label: 'Staff' },
  { href: '/departments',  label: 'Departments' },
  { href: '/reliability',  label: 'Reliability' },
];

export default function Navbar({ userEmail, userName }: { userEmail: string | null; userName?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const onLoginPage = pathname === '/login';
  const [menuOpen, setMenuOpen] = useState(false);

  // Close on navigation — without this the panel stays open over the page
  // you just asked for, which reads as a broken tap on a phone.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  async function logOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const showNav = !onLoginPage && !!userEmail;

  return (
    <nav className="bg-blue-700 text-white shadow-lg sticky top-0 z-40">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1 h-14">
          <span className="font-bold text-lg lg:mr-4 whitespace-nowrap">⚡ ShiftFlow</span>

          {/* Full row from lg up — seven links plus the account controls need
              around 900px before they start colliding. Below that it's the
              burger, so the bar never becomes a sideways-scrolling strip. */}
          {!onLoginPage && (
            <div className="hidden lg:flex items-center gap-1">
              {links.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                    pathname === href
                      ? 'bg-blue-900 text-white'
                      : 'text-blue-100 hover:bg-blue-600'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}

          {showNav && (
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              <span className="hidden lg:inline text-xs text-blue-100 truncate max-w-[14rem]" title={userEmail}>
                {userName ?? userEmail}
              </span>
              <Link
                href="/settings"
                title="Settings"
                className={`hidden lg:inline-flex p-1.5 rounded-md transition-colors ${
                  pathname === '/settings' ? 'bg-blue-900 text-white' : 'text-blue-100 hover:bg-blue-600'
                }`}
              >
                <Settings size={15} />
              </Link>
              <button
                onClick={logOut}
                title="Log out"
                className="hidden lg:inline-flex p-1.5 rounded-md text-blue-100 hover:bg-blue-600 transition-colors"
              >
                <LogOut size={15} />
              </button>

              <button
                onClick={() => setMenuOpen(o => !o)}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                className="lg:hidden p-2 -mr-2 rounded-md text-white hover:bg-blue-600 transition-colors"
              >
                {menuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Drops in below the bar rather than floating over the page: nothing
          overlaps, nothing needs a scroll lock, and closing it puts the page
          back exactly where it was. */}
      {showNav && menuOpen && (
        <div className="lg:hidden border-t border-blue-600 bg-blue-700 pb-2">
          <div className="px-2 pt-2 space-y-0.5">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`block px-4 py-3 rounded-md text-base font-medium transition-colors ${
                  pathname === href ? 'bg-blue-900 text-white' : 'text-blue-50 hover:bg-blue-600'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          <div className="mt-2 pt-2 px-2 border-t border-blue-600 space-y-0.5">
            <Link
              href="/settings"
              className={`flex items-center gap-2.5 px-4 py-3 rounded-md text-base font-medium transition-colors ${
                pathname === '/settings' ? 'bg-blue-900 text-white' : 'text-blue-50 hover:bg-blue-600'
              }`}
            >
              <Settings size={17} /> Settings
            </Link>
            <button
              onClick={logOut}
              className="w-full flex items-center gap-2.5 px-4 py-3 rounded-md text-base font-medium text-blue-50 hover:bg-blue-600 transition-colors"
            >
              <LogOut size={17} /> Log out
            </button>
            <p className="px-4 pt-1.5 text-xs text-blue-200 truncate">{userName ?? userEmail}</p>
          </div>
        </div>
      )}
    </nav>
  );
}
