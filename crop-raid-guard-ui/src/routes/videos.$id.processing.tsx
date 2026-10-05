import { createFileRoute } from "@tanstack/react-router";
import { Processing } from "@/components/pages";
export const Route = createFileRoute("/videos/$id/processing")({
  head: () => ({
    meta: [
      { title: "Analysis preview — Crop Raid Guard" },
      { name: "description", content: "Follow the sample wildlife video analysis workflow." },
      { property: "og:title", content: "Analysis preview — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Follow the sample wildlife video analysis workflow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  const { id } = Route.useParams();
  return <Processing id={id} />;
}
