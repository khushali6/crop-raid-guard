import { createFileRoute } from "@tanstack/react-router";
import { Alerts } from "@/components/pages";
export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Wildlife alerts — Crop Raid Guard" },
      {
        name: "description",
        content: "Review recurring wildlife activity and significant field risk patterns.",
      },
      { property: "og:title", content: "Wildlife alerts — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Review recurring wildlife activity and significant field risk patterns.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Alerts />;
}
