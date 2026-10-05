import { createFileRoute } from "@tanstack/react-router";
import { ClaimDetail } from "@/components/claims";
export const Route = createFileRoute("/claims/$id")({
  head: () => ({
    meta: [
      { title: "Claim — Crop Raid Guard" },
      {
        name: "description",
        content: "Evidence, claim text and filing checklist for a crop-loss claim.",
      },
    ],
  }),
  component: Page,
});
function Page() {
  const { id } = Route.useParams();
  return <ClaimDetail id={id} />;
}
