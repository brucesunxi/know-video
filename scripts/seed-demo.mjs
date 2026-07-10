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
    title: "Three-Phase Governance Architecture",
    voiceover: "VYBEA is a project-level accountability governance operating environment built for entertainment IPs.",
    visualPrompt: "Dark premium product dashboard with three governance columns, cyan connectors, and executive console styling.",
    motionPrompt: "Panels glide forward, cyan data lines connect the columns, and a central status node pulses softly.",
    durationSeconds: 7
  },
  {
    id: "00000000-0000-4000-8000-000000001002",
    sceneNumber: 2,
    title: "Project Cycle Map",
    voiceover: "It organizes decisions, tasks, approvals, and risks into one shared operating layer.",
    visualPrompt: "Circular project map on a dark navy board with small nodes orbiting a central governance hub.",
    motionPrompt: "Nodes orbit slowly, then lock into phase markers as labels fade in.",
    durationSeconds: 6
  },
  {
    id: "00000000-0000-4000-8000-000000001003",
    sceneNumber: 3,
    title: "Accountability Flow",
    voiceover: "Each team member sees the exact responsibility path from strategy to execution.",
    visualPrompt: "Dark interface with vertical accountability lanes, teal milestones, and connected owner cards.",
    motionPrompt: "Milestones drop into place, ownership cards slide in, and connecting lines trace the flow.",
    durationSeconds: 7
  },
  {
    id: "00000000-0000-4000-8000-000000001004",
    sceneNumber: 4,
    title: "Executive Review",
    voiceover: "Leaders can review progress, identify blockers, and keep creative work aligned with business outcomes.",
    visualPrompt: "Dark executive review dashboard with project cards, risk badges, approval indicators, and a large progress panel.",
    motionPrompt: "Project cards fan into the frame, risk badges resolve, and an approval panel slides up.",
    durationSeconds: 8
  },
  {
    id: "00000000-0000-4000-8000-000000001005",
    sceneNumber: 5,
    title: "VYBEA Closing Mark",
    voiceover: "The result is a clearer governance rhythm for complex entertainment projects.",
    visualPrompt: "Dark closing card with the VYBEA wordmark centered and a subtle constellation of governance points.",
    motionPrompt: "The wordmark fades in, points connect behind it, and the scene settles into a calm hold.",
    durationSeconds: 6
  }
];

await sql`
  insert into projects (id, title, current_version_id)
  values (${projectId}, 'VYBEA Governance Platform', null)
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
