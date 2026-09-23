'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Building2, Calendar, ShieldAlert, TrendingUp, Clock, AlertTriangle, Award, Phone } from 'lucide-react';
import { formatDate, weekBounds, shiftDurationMinutes, todayStr } from '@/lib/shiftUtils';
import ReliabilityBar from '@/components/ReliabilityBar';
import StaffName from '@/components/StaffName';
import MessageBoard from '@/components/MessageBoard';

interface Stats {
  totalStaff: number;
  activeStaff: number;
  departments: number;
  openShifts: number;
  todayShifts: number;
}

type AttentionReasonType = 'no_phone' | 'opted_out' | 'low_reliability' | 'overworked' | 'no_shifts';
interface AttentionReason { type: AttentionReasonType; label: string }
interface AttentionStaff { id: string; name: string; reasons: AttentionReason[] }
interface HighAchiever { id: string; name: string; score: number }

const NEEDS_ATTENTION_HOURS_CAP = 38 * 60;
const HIGH_ACHIEVER_THRESHOLD = 80;
const LOW_RELIABILITY_THRESHOLD = 50;

const ATTENTION_FILTERS: { value: AttentionReasonType | 'all'; label: string }[] = [
  { value: 'all', label: 'All reasons' },
  { value: 'no_phone', label: 'No phone number' },
  { value: 'opted_out', label: 'Opted out of SMS' },
  { value: 'low_reliability', label: 'Low reliability' },
  { value: 'overworked', label: 'Overworked (38h+)' },
  { value: 'no_shifts', label: 'No shifts this week' },
];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [openShifts, setOpenShifts] = useState<{ id: string; date: string; start_time: string; end_time: string; departments: { name: string } }[]>([]);
  const [needsAttention, setNeedsAttention] = useState<AttentionStaff[]>([]);
  const [highAchievers, setHighAchievers] = useState<HighAchiever[]>([]);
  const [attentionFilter, setAttentionFilter] = useState<AttentionReasonType | 'all'>('all');
  const today = todayStr();

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

      // This Sun–Sat week's rostered minutes per staff member, same window
      // the 38-hour weekly cap uses when finding cover for a shift.
      const { weekStart, weekEnd } = weekBounds(today);
      const weeklyMinutes = new Map<string, number>();
      for (const s of (shifts ?? []) as { status: string; assigned_staff_id?: string; date: string; start_time: string; end_time: string }[]) {
        if (s.status === 'cancelled' || !s.assigned_staff_id) continue;
        if (s.date < weekStart || s.date > weekEnd) continue;
        weeklyMinutes.set(
          s.assigned_staff_id,
          (weeklyMinutes.get(s.assigned_staff_id) ?? 0) + shiftDurationMinutes(s.start_time, s.end_time)
        );
      }

      const attention: AttentionStaff[] = [];
      const achievers: HighAchiever[] = [];
      for (const s of (staff ?? []) as { id: string; name: string; active: boolean; phone?: string; phone_e164?: string; reliability_score: number; sms_opt_out?: boolean }[]) {
        if (!s.active) continue;
        const minutes = weeklyMinutes.get(s.id) ?? 0;
        const score = s.reliability_score ?? 50;
        const reasons: AttentionReason[] = [];
        if (!s.phone && !s.phone_e164) reasons.push({ type: 'no_phone', label: 'No phone number on file' });
        // Surfaced here rather than penalised on reliability — that score
        // tracks shift attendance, not texting preferences, and STOP has to
        // stay a free, no-consequence opt-out or the business risks the
        // whole SMS number getting suspended for spam-law non-compliance.
        // This is the honest lever: a manager sees it and follows up in
        // person, rather than it sitting invisible in the database.
        if (s.sms_opt_out) reasons.push({ type: 'opted_out', label: 'Opted out of SMS — won’t be offered shifts by text' });
        if (score < LOW_RELIABILITY_THRESHOLD) reasons.push({ type: 'low_reliability', label: 'Low reliability' });
        if (minutes > NEEDS_ATTENTION_HOURS_CAP) reasons.push({ type: 'overworked', label: `${(minutes / 60).toFixed(1)}h rostered this week` });
        if (minutes === 0) reasons.push({ type: 'no_shifts', label: 'No shifts rostered this week' });
        if (reasons.length) attention.push({ id: s.id, name: s.name, reasons });
        if (score > HIGH_ACHIEVER_THRESHOLD) achievers.push({ id: s.id, name: s.name, score });
      }
      setNeedsAttention(attention);
      setHighAchievers(achievers.sort((a, b) => b.score - a.score));
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

      <MessageBoard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              <h2 className="font-semibold text-slate-800">Needs Attention</h2>
            </div>
            <select
              value={attentionFilter}
              onChange={e => setAttentionFilter(e.target.value as AttentionReasonType | 'all')}
              className="input py-1 w-auto text-xs sm:text-xs"
              aria-label="Filter by"
            >
              {ATTENTION_FILTERS.map(f => (
                <option key={f.value} value={f.value}>{f.value === 'all' ? 'Filter By: All reasons' : `Filter By: ${f.label}`}</option>
              ))}
            </select>
          </div>
          {(() => {
            const filtered = attentionFilter === 'all'
              ? needsAttention
              : needsAttention.filter(s => s.reasons.some(r => r.type === attentionFilter));
            if (filtered.length === 0) {
              return (
                <p className="text-slate-400 text-sm">
                  {needsAttention.length === 0 ? 'Nothing needs attention right now.' : 'Nobody matches that filter.'}
                </p>
              );
            }
            return (
              <div className="space-y-2">
                {filtered.map(s => (
                  <div key={s.id} className="flex items-start justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
                    <StaffName staffId={s.id} name={s.name} className="text-sm font-medium text-slate-700" />
                    <div className="flex flex-wrap gap-1 justify-end">
                      {s.reasons
                        .filter(r => attentionFilter === 'all' || r.type === attentionFilter)
                        .map(r => (
                          <span key={r.type} className="badge-amber text-[11px]">
                            {r.type === 'no_phone' && <Phone size={10} className="mr-1" />}
                            {r.label}
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award size={16} className="text-blue-500" />
            <h2 className="font-semibold text-slate-800">High Achievers</h2>
          </div>
          {highAchievers.length === 0 ? (
            <p className="text-slate-400 text-sm">Nobody above {HIGH_ACHIEVER_THRESHOLD} reliability yet.</p>
          ) : (
            <div className="space-y-2">
              {highAchievers.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
                  <StaffName staffId={s.id} name={s.name} className="text-sm font-medium text-slate-700 flex-shrink-0" />
                  <div className="w-28"><ReliabilityBar score={s.score} showLabel={false} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
