/**
 * persona-prompts.test.ts
 * The call personas' system prompts now built on the server
 * (lib/server/persona-prompts.ts) from a persona key: each one is byte-for-byte what
 * the browser built and sent before (the Tempo prompts pinned by the SHA-256 of the
 * old client-built strings, taken before the move; the legacy ones against the old
 * client construction). The module refuses to load in a browser, and no "use client"
 * file reaches it through its imports (the import graph is walked), nor holds the
 * prompt text itself.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_PERSONAS, LEGACY_CHAT_STAGES } from "@/lib/chat-personas";
import { OBJECTIONS_COUNT } from "@/lib/constants";
import { buildVoiceSystemPrompt } from "@/lib/persona-voice";
import { buildPersonaSystemPrompt } from "@/lib/server/persona-prompts";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const ROOT = path.resolve(__dirname, "..");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("each persona's system prompt is exactly what the browser sent before", () => {
  // SHA-256 of the client-built strings before the move (2026-11-06):
  // buildVoiceSystemPrompt(DANA_REYES_SYSTEM_PROMPT, TEMPO_DISCOVERY_STAGE_HINT),
  // buildVoiceSystemPrompt(DR_KIM_SYSTEM_PROMPT, TEMPO_OBJECTIONS_STAGE_HINT), and the
  // two negotiation scenario prompts as they were.
  const BEFORE: Record<string, string> = {
    tempo_discovery: "3fead491a07b4fb3b1a1ce301987dc1f0de4b773a21d3b10b5f76404e42f7642",
    tempo_objections: "c059505174f9db0bc4aedc27e8ae34660eada900568b5779e5c02c712f8a5618",
    tempo_negotiation_a: "09bd3f2071666c5ba75cb06b60fef7c2ec00d01f3a731319ed48caa7ab0280dd",
    tempo_negotiation_b: "20dfd6d2dc97c8c1d034f2f80511b31bd3b04f53f6268882b434fe6b793eee09",
  };

  it("the four Tempo personas", () => {
    for (const persona of ["tempo_discovery", "tempo_objections", "tempo_negotiation_a", "tempo_negotiation_b"] as const) {
      expect(sha256(buildPersonaSystemPrompt(persona)), persona).toBe(BEFORE[persona]);
    }
    expect(buildPersonaSystemPrompt("tempo_discovery").startsWith("You are Dana Reyes, Director of Operations")).toBe(true);
    expect(buildPersonaSystemPrompt("tempo_objections").startsWith("You are Dr. Saul Kim, Founder and Owner")).toBe(true);
  });

  it("a legacy simulation: its own prompt, the listening rules and the stage's hint, as each stage component built it", () => {
    const simulationPrompt = "  You are Pat, owner of a bakery. Be brief.  ";
    // The hints exactly as the legacy stage components wrote them before.
    const oldHints: Record<string, string> = {
      prospecting: "PROSPECTING STAGE: You are on a short cold call. Be busy but fair.",
      discovery: "DISCOVERY STAGE: Answer the student's questions in character. Do not agree to buy yet.",
      close: "CLOSE STAGE: The student should ask for the sale clearly. Push back with realistic hesitation. Stay in character.",
    };
    for (const stage of ["prospecting", "discovery", "close"] as const) {
      expect(buildPersonaSystemPrompt("simulation", { simulationPrompt, legacyStage: stage }), stage).toBe(
        buildVoiceSystemPrompt(simulationPrompt, oldHints[stage])
      );
    }
    const pitchText = "Our ovens cut energy use by a third.";
    expect(buildPersonaSystemPrompt("simulation", { simulationPrompt, legacyStage: "objections", pitchText })).toBe(
      buildVoiceSystemPrompt(
        simulationPrompt,
        `OBJECTIONS STAGE: The student pitched: """${pitchText}""" Raise ${OBJECTIONS_COUNT} specific objections (price, timing, fit). Push back realistically.`
      )
    );
    // No saved pitch: "" as the browser used.
    expect(buildPersonaSystemPrompt("simulation", { simulationPrompt, legacyStage: "objections" })).toContain(
      'The student pitched: """"""'
    );
  });

  it("every persona key and legacy stage is covered", () => {
    expect([...CHAT_PERSONAS]).toEqual(["tempo_discovery", "tempo_objections", "tempo_negotiation_a", "tempo_negotiation_b", "simulation"]);
    expect([...LEGACY_CHAT_STAGES]).toEqual(["prospecting", "discovery", "objections", "close"]);
  });
});

describe("the prompts stay on the server", () => {
  it("the module refuses to load where a browser window exists", async () => {
    vi.stubGlobal("window", {});
    await expect(import("@/lib/server/persona-prompts")).rejects.toThrow(/server-only/);
  });

  /** Every .ts/.tsx file under these folders. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        return name === "node_modules" || name.startsWith(".") ? [] : sourceFiles(full);
      }
      return /\.tsx?$/.test(name) ? [full] : [];
    });
  }

  /** The project files a file imports at runtime (type-only imports are erased, so they don't count). */
  function runtimeImports(file: string): string[] {
    const source = readFileSync(file, "utf8");
    const specs = [
      // [^;] already spans lines, so multi-line import lists match without the s flag.
      ...Array.from(source.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm), (m) => m[1] ?? ""),
      ...Array.from(source.matchAll(/^\s*export\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm), (m) => m[1] ?? ""),
      ...Array.from(source.matchAll(/^\s*import\s+["']([^"']+)["']/gm), (m) => m[1] ?? ""),
      ...Array.from(source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g), (m) => m[1] ?? ""),
    ];
    return specs.flatMap((spec) => {
      const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
      if (!base) {
        return [];
      }
      const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find(
        (candidate) => existsSync(candidate) && statSync(candidate).isFile()
      );
      return found ? [found] : [];
    });
  }

  const files = ["app", "components", "hooks", "lib"].flatMap((dir) => sourceFiles(path.join(ROOT, dir)));
  const clientFiles = files.filter((file) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(readFileSync(file, "utf8")));
  const serverModule = path.join(ROOT, "lib", "server", "persona-prompts.ts");

  it("no \"use client\" file reaches lib/server/persona-prompts.ts through its imports", () => {
    expect(clientFiles.length).toBeGreaterThan(20);
    const reachable = new Set<string>();
    const queue = [...clientFiles];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (reachable.has(file)) {
        continue;
      }
      reachable.add(file);
      queue.push(...runtimeImports(file));
    }
    expect(reachable.has(serverModule)).toBe(false);
    // And no client-reachable file holds the persona text itself (phrases found only in
    // the prompts and stage hints; the Objection Handling tips the student sees say
    // "Dr. Kim leads with price…" on purpose).
    for (const file of Array.from(reachable)) {
      const source = readFileSync(file, "utf8");
      for (const marker of [
        "You are Dana Reyes",
        "You are Dr. Saul Kim",
        "YOUR HIDDEN SITUATION",
        "Take 25% off or we walk",
        "OBJECTION HANDLING STAGE:",
        "DISCOVERY STAGE: Ask open-ended questions",
      ]) {
        expect(source.includes(marker), `${path.relative(ROOT, file)}: ${marker}`).toBe(false);
      }
    }
    // The chat route is the module's server-side reader.
    expect(runtimeImports(path.join(ROOT, "app", "api", "chat", "route.ts"))).toContain(serverModule);
  });
});
