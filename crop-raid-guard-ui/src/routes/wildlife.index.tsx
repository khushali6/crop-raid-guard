import { createFileRoute } from "@tanstack/react-router";
import { Wildlife } from "@/components/pages";
export const Route = createFileRoute("/wildlife/")({
  head: () => ({
    meta: [
      { title: "Wildlife neighbours — Crop Raid Guard" },
      {
        name: "description",
        content: "Discover species recorded across your monitored agricultural fields.",
      },
      { property: "og:title", content: "Wildlife neighbours — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Discover species recorded across your monitored agricultural fields.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Wildlife />;
}
