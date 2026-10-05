import { createFileRoute } from "@tanstack/react-router";
import { Overview } from "@/components/pages";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Crop Raid Guard" },
      {
        name: "description",
        content:
          "Observe wildlife activity, field risks, and camera-trap insights across your fields.",
      },
      { property: "og:title", content: "Overview — Crop Raid Guard" },
      {
        property: "og:description",
        content:
          "Observe wildlife activity, field risks, and camera-trap insights across your fields.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Overview />;
}
