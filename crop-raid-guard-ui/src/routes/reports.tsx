import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/reports")({ component: Layout });
function Layout() {
  return <Outlet />;
}
