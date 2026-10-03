# Rehearse — AI Sales Training Platform

Rehearse is a full-stack sales training app. Students complete a 6-stage simulation (lead gen → close); teachers create and publish scenarios.

## Stack

- **Next.js 13** App Router
- **Supabase** — Postgres + Auth
- **Anam** — WebRTC avatar for Discovery and Objection Handling (`Avatar.tsx`)
- **OpenAI GPT-4o** — Persona replies + stage scoring
- **ElevenLabs** + **Deepgram** — TTS / STT (Prospecting and legacy voice paths)

## Setup

1. Run `supabase/FULL-SETUP.sql` in your Supabase SQL editor (only setup file; see `supabase/archive/` for historical migrations).
2. Copy `.env.example` → `.env.local` and fill all keys (including Supabase).
3. Install and run:

```bash
npm install
npm run dev
```

## Environment variables

See `.env.example` for OpenAI, ElevenLabs, Deepgram, Anam, and Supabase keys.

## Deploy (Vercel)

- Add all env vars from `.env.local`
- `npm run build` must pass before deploy

```bash
npm run build
vercel --prod
```

## Project layout

See `CODE_GUIDELINES.md` for folder structure and conventions.
