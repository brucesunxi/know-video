import { getCurrentProjectSnapshot } from "@/lib/project-store";
import { WorkspaceClient } from "@/app/workspace-client";
import { authIsConfigured, getCurrentUser } from "@/lib/auth";
import { LoginScreen } from "@/app/login-screen";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    const params = await searchParams;
    return <LoginScreen configured={authIsConfigured()} error={params.auth_error} />;
  }

  const { project, messages, pendingPlan, source } = await getCurrentProjectSnapshot(currentUser.id);

  return (
    <WorkspaceClient
      currentUser={currentUser}
      initialMessages={messages}
      initialPendingPlan={pendingPlan}
      initialProject={project}
      source={source}
    />
  );
}
