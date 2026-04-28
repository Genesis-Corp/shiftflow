'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Building2, Calendar, ShieldAlert, TrendingUp, Clock } from 'lucide-react';
import { formatDate } from '@/lib/shiftUtils';

interface Stats {
  totalStaff: number;
  activeStaff: number;
  departments: number;
  openShifts: number;
  todayShifts: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [openShifts, setOpenShifts] = useState<{ id: string; date: string; start_time: string; end_time: string; departments: { name: string } }[]>([]);
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    async function load() {
      const [staffRes, deptRes, shiftsRes] = await Promise.all([
        fetch('/api/staff'),
        fetch('/api/departments'),
        fetch('/api/shifts'),
      ]);
      const [staff, depts, shifts] = await Promise.all([staffRes.json(), deptRes.json(), shiftsRes.json()]);

      const open = (shifts ?? []).filter((s: { status: string }) => s.status === 'open');
      const todayCount = (shifts ?? []).filter((s: { date: string }) => s.date === today).length;

      setStats({
        totalStaff: staff?.length ?? 0,
        activeStaff: (staff ?? []).filter((s: { active: boolean }) => s.active).length,
        departments: depts?.length ?? 0,
        openShifts: open.length,
        todayShifts: todayCount,
      });
      setOpenShifts(open.slice(0, 5));
    }
    load();
  }, [today]);

  const cards = [
    { href: '/staff', icon: Users, label: 'Total Staff', value: stats?.totalStaff, sub: `${stats?.activeStaff} active`, color: 'text-blue-600 bg-blue-50' },
    { href: '/departments', icon: Building2, label: 'Departments', value: stats?.departments, sub: 'Manage departments', color: 'text-purple-600 bg-purple-50' },
    { href: '/shifts', icon: Calendar, label: "Today's Shifts", value: stats?.todayShifts, sub: `${stats?.openShifts} open total`, color: 'text-green-600 bg-green-50' },
    { href: '/cover-shift', icon: ShieldAlert, label: 'Open Shifts', value: stats?.openShifts, sub: 'Needs covering', color: 'text-red-600 bg-red-50' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">{formatDate(today)} — Shift management overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(({ href, icon: Icon, label, value, sub, color }) => (
          <Link key={href} href={href} className="card p-4 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-500">{label}</p>
                <p className="text-3xl font-bold text-slate-900 mt-1">{value ?? '—'}</p>
                <p className="text-xs text-slate-400 mt-1">{sub}</p>
              </div>
              <div className={`p-2 rounded-lg ${color}`}>
                <Icon size={20} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-red-500" />
            <h2 className="font-semibold text-slate-800">Open Shifts</h2>
          </div>
          {openShifts.length === 0 ? (
            <p className="text-slate-400 text-sm">No open shifts</p>
          ) : (
            <div className="space-y-2">
              {openShifts.map(s => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{s.departments?.name}</p>
                    <p className="text-xs text-slate-400">{formatDate(s.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-700">{s.start_time} – {s.end_time}</p>
                    <Link href="/cover-shift" className="text-xs text-blue-600 hover:underline">Find cover →</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-green-500" />
            <h2 className="font-semibold text-slate-800">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { href: '/cover-shift', label: 'Find Cover', desc: 'For open shifts' },
              { href: '/shifts', label: 'Add Shift', desc: 'Create new shift' },
              { href: '/staff', label: 'Add Staff', desc: 'New team member' },
              { href: '/availability', label: 'Availability', desc: 'View matrix' },
              { href: '/reliability', label: 'Log Incident', desc: 'No-show / no-answer' },
              { href: '/departments', label: 'Departments', desc: 'Manage areas' },
            ].map(({ href, label, desc }) => (
              <Link key={href} href={href} className="p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                <p className="text-sm font-medium text-slate-700">{label}</p>
                <p className="text-xs text-slate-400">{desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
