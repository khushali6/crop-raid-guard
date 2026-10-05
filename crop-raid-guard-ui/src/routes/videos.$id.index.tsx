import { createFileRoute } from "@tanstack/react-router";
import { VideoDetail } from "@/components/pages";
export const Route = createFileRoute("/videos/$id/")({
  head: () => ({
    meta: [
      { title: "Footage insights — Crop Raid Guard" },
      {
        name: "description",
        content:
          "Explore camera-trap evidence, wildlife event timelines, and crop-raid risk insights.",
      },
      { property: "og:title", content: "Footage insights — Crop Raid Guard" },
      {
        property: "og:description",
        content:
          "Explore camera-trap evidence, wildlife event timelines, and crop-raid risk insights.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { t?: number | undefined } => {
    const t = Number(search["t"]);
    return { t: search["t"] !== undefined && Number.isFinite(t) && t >= 0 ? t : undefined };
  },
  component: Page,
});
function Page() {
  const { id } = Route.useParams();
  const { t } = Route.useSearch();
  return t === undefined ? <VideoDetail id={id} /> : <VideoDetail id={id} t={t} />;
}
