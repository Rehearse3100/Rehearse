/**
 * data-room-chat-models.ts
 * The Data Room chat's model requests (pure; no network). Each of the three calls
 * (router, selection, opening) is built from its settings in the simulation's chat
 * config (lib/data-room-chat-config.ts `models`): the model, reasoning_effort only
 * when set, temperature only when set, the output cap under max_tokens (or
 * max_completion_tokens when the settings say so), and JSON mode. The optional
 * server variable DATA_ROOM_CHAT_MODEL (read by the chat route, never logged)
 * replaces the model of all three so the private eval can compare models; "gpt-4o"
 * brings back gpt-4o's settings as they were (temperature 0 / 0 / 0.3, no reasoning
 * effort). Used by POST /api/student/data-room-chat.
 */

import type {
  DataRoomChatModels,
  DataRoomChatModelSetting,
  DataRoomChatReasoningEffort,
} from "@/lib/data-room-chat-config";

/** The model name that brings back gpt-4o's own settings. */
export const GPT_4O_MODEL = "gpt-4o";

/** gpt-4o's settings as they were before gpt-6-luna (router 0, selection 0, opening 0.3; no reasoning effort). */
export const GPT_4O_CHAT_MODELS: DataRoomChatModels = {
  router: { model: GPT_4O_MODEL, temperature: 0 },
  selection: { model: GPT_4O_MODEL, temperature: 0 },
  opening: { model: GPT_4O_MODEL, temperature: 0.3 },
};

/**
 * The settings the calls use: the config's, or with a model override (the
 * DATA_ROOM_CHAT_MODEL value, trimmed) the same settings with that model for all
 * three; "gpt-4o" gives GPT_4O_CHAT_MODELS. A missing or blank override changes
 * nothing.
 */
export function resolveChatModels(models: DataRoomChatModels, override?: string | null): DataRoomChatModels {
  const model = typeof override === "string" ? override.trim() : "";
  if (!model) {
    return models;
  }
  if (model === GPT_4O_MODEL) {
    return GPT_4O_CHAT_MODELS;
  }
  return {
    router: { ...models.router, model },
    selection: { ...models.selection, model },
    opening: { ...models.opening, model },
  };
}

/** One Chat Completions request's settings (the messages are added by the caller). */
export type ChatRequestSettings = {
  model: string;
  max_tokens?: number;
  max_completion_tokens?: number;
  reasoning_effort?: DataRoomChatReasoningEffort;
  temperature?: number;
  response_format: { type: "json_object" };
};

/**
 * A call's request settings from its model settings: the model; the output cap
 * (maxTokens) under max_tokens, or max_completion_tokens when tokenLimitParam says
 * so; reasoning_effort only when set; temperature only when set; JSON mode always.
 */
export function chatRequestSettings(setting: DataRoomChatModelSetting, maxTokens: number): ChatRequestSettings {
  return {
    model: setting.model,
    ...(setting.tokenLimitParam === "max_completion_tokens"
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }),
    ...(setting.reasoningEffort !== undefined ? { reasoning_effort: setting.reasoningEffort } : {}),
    ...(setting.temperature !== undefined ? { temperature: setting.temperature } : {}),
    response_format: { type: "json_object" },
  };
}
