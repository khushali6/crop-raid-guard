import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/pages";
export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Workspace settings — Crop Raid Guard" },
      {
        name: "description",
        content: "Manage profile, notification, privacy, and retention preferences.",
      },
      { property: "og:title", content: "Workspace settings — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Manage profile, notification, privacy, and retention preferences.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <SettingsPage />;
}
