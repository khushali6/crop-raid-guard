import { createFileRoute } from "@tanstack/react-router";
import { Claims } from "@/components/claims";
export const Route = createFileRoute("/claims/")({
  head: () => ({
    meta: [
      { title: "Claims — Crop Raid Guard" },
      {
        name: "description",
        content:
          "Prepare signed evidence and crop-loss claims within the 72-hour reporting window.",
      },
      { property: "og:title", content: "Claims — Crop Raid Guard" },
      { property: "og:type", content: "website" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { event?: string | undefined } => ({
    event:
      typeof search["event"] === "string" && /^[0-9a-f-]{36}$/i.test(search["event"])
        ? search["event"]
        : undefined,
  }),
  component: Page,
});
function Page() {
  const { event } = Route.useSearch();
  return event === undefined ? <Claims /> : <Claims event={event} />;
}
