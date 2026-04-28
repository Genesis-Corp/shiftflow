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
        </div>
      </div>
    </nav>
  );
}
