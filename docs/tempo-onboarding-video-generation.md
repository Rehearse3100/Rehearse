# Tempo Onboarding Video — Deck, Intent, and What Actually Shipped

Last updated: August 29, 2026

This document describes the **current slide deck content**, the **intended presenter-over-deck video pipeline**, and **what HeyGen actually produced** for the Tempo simulation onboarding welcome video.

---

## Summary

| | |
|---|---|
| **Live video** | [tempo-welcome.mp4](https://visuvrjmcoanndndimfw.supabase.co/storage/v1/object/public/onboarding-videos/tempo-welcome.mp4) (~72s) |
| **What users see** | Five talking-head clips stitched together — avatar in default HeyGen office background |
| **What we wanted** | Professional slide deck visible on screen with Avatar III presenter speaking over each slide |
| **Slide assets** | Exist as PNGs on Supabase but were **not composited** into the final video |
| **PowerPoint file** | None — slides are code-generated PNGs, not a `.pptx` |

---

## Current Deck Content (v1)

Slides are defined in `scripts/config/tempo-onboarding-slides.ts` and rendered to **1920×1080 PNGs** by `scripts/lib/render-onboarding-slides.ts` (SVG + sharp). Visual style: dark navy background, gold accent bar, white headline text, bullet list.

Slide PNGs are stored at:

```
onboarding-videos/slides/slide-01-welcome.png
onboarding-videos/slides/slide-02-product.png
onboarding-videos/slides/slide-03-assignment.png
onboarding-videos/slides/slide-04-stages.png
onboarding-videos/slides/slide-05-ready.png
```

Public base URL: `https://visuvrjmcoanndndimfw.supabase.co/storage/v1/object/public/onboarding-videos/slides/`

### Slide 1 — Welcome (`welcome`)

- **Title:** Welcome to Tempo
- **Subtitle:** Your First Deal Simulation
- **Bullets:**
  - Account Executive onboarding
  - One territory · One target account · One full sales cycle

### Slide 2 — Product (`product`)

- **Title:** What Is Tempo?
- **Subtitle:** Scheduling automation for appointment-based businesses
- **Bullets:**
  - Reduce costly no-shows with smart reminders
  - Free the front desk from manual scheduling
  - Capture after-hours demand automatically

### Slide 3 — Assignment (`assignment`)

- **Title:** Your Assignment
- **Subtitle:** Find the right account — then win it
- **Bullets:**
  - Research a real prospect directory in your territory
  - Qualify accounts and identify the true decision maker
  - Build outreach that earns a conversation

### Slide 4 — Stages (`stages`)

- **Title:** The Five Stages
- **Subtitle:** Prospecting → Close
- **Bullets:**
  1. Prospecting — qualify and reach out
  2. Discovery — live call to uncover pain
  3. Presentation — tailored value pitch
  4. Objections — handle pushback on a call
  5. Negotiation — close the annual contract

### Slide 5 — Ready (`ready`)

- **Title:** How to Succeed
- **Subtitle:** This is real practice — not a scripted walkthrough
- **Bullets:**
  - Follow signal, not assumptions — dead ends are part of the job
  - Substance and communication are both scored
  - Rewatch this briefing anytime · Begin when you're ready

---

## Narration Script (paired 1:1 with slides)

Defined in `scripts/config/tempo-onboarding-script.ts`. One script segment per slide; target runtime ~90 seconds (actual TTS came in shorter).

| Slide | Script |
|-------|--------|
| **welcome** | Welcome to Tempo. You've joined as an Account Executive. In this simulation, you'll run one real deal from first research to signed contract — the same scope of work you'd face in your first month on the job. |
| **product** | Tempo is scheduling automation for appointment-based businesses — dental practices, clinics, salons, and similar teams. They lose revenue to no-shows, manual front-desk work, and demand they miss after hours. Your product fixes those problems. |
| **assignment** | Your territory includes dozens of candidate accounts. Your job is to qualify the market, select the account with the strongest fit, and identify the decision maker who actually owns this purchase. |
| **stages** | You'll advance through five stages: prospecting, a live discovery call, a written presentation, objection handling, and negotiation to close. Each stage tests whether you can find signal, build trust, and move the deal forward. |
| **ready** | Nothing here is handed to you. Some paths will be dead ends — that's intentional. Rewatch this briefing anytime from your dashboard. When you're ready, start Stage One and go find your first customer. |

**Measured segment durations (HeyGen output):** 13.2s + 17.8s + 12.2s + 16.8s + 12.4s ≈ **72.5s total**

---

## What We Wanted To Do

### Target experience

A **professional onboarding briefing** that feels like a short internal sales kickoff:

1. **Slide deck on screen** — clean, easy-to-read bullets explaining Tempo, the assignment, and the five stages.
2. **Avatar III presenter** (photo avatar / digital twin) in a **picture-in-picture or presenter-over-deck** layout — speaking professionally over each slide.
3. **~90 seconds** total, one continuous video served from Supabase and played in the Tempo entry UI (`TempoOnboardingVideoModal`, entry pages).

### Intended pipeline

```
┌─────────────────────┐
│ Slide copy (TS)     │
│ tempo-onboarding-   │
│ slides.ts           │
└──────────┬──────────┘
           │ render SVG → PNG (sharp)
           ▼
┌─────────────────────┐
│ Upload slide PNGs   │
│ to Supabase         │
└──────────┬──────────┘
           │
           │  For each of 5 segments:
           ▼
┌─────────────────────┐
│ HeyGen API          │
│ POST /v3/videos     │
│ type: "avatar"      │
│ engine: avatar_iii  │
│ background: image   │  ← slide PNG URL
│ script: segment     │
└──────────┬──────────┘
           │ poll × 5
           ▼
┌─────────────────────┐
│ Download 5 MP4s     │
│ ffmpeg concat       │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Upload tempo-       │
│ welcome.mp4         │
│ → app plays video   │
└─────────────────────┘
```

### HeyGen settings used

| Setting | Value |
|---------|-------|
| Avatar | Khady Professional Office, City View (`abb82a33ff074a4781f78ae54275f78c`) |
| Type | `photo_avatar` |
| Engine | `avatar_iii` |
| Voice | `6990bd1c1293466aaf025743758623ed` (avatar default) |
| Resolution | 1080p, 16:9 |
| Background (intended) | `{ type: "image", url: <slide PNG public URL> }` |

Generator script: `scripts/generate-heygen-video.ts`  
Commit: `968c09d` on `main`

---

## What Actually Happened

### 1. Slides were created — but only as standalone PNGs

The deck renders correctly. Example: slide 1 shows "Welcome to Tempo" with bullets on a dark professional layout. These PNGs are on Supabase and viewable directly in a browser.

They were **never visible in the shipped video**.

### 2. HeyGen ignored the image background

For each segment, the API accepted `background: { type: "image", url: ... }`, but the rendered MP4s came back as **avatar-only** footage in HeyGen's default office scene (city-view window, conference table). Frame inspection of `segment-01.mp4` confirms: no slide text, no deck layout — just the presenter talking.

This is why the HeyGen dashboard shows **five separate short clips** rather than one deck-based video.

### 3. Segments were stitched locally — not in HeyGen Studio

An earlier attempt to stitch segment URLs via HeyGen Studio produced a **~10 second broken file** (likely expired URLs or studio scene behavior). The fix was **ffmpeg concat** on the downloaded segment MP4s:

```
segment-01.mp4 (13.2s)
segment-02.mp4 (17.8s)
segment-03.mp4 (12.2s)
segment-04.mp4 (16.8s)
segment-05.mp4 (12.4s)
        ↓ ffmpeg -f concat
tempo-welcome.mp4 (72.5s)
```

Segment files are also stored on Supabase at `onboarding-videos/segments/segment-0X.mp4`.

### 4. App integration works — content layout does not

- `lib/tempo-onboarding-video.ts` points to the uploaded MP4.
- `components/tempo/TempoOnboardingVideoModal.tsx` plays it on Tempo entry pages.
- Audio and narration match the script; **visual deck is missing**.

### 5. No PowerPoint file exists

"We wanted a PPT" in the product sense — a visual deck briefing. Technically we built **slide images from code**, not a `.pptx`. There is nothing to open in PowerPoint; the deck lives only in `tempo-onboarding-slides.ts` and the PNG exports.

---

## Asset Inventory

| Asset | Location | In final video? |
|-------|----------|-----------------|
| Slide PNGs (5) | `onboarding-videos/slides/` | No |
| HeyGen segments (5) | `onboarding-videos/segments/` | Yes (stitched) |
| Final MP4 | `onboarding-videos/tempo-welcome.mp4` | Yes (what app plays) |
| Captions | `tempo-welcome.srt` (stale from failed studio run) | Not wired (`TEMPO_ONBOARDING_CAPTIONS_URL = null`) |

---

## Known Issues & Failed Approaches

| Approach | Result |
|----------|--------|
| `background.type: "image"` on `type: "avatar"` + Avatar III | API accepted request; output ignored background |
| HeyGen Studio `avatar_video` scenes with image background | API error: image background not supported (only `color`) |
| HeyGen Studio stitch of segment URLs | ~10s broken output instead of ~73s |
| ffmpeg local concat of segments | Works reliably for length; does not add slides |

---

## Recommended Fix (not yet implemented)

To achieve the original presenter-over-deck goal:

1. **Option A — ffmpeg compositing (most reliable):** Generate avatar-only clips from HeyGen (or use existing segments), composite each onto the matching slide PNG (e.g. avatar in bottom-right corner, slide fills frame), then concat.
2. **Option B — HeyGen Studio layout:** Investigate studio scene types that support image/video backgrounds with explicit avatar positioning (may require different API surface than `avatar_video`).
3. **Option C — Pre-built video template:** Design slides + avatar placement in After Effects / Remotion, use HeyGen only for avatar audio/video export.

Re-run after fix:

```bash
npx tsx scripts/generate-heygen-video.ts
```

Stitch existing segments without re-burning HeyGen credits (does not fix missing slides):

```bash
npx tsx scripts/generate-heygen-video.ts --stitch-only
```

---

## Related Files

| File | Purpose |
|------|---------|
| `scripts/config/tempo-onboarding-slides.ts` | Deck copy (source of truth for slide text) |
| `scripts/config/tempo-onboarding-script.ts` | Narration per slide |
| `scripts/lib/render-onboarding-slides.ts` | PNG renderer |
| `scripts/generate-heygen-video.ts` | HeyGen + Supabase + ffmpeg pipeline |
| `lib/tempo-onboarding-video.ts` | Public URL consumed by the app |
| `components/tempo/TempoOnboardingVideoModal.tsx` | In-app video player |
