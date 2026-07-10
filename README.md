# Know Video Studio

AI conversational video generation and scene-based editing studio.

This project is the first implementation pass for a Knowlify-style workflow:

- Generate a structured `scene_plan`
- Render a video draft
- Let the user edit through conversation
- Produce an `edit_plan` with scene-level before/after diffs
- Confirm the plan
- Regenerate only affected scene assets
- Save every result as a version

## Stack

- App: Next.js on Vercel
- Database: Neon Postgres
- Storage: Cloudflare R2
- AI: OpenAI-compatible planner/generator layer
- Render: external Remotion worker

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

The MVP can run without model keys by falling back to local planning rules. Production generation uses:

- `DATABASE_URL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL=deepseek-v4-flash`
- `OPENAI_API_KEY` for fallback and future vision/video-related work
- R2 credentials: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `RENDER_WORKER_URL`

Text planning is routed to DeepSeek flash first for cost control. The code intentionally forces the DeepSeek model to `deepseek-v4-flash` even if a different `DEEPSEEK_MODEL` value is supplied.

## Core Model

```txt
Project
  Version
    Scene
      SceneAsset
  ChatMessage
  EditPlan
  RenderJob
```

The important design decision is that every conversational edit creates an `edit_plan` first. The app previews affected scenes and asks for approval before generating new assets or rendering a new version.

## Database

Apply the schema in `db/schema.sql` to Neon.

```bash
npm run db:init
npm run db:seed
```

`db:init` applies the schema. `db:seed` inserts the demo VYBEA project used by the current editor screen.

The app reads from Neon when `DATABASE_URL` is configured. If no project exists or the database is unavailable, it falls back to mock data so the UI still runs.

## API Routes

- `POST /api/projects`
  - Input: `{ "prompt": "..." }`
  - Output: generated storyboard project persisted to Neon

- `POST /api/edit-plan`
  - Input: `{ "projectId": "...", "versionId": "...", "request": "..." }`
  - Output: structured edit plan persisted to Neon with affected scenes and before/after diff data

- `POST /api/edit-plan/apply`
  - Input: `{ "project": {...}, "editPlan": {...} }`
  - Output: new project version and queued render job

- `POST /api/render-jobs`
  - Input: `{ "projectId": "...", "versionId": "...", "affectedScenes": [1,2] }`
  - Output: queued render job

- `POST /api/assets/upload`
  - Input: multipart `file`
  - Output: R2 key and asset metadata

## Next Milestones

1. Add the Remotion/FFmpeg worker service for MP4 rendering.
2. Add OpenAI vision or another multimodal model for image/reference analysis.
3. Generate scene thumbnails and store them in R2.
4. Add authentication and per-user project ownership.
