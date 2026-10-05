import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/fields")({ component: Layout });
function Layout() {
  return <Outlet />;
}
