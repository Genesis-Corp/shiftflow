'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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

export default function Navbar() {
  const pathname = usePathname();
  return (
    <nav className="bg-blue-700 text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center gap-1 h-14 overflow-x-auto">
          <span className="font-bold text-lg mr-4 whitespace-nowrap">⚡ ShiftFlow</span>
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
          <DeployTag />
        </div>
      </div>
    </nav>
  );
}
