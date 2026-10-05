import { createFileRoute } from "@tanstack/react-router";
import { WildlifeDetail } from "@/components/pages";
export const Route = createFileRoute("/wildlife/$species")({
  head: () => ({
    meta: [
      { title: "Species intelligence — Crop Raid Guard" },
      {
        name: "description",
        content: "Explore species activity patterns, recorded encounters, and field evidence.",
      },
      { property: "og:title", content: "Species intelligence — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Explore species activity patterns, recorded encounters, and field evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  const { species } = Route.useParams();
  return <WildlifeDetail species={species} />;
}
