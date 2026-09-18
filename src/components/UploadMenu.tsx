'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, ChevronDown } from 'lucide-react';

export interface UploadOption {
  key: string;
  label: string;
  icon: React.ReactNode;
  accept: string;
  capture?: 'environment';
  multiple?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

interface Props {
  options: UploadOption[];
  disabled?: boolean;
  label?: string;
}

/**
 * One "Upload" button that opens a menu of the different ways a file can
 * come in (Capture, a PDF, a CSV) — instead of a row of separate buttons
 * that only differ in which hidden file input they click.
 *
 * Each option still owns its own hidden `<input type=file>` with its own
 * accept/capture/multiple and onChange, unchanged from before — this is
 * purely a different way to trigger the same inputs.
 */
export default function UploadMenu({ options, disabled, label = 'Upload' }: Props) {
  const [open, setOpen] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn-secondary"
      >
        <Upload size={14} /> {label}
        <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1 z-20 w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-1"
        >
          {options.map(opt => (
            <button
              key={opt.key}
              type="button"
              role="menuitem"
              onClick={() => { inputRefs.current[opt.key]?.click(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 text-left transition-colors"
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      )}

      {options.map(opt => (
        <input
          key={opt.key}
          ref={el => { inputRefs.current[opt.key] = el; }}
          type="file"
          accept={opt.accept}
          capture={opt.capture}
          multiple={opt.multiple}
          className="hidden"
          onChange={opt.onChange}
        />
      ))}
    </div>
  );
}
