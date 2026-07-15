# Sandbox Renderer Contract

The app starts an isolated Vercel Sandbox when the user exports a video. The request route returns as soon as the detached render process starts; the browser reads progress from Neon through `GET /api/render-jobs?id=...`.

## Request

```json
{
  "jobId": "render-job-id",
  "project": { "id": "project-id", "currentVersion": {} },
  "assetBaseUrl": "https://your-vercel-app.com",
  "callbackUrl": "https://your-vercel-app.com/api/render-jobs/callback"
}
```

## Worker Steps

1. Fork the version-pinned renderer snapshot.
2. Write the immutable project input into the isolated filesystem.
3. Render MP4 through the shared Remotion composition.
4. Upload the MP4 to R2.
5. Send authenticated progress and final callbacks.
6. Stop the job Sandbox after a terminal callback.

## Callback

```json
{
  "jobId": "render-job-id",
  "status": "ready",
  "progress": 100,
  "outputR2Key": "renders/project/version/job-id.mp4",
  "sandboxName": "know-video-job-render-job-id"
}
```
