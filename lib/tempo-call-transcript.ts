/**
 * tempo-call-transcript.ts
 * Turns the voice hook's transcript text (one "Student: …" or "Persona: …" line per turn,
 * hooks/useSimulationVoiceSession.ts) into transcript entries for the Tempo Discovery and
 * Objection Handling calls, each stamped MM:SS (formatClock, lib/call-clock.ts) at its
 * share of the call time. Used by the live call screens (hooks/useTempoCallSession.ts)
 * and by the Reference Library (lib/tempo-reference-library.ts) for a saved call that
 * has no entries.
 */

import { formatClock } from "@/lib/call-clock";

/** One transcript line: the student or the persona (by its role), what was said, and about when. */
export type CallTranscriptEntry<PersonaRole extends string> = {
  role: "student" | PersonaRole;
  content: string;
  timestamp: string;
};

/**
 * Parses transcript text into entries.
 * @param raw - The voice hook's transcript, one "Student: …" or "Persona: …" line per turn
 * @param callSeconds - The call time; line n of N is stamped at about n/N of it
 * @param personaRole - The role of every line that isn't the student's ("dana", "drKim")
 * @returns One entry per non-empty line, in order
 */
export function parseCallTranscript<PersonaRole extends string>(
  raw: string,
  callSeconds: number,
  personaRole: PersonaRole
): CallTranscriptEntry<PersonaRole>[] {
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    const isStudent = line.startsWith("Student:");
    const content = line.replace(/^(Student|Persona):\s*/, "").trim();
    const approxSeconds = Math.min(
      callSeconds,
      Math.floor(((index + 1) / lines.length) * Math.max(callSeconds, 1))
    );
    return {
      role: isStudent ? "student" : personaRole,
      content,
      timestamp: formatClock(approxSeconds),
    };
  });
}
