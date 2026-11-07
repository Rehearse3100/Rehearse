/**
 * resize-handle.test.ts
 * The resize handle's line (components/ui/ResizeHandle.tsx), driven through its own
 * handlers: React's hooks are replaced by a minimal synchronous stand-in so one call
 * is one render (state kept between calls, effects never run). The line shows while
 * dragging, softly under the pointer, and when focused from the keyboard; a drag let
 * go away from the strip (past a limit), or the focus a click brings, never leaves it on.
 */

import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResizeHandle, resizeLineState } from "@/components/ui/ResizeHandle";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, refs: [] as Array<{ current: unknown }>, refIndex: 0 }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = hooks.index++;
      if (!(slot in hooks.values)) {
        hooks.values[slot] = initial;
      }
      const set = (update: unknown): void => {
        hooks.values[slot] = typeof update === "function" ? (update as (prev: unknown) => unknown)(hooks.values[slot]) : update;
      };
      return [hooks.values[slot], set];
    },
    // Refs keep their value between renders, as React's do.
    useRef: (current: unknown) => {
      const slot = hooks.refIndex++;
      hooks.refs[slot] ??= { current };
      return hooks.refs[slot];
    },
    useEffect: () => undefined,
  };
});

(globalThis as { React?: typeof React }).React = React;

type Element = React.ReactElement<Record<string, unknown>>;

const onResize = vi.fn();
const onResizeEnd = vi.fn();

function render(): Element {
  hooks.index = 0;
  hooks.refIndex = 0;
  return ResizeHandle({
    label: "Resize company list",
    value: 260,
    min: 220,
    max: 400,
    growsTo: "right",
    onResize,
    onResizeEnd,
    onReset: () => undefined,
  }) as Element;
}

/** The line's state in the latest render. */
function line(): string {
  const children = render().props.children as Element;
  return String(children.props["data-line"]);
}

/** A pointer event on the strip, which sits at x 256–264, y 0–800. */
function pointer(type: string, clientX: number, pointerType = "mouse"): Record<string, unknown> {
  let captured = false;
  return {
    type,
    pointerId: 1,
    pointerType,
    button: 0,
    clientX,
    clientY: 300,
    preventDefault: () => undefined,
    currentTarget: {
      setPointerCapture: () => {
        captured = true;
      },
      hasPointerCapture: () => captured,
      releasePointerCapture: () => {
        captured = false;
      },
      getBoundingClientRect: () => ({ left: 256, right: 264, top: 0, bottom: 800 }),
    },
  };
}

const call = (name: string, event: unknown = {}): void => {
  (render().props[name] as (event: unknown) => void)(event);
};

beforeEach(() => {
  hooks.values = [];
  hooks.refs = [];
  onResize.mockReset();
  onResizeEnd.mockReset();
});

describe("the resize handle's line", () => {
  it("strong while dragging or keyboard-focused, soft under the pointer, else hidden", () => {
    expect(resizeLineState({ isDragging: true, isKeyboardFocused: false, isHovered: false })).toBe("strong");
    expect(resizeLineState({ isDragging: false, isKeyboardFocused: true, isHovered: false })).toBe("strong");
    expect(resizeLineState({ isDragging: false, isKeyboardFocused: false, isHovered: true })).toBe("soft");
    expect(resizeLineState({ isDragging: false, isKeyboardFocused: false, isHovered: false })).toBe("hidden");
  });

  it("the reported case: dragged past the limit and let go away from the strip → hidden, though the strip keeps focus", () => {
    expect(line()).toBe("hidden");
    call("onPointerEnter", pointer("pointerenter", 260));
    expect(line()).toBe("soft");
    const down = pointer("pointerdown", 260);
    call("onPointerDown", down);
    call("onFocus"); // the press focuses the strip
    expect(line()).toBe("strong");
    // Dragged left past the 220px minimum: the strip stops, the pointer goes on.
    const move = { ...down, clientX: 120 };
    call("onPointerMove", move);
    expect(onResize).toHaveBeenLastCalledWith(120);
    call("onPointerLeave", move); // ignored while dragging
    call("onPointerUp", { ...down, clientX: 120 });
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(line()).toBe("hidden");
  });

  it("let go over the strip → the soft hover line, gone once the pointer leaves", () => {
    const down = pointer("pointerdown", 260);
    call("onPointerEnter", down);
    call("onPointerDown", down);
    call("onFocus");
    call("onPointerUp", { ...down, clientX: 261 });
    expect(line()).toBe("soft");
    call("onPointerLeave", down);
    expect(line()).toBe("hidden");
  });

  it("a touch drag never leaves a hover line", () => {
    const down = pointer("pointerdown", 260, "touch");
    call("onPointerEnter", down);
    expect(line()).toBe("hidden");
    call("onPointerDown", down);
    expect(line()).toBe("strong");
    call("onPointerUp", { ...down, clientX: 261 });
    expect(line()).toBe("hidden");
  });

  it("focus from the keyboard (Tab) shows it, ←/→ keep it, and leaving the strip hides it", () => {
    call("onFocus");
    expect(line()).toBe("strong");
    call("onKeyDown", { key: "ArrowRight", preventDefault: () => undefined });
    expect(onResize).toHaveBeenLastCalledWith(276);
    expect(line()).toBe("strong");
    call("onBlur");
    expect(line()).toBe("hidden");
  });

  it("after a mouse drag, using the arrow keys shows the line again", () => {
    const down = pointer("pointerdown", 260);
    call("onPointerDown", down);
    call("onFocus");
    call("onPointerUp", { ...down, clientX: 120 });
    expect(line()).toBe("hidden");
    call("onKeyDown", { key: "ArrowLeft", preventDefault: () => undefined });
    expect(line()).toBe("strong");
  });
});
