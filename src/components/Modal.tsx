'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export default function Modal({ title, onClose, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Freeze the page behind the modal. Without this, scrolling a modal that
  // has reached its end carries on scrolling the page underneath it — on a
  // phone that reads as the background sliding around under your finger.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* dvh, not vh: on mobile Safari `vh` counts the area behind the URL
          bar, so a 90vh modal has its footer buttons off-screen until you
          scroll the browser chrome away. */}
      <div className={`relative card w-full ${widths[size]} max-h-[88dvh] overflow-y-auto overscroll-contain`}>
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between gap-2 p-4 border-b border-slate-200 rounded-t-xl">
          <h2 className="font-semibold text-slate-900 min-w-0 truncate">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-md flex-shrink-0">
            <X size={16} />
          </button>
        </div>
        <div className="p-3 sm:p-4">{children}</div>
      </div>
    </div>
  );
}
