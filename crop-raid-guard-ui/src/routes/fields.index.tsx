import { createFileRoute } from "@tanstack/react-router";
import { Fields } from "@/components/pages";
export const Route = createFileRoute("/fields/")({
  head: () => ({
    meta: [
      { title: "Your fields — Crop Raid Guard" },
      {
        name: "description",
        content: "Monitor agricultural fields, cameras, wildlife activity, and risk patterns.",
      },
      { property: "og:title", content: "Your fields — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Monitor agricultural fields, cameras, wildlife activity, and risk patterns.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Fields />;
}
