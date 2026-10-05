import { createFileRoute } from "@tanstack/react-router";
import { FieldDetail } from "@/components/pages";
export const Route = createFileRoute("/fields/$id")({
  head: () => ({
    meta: [
      { title: "Field intelligence — Crop Raid Guard" },
      {
        name: "description",
        content: "Explore a field’s wildlife activity, species patterns, cameras, and evidence.",
      },
      { property: "og:title", content: "Field intelligence — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Explore a field’s wildlife activity, species patterns, cameras, and evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  const { id } = Route.useParams();
  return <FieldDetail id={id} />;
}
