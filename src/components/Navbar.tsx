'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

const links = [
  { href: '/',             label: 'Dashboard' },
  { href: '/cover-shift',  label: 'Cover Shift' },
  { href: '/shifts',       label: 'Shifts' },
  { href: '/availability', label: 'Availability' },
  { href: '/staff',        label: 'Staff' },
  { href: '/departments',  label: 'Departments' },
  { href: '/reliability',  label: 'Reliability' },
  { href: '/managers',     label: 'Managers' },
];

/**
 * Which branch/commit this deployment was built from, and whether it's
 * Production or a Preview. Set automatically by Vercel's System Environment
 * Variables (see next.config.mjs) — nothing to configure by hand.
 *
 * This exists because the Vercel project has two branches deploying in
 * parallel (this claim-race branch and a separate staff-details branch), both
 * producing shiftflow-*.vercel.app URLs that look identical at a glance. That
 * ambiguity repeatedly cost real time diagnosing "my change isn't showing up"
 * when the real answer was "you're on the other branch." The tag makes that
 * obvious without leaving the page.
 */
function DeployTag() {
  const branch = process.env.NEXT_PUBLIC_GIT_BRANCH || 'local';
  const sha = process.env.NEXT_PUBLIC_GIT_SHA;
  const env = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const isProd = env === 'production';

  return (
    <span
      title={`${branch}${sha ? ` @ ${sha}` : ''}`}
      className={`ml-auto flex-shrink-0 hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono ${
        isProd ? 'bg-red-900/60 text-red-100' : 'bg-blue-900/60 text-blue-100'
      }`}
    >
      {isProd ? 'PROD' : 'preview'} · {branch}
    </span>
  );
}

export default function Navbar({ userEmail }: { userEmail: string | null }) {
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
                {userEmail}
              </span>
              <button
                onClick={logOut}
                title="Log out"
                className="p-1.5 rounded-md text-blue-100 hover:bg-blue-600 transition-colors"
              >
                <LogOut size={15} />
              </button>
            </div>
          )}
          <DeployTag />
        </div>
      </div>
    </nav>
  );
}
