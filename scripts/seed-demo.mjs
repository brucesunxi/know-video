import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Add it to .env.local or your Vercel environment.");
  process.exit(1);
}

const sql = neon(databaseUrl);

const projectId = "00000000-0000-4000-8000-000000000001";
const versionId = "00000000-0000-4000-8000-000000000101";

const scenes = [
  {
    id: "00000000-0000-4000-8000-000000001001",
    sceneNumber: 1,
    title: "Prompt to Video Brief",
    voiceover: "Know Video turns a single production request into a structured video brief, script, and scene plan.",
    visualPrompt: "Premium product interface showing a text prompt transforming into a concise video production brief.",
    motionPrompt: "The prompt expands into structured cards for audience, goal, tone, and duration.",
    durationSeconds: 7
  },
  {
    id: "00000000-0000-4000-8000-000000001002",
    sceneNumber: 2,
    title: "Scene Breakdown",
    voiceover: "The system breaks the idea into scenes, each with narration, visual direction, motion, and timing.",
    visualPrompt: "Storyboard timeline with five scene cards, voiceover snippets, and motion prompt indicators.",
    motionPrompt: "Scene cards slide into a timeline and connect with subtle teal progress lines.",
    durationSeconds: 6
  },
  {
    id: "00000000-0000-4000-8000-000000001003",
    sceneNumber: 3,
    title: "Conversational Editing",
    voiceover: "After the first version, creators can ask for precise changes in natural language.",
    visualPrompt: "Split editor with video preview on the left and chat-based edit instructions on the right.",
    motionPrompt: "A user message becomes a before-and-after edit plan with highlighted affected scenes.",
    durationSeconds: 7
  },
  {
    id: "00000000-0000-4000-8000-000000001004",
    sceneNumber: 4,
    title: "Version Control",
    voiceover: "Every accepted change creates a new version, so teams can iterate without losing the original direction.",
    visualPrompt: "Clean version history panel with accepted edit plans, render status, and scene diffs.",
    motionPrompt: "Version chips stack upward while the current version is promoted into the preview.",
    durationSeconds: 8
  },
  {
    id: "00000000-0000-4000-8000-000000001005",
    sceneNumber: 5,
    title: "Know Video Export",
    voiceover: "Know Video brings planning, generation, review, and export into one focused production workflow.",
    visualPrompt: "Dark closing card with the Know Video wordmark, export button, and completed render timeline.",
    motionPrompt: "The Know Video mark fades in as the final render progress reaches complete.",
    durationSeconds: 6
  }
];

await sql`
  insert into projects (id, title, current_version_id)
  values (${projectId}, 'Know Video Product Demo', null)
  on conflict (id) do update set title = excluded.title, updated_at = now()
`;

await sql`
  insert into project_versions (id, project_id, status, scene_plan_json, duration_seconds)
  values (${versionId}, ${projectId}, 'ready', ${JSON.stringify({ scenes })}::jsonb, 34)
  on conflict (id) do update set scene_plan_json = excluded.scene_plan_json, duration_seconds = excluded.duration_seconds
`;

for (const scene of scenes) {
  await sql`
    insert into scenes (
      id,
      version_id,
      scene_number,
      title,
      voiceover,
      visual_prompt,
      motion_prompt,
      duration_seconds,
      style_json
    )
    values (
      ${scene.id},
      ${versionId},
      ${scene.sceneNumber},
      ${scene.title},
      ${scene.voiceover},
      ${scene.visualPrompt},
      ${scene.motionPrompt},
      ${scene.durationSeconds},
      ${JSON.stringify({
        theme: "premium dark",
        palette: ["#07111d", "#38d5e5", "#f8fafc"],
        mood: "strategic"
      })}::jsonb
    )
    on conflict (version_id, scene_number) do update set
      title = excluded.title,
      voiceover = excluded.voiceover,
      visual_prompt = excluded.visual_prompt,
      motion_prompt = excluded.motion_prompt,
      duration_seconds = excluded.duration_seconds,
      style_json = excluded.style_json
  `;
}

await sql`
  update projects
  set current_version_id = ${versionId}, updated_at = now()
  where id = ${projectId}
`;

await sql`
  delete from chat_messages
  where project_id = ${projectId}
`;

await sql`
  insert into chat_messages (project_id, version_id, role, message_type, content)
  values
    (${projectId}, ${versionId}, 'assistant', 'version', 'Previous version'),
    (${projectId}, ${versionId}, 'user', 'text', 'Please adjust the style to a light color scheme.'),
    (${projectId}, ${versionId}, 'assistant', 'plan', 'Adapt the entire video to a premium, high-contrast light color scheme while keeping the current structure, timing, and voiceover intact.')
  on conflict do nothing
`;

console.log("Demo project seeded.");
