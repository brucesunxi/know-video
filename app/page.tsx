import { getCurrentProjectSnapshot } from "@/lib/project-store";
import { WorkspaceClient } from "@/app/workspace-client";

export default async function Home() {
  const { project, messages, source } = await getCurrentProjectSnapshot();

  return <WorkspaceClient initialProject={project} initialMessages={messages} source={source} />;
}
