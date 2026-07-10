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

The MVP runs with mock data. Real generation requires:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- R2 credentials
- `RENDER_WORKER_URL`

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

- `POST /api/edit-plan`
  - Input: `{ "request": "...", "versionId": "..." }`
  - Output: structured edit plan with affected scenes and before/after diff data

- `POST /api/render-jobs`
  - Input: `{ "projectId": "...", "versionId": "...", "affectedScenes": [1,2] }`
  - Output: queued render job

## Next Milestones

1. Persist projects, versions, scenes, and messages in Neon.
2. Replace the mock edit planner with an OpenAI structured-output planner.
3. Add R2 uploads for scene images, audio, thumbnails, and renders.
4. Add a Remotion worker service for MP4 rendering.
5. Add approval flow that creates a new version from an accepted edit plan.
