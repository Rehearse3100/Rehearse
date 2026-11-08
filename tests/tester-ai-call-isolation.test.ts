/**
 * tester-ai-call-isolation.test.ts
 * Keeps the throwaway /tester/ai-call page (app/tester/ai-call/) removable with no
 * effect on the project:
 * - no file in app/tester/ai-call/ imports from the project: no "@/…", no relative path
 *   outside the folder, no absolute path, nothing but an installed package (React,
 *   Next.js, @anam-ai/js-sdk…). Type-only imports count too;
 * - no file outside the folder imports from it.
 * Reads source files only (static, re-export, side-effect and dynamic imports and
 * require); skips node_modules and dot folders (.next, .git, .claude, .eval). No
 * network, no database.
 * Removing the page: delete app/tester/ai-call/, this test, and the "AI call test"
 * option in app/student/dashboard/TestShortcutsDropdown.tsx.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const TESTER_DIR = path.join(ROOT, "app", "tester", "ai-call");
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

// ── Scanning ───

/** Every source file under a folder, skipping node_modules and dot folders. */
function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" || name.startsWith(".") ? [] : sourceFilesUnder(full);
    }
    return SOURCE_FILE.test(name) ? [full] : [];
  });
}

/** Every module a source text names in an import, export-from, dynamic import or require. */
function moduleSpecifiers(source: string): string[] {
  const patterns = [
    // [^;] spans lines, so multi-line import lists match.
    /^\s*import\s+[^;]*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*export\s+(?:type\s+)?(?:\*|\{)[^;]*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((pattern) => Array.from(source.matchAll(pattern), (match) => match[1] ?? ""));
}

function isInside(dir: string, target: string): boolean {
  const relative = path.relative(dir, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? spec;
}

function installedPackages(): Set<string> {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
}

/** Why an import in a tester-folder file breaks the isolation, or null when it's fine. */
function insideImportProblem(file: string, spec: string, installed: ReadonlySet<string>): string | null {
  if (spec.startsWith("@/")) {
    return "imports the project through @/";
  }
  if (spec.startsWith(".")) {
    return isInside(TESTER_DIR, path.resolve(path.dirname(file), spec)) ? null : "imports a path outside app/tester/ai-call";
  }
  if (spec.startsWith("/") || spec.startsWith("~")) {
    return "imports by absolute path";
  }
  return installed.has(packageName(spec)) ? null : "imports something that isn't an installed package";
}

/** True when an import in a file outside the tester folder reaches into it. */
function reachesTesterFolder(file: string, spec: string): boolean {
  const target = spec.startsWith("@/")
    ? path.join(ROOT, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(file), spec)
      : spec.startsWith("/")
        ? spec
        : null;
  return target ? isInside(TESTER_DIR, target) : spec.includes("tester/ai-call");
}

// ── Tests ───

describe("the /tester/ai-call page stands alone", () => {
  it("the checks catch what they're meant to catch", () => {
    const installed = new Set(["react", "next", "@anam-ai/js-sdk"]);
    const pageFile = path.join(TESTER_DIR, "page.tsx");
    expect(
      moduleSpecifiers(
        [
          'import { notFound } from "next/navigation";',
          'import type { ChatPersona } from "@/lib/chat-personas";',
          "import {\n  a,\n  b,\n} from '../x';",
          'export { c } from "./AiCallTester";',
          'import "./side.css";',
          'const lazy = import("@anam-ai/js-sdk");',
          'const old = require("react");',
        ].join("\n")
      )
    ).toEqual(["next/navigation", "@/lib/chat-personas", "../x", "./AiCallTester", "./side.css", "@anam-ai/js-sdk", "react"]);
    expect(insideImportProblem(pageFile, "@/lib/chat-personas", installed)).not.toBeNull();
    expect(insideImportProblem(pageFile, "../../lib/x", installed)).not.toBeNull();
    expect(insideImportProblem(pageFile, "/abs/x", installed)).not.toBeNull();
    expect(insideImportProblem(pageFile, "left-pad", installed)).not.toBeNull();
    expect(insideImportProblem(pageFile, "./AiCallTester", installed)).toBeNull();
    expect(insideImportProblem(pageFile, "next/link", installed)).toBeNull();
    expect(insideImportProblem(pageFile, "@anam-ai/js-sdk", installed)).toBeNull();
    const outsideFile = path.join(ROOT, "app", "student", "dashboard", "TestShortcutsDropdown.tsx");
    expect(reachesTesterFolder(outsideFile, "@/app/tester/ai-call/AiCallTester")).toBe(true);
    expect(reachesTesterFolder(outsideFile, "../../tester/ai-call/page")).toBe(true);
    expect(reachesTesterFolder(outsideFile, "app/tester/ai-call")).toBe(true);
    expect(reachesTesterFolder(outsideFile, "@/lib/tempo-results")).toBe(false);
    expect(reachesTesterFolder(outsideFile, "next/navigation")).toBe(false);
  });

  it("no file in app/tester/ai-call/ imports from the project or anything outside its folder", () => {
    expect(existsSync(path.join(TESTER_DIR, "page.tsx"))).toBe(true);
    const installed = installedPackages();
    const files = sourceFilesUnder(TESTER_DIR);
    const problems = files.flatMap((file) => {
      const specs = moduleSpecifiers(readFileSync(file, "utf8"));
      // Every file here imports something (React or Next.js), so an empty list means the scan broke.
      expect(specs.length, path.relative(ROOT, file)).toBeGreaterThan(0);
      return specs.flatMap((spec) => {
        const problem = insideImportProblem(file, spec, installed);
        return problem ? [`${path.relative(ROOT, file)}: "${spec}" ${problem}`] : [];
      });
    });
    expect(problems).toEqual([]);
  });

  it("no file outside app/tester/ai-call/ imports from it", () => {
    const outside = sourceFilesUnder(ROOT).filter((file) => !isInside(TESTER_DIR, file));
    expect(outside.length).toBeGreaterThan(100);
    const problems = outside.flatMap((file) =>
      moduleSpecifiers(readFileSync(file, "utf8"))
        .filter((spec) => reachesTesterFolder(file, spec))
        .map((spec) => `${path.relative(ROOT, file)}: "${spec}"`)
    );
    expect(problems).toEqual([]);
  });
});
