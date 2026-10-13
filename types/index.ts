/**
 * types/index.ts
 * Shared TypeScript types for Rehearse — auth, simulations, stages, voice, and API payloads.
 */

export type UserRole = "student" | "teacher";

export type AttemptStatus = "in_progress" | "completed" | "abandoned";

export type SimulationStage =
  | "lead_gen"
  | "prospecting"
  | "discovery"
  | "presentation"
  | "objections"
  | "close"
  | "results";

export const STAGE_ORDER: SimulationStage[] = [
  "lead_gen",
  "prospecting",
  "discovery",
  "presentation",
  "objections",
  "close",
  "results",
];

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
};

export type Simulation = {
  id: string;
  teacher_id: string;
  title: string;
  description: string | null;
  persona_name: string;
  persona_role: string;
  persona_system_prompt: string;
  product_context: string;
  simli_face_id: string;
  is_published: boolean;
  created_at: string;
};

export type Attempt = {
  id: string;
  student_id: string;
  simulation_id: string;
  class_id?: string;
  student_class_id?: string;
  status: AttemptStatus;
  current_stage: SimulationStage;
  total_score: number;
  started_at: string;
  completed_at: string | null;
};

/** Background badge grading state on a stage_scores row (grade-badges route). */
export type BadgeGradingStatus = "pending" | "grading" | "done";

export type StageScore = {
  id: string;
  attempt_id: string;
  stage: SimulationStage;
  score: number;
  feedback: string | null;
  transcript: string | null;
  completed_at: string;
  badges_earned: string[];
  /** Missing on older rows and test mocks; treat a missing value as "done". */
  badges_status?: BadgeGradingStatus;
  badges_claimed_at?: string | null;
  badges_claim_id?: string | null;
};

/** Saved CRM opportunity log for one Tempo stage. */
export type CrmLogEntry = {
  stage: SimulationStage;
  fields: Record<string, string>;
  submitted_at: string;
};

/** Multi-entry CRM Lead row (pre-conversion prospecting data). */
export type CrmLead = {
  id: string;
  attempt_id: string;
  company_name: string;
  contact_name: string;
  contact_title: string;
  why_fit: string;
  trigger_event: string;
  next_step: string;
  decision_maker_rationale: string;
  status: "new" | "shortlisted" | "selected" | "converted";
  created_at: string;
  updated_at: string;
};

export type LeaderboardEntry = {
  rank: number;
  student_id: string;
  student_name: string;
  total_score: number;
  grade: string;
  attempt_id: string;
  completed_at?: string | null;
};

export type StudentSession = {
  studentId: string;
  username: string;
  displayName: string;
};

export type ClassColorSchemeId =
  | "default"
  | "ocean"
  | "forest"
  | "sunset"
  | "violet"
  | "rose";

export type Class = {
  id: string;
  professor_id: string;
  name: string;
  description: string | null;
  join_code: string;
  is_active: boolean;
  created_at: string;
  card_image_url?: string | null;
  card_color_scheme?: ClassColorSchemeId | null;
};

export type Student = {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
};

export type StudentClass = {
  id: string;
  studentId: string;
  classId: string;
  professorId: string;
  joinedAt: string;
};

/** Student enrolled in a class — used in professor class management UI. */
export type EnrolledStudent = {
  id: string;
  username: string;
  displayName: string;
  joinedAt: string;
};

export type ClassSimulation = {
  id: string;
  class_id: string;
  simulation_id: string;
  added_at: string;
};

/** Imperative handle exposed by Avatar for TTS playback and interruption. */
export interface AvatarRef {
  /** Starts Anam WebRTC session — call from a user gesture (Join Call). */
  startSession: () => Promise<boolean>;
  /** Resolves when Dana video + audio elements are mounted in the DOM. */
  waitForMediaElements: (maxMs?: number) => Promise<boolean>;
  speakAudio: (data: SpeakAudioPayload) => Promise<void>;
  resumeAudioContext: () => void;
  stopSpeaking: () => void;
  isReady: () => boolean;
  waitUntilReady: (maxMs?: number) => Promise<boolean>;
}

export type SpeakAudioPayload = {
  audio: ArrayBuffer | Blob;
  words?: string[];
  wtimes?: number[];
  wdurations?: number[];
  chars?: string[];
  ctimes?: number[];
  cdurations?: number[];
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type LipSyncTiming = {
  words: string[];
  wtimes: number[];
  wdurations: number[];
  chars: string[];
  ctimes: number[];
  cdurations: number[];
};

/** Flags on each Deepgram transcript WebSocket message. */
export type DeepgramTranscriptMeta = {
  isFinal: boolean;
  isSpeechFinal: boolean;
};

export interface DeepgramConnection {
  send: (data: Blob | ArrayBuffer) => void;
  close: () => void;
  getReadyState: () => number;
  onTranscript: (callback: (transcript: string, meta: DeepgramTranscriptMeta) => void) => void;
  onOpen: (callback: () => void) => void;
  onClose: (callback: () => void) => void;
  onError: (callback: (error: Event) => void) => void;
}

export type DeepgramStreamOptions = {
  model?: string;
  language?: string;
  smart_format?: boolean;
  interim_results?: boolean;
  utterance_end_ms?: number;
  vad_events?: boolean;
  endpointing?: number;
};

export type ElevenLabsAlignment = {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
};

export type ChatRequestBody = {
  messages?: ChatMessage[];
  newMessage: string;
  systemPrompt?: string;
};

export type TtsRequestBody = {
  text: string;
};

export type TtsResponseBody = {
  audioBase64?: string;
  words: string[];
  wtimes: number[];
  wdurations: number[];
  chars: string[];
  ctimes: number[];
  cdurations: number[];
};

export type LeadGenAnswers = {
  fit: string;
  painPoints: string;
  openingApproach: string;
};

export type SimulationContext = {
  personaName: string;
  personaRole: string;
  personaSystemPrompt: string;
  productContext: string;
  productName?: string;
};

/** Inputs for building a stage-specific GPT scoring prompt. */
export type ScoringContext = {
  stage: SimulationStage;
  personaName: string;
  personaRole: string;
  productName: string;
  productContext: string;
  transcript?: string;
  pitchText?: string;
  studentAnswers?: string;
  leadGenAnswers?: LeadGenAnswers;
  priorStagesSummary?: string;
};

export type ScoreRequestBody = {
  stage: SimulationStage;
  transcript?: string;
  pitchText?: string;
  studentAnswers?: LeadGenAnswers;
  simulationContext: SimulationContext;
  runningTotalScore?: number;
  priorStagesSummary?: string;
};

export type ScoreResponseBody = {
  score: number;
  feedback: string;
};

export type StageProgressItem = {
  stage: SimulationStage;
  label: string;
  status: "completed" | "current" | "locked";
  score?: number;
};

export type RestartSimulationResponse = {
  success: boolean;
  newAttemptId: string;
};
