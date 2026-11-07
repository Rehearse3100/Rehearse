/**
 * ResizeHandle.tsx
 * A thin vertical drag handle for resizing a panel's width (generic: any page can
 * use it; the page owns the width, its limits and where it is stored). Drag with a
 * mouse, pen or finger (pointer events; no text selection and a col-resize cursor
 * while dragging), or focus it and press ←/→ (16px a press); a double-click resets.
 * Invisible until hovered, focused or dragged, when a subtle line shows. Exposed as
 * role="separator" with its value and limits. Also small localStorage helpers for
 * remembering a width per browser (every access in try/catch; defaults otherwise).
 * First used by the Data Room (components/tempo/stages/ProspectingDataRoom.tsx).
 */

"use client";

import { useEffect, useRef, useState } from "react";

/** How far one ←/→ press moves the handle. */
export const RESIZE_KEY_STEP_PX = 16;

/**
 * The width change for a key press: ← and → move the handle by the step, so a
 * panel whose handle is on its right edge grows with →, one with the handle on its
 * left edge grows with ←. 0 for any other key.
 */
export function resizeKeyDelta(key: string, growsTo: "right" | "left", step: number = RESIZE_KEY_STEP_PX): number {
  const handleMove = key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0;
  return growsTo === "right" ? handleMove : -handleMove;
}

/** A remembered width, or the fallback when there is none, it isn't a number, or storage is unavailable. */
export function readStoredWidth(storageKey: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Remembers a width (null forgets it); storage errors are ignored (the width still applies on the page). */
export function storeWidth(storageKey: string, width: number | null): void {
  try {
    if (width === null) {
      window.localStorage.removeItem(storageKey);
    } else {
      window.localStorage.setItem(storageKey, String(Math.round(width)));
    }
  } catch {
    /* storage unavailable: the width lasts for this visit only */
  }
}

type ResizeHandleProps = {
  /** aria-label, e.g. "Resize company list". */
  label: string;
  /** The panel's current width (aria-valuenow), and its limits. */
  value: number;
  min: number;
  max: number;
  /** Which way the panel grows when the handle moves: "right" (handle on its right edge) or "left". */
  growsTo: "right" | "left";
  /** A new width while dragging or after a key press; the page clamps it. */
  onResize: (width: number) => void;
  /** A drag, key press or reset is done (the page remembers the width). */
  onResizeEnd: () => void;
  /** Double-click: back to the default width. */
  onReset: () => void;
  /** Positioning on the panel edge, e.g. "-right-1". */
  className?: string;
};

/**
 * The handle: an 8px strip over the panel's edge with a 1px line in its middle that
 * shows on hover, focus or drag.
 */
export function ResizeHandle({
  label,
  value,
  min,
  max,
  growsTo,
  onResize,
  onResizeEnd,
  onReset,
  className = "",
}: ResizeHandleProps): React.ReactElement {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // While dragging: no text selection and the resize cursor everywhere (the pointer
  // can leave the thin strip); both are restored afterwards.
  useEffect(() => {
    if (!isDragging) {
      return;
    }
    const { style } = document.body;
    const previous = { userSelect: style.userSelect, cursor: style.cursor };
    style.userSelect = "none";
    style.cursor = "col-resize";
    return () => {
      style.userSelect = previous.userSelect;
      style.cursor = previous.cursor;
    };
  }, [isDragging]);

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onResizeEnd();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        // Main button only for a mouse; any touch or pen.
        if (event.pointerType === "mouse" && event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: value };
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }
        const moved = event.clientX - drag.startX;
        onResize(drag.startWidth + (growsTo === "right" ? moved : -moved));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        const delta = resizeKeyDelta(event.key, growsTo);
        if (delta === 0) {
          return;
        }
        event.preventDefault();
        onResize(value + delta);
        onResizeEnd();
      }}
      onDoubleClick={() => {
        onReset();
        onResizeEnd();
      }}
      className={`group absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none select-none outline-none ${className}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 motion-reduce:transition-none ${
          isDragging ? "bg-secondary" : "bg-transparent group-hover:bg-secondary/50 group-focus-visible:bg-secondary"
        }`}
      />
    </div>
  );
}
