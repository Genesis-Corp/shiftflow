'use client';

import { UploadCloud } from 'lucide-react';

/** Shown while a file is being dragged over a drop target, so it's obvious where it'll land. */
export default function DropOverlay({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-40 bg-blue-600/10 flex items-center justify-center pointer-events-none">
      <div className="bg-white rounded-xl shadow-xl border-2 border-dashed border-blue-400 px-8 py-6 flex flex-col items-center gap-2">
        <UploadCloud size={28} className="text-blue-500" />
        <p className="text-sm font-medium text-slate-700">{label}</p>
      </div>
    </div>
  );
}
