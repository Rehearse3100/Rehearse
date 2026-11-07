/**
 * data-room-panel-widths.test.ts
 * Resizable Data Room panels: the width clamping as a pure function (list 220–400px,
 * assistant 360–640px, the company page between them keeps at least 420px, the panel
 * being dragged gives way first, never below a default); the generic ResizeHandle
 * (its keys, its separator semantics, remembered widths in try/catch); and a static
 * render showing the default layout is unchanged (260px list, 436px assistant).
 * Static render only: effects don't run, so nothing is fetched or stored.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_WIDTH,
  clampDataRoomPanelWidths,
  LIST_WIDTH,
  MIDDLE_MIN_WIDTH,
  ProspectingDataRoom,
} from "@/components/tempo/stages/ProspectingDataRoom";
import { readStoredWidth, ResizeHandle, resizeKeyDelta, RESIZE_KEY_STEP_PX, storeWidth } from "@/components/ui/ResizeHandle";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement calls.
(globalThis as { React?: typeof React }).React = React;

const DEFAULTS = { list: LIST_WIDTH.default, chat: CHAT_WIDTH.default };
/** The Data Room at a 1360px window: the 240px project rail leaves it 1120px (the narrowest docked case). */
const DOCKED_AT_1360 = { containerWidth: 1120, isChatDocked: true };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clampDataRoomPanelWidths", () => {
  it("the limits: list 220–400px, assistant 360–640px, whole pixels", () => {
    expect([LIST_WIDTH, CHAT_WIDTH, MIDDLE_MIN_WIDTH]).toEqual([
      { default: 260, min: 220, max: 400 },
      { default: 436, min: 360, max: 640 },
      420,
    ]);
    const unmeasured = { containerWidth: null, isChatDocked: true };
    expect(clampDataRoomPanelWidths({ list: 100, chat: 100 }, unmeasured)).toEqual({ list: 220, chat: 360 });
    expect(clampDataRoomPanelWidths({ list: 999, chat: 999 }, unmeasured)).toEqual({ list: 400, chat: 640 });
    expect(clampDataRoomPanelWidths({ list: 301.6, chat: Number.NaN }, unmeasured)).toEqual({ list: 302, chat: 360 });
  });

  it("the defaults are unchanged wherever the assistant is docked (the page keeps 424px at a 1360px window)", () => {
    expect(clampDataRoomPanelWidths(DEFAULTS, DOCKED_AT_1360)).toEqual(DEFAULTS);
    expect(DOCKED_AT_1360.containerWidth - DEFAULTS.list - DEFAULTS.chat).toBeGreaterThanOrEqual(MIDDLE_MIN_WIDTH);
    expect(clampDataRoomPanelWidths(DEFAULTS, { containerWidth: 1680, isChatDocked: true })).toEqual(DEFAULTS);
  });

  it("dragging a panel wider stops where the company page would drop under 420px; the other panel stays", () => {
    expect(clampDataRoomPanelWidths({ list: 400, chat: 436 }, { ...DOCKED_AT_1360, active: "list" })).toEqual({ list: 264, chat: 436 });
    expect(clampDataRoomPanelWidths({ list: 260, chat: 640 }, { ...DOCKED_AT_1360, active: "chat" })).toEqual({ list: 260, chat: 440 });
    // A wide window has room for both maxima.
    expect(clampDataRoomPanelWidths({ list: 400, chat: 640 }, { containerWidth: 1600, isChatDocked: true, active: "list" })).toEqual({
      list: 400,
      chat: 640,
    });
  });

  it("a narrower window: the assistant gives back first, then the list, never below a default", () => {
    const wide = { list: 400, chat: 640 };
    expect(clampDataRoomPanelWidths(wide, { containerWidth: 1300, isChatDocked: true })).toEqual({ list: 400, chat: 480 });
    expect(clampDataRoomPanelWidths(wide, { containerWidth: 1180, isChatDocked: true })).toEqual({ list: 324, chat: 436 });
    // The page gets exactly 420px: 1120 − 264 − 436.
    expect(clampDataRoomPanelWidths(wide, { containerWidth: 1120, isChatDocked: true })).toEqual({ list: 264, chat: 436 });
    // Narrower still, both stop at their defaults.
    expect(clampDataRoomPanelWidths(wide, { containerWidth: 1000, isChatDocked: true })).toEqual(DEFAULTS);
    // A width the student chose below its default is kept.
    expect(clampDataRoomPanelWidths({ list: 230, chat: 380 }, { containerWidth: 1120, isChatDocked: true })).toEqual({ list: 230, chat: 380 });
  });

  it("the slide-over (narrow windows) covers the page, so only the list counts against the 420px", () => {
    expect(clampDataRoomPanelWidths({ list: 400, chat: 640 }, { containerWidth: 760, isChatDocked: false, active: "list" })).toEqual({
      list: 340,
      chat: 640,
    });
    expect(clampDataRoomPanelWidths(DEFAULTS, { containerWidth: 1000, isChatDocked: false })).toEqual(DEFAULTS);
  });

  it("whenever it can, the company page keeps at least 420px", () => {
    for (const containerWidth of [1120, 1200, 1300, 1450, 1700]) {
      for (const list of [220, 260, 330, 400]) {
        for (const chat of [360, 436, 520, 640]) {
          for (const active of [undefined, "list", "chat"] as const) {
            const shown = clampDataRoomPanelWidths({ list, chat }, { containerWidth, isChatDocked: true, active });
            const page = containerWidth - shown.list - shown.chat;
            const canFit = containerWidth - Math.min(list, LIST_WIDTH.default) - Math.min(chat, CHAT_WIDTH.default) >= MIDDLE_MIN_WIDTH;
            if (canFit) {
              expect(page, JSON.stringify({ containerWidth, list, chat, active })).toBeGreaterThanOrEqual(MIDDLE_MIN_WIDTH);
            }
          }
        }
      }
    }
  });
});

describe("ResizeHandle", () => {
  it("←/→ move the handle 16px: → widens a panel whose handle is on its right edge, ← one with it on the left", () => {
    expect(RESIZE_KEY_STEP_PX).toBe(16);
    expect(resizeKeyDelta("ArrowRight", "right")).toBe(16);
    expect(resizeKeyDelta("ArrowLeft", "right")).toBe(-16);
    expect(resizeKeyDelta("ArrowLeft", "left")).toBe(16);
    expect(resizeKeyDelta("ArrowRight", "left")).toBe(-16);
    expect(resizeKeyDelta("Enter", "right")).toBe(0);
  });

  it("a focusable vertical separator with its value, limits and label; invisible until hovered", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ResizeHandle, {
        label: "Resize company list",
        value: 260,
        min: 220,
        max: 400,
        growsTo: "right",
        onResize: () => undefined,
        onResizeEnd: () => undefined,
        onReset: () => undefined,
        className: "-right-1",
      })
    );
    for (const attribute of [
      'role="separator"',
      'aria-orientation="vertical"',
      'aria-label="Resize company list"',
      'aria-valuenow="260"',
      'aria-valuemin="220"',
      'aria-valuemax="400"',
      'tabindex="0"',
    ]) {
      expect(markup, attribute).toContain(attribute);
    }
    expect(markup).toContain("cursor-col-resize");
    expect(markup).toContain("touch-none");
    expect(markup).toContain("bg-transparent group-hover:bg-secondary/50");
  });

  it("remembered widths: a stored number, else the fallback; storage that throws or is missing never breaks", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
    expect(readStoredWidth("w", 260)).toBe(260);
    storeWidth("w", 301.4);
    expect(store.get("w")).toBe("301");
    expect(readStoredWidth("w", 260)).toBe(301);
    store.set("w", "wide");
    expect(readStoredWidth("w", 260)).toBe(260);
    storeWidth("w", null);
    expect(store.has("w")).toBe(false);

    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readStoredWidth("w", 436)).toBe(436);
    expect(() => storeWidth("w", 500)).not.toThrow();
    vi.unstubAllGlobals();
    // No window at all (server render).
    expect(readStoredWidth("w", 436)).toBe(436);
  });
});

describe("the Data Room's default layout", () => {
  it("renders the list at 260px and the assistant at 436px, each with its resize handle", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined); // useLayoutEffect on the server
    const markup = renderToStaticMarkup(
      React.createElement(ProspectingDataRoom, {
        attemptId: "attempt-1",
        selectedCompanyId: null,
        onSelectCompany: () => undefined,
        onShortlistChange: () => undefined,
      })
    );
    errorSpy.mockRestore();
    expect(markup).toMatch(/<section class="relative shrink-0 flex flex-col[^"]*" style="width:260px">/);
    expect(markup).toMatch(/<aside aria-label="AI Research Assistant" style="width:436px"/);
    expect(markup).toContain('aria-label="Resize company list"');
    expect(markup).toContain('aria-label="Resize chat"');
    // The slide-over keeps its own-width slide, so it opens and closes the same at any width.
    expect(markup).toContain("invisible translate-x-full transition-[transform,visibility] duration-[180ms] ease-in");
  });
});
