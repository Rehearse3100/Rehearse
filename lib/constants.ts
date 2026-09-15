/**
 * constants.ts
 * Named constants for Rehearse — audio, STT, stages, scoring, and avatar tuning.
 */

import type { SimulationStage } from "@/types";

// ── Audio / PCM ───────────────────────────────────────────────────────────────

export const PCM_CHUNK_SIZE = 8192;
export const SAMPLE_RATE_HZ = 16000;
export const FLOAT_SAMPLES_PER_WORKER_CHUNK = PCM_CHUNK_SIZE / 2;

// ── Deepgram ──────────────────────────────────────────────────────────────────

export const UTTERANCE_DEDUPE_MS = 900;
export const ENDPOINTING_MS = 350;
export const UTTERANCE_END_MS = 1000;

/** Longer silence before phrase end — voice conversation stages (student must finish). */
export const VOICE_ENDPOINTING_MS = 900;

/** Longer utterance end — reduces persona cutting off the student mid-thought. */
export const VOICE_UTTERANCE_END_MS = 1800;

/** Cooldown after persona TTS before accepting the next student utterance. */
export const POST_SPEAK_COOLDOWN_MS = 400;

/** Tempo Anam call stages — tuned for responsive turn-taking without clipping. */
export const SIMULATION_VOICE_ENDPOINTING_MS = 550;
export const SIMULATION_VOICE_UTTERANCE_END_MS = 1200;
export const SIMULATION_VOICE_DEBOUNCE_MS = 700;
export const SIMULATION_VOICE_RECORDER_TIMESLICE_MS = 250;
export const SIMULATION_POST_SPEAK_COOLDOWN_MS = 200;

export const DEEPGRAM_MODEL = "nova-2";
export const DEEPGRAM_LANGUAGE = "en-US";
export const MEDIA_RECORDER_TIMESLICE_MS = 250;

// ── LLM ───────────────────────────────────────────────────────────────────────

export const MAX_TOKENS = 120;
export const MAX_SCORE_TOKENS = 500;
export const DEBOUNCE_MS = 1200;

// ── Anam avatar ───────────────────────────────────────────────────────────────

/** Max wait for Anam WebRTC session + stream before showing a connection error. */
export const ANAM_CONNECT_TIMEOUT_MS = 15_000;

export const POST_CONNECT_ACK_WAIT_MS = 300;

/** Brief pause after end call before revealing the stage score UI. */
export const CALL_SCORE_DELAY_MS = 1500;

/** Student picture-in-picture dimensions during video calls. */
export const PIP_WIDTH_PX = 200;
export const PIP_HEIGHT_PX = 150;

// ── ElevenLabs ────────────────────────────────────────────────────────────────

/** Prefer Flash over legacy Turbo (functionally equivalent, lower latency). */
export const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
export const ELEVENLABS_STABILITY = 0.5;
export const ELEVENLABS_SIMILARITY_BOOST = 0.75;

// ── Rehearse stages ───────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<SimulationStage, string> = {
  lead_gen: "Lead Gen",
  prospecting: "Prospecting",
  discovery: "Discovery",
  presentation: "Presentation",
  objections: "Objections",
  close: "Close",
  results: "Results",
};

export const SCORED_STAGES: SimulationStage[] = [
  "lead_gen",
  "prospecting",
  "discovery",
  "presentation",
  "objections",
  "close",
];

export const MAX_STAGE_SCORE = 100;
export const TOTAL_STAGES_COUNT = 6;
export const MAX_TOTAL_SCORE = MAX_STAGE_SCORE * TOTAL_STAGES_COUNT;

export const GRADE_A_MIN = 540;
export const GRADE_B_MIN = 420;
export const GRADE_C_MIN = 300;
export const GRADE_D_MIN = 180;

export const PRESENTATION_MIN_WORDS = 100;

export const OBJECTIONS_COUNT = 3;

/** Stages that use Anam video (camera + avatar). */
export const AVATAR_VIDEO_STAGES = ["discovery", "objections"] as const;

/** Stages that use voice-only phone UI (no avatar video, no camera). */
export const VOICE_ONLY_STAGES = ["prospecting", "close"] as const;

// ── Routes ──────────────────────────────────────────────────────────────────────

export const PUBLIC_ROUTES = [
  "/login",
  "/register",
  "/signup",
  "/student-login",
  "/student-register",
  "/join",
] as const;

/** Student onboarding entry — class code is never embedded in this URL. */
export const STUDENT_JOIN_PATH = "/join";

export const STUDENT_SESSION_COOKIE = "student_session";

// ── Student auth ────────────────────────────────────────────────────────────────

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
export const PASSWORD_MIN_LENGTH = 6;
export const JOIN_CODE_LENGTH = 6;
export const STUDENT_SESSION_DAYS = 7;
/** Username is globally unique — not per class. */
export const USERNAME_SCOPE = "global" as const;

// ── Default system class ───────────────────────────────────────────────────

/** UUID of the system-seeded Rehearse Essentials class.
 *  Every student is auto-enrolled in this class on registration.
 *  It belongs to no professor (professor_id = null).
 *  Never delete or reassign this ID.
 */
export const DEFAULT_CLASS_ID = "00000000-0000-0000-0000-000000000001" as const;

/** Display name for the system class shown in the student UI */
export const DEFAULT_CLASS_NAME = "Rehearse Essentials" as const;

/** Description for the system class */
export const DEFAULT_CLASS_DESCRIPTION =
  "Curated simulations from Rehearse — available to every student." as const;

/** Banner image for the Rehearse Essentials class card (public/) */
export const DEFAULT_CLASS_BANNER_URL = "/rehearse-essentials.png" as const;

/** Join code for the default class — reserved, cannot be used by professors */
export const DEFAULT_CLASS_JOIN_CODE = "DEFAULT" as const;

/**
 * ID of the Tempo/Summit Dental simulation seeded in the default class.
 * Never delete or reassign this ID.
 */
export const TEMPO_SIMULATION_ID = "00000000-0000-0000-0000-000000000002" as const;

// ── Attempt lifecycle ─────────────────────────────────────────────────────────

/** Attempt status values stored on attempts.status */
export const ATTEMPT_STATUS = {
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
} as const;

export type AttemptStatusValue = (typeof ATTEMPT_STATUS)[keyof typeof ATTEMPT_STATUS];

// ── Stitch UI layout ──────────────────────────────────────────────────────────

export const CALL_OVERLAY_INSET_PX = 16;
export const CALL_CONTAINER_PADDING_PX = 16;
export const SIMULATION_ENTRY_LOADER_MS = 500;
export const STAGE_TRANSITION_MS = 200;
export const CALL_CONTROL_BAR_BOTTOM_PX = 80;
export const CALL_TRANSCRIPT_MAX_HEIGHT_PX = 128;
/** Taller transcript strip during avatar video calls. */
export const CALL_TRANSCRIPT_VIDEO_COMPACT_MAX_HEIGHT_PX = 132;
export const PHONE_INITIALS_SIZE_PX = 96;
export const PHONE_WAVEFORM_BAR_COUNT = 24;
export const PHONE_WAVEFORM_MAX_HEIGHT_PX = 56;
export const PHONE_WAVEFORM_MIN_HEIGHT_PX = 8;
export const PIPELINE_CELL_MIN_HEIGHT_PX = 80;
export const PIPELINE_GRID_MIN_WIDTH_PX = 720;
export const PIPELINE_LABEL_INSET_LEFT_PX = 56;
export const PIP_BORDER_RADIUS_PX = 12;
export const AUTH_BRAND_PANEL_PERCENT = 42;
export const APP_NAVBAR_HEIGHT_PX = 64;
export const PIPELINE_SECTION_HEIGHT_PX = 140;
export const TOAST_AUTO_DISMISS_MS = 3000;
export const LEADERBOARD_TOP_N = 10;
export const LEADERBOARD_QUERY_LIMIT = 50;

/** Appended to persona system prompts on voice stages — reduces interruptions. */
export const PERSONA_LISTENING_RULES =
  "CRITICAL RULE: Let the student finish speaking completely before you respond. Never interrupt mid-sentence. Wait for a clear pause. Keep replies to 2-3 short sentences.";

/** Dana Reyes persona for Tempo Stage 2 Discovery (default class only). */
export const DANA_REYES_SYSTEM_PROMPT = `You are Dana Reyes, Director of Operations at Summit Dental Group — a family-owned group of 8 dental practices across Colorado's Front Range. You are on a 15-minute discovery call with a new Account Executive from Tempo, a scheduling software company.

YOUR CHARACTER:
- Professional and willing, not effusive. You took this call; you'll engage. But you're busy.
- You were hired by Dr. Saul Kim to "get operations under control" as the group grows.
- You just opened the 8th location 3 months ago and things are straining.

YOUR HIDDEN SITUATION (reveal only when asked good questions):
1. No-show rate around 18% — you feel it but haven't quantified it precisely. If asked directly, give vague answer first ("more than I'd like"). Only share the real figure if student asks you to estimate or walks you through the math.
2. Front desk is drowning — phone scheduling and confirmation calls eat hours. Two front-desk staff have quit in the last year. This is the pain you'll surface first if rapport is decent because it stresses you daily.
3. Losing after-hours demand — you haven't really thought about this one. A sharp student can surface it by asking how people book and what happens after hours.
4. The 8th location broke the system — the manual approach sort of worked at 7; at 8 it's clearly failing. This is the "why now."

YOUR PERSONAL DRIVER (only surfaces with real rapport):
You do not want to look bad to Dr. Kim. You were hired to fix operations and the cracks showing at the new location feel like your problem to solve. You also genuinely care about your staff and worry about burnout and turnover.

BEHAVIORAL RULES:
- Surface answers to weak questions. Closed or generic questions get short low-information answers. Open specific questions get rich answers.
- Never volunteer numbers. Provide them only when asked to estimate or quantify.
- Deflect early pitching: if student starts selling features before understanding your situation, push back gently: "Before we get into the product — what made you reach out to us?"
- Repeated premature pitching makes you cooler and shorter.
- Reward listening: if student builds on something you said earlier, you notice and warm up.
- Mention Dr. Kim naturally if the conversation goes well: "anything like this, I'd want Dr. Kim comfortable with too."
- Never hostile. A nervous student still gets a workable call; the depth is what's earned.
- Opening line: "Thanks for jumping on — I've got about 15 minutes. What made you reach out to us?"` as const;

export const TEMPO_DISCOVERY_STAGE_HINT =
  "DISCOVERY STAGE: Ask open-ended questions. Do not pitch features or pricing. Uncover business issues before discussing solutions." as const;

export const TEMPO_DISCOVERY_OPENING_GREETING =
  "Thanks for jumping on — I've got about 15 minutes. What made you reach out to us?" as const;

/** Dr. Saul Kim persona for Tempo Stage 4 Objection Handling (default class only). */
export const DR_KIM_SYSTEM_PROMPT = `You are Dr. Saul Kim, Founder and Owner of Summit Dental Group — 8 dental practices across Colorado's Front Range. You built this from one chair to eight locations over 15 years. You are on a follow-up call to review the Tempo proposal. Dana Reyes is on the call but mostly deferring to you.

YOUR CHARACTER:
- Dentist first, businessman second. Careful with money and skeptical of software subscriptions.
- You've been burned by tools that didn't deliver before.
- You respect confidence, not pushiness. A student who caves immediately on price loses your respect.
- You escalate if dodged or if student is evasive. You soften when genuinely heard.
- Never hostile — realistic, not aggressive.

YOUR THREE OBJECTIONS (lead with these, each has a surface and a root):

1. PRICE: Surface — "Eight locations times that price adds up fast — is it really worth it?" Root — not convinced it will actually pay for itself. What you need: ROI made concrete. The student must show how no-show recovery dwarfs the monthly cost.

2. ADOPTION: Surface — "My front desk will never adopt new software — half my staff have been here twenty years." Root — fear of a disruptive rollout that wastes money and frustrates people. What you need: reassurance on training, onboarding ease, and that most teams are live in days not weeks.

3. STATUS QUO: Surface — "We've managed fine growing to eight locations doing it our way." Root — under-counting the cost of the current chaos. What you need: the cost of inaction made visible — the no-show revenue leak, the front desk turnover risk.

BEHAVIORAL RULES:
- Lead with the price objection first. Don't wait to be asked.
- After price is addressed, raise adoption. After adoption, raise status quo.
- If student dodges, talks over you, or jumps straight to discounting — get firmer and more skeptical.
- If student acknowledges the concern first then addresses the root with evidence — engage constructively and move toward "okay, what would this look like for us?"
- Defers to Dana on operational detail but owns the money decision.
- Opening line: "Thanks for making time. I've had a chance to look at the proposal — I have a few concerns before we talk about moving forward."` as const;

export const TEMPO_OBJECTIONS_STAGE_HINT =
  "OBJECTION HANDLING STAGE: Dr. Kim leads with price, then adoption, then status quo. Acknowledge before answering. Do not cave on price immediately." as const;

export const TEMPO_OBJECTIONS_OPENING_GREETING =
  "Thanks for making time. I've had a chance to look at the proposal — I have a few concerns before we talk about moving forward." as const;

/** Dr. Kim negotiation persona — Tempo Stage 5 Scenario A (value defense). */
export const SCENARIO_A_SYSTEM_PROMPT = `You are Dr. Saul Kim in a negotiation. The student just submitted a Tempo proposal and you are pushing for a 25% discount. You have 3 turns.

Turn 1: Push hard — "Take 25% off or we walk."
Turn 2: Based on student's response — if they held value, soften slightly but still push. If they caved immediately, push harder.
Turn 3: Final position — if student defended value well with ROI reframe, agree to move forward without the discount. If they caved, push for more.

After Turn 3, end your response with exactly one of these outcome codes on a new line:
OUTCOME:deal_agreed
OUTCOME:kim_walked
OUTCOME:partial_close

Then on the next line write a 2-3 sentence closing message explaining the outcome.` as const;

/** Dr. Kim negotiation persona — Tempo Stage 5 Scenario B (concession management). */
export const SCENARIO_B_SYSTEM_PROMPT = `You are Dr. Saul Kim in a concession management negotiation. You want: monthly billing, free onboarding, and to add a 9th location. You have 3 turns.

Trade intelligently — if the student trades (gives something to get something), engage constructively. If they just cave and give everything, push for more. If they refuse all concessions, soften and find common ground.

After Turn 3, end your response with exactly one of these outcome codes on a new line:
OUTCOME:deal_agreed
OUTCOME:kim_walked
OUTCOME:partial_close

Then on the next line write a 2-3 sentence closing message.` as const;
