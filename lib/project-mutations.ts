import { getSql, hasDatabaseUrl } from "@/lib/db";
import { applyEditPlan } from "@/lib/video-brain";
import type { ChatMessage, EditPlan, Project, ProjectVersion, Scene } from "@/lib/types";

type IdRow = { id: string };

export function canPersist() {
  return hasDatabaseUrl();
}

async function insertScenes(versionId: string, scenes: Scene[]) {
  const sql = getSql();

  for (const scene of scenes) {
    await sql`
      insert into scenes (
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
        ${versionId},
        ${scene.sceneNumber},
        ${scene.title},
        ${scene.voiceover},
        ${scene.visualPrompt},
        ${scene.motionPrompt},
        ${scene.durationSeconds},
        ${JSON.stringify(scene.style)}
      )
    `;
  }
}

export async function persistGeneratedProject(params: {
  prompt: string;
  project: Project;
  engine: string;
}): Promise<{ project: Project; messages: ChatMessage[] }> {
  if (!canPersist()) {
    const messages: ChatMessage[] = [
      {
        id: crypto.randomUUID(),
        role: "user",
        type: "text",
        content: params.prompt
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "version",
        content: `Generated ${params.project.currentVersion.scenes.length} scenes with ${params.engine}.`,
        versionId: params.project.currentVersion.id
      }
    ];
    return { project: params.project, messages };
  }

  const sql = getSql();
  const projectRows = await sql`
    insert into projects (title)
    values (${params.project.title})
    returning id
  ` as IdRow[];
  const projectId = projectRows[0].id;

  const versionRows = await sql`
    insert into project_versions (
      project_id,
      status,
      scene_plan_json,
      duration_seconds
    )
    values (
      ${projectId},
      ${params.project.currentVersion.status},
      ${JSON.stringify(params.project.currentVersion.scenes)},
      ${params.project.currentVersion.durationSeconds}
    )
    returning id
  ` as IdRow[];
  const versionId = versionRows[0].id;

  await insertScenes(versionId, params.project.currentVersion.scenes);

  await sql`
    update projects
    set current_version_id = ${versionId}, updated_at = now()
    where id = ${projectId}
  `;

  const userRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${projectId}, ${versionId}, 'user', 'text', ${params.prompt})
    returning id
  ` as IdRow[];

  const assistantContent = `Generated ${params.project.currentVersion.scenes.length} scenes with ${params.engine}. You can now revise any scene through chat.`;
  const assistantRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${projectId}, ${versionId}, 'assistant', 'version', ${assistantContent})
    returning id
  ` as IdRow[];

  const project: Project = {
    ...params.project,
    id: projectId,
    currentVersion: {
      ...params.project.currentVersion,
      id: versionId,
      scenes: params.project.currentVersion.scenes
    }
  };

  return {
    project,
    messages: [
      {
        id: userRows[0].id,
        role: "user",
        type: "text",
        content: params.prompt,
        versionId
      },
      {
        id: assistantRows[0].id,
        role: "assistant",
        type: "version",
        content: assistantContent,
        versionId
      }
    ]
  };
}

export async function loadVersion(versionId: string): Promise<ProjectVersion | undefined> {
  if (!canPersist()) return undefined;

  const sql = getSql();
  const versions = await sql`
    select id, status, duration_seconds, render_url, created_at
    from project_versions
    where id = ${versionId}
    limit 1
  ` as Array<{
    id: string;
    status: ProjectVersion["status"];
    duration_seconds: number;
    render_url: string | null;
    created_at: Date | string;
  }>;

  const version = versions[0];
  if (!version) return undefined;

  const scenes = await sql`
    select id, scene_number, title, voiceover, visual_prompt, motion_prompt, duration_seconds, style_json
    from scenes
    where version_id = ${versionId}
    order by scene_number asc
  ` as Array<{
    id: string;
    scene_number: number;
    title: string;
    voiceover: string;
    visual_prompt: string;
    motion_prompt: string;
    duration_seconds: number;
    style_json: unknown;
  }>;

  return {
    id: version.id,
    label: "current",
    status: version.status,
    createdAt: new Date(version.created_at).toISOString(),
    durationSeconds: version.duration_seconds,
    renderUrl: version.render_url ?? undefined,
    scenes: scenes.map((scene) => ({
      id: scene.id,
      sceneNumber: scene.scene_number,
      title: scene.title,
      voiceover: scene.voiceover,
      visualPrompt: scene.visual_prompt,
      motionPrompt: scene.motion_prompt,
      durationSeconds: scene.duration_seconds,
      style: scene.style_json as Scene["style"],
      assets: []
    }))
  };
}

export async function persistEditPlan(params: {
  projectId: string;
  request: string;
  versionId: string;
  editPlan: EditPlan;
  engine: string;
}): Promise<{ editPlan: EditPlan; messages: ChatMessage[] }> {
  if (!canPersist()) {
    return {
      editPlan: params.editPlan,
      messages: [
        { id: crypto.randomUUID(), role: "user", type: "text", content: params.request },
        { id: crypto.randomUUID(), role: "assistant", type: "plan", content: params.editPlan.summary, editPlan: params.editPlan }
      ]
    };
  }

  const sql = getSql();
  const userRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${params.projectId}, ${params.versionId}, 'user', 'text', ${params.request})
    returning id
  ` as IdRow[];

  const planRows = await sql`
    insert into edit_plans (
      project_id,
      base_version_id,
      user_message_id,
      status,
      summary,
      affected_scenes_json,
      patch_json,
      preview_json
    )
    values (
      ${params.projectId},
      ${params.versionId},
      ${userRows[0].id},
      'proposed',
      ${params.editPlan.summary},
      ${JSON.stringify(params.editPlan.affectedScenes)},
      ${JSON.stringify(params.editPlan)},
      ${JSON.stringify({ engine: params.engine })}
    )
    returning id
  ` as IdRow[];

  const editPlan: EditPlan = {
    ...params.editPlan,
    id: planRows[0].id,
    baseVersionId: params.versionId
  };

  const assistantRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content, metadata_json)
    values (
      ${params.projectId},
      ${params.versionId},
      'assistant',
      'plan',
      ${editPlan.summary},
      ${JSON.stringify({ editPlan, engine: params.engine })}
    )
    returning id
  ` as IdRow[];

  return {
    editPlan,
    messages: [
      { id: userRows[0].id, role: "user", type: "text", content: params.request, versionId: params.versionId },
      { id: assistantRows[0].id, role: "assistant", type: "plan", content: editPlan.summary, versionId: params.versionId, editPlan }
    ]
  };
}

export async function applyPersistedEditPlan(params: {
  project: Project;
  editPlan: EditPlan;
}): Promise<{ project: Project; message: ChatMessage; renderJobId?: string }> {
  const nextProject = applyEditPlan(params.project, params.editPlan);

  if (!canPersist()) {
    return {
      project: nextProject,
      message: {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "version",
        content: `${nextProject.currentVersion.label} applied · render job queued`,
        versionId: nextProject.currentVersion.id
      },
      renderJobId: crypto.randomUUID()
    };
  }

  const sql = getSql();
  const versionRows = await sql`
    insert into project_versions (
      project_id,
      parent_version_id,
      status,
      scene_plan_json,
      duration_seconds
    )
    values (
      ${params.project.id},
      ${params.project.currentVersion.id},
      'planning',
      ${JSON.stringify(nextProject.currentVersion.scenes)},
      ${nextProject.currentVersion.durationSeconds}
    )
    returning id
  ` as IdRow[];
  const versionId = versionRows[0].id;

  await insertScenes(versionId, nextProject.currentVersion.scenes);

  await sql`
    update projects
    set current_version_id = ${versionId}, updated_at = now()
    where id = ${params.project.id}
  `;

  await sql`
    update edit_plans
    set status = 'applied'
    where id = ${params.editPlan.id}
  `;

  const jobRows = await sql`
    insert into render_jobs (project_id, version_id, status, progress)
    values (${params.project.id}, ${versionId}, 'queued', 0)
    returning id
  ` as IdRow[];

  const content = `${nextProject.currentVersion.label} applied · render job ${jobRows[0].id.slice(0, 8)} queued`;
  const messageRows = await sql`
    insert into chat_messages (project_id, version_id, role, message_type, content)
    values (${params.project.id}, ${versionId}, 'assistant', 'version', ${content})
    returning id
  ` as IdRow[];

  return {
    project: {
      ...nextProject,
      currentVersion: {
        ...nextProject.currentVersion,
        id: versionId
      }
    },
    message: {
      id: messageRows[0].id,
      role: "assistant",
      type: "version",
      content,
      versionId
    },
    renderJobId: jobRows[0].id
  };
}
