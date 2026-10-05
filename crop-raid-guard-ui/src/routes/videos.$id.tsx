import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/videos/$id")({ component: Layout });
function Layout() {
  return <Outlet />;
}
