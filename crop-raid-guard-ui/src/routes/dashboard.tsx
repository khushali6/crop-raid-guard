import { createFileRoute } from "@tanstack/react-router";
import { Overview } from "@/components/pages";
export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Field overview — Crop Raid Guard" },
      { name: "description", content: "Explore your wildlife intelligence workspace." },
      { property: "og:title", content: "Field overview — Crop Raid Guard" },
      { property: "og:description", content: "Explore your wildlife intelligence workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Overview />;
}
