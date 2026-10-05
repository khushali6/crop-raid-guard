import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/wildlife")({ component: Layout });
function Layout() {
  return <Outlet />;
}
