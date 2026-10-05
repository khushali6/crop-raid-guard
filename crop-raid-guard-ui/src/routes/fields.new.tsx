import { createFileRoute } from "@tanstack/react-router";
import { NewField } from "@/components/pages";
export const Route = createFileRoute("/fields/new")({
  head: () => ({
    meta: [
      { title: "Create field — Crop Raid Guard" },
      { name: "description", content: "Add a new field to your wildlife monitoring workspace." },
      { property: "og:title", content: "Create field — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Add a new field to your wildlife monitoring workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <NewField />;
}
