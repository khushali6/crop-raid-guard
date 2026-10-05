import { createFileRoute } from "@tanstack/react-router";
import { Login } from "@/components/pages";
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Welcome back — Crop Raid Guard" },
      {
        name: "description",
        content: "Sign in to your Crop Raid Guard wildlife intelligence workspace.",
      },
      { property: "og:title", content: "Welcome back — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Sign in to your Crop Raid Guard wildlife intelligence workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: typeof search["redirect"] === "string" ? search["redirect"] : undefined,
  }),
  component: Page,
});
function Page() {
  const { redirect } = Route.useSearch();
  return redirect === undefined ? <Login /> : <Login redirect={redirect} />;
}
