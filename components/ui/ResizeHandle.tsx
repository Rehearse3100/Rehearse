/**
 * ResizeHandle.tsx
 * A thin vertical drag handle for resizing a panel's width (generic: any page can
 * use it; the page owns the width, its limits and where it is stored). Drag with a
 * mouse, pen or finger (pointer events; no text selection and a col-resize cursor
 * while dragging), or focus it and press ←/→ (16px a press); a double-click resets.
 * Invisible until hovered, focused from the keyboard or dragged, when a subtle line
 * shows (tracked in state, not CSS :hover / :focus-visible, which a browser can leave
 * on after a drag ends away from the strip). Exposed as
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

/** How the handle's line shows: strong while dragging or focused from the keyboard, soft under the pointer, else hidden. */
export function resizeLineState(state: {
  isDragging: boolean;
  isKeyboardFocused: boolean;
  isHovered: boolean;
}): "strong" | "soft" | "hidden" {
  if (state.isDragging || state.isKeyboardFocused) {
    return "strong";
  }
  return state.isHovered ? "soft" : "hidden";
}

const LINE_CLASS: Record<ReturnType<typeof resizeLineState>, string> = {
  strong: "bg-secondary",
  soft: "bg-secondary/50",
  hidden: "bg-transparent",
};

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
  // Set by a press so the focus it brings doesn't count as keyboard focus.
  const isPointerFocusRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isKeyboardFocused, setIsKeyboardFocused] = useState(false);

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
    const handle = event.currentTarget;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    // The pointer may have been let go away from the strip (past a limit): only a
    // pointer still over it keeps the soft line.
    const box = handle.getBoundingClientRect();
    setIsHovered(
      event.pointerType !== "touch" &&
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
    );
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
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") {
          setIsHovered(true);
        }
      }}
      onPointerLeave={() => {
        // During a drag the captured strip keeps the events; it's checked when the drag ends.
        if (!dragRef.current) {
          setIsHovered(false);
        }
      }}
      onFocus={() => {
        setIsKeyboardFocused(!isPointerFocusRef.current);
        isPointerFocusRef.current = false;
      }}
      onBlur={() => setIsKeyboardFocused(false)}
      onPointerDown={(event) => {
        // A press focuses the strip, but that isn't keyboard focus: no lasting line.
        isPointerFocusRef.current = true;
        setIsKeyboardFocused(false);
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
        // Resizing from the keyboard shows where the edge is.
        setIsKeyboardFocused(true);
        onResize(value + delta);
        onResizeEnd();
      }}
      onDoubleClick={() => {
        onReset();
        onResizeEnd();
      }}
      className={`absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none select-none outline-none ${className}`}
    >
      <span
        aria-hidden="true"
        data-line={resizeLineState({ isDragging, isKeyboardFocused, isHovered })}
        className={`pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150 motion-reduce:transition-none ${
          LINE_CLASS[resizeLineState({ isDragging, isKeyboardFocused, isHovered })]
        }`}
      />
    </div>
  );
}
