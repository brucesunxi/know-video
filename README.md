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
- Preview and render: one shared Remotion composition
- Encoding: FFmpeg / H.264 MP4 / AAC
- Render runtime: isolated Vercel Sandbox jobs

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

The MVP can run without model keys by falling back to local planning rules. Production generation uses:

- `DATABASE_URL`
- Primary text-planning model credentials
- `OPENAI_API_KEY` for fallback and future vision/video-related work
- R2 credentials: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
- `WORKER_SHARED_SECRET` for authenticated render callbacks

Vercel Sandbox authentication is automatic on deployments through Vercel OIDC. No Google Cloud project or long-lived Vercel access token is required.

Text planning is routed through the low-cost primary planner first, with OpenAI reserved for fallback and future multimodal/video-related work.

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

`db:init` applies the schema. `db:seed` inserts the demo Know Video project used by the current editor screen.

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
  - Input: `{ "projectId": "...", "versionId": "..." }`
  - Output: queued render job
- `GET /api/render-jobs?projectId=...`
  - Returns the latest export jobs across all versions of a project
- `DELETE /api/render-jobs`
  - Cancels a queued/running export and terminates its isolated render sandbox

- `POST /api/assets/upload`
  - Input: multipart `file`
  - Output: R2 key and asset metadata
- `POST /api/assets/upload-url`
  - Input: project, version, scene, filename, size, and content type
  - Output: a 15-minute signed R2 upload URL for files larger than 4 MB
- `POST /api/assets/attach`
  - Binds a completed direct upload to the selected scene and current version
- `POST /api/assets/detach`
  - Removes a scene asset from the current version without deleting history

## Next Milestones

1. Add generated video clips selectively for motion-critical scenes.
2. Add authentication and per-user project ownership.
3. Add reusable music tracks and automatic voice/music ducking.

## Renderer

The renderer shares the exact composition used by the browser player. The first export for a deployment creates a version-pinned Vercel Sandbox, installs Chromium with its Amazon Linux runtime libraries, and stores a seven-day base snapshot. Each export then forks that snapshot into an isolated job, renders a 1920x1080 H.264/AAC MP4, uploads it to R2, reports progress through the authenticated callback route, and shuts down.

`WORKER_SHARED_SECRET` must be present in the Vercel project. Only R2 credentials and this callback secret are passed to render jobs; model credentials remain in the application runtime.

Files up to 4 MB use the Vercel upload route. Larger files upload directly from the browser to a short-lived signed R2 URL and support progress reporting up to 500 MB. Apply [`docs/r2-cors.json`](docs/r2-cors.json) to the production bucket CORS policy so the canonical production domain can send `PUT` requests. Asset reads support HTTP byte ranges, which keeps uploaded video seeking and Remotion rendering stable without making the bucket public.
