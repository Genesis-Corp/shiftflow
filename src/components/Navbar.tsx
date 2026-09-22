'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut, Settings } from 'lucide-react';
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

/**
 * The top bar. Below lg it's just the logo — mobile navigation lives in
 * MobileTabBar instead (a bottom bar reaches a thumb far more easily than
 * anything up here), so there's no burger to duplicate that with.
 */
export default function Navbar({ userEmail, userName }: { userEmail: string | null; userName?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const onLoginPage = pathname === '/login';

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
              around 900px before they start colliding. Below that, the
              bottom tab bar takes over and this row just disappears. */}
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
            <div className="ml-auto hidden lg:flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-blue-100 truncate max-w-[14rem]" title={userEmail}>
                {userName ?? userEmail}
              </span>
              <Link
                href="/settings"
                title="Settings"
                className={`p-1.5 rounded-md transition-colors ${
                  pathname === '/settings' ? 'bg-blue-900 text-white' : 'text-blue-100 hover:bg-blue-600'
                }`}
              >
                <Settings size={15} />
              </Link>
              <button
                onClick={logOut}
                title="Log out"
                className="p-1.5 rounded-md text-blue-100 hover:bg-blue-600 transition-colors"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
