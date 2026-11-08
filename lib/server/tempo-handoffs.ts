/**
 * tempo-handoffs.ts — SERVER ONLY
 * The manager handoff message for each Tempo stage (moved from lib/tempo-prospecting.ts
 * on 2026-11-08). They name the target account and its contacts and summarise what
 * later stages uncover, so they must never be bundled for the browser: the simulation
 * page (app/student/simulation/[id]/page.tsx) passes each stage component only the
 * messages it shows — its own, and the next stage's brief for its end-of-stage
 * handoff; Stage 1 gets the Discovery message only once Stage 1 has been submitted.
 * Never import this from a "use client" file or anything a client file imports (a
 * test walks the import graph to check).
 */

import type { TempoHandoffStageKey } from "@/lib/tempo-prospecting";

// The `server-only` package isn't installed; this guard fails fast if a bundle ever
// runs this module in a browser.
if (typeof window !== "undefined") {
  throw new Error("lib/server/tempo-handoffs.ts is server-only: stage handoffs must never reach the browser.");
}

/** Each stage's manager handoff, shown in its HandoffModal. */
export const TEMPO_HANDOFF_MESSAGES: Readonly<Record<TempoHandoffStageKey, string>> = {
  prospecting: `Time to build your pipeline. I have loaded a directory of appointment-based businesses into your research workspace. One of those accounts is showing real buying signals right now, and only one person there truly owns this decision. Research the candidates, verify what the AI tells you before you trust it, work up your leads in the CRM, and pick your target. Then draft a crisp opening message. No pitching yet. Just sharp research and a strong first touch. Good luck.`,

  discovery: `Your outreach landed. Dana Reyes has agreed to a 15-minute discovery call next Tuesday. You are not pitching yet. You are here to understand their world and find out whether there is a business issue worth solving. Be curious. Ask good questions. Listen more than you talk. Good luck.`,

  presentation: `Nice work. Dana wants you back to present to her and Dr. Kim next week. Here is what the team knows about Summit Dental: 8 dental practices, just opened their 8th, straining a manual phone-based scheduling setup. Front desk is overloaded, no-shows run about 1 in 6, they capture no after-hours demand, and Dana is under pressure from Dr. Kim to get operations right as they scale. Build them a pitch that connects to that business issue.`,

  objections: `You sent the proposal, and Dr. Kim wants a call before he signs off. He has got concerns. Dana will be on, but Kim is the one to win over: he built this from one chair to eight locations and he is careful with money. Do not expect an easy yes, and do not fold the moment he pushes on price.`,

  negotiation: `You earned it. Kim is ready to talk terms. Dana will work the details with you. They want Pro across all 8 locations, Kim wants confidence it will deliver before committing, and price is on the table. Now build the mutual plan and close it.`,
};
