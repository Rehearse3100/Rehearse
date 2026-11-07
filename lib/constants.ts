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
/** /api/chat: the most history turns sent to the model (the latest ones). */
export const CHAT_MAX_HISTORY_MESSAGES = 60;
/** /api/chat: the longest history message or new message accepted (longer → 400). */
export const CHAT_MAX_MESSAGE_CHARS = 2_000;
/** /api/tts: the longest text sent for speech (longer → 400; persona replies are far shorter). */
export const TTS_MAX_TEXT_CHARS = 1_000;
/** /api/score: the longest transcript, pitch, summary, answer or product context accepted (longer → 400). */
export const SCORE_MAX_TEXT_CHARS = 40_000;
/** /api/score: the longest persona name, role or product name accepted (longer → 400). */
export const SCORE_MAX_SHORT_TEXT_CHARS = 500;
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

export const TEMPO_DISCOVERY_OPENING_GREETING =
  "Thanks for jumping on — I've got about 15 minutes. What made you reach out to us?" as const;

export const TEMPO_OBJECTIONS_OPENING_GREETING =
  "Thanks for making time. I've had a chance to look at the proposal — I have a few concerns before we talk about moving forward." as const;
