/**
 * tempo-icp-criteria.ts
 * Tempo's ICP rubric and manager-note copy, used by the grading route
 * (app/api/student/icp-check) with the generic lib/icp-grading.ts. Server only:
 * the rubric's answer lists and the territory never reach the browser or the
 * note-writing model. Five criteria, 100 points: met = full, partial = half,
 * missing = 0; bands strong ≥ 80, developing 50–79, needs_work < 50. The real
 * size range (3–12 locations) is the one the directory generator uses
 * (scripts/config/tempo-icp.ts), copied here, not imported. Keep it abstract:
 * no named accounts or people.
 */

import type { IcpNoteCopy, IcpRubric } from "@/lib/icp-grading";

export const TEMPO_ICP_RUBRIC: IcpRubric = {
  version: "tempo-icp-v1",
  productContext:
    "The product is Tempo, scheduling software for appointment-based, multi-location service businesses.",
  criteria: [
    {
      kind: "ai",
      id: "industry",
      label: "Target industry",
      points: 20,
      met: "Multi-location, appointment-based service businesses: dental, veterinary, physical therapy, optometry, med spa, chiropractic, or a clearly similar appointment-based service.",
      partial: "Names only one vertical, or something broad such as \"healthcare\" without the multi-location, appointment-based angle.",
      missing: "Generic (\"any business\", \"SMBs\") or the wrong type of business for scheduling software.",
    },
    {
      kind: "ai",
      id: "decision_maker",
      label: "Decision-maker role",
      points: 15,
      met: "The operations owner of scheduling and the front desk: Director or VP of Operations, COO, or an operations or practice manager who owns those processes.",
      partial: "Founder or CEO, or an office manager without clear ownership of operations.",
      missing: "A clinical title (dentist, doctor, vet), a receptionist, or \"anyone\".",
    },
    {
      kind: "size",
      id: "size",
      label: "Size range",
      points: 15,
      realMin: 3,
      realMax: 12,
      metMin: [2, 4],
      metMax: [10, 15],
      gaps: {
        partial:
          "Your location range stretches past the groups where manual scheduling hurts most; tighten it around growing multi-location operators.",
        missing:
          "Your location range misses the multi-location groups where manual scheduling breaks down; rethink how big a good-fit account really is.",
      },
    },
    {
      kind: "ai",
      id: "signals",
      label: "Operational signals",
      points: 25,
      met: "Two or more signals that can be verified in research, including BOTH manual or phone scheduling (or no online booking) AND a current strain or trigger such as a new location, hiring front-desk staff, or complaints about wait times or phones.",
      partial: "Only one of those two kinds of signal, or vague intent (\"wants to grow\", \"interested in software\").",
      missing: "Nothing that could be verified in research.",
    },
    {
      kind: "ai",
      id: "disqualifiers",
      label: "Disqualifiers",
      points: 25,
      met: "Two or more real hard walk-away rules, such as: locked into a scheduling vendor or contract, a corporate or franchise vendor mandate, a spending freeze, expansion that isn't real, or out of territory or scope.",
      partial: "Exactly one real hard walk-away rule; the others are soft preferences or not disqualifying.",
      missing: "No real walk-away rule.",
    },
  ],
  bands: { strong: 80, developing: 50 },
};

/** Cities and regions in Tempo's sales territory; the manager note must never name one. */
export const TEMPO_TERRITORY_PLACES: readonly string[] = [
  "Front Range",
  "Denver",
  "Colorado Springs",
  "Boulder",
  "Fort Collins",
  "Greeley",
  "Pueblo",
  "Salt Lake City",
  "Provo",
  "Ogden",
  "Boise",
  "Albuquerque",
  "Santa Fe",
  "Cheyenne",
  "Casper",
  "Missoula",
  "Billings",
  "Grand Junction",
];

export const TEMPO_ICP_NOTE_COPY: IcpNoteCopy = {
  productName: "Tempo",
  managerVoice: "the rep's sales manager at Tempo",
  minWords: 80,
  maxWords: 140,
  ungradedNote:
    "Thanks for putting real thought into this ICP. I couldn't get to a full review right now, so treat it as your working filter. As you research, check each account against your industry, the person who owns scheduling, the signals you listed and your walk-away rules. Notice where an account almost fits but not quite, because that is usually where your definition needs sharpening. Bring what you learn to our next check-in and we'll tighten it together.",
  fallback: {
    strengthLead: "One thing you got right:",
    strengthFollow: "That's the kind of detail that makes research faster, so keep it.",
    noStrength: "You've got a starting point here, and it's worth sharpening before you spend time on research.",
    firstGapLead: "The biggest thing to tighten:",
    secondGapLead: "After that:",
    gapQuestion: "If you had to defend this filter to a skeptical buyer, which part would you change first?",
    closing: "Carry this into research: for every account, ask whether the pain is happening right now, not someday.",
  },
};
