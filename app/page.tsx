import { getCurrentProjectSnapshot } from "@/lib/project-store";
import { WorkspaceClient } from "@/app/workspace-client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { project, messages, pendingPlan, source } = await getCurrentProjectSnapshot();

  return (
    <WorkspaceClient
      initialMessages={messages}
      initialPendingPlan={pendingPlan}
      initialProject={project}
      source={source}
    />
  );
}
