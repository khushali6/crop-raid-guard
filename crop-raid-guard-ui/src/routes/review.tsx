import { createFileRoute } from "@tanstack/react-router";
import { Review } from "@/components/claims";
export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review detections — Crop Raid Guard" },
      { name: "description", content: "Confirm or correct detections the model was unsure about." },
      { property: "og:title", content: "Review detections — Crop Raid Guard" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Review />;
}
