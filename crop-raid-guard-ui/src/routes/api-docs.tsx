import { createFileRoute } from "@tanstack/react-router";
import { ApiDocs } from "@/components/pages";
export const Route = createFileRoute("/api-docs")({
  head: () => ({
    meta: [
      { title: "Developer documentation — Crop Raid Guard" },
      {
        name: "description",
        content: "Explore illustrative Crop Raid Guard API integration examples.",
      },
      { property: "og:title", content: "Developer documentation — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Explore illustrative Crop Raid Guard API integration examples.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <ApiDocs />;
}
