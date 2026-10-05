import { createFileRoute } from "@tanstack/react-router";
import { Videos } from "@/components/pages";
export const Route = createFileRoute("/videos/")({
  head: () => ({
    meta: [
      { title: "Video library — Crop Raid Guard" },
      {
        name: "description",
        content:
          "Explore wildlife footage, filter camera-trap videos, and inspect recorded activity.",
      },
      { property: "og:title", content: "Video library — Crop Raid Guard" },
      {
        property: "og:description",
        content:
          "Explore wildlife footage, filter camera-trap videos, and inspect recorded activity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Videos />;
}
