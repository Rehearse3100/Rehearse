/**
 * client-import-graph.ts
 * Test helper: the project files the browser can load. Starts from every "use client"
 * file under app/, components/, hooks/ and lib/ and follows their runtime imports
 * (type-only imports are erased, so they don't count). Used by
 * tests/tempo-handoff-delivery.test.ts to check that server-only modules and their
 * text never reach a client bundle. Same walk as tests/persona-prompts.test.ts.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const PROJECT_ROOT = process.cwd();

/** Every .ts/.tsx file under a folder (skipping node_modules and dot folders). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" || name.startsWith(".") ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/**
 * The project files a file imports at runtime (absolute paths). Static, re-export,
 * side-effect and dynamic imports count; `import type` doesn't.
 */
export function runtimeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specs = [
    // [^;] already spans lines, so multi-line import lists match without the s flag.
    ...Array.from(source.matchAll(/^\s*import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm), (m) => m[1] ?? ""),
    ...Array.from(source.matchAll(/^\s*export\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm), (m) => m[1] ?? ""),
    ...Array.from(source.matchAll(/^\s*import\s+["']([^"']+)["']/gm), (m) => m[1] ?? ""),
    ...Array.from(source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g), (m) => m[1] ?? ""),
  ];
  return specs.flatMap((spec) => {
    const base = spec.startsWith("@/")
      ? path.join(PROJECT_ROOT, spec.slice(2))
      : spec.startsWith(".")
        ? path.resolve(path.dirname(file), spec)
        : null;
    if (!base) {
      return [];
    }
    const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    );
    return found ? [found] : [];
  });
}

/** Every "use client" file under app/, components/, hooks/ and lib/. */
export function clientEntryFiles(): string[] {
  const files = ["app", "components", "hooks", "lib"].flatMap((dir) => sourceFiles(path.join(PROJECT_ROOT, dir)));
  return files.filter((file) =>
    /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(readFileSync(file, "utf8"))
  );
}

/** Every project file reachable from a "use client" file through runtime imports. */
export function clientReachableFiles(): Set<string> {
  const reachable = new Set<string>();
  const queue = clientEntryFiles();
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reachable.has(file)) {
      continue;
    }
    reachable.add(file);
    queue.push(...runtimeImports(file));
  }
  return reachable;
}
