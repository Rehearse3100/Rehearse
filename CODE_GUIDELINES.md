# Rehearse — Code Guidelines

Reference this file for all changes to the Rehearse codebase.

## Repository

- Canonical GitHub remote: https://github.com/Rehearse3100/Rehearse
- Push to that `origin` by default. Do not use `Atharva309/Rehearse` or `rehearse2026/Rehearse` unless explicitly asked.

## Folder structure (core)

```
Rehearse/
├── app/
│   ├── api/
│   │   ├── chat/route.ts      # GPT-4o persona replies
│   │   └── tts/route.ts       # ElevenLabs TTS
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   └── Avatar.tsx              # Anam WebRTC (reuse; do not break AvatarRef)
├── hooks/                       # Voice session orchestration
├── lib/
│   ├── constants.ts            # All magic numbers
│   └── utils.ts                # Shared helper functions
├── types/
│   └── index.ts                # All shared types
├── public/
│   └── pcm-worker.js
└── .env.example
```

## TypeScript

- Explicit parameter and return types on every function — no `any` unless unavoidable (comment why).
- Shared types only in `types/index.ts`.
- Prefer `const`; use `let` only when reassigned.
- No unused imports or variables.

## Comments

Every file needs:

- File-level JSDoc (2–3 lines): what, what it connects to, why.
- Function-level JSDoc: inputs, outputs, behavior.
- Inline comments for non-obvious logic (chunk sizes, debounce, refs).
- Section dividers: `// ── Section Name ───`

## Naming

| Type | Convention |
|---|---|
| Functions | camelCase, verb-first: `fetchChatReply` |
| Components | PascalCase: `Avatar` |
| Constants | SCREAMING_SNAKE_CASE: `DEBOUNCE_MS` |
| Types | PascalCase: `ChatMessage` |
| Booleans | `is` / `has` / `should` prefix |

## Constants

All magic numbers in `lib/constants.ts` — never scatter in components.

## Error handling

- API routes: try/catch, meaningful JSON errors.
- External services: graceful failures, user-facing messages in UI.
- No silent unhandled rejections.

## No dead code

Remove commented-out blocks, unused files, unused imports.

## Hard rules

- Do not commit `.env.local`.
- Do not rename or remove `AvatarRef`.
- Do not change `/api/chat` or `/api/tts` paths.
- Run `npm run build` with zero errors before commit/deploy.

## Env template

See `.env.example` for OpenAI, ElevenLabs, Deepgram, Anam, and Supabase.
