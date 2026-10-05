import { createFileRoute } from "@tanstack/react-router";
import { AskPage } from "@/components/agent";
export const Route = createFileRoute("/ask")({
  head: () => ({
    meta: [
      { title: "Ask your fields — Crop Raid Guard" },
      {
        name: "description",
        content:
          "Ask about wildlife activity, crop insurance schemes and claims, answered from your own footage with sources.",
      },
      { property: "og:title", content: "Ask your fields — Crop Raid Guard" },
      { property: "og:type", content: "website" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { q?: string | undefined } => ({
    q:
      typeof search["q"] === "string" && search["q"].trim()
        ? search["q"].slice(0, 2000)
        : undefined,
  }),
  component: Page,
});
function Page() {
  const { q } = Route.useSearch();
  return q === undefined ? <AskPage /> : <AskPage key={q} initial={q} />;
}
