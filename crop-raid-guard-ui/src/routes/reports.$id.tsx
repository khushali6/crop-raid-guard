import { createFileRoute } from "@tanstack/react-router";
import { ReportDetail } from "@/components/pages";
export const Route = createFileRoute("/reports/$id")({
  head: () => ({
    meta: [
      { title: "Weekly field report — Crop Raid Guard" },
      {
        name: "description",
        content: "Read the weekly wildlife activity report and supporting field observations.",
      },
      { property: "og:title", content: "Weekly field report — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Read the weekly wildlife activity report and supporting field observations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  const { id } = Route.useParams();
  return <ReportDetail id={id} />;
}
