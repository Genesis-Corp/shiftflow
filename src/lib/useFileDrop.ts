'use client';

import { useRef, useState } from 'react';

/**
 * Drag-and-drop for a page or card that already accepts files via a picker.
 *
 * Spread `dropHandlers` onto the container to make it a drop target; `dragging`
 * is true for as long as a file drag is over it, for a visual overlay.
 *
 * dragenter/dragleave fire on every child element a drag passes over, not
 * just the container, so a naive "leave sets dragging false" flickers the
 * whole time a drag crosses child elements. A depth counter fixes that: only
 * the leave that brings it back to zero actually clears the flag.
 */
export function useFileDrop(onFiles: (files: File[]) => void, disabled = false) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  return {
    dragging,
    dropHandlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (disabled || !isFileDrag(e)) return;
        e.preventDefault();
        depth.current++;
        setDragging(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (disabled || !isFileDrag(e)) return;
        e.preventDefault();
      },
      onDragLeave: (e: React.DragEvent) => {
        if (disabled || !isFileDrag(e)) return;
        e.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (disabled || !isFileDrag(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
      },
    },
  };
}
