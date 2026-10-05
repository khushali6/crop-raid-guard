import { createFileRoute } from "@tanstack/react-router";
import { Reports } from "@/components/pages";
export const Route = createFileRoute("/reports/")({
  head: () => ({
    meta: [
      { title: "Field reports — Crop Raid Guard" },
      {
        name: "description",
        content: "Explore weekly wildlife reports and field activity summaries.",
      },
      { property: "og:title", content: "Field reports — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Explore weekly wildlife reports and field activity summaries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Reports />;
}
