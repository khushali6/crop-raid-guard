import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/claims")({ component: Layout });
function Layout() {
  return <Outlet />;
}
