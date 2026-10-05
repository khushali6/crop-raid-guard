import { createFileRoute } from "@tanstack/react-router";
import { UploadPage } from "@/components/pages";
export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload footage — Crop Raid Guard" },
      {
        name: "description",
        content: "Select camera-trap MP4 footage and preview a wildlife analysis workflow.",
      },
      { property: "og:title", content: "Upload footage — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Select camera-trap MP4 footage and preview a wildlife analysis workflow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <UploadPage />;
}
