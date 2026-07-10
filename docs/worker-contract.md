# Render Worker Contract

The app should call a worker endpoint when an edit plan is approved.

## Request

```json
{
  "jobId": "render-job-id",
  "projectId": "project-id",
  "versionId": "version-id",
  "affectedScenes": [1, 4, 5],
  "callbackUrl": "https://your-vercel-app.com/api/render-jobs/callback"
}
```

## Worker Steps

1. Validate shared secret.
2. Load project version and scenes from Neon.
3. Regenerate missing/affected assets.
4. Upload assets to R2.
5. Render MP4 through Remotion.
6. Upload MP4 to R2.
7. Send callback with final status.

## Callback

```json
{
  "jobId": "render-job-id",
  "status": "ready",
  "progress": 100,
  "outputR2Key": "renders/project/version/output.mp4",
  "renderUrl": "https://cdn.example.com/renders/project/version/output.mp4"
}
```
