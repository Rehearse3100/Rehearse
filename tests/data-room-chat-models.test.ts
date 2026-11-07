/**
 * data-room-chat-models.test.ts
 * The Data Room chat's model requests (lib/data-room-chat-models.ts, pure): each call's
 * request is built from its settings in the chat config — reasoning_effort only when
 * set, temperature only when set, the output cap under max_tokens (or
 * max_completion_tokens when the settings say so), JSON mode always — and the
 * DATA_ROOM_CHAT_MODEL override replaces the model of all three ("gpt-4o" brings back
 * gpt-4o's old settings). Tempo's default is gpt-6-luna with reasoning effort "none".
 */

import { describe, expect, it } from "vitest";
import { getDataRoomChatConfig, type DataRoomChatModels } from "@/lib/data-room-chat-config";
import { chatRequestSettings, GPT_4O_CHAT_MODELS, resolveChatModels } from "@/lib/data-room-chat-models";

const JSON_MODE = { type: "json_object" };

describe("a call's request settings", () => {
  it("reasoning_effort only when set, temperature only when set; max_tokens and JSON mode always", () => {
    expect(chatRequestSettings({ model: "m" }, 100)).toEqual({ model: "m", max_tokens: 100, response_format: JSON_MODE });
    expect(chatRequestSettings({ model: "m", reasoningEffort: "none" }, 600)).toEqual({
      model: "m",
      max_tokens: 600,
      reasoning_effort: "none",
      response_format: JSON_MODE,
    });
    expect(chatRequestSettings({ model: "m", temperature: 0 }, 500)).toEqual({
      model: "m",
      max_tokens: 500,
      temperature: 0,
      response_format: JSON_MODE,
    });
    expect(chatRequestSettings({ model: "m", reasoningEffort: "low", temperature: 0.3 }, 100)).toEqual({
      model: "m",
      max_tokens: 100,
      reasoning_effort: "low",
      temperature: 0.3,
      response_format: JSON_MODE,
    });
  });

  it("a model that rejects max_tokens is a settings change: tokenLimitParam max_completion_tokens", () => {
    const settings = chatRequestSettings({ model: "m", reasoningEffort: "none", tokenLimitParam: "max_completion_tokens" }, 600);
    expect(settings).toEqual({ model: "m", max_completion_tokens: 600, reasoning_effort: "none", response_format: JSON_MODE });
    expect(settings).not.toHaveProperty("max_tokens");
    expect(chatRequestSettings({ model: "m", tokenLimitParam: "max_tokens" }, 600)).toEqual({
      model: "m",
      max_tokens: 600,
      response_format: JSON_MODE,
    });
  });
});

describe("the models the calls use", () => {
  const tempo = getDataRoomChatConfig().models;

  it("Tempo's default: gpt-6-luna for all three, reasoning effort none, no temperature", () => {
    for (const call of ["router", "selection", "opening"] as const) {
      expect(tempo[call], call).toEqual({ model: "gpt-6-luna", reasoningEffort: "none" });
    }
  });

  it("no override (missing or blank) → the config's settings", () => {
    expect(resolveChatModels(tempo)).toBe(tempo);
    expect(resolveChatModels(tempo, undefined)).toBe(tempo);
    expect(resolveChatModels(tempo, null)).toBe(tempo);
    expect(resolveChatModels(tempo, "  ")).toBe(tempo);
  });

  it('"gpt-4o" → gpt-4o\'s old settings: temperature 0 / 0 / 0.3, no reasoning effort', () => {
    expect(resolveChatModels(tempo, "gpt-4o")).toEqual({
      router: { model: "gpt-4o", temperature: 0 },
      selection: { model: "gpt-4o", temperature: 0 },
      opening: { model: "gpt-4o", temperature: 0.3 },
    });
    expect(resolveChatModels(tempo, " gpt-4o ")).toBe(GPT_4O_CHAT_MODELS);
    expect(chatRequestSettings(GPT_4O_CHAT_MODELS.opening, 100)).toEqual({
      model: "gpt-4o",
      max_tokens: 100,
      temperature: 0.3,
      response_format: JSON_MODE,
    });
  });

  it("any other model replaces the model of all three and keeps the other settings", () => {
    const custom: DataRoomChatModels = {
      router: { model: "a", reasoningEffort: "none" },
      selection: { model: "b", temperature: 0, tokenLimitParam: "max_completion_tokens" },
      opening: { model: "c", reasoningEffort: "low", temperature: 0.2 },
    };
    expect(resolveChatModels(custom, "eval-model")).toEqual({
      router: { model: "eval-model", reasoningEffort: "none" },
      selection: { model: "eval-model", temperature: 0, tokenLimitParam: "max_completion_tokens" },
      opening: { model: "eval-model", reasoningEffort: "low", temperature: 0.2 },
    });
    // The config itself is never changed.
    expect(custom.router.model).toBe("a");
  });
});
