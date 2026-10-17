/**
 * narrow-call-layout.test.ts
 * Discovery and Objection Handling on narrow windows (below lg): the pre-call
 * lobby centres safely (scrolls from the top, manager note first); the post-call
 * transcript stacks under the post-call content; during the call a Transcript
 * button opens the live transcript as a slide-over. At lg and up the docked
 * panels keep their exact classes. Rendered to static HTML; no network.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CallTranscriptPanel,
  CallTranscriptSlideOver,
  type CallTranscriptPanelEntry,
} from "@/components/tempo/CallTranscriptPanel";
import { DiscoveryStageLayout } from "@/components/tempo/stages/DiscoveryStageLayout";
import { ObjectionHandlingStageLayout } from "@/components/tempo/stages/ObjectionHandlingStageLayout";
import { TempoCallLobby } from "@/components/tempo/stages/TempoCallLobby";
import type { DiscoveryPhase } from "@/lib/tempo-discovery";
import { EMPTY_TRACKER, type ObjectionHandlingPhase } from "@/lib/tempo-objections";

// vitest.config.ts has no JSX setting, so esbuild emits classic React.createElement
// calls; components rely on Next's automatic runtime and never import React.
(globalThis as { React?: typeof React }).React = React;

const ENTRIES: CallTranscriptPanelEntry[] = [
  { speaker: "persona", name: "Dana Reyes", timestamp: "00:05", content: "Thanks for calling." },
  { speaker: "student", name: "You", timestamp: "00:09", content: "Happy to be here." },
];

/** The docked panels' classes before this change (lg and up must not change). */
const DOCKED_ENDED_CLASS =
  "hidden lg:flex w-[360px] h-full shrink-0 flex-col bg-surface-container-lowest border-l border-outline-variant";
const DOCKED_LIVE_CLASS = "hidden lg:flex w-[280px] h-full shrink-0 flex-col bg-[#0a0a0a] border-l border-white/10";

const render = (element: React.ReactElement): string => renderToStaticMarkup(element);

const classesOf = (html: string, pattern: RegExp): string[] => html.match(pattern)?.[1]?.split(" ") ?? [];

describe("pre-call lobby", () => {
  const html = render(
    React.createElement(TempoCallLobby, {
      managerNote: ["First paragraph of the note.", "Second paragraph."],
      cameraBlockedMessage: "Camera blocked.",
      connectError: "",
      onJoin: vi.fn(),
    })
  );

  it("centres safely: no justify-center on the scroll container, my-auto on the content", () => {
    const section = classesOf(html, /^<section class="([^"]*)"/);
    expect(section).toContain("overflow-y-auto");
    expect(section).toContain("items-center");
    expect(section).not.toContain("justify-center");
    expect(classesOf(html, /^<section[^>]*><div class="([^"]*)"/)).toContain("my-auto");
  });

  it("keeps the manager note above the camera (first when the columns stack)", () => {
    expect(html.indexOf("Manager note")).toBeLessThan(html.indexOf("Camera off"));
    expect(html).toContain("grid grid-cols-1 lg:grid-cols-2");
  });
});

describe("transcript panel", () => {
  it("docked (lg and up): exactly the same classes as before, collapsible", () => {
    const ended = render(React.createElement(CallTranscriptPanel, { entries: ENTRIES, variant: "ended", durationLabel: "05:12" }));
    expect(ended).toContain(`<aside class="${DOCKED_ENDED_CLASS}">`);
    expect(ended).toContain('aria-label="Collapse transcript"');
    const live = render(React.createElement(CallTranscriptPanel, { entries: ENTRIES, variant: "live" }));
    expect(live).toContain(`<aside class="${DOCKED_LIVE_CLASS}">`);
    expect(live).toContain('aria-label="Collapse transcript"');
  });

  it("stacked (ended, below lg): full width, own max-height scroll, same header and entries, no collapse", () => {
    const html = render(
      React.createElement(CallTranscriptPanel, { entries: ENTRIES, variant: "ended", durationLabel: "05:12", placement: "stacked" })
    );
    const aside = classesOf(html, /^<aside class="([^"]*)"/);
    for (const part of ["flex", "lg:hidden", "w-full", "max-h-[60vh]", "flex-col"]) {
      expect(aside, part).toContain(part);
    }
    for (const text of ["Transcript", "Call ended · 05:12", "Copy", "Thanks for calling.", "Happy to be here."]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain("overflow-y-auto");
    expect(html).not.toContain("Collapse transcript");
  });

  it("slide-over (live): fills its container, LIVE header with a close button, footer kept", () => {
    const html = render(
      React.createElement(CallTranscriptPanel, {
        entries: ENTRIES,
        variant: "live",
        placement: "slide-over",
        onClose: vi.fn(),
        footer: React.createElement("p", null, "Strategy footer"),
      })
    );
    const aside = classesOf(html, /^<aside class="([^"]*)"/);
    expect(aside).toContain("w-full");
    expect(aside).toContain("h-full");
    expect(aside).not.toContain("hidden");
    for (const text of ["LIVE", 'aria-label="Close transcript"', "Thanks for calling.", "Strategy footer"]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("Collapse transcript");
  });

  it("the Transcript button bar shows only below lg; the slide-over starts closed", () => {
    const html = render(React.createElement(CallTranscriptSlideOver, { entries: ENTRIES }));
    expect(classesOf(html, /^<div class="([^"]*)"/)).toContain("lg:hidden");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Transcript");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("stage layouts", () => {
  const discovery = (phase: DiscoveryPhase): string =>
    render(
      React.createElement(DiscoveryStageLayout, {
        phase,
        callSeconds: 312,
        transcript: [{ role: "dana", content: "Thanks for calling.", timestamp: "00:05" }],
        lobbySlot: null,
        callSlot: React.createElement("div", { id: "call-slot" }, "CALL"),
        isPrepNextEnabled: true,
        onPrepNext: vi.fn(),
        isSubmitting: false,
        nextStageName: "Presentation",
        onContinueAfterCall: vi.fn(),
      })
    );

  const objections = (phase: ObjectionHandlingPhase): string =>
    render(
      React.createElement(ObjectionHandlingStageLayout, {
        phase,
        callSeconds: 312,
        transcript: [{ role: "drKim", content: "What does this cost?", timestamp: "00:05" }],
        objectionTracker: EMPTY_TRACKER,
        lobbySlot: null,
        callSlot: React.createElement("div", { id: "call-slot" }, "CALL"),
        isSubmitting: false,
        nextStageName: "Negotiation",
        onContinueAfterCall: vi.fn(),
      })
    );

  it("after the call: docked transcript unchanged, stacked one under the post-call content below lg", () => {
    for (const html of [discovery("summary"), objections("summary")]) {
      expect(html).toContain(`<aside class="${DOCKED_ENDED_CLASS}">`);
      expect(html).toContain('<aside class="flex lg:hidden w-full max-h-[60vh]');
      expect(html).toContain('<div class="flex flex-col lg:flex-row flex-1 min-w-0 min-h-0 overflow-y-auto lg:overflow-visible">');
      expect(html.indexOf("Call completed")).toBeLessThan(html.indexOf('<aside class="flex lg:hidden'));
    }
  });

  it("during the call: the Transcript button sits above the call below lg; the docked panel is unchanged", () => {
    for (const html of [discovery("active"), objections("active")]) {
      expect(html).toContain(`<aside class="${DOCKED_LIVE_CLASS}">`);
      const bar = html.indexOf('<div class="lg:hidden h-10');
      expect(bar).toBeGreaterThan(-1);
      expect(bar).toBeLessThan(html.indexOf('id="call-slot"'));
    }
  });
});
