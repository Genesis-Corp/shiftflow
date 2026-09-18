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

  return (
    <nav className="bg-blue-700 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-1 h-14 overflow-x-auto">
          <span className="font-bold text-lg mr-4 whitespace-nowrap">⚡ ShiftFlow</span>

          {/* No nav links pre-login — every one of them is behind the wall
              this page exists to get past, so showing them is just dead-end
              clutter until there's a session. */}
          {!onLoginPage && links.map(({ href, label }) => (
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

          {!onLoginPage && userEmail && (
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              <span className="hidden md:inline text-xs text-blue-100 truncate max-w-[14rem]" title={userEmail}>
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
