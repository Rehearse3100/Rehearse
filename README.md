# Rehearse — AI Sales Training Platform

Rehearse is a full-stack sales training app. Students complete a 5-stage Tempo simulation (Prospecting → Negotiation); teachers create and publish scenarios.

## Stack

- **Next.js 13** App Router
- **Supabase** — Postgres + Auth
- **Anam** — WebRTC avatar for Discovery and Objection Handling (`Avatar.tsx`)
- **OpenAI GPT-4o** — Persona replies + stage scoring
- Prospecting is structured/text — no voice stack. The legacy phone path (ElevenLabs + Deepgram via `/api/tts`) is dormant; see `docs/legacy-simulation-path-status.md`.

## Setup

1. Run `supabase/FULL-SETUP.sql` in your Supabase SQL editor (only setup file; see `supabase/archive/` for historical migrations).
2. Copy `.env.example` → `.env.local` and fill all keys (including Supabase).
3. Install and run:

```bash
npm install
npm run dev
```

## Environment variables

See `.env.example`. It has two sections:

- **App** — required locally and in Vercel (OpenAI, Anam, Supabase, student session secret)
- **Local scripts only** — never set in Vercel (e.g. HeyGen for onboarding video scripts)

## Deploy (Vercel)

- Add only the **App** section from `.env.example` to Vercel
- Do not add local-script keys (HeyGen, onboarding presenter path) to Vercel
- `npm run build` must pass before deploy

```bash
npm run build
vercel --prod
```

## Project layout

See `CODE_GUIDELINES.md` for folder structure and conventions.
