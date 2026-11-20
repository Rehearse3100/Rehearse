/**
 * page.tsx — /tester/ai-call
 * THROWAWAY TESTER PAGE for the AI call: a text chat with the shared call brain for Dana
 * and Dr. Kim (POST /tester/ai-call/api/chat, in api/chat/ here: a thin wrapper around
 * lib/server/call-brain.ts, which POST /api/student/call-turn also runs), a call timer,
 * and a switch that turns on the Anam avatar and voice (POST /tester/ai-call/api/session,
 * in api/session/ here, for the token, then @anam-ai/js-sdk in the browser).
 *
 * TO REMOVE IT: delete app/tester/ai-call/, delete tests/tester-ai-call-isolation.test.ts,
 * and delete the one "AI call test" option in app/student/dashboard/TestShortcutsDropdown.tsx
 * (the option and the one onChange branch that opens this page). The shared call brain it
 * uses (lib/call-config.ts, lib/server/call-brain.ts and what they import) stays.
 *
 * It stands apart on purpose: from the project, this folder imports only lib/call-config.ts
 * (timings and wire types, client-safe) and lib/server/call-brain.ts (server routes only),
 * nothing outside app/tester/ imports from it, and it talks to the app only over HTTP with
 * fetch. tests/tester-ai-call-isolation.test.ts checks both directions. Nothing here
 * writes to the database or uses a project endpoint: the avatar's session token comes
 * from the tester's own api/session route, with no sign-in and no attempt id.
 *
 * Server component: with tester mode off it is a 404. The check is a copy of
 * isGateBypassEnabled() in lib/tempo-test-bypass.ts (copied, not imported).
 */

import { notFound } from "next/navigation";
import { AiCallTester } from "./AiCallTester";

// Read the tester flag on every request, never at build time.
export const dynamic = "force-dynamic";

type AiCallTesterPageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

/** The first value of a query param, trimmed ("" when it's missing). */
function firstParam(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

/**
 * /tester/ai-call?simulationId=…&classId=… — both optional (only for the "open the
 * simulation" link). Tester mode off → notFound().
 */
export default function AiCallTesterPage({ searchParams }: AiCallTesterPageProps): React.ReactElement {
  // Same check as lib/tempo-test-bypass.ts isGateBypassEnabled(): only the exact string "true" turns it on.
  if (process.env.TEMPO_TEST_BYPASS_GATES !== "true") {
    notFound();
  }

  return (
    <AiCallTester
      simulationId={firstParam(searchParams.simulationId)}
      classId={firstParam(searchParams.classId)}
    />
  );
}
