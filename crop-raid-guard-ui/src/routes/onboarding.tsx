import { createFileRoute } from "@tanstack/react-router";
import { Onboarding } from "@/components/pages";
export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Get acquainted — Crop Raid Guard" },
      { name: "description", content: "Set up your sample wildlife field monitoring workspace." },
      { property: "og:title", content: "Get acquainted — Crop Raid Guard" },
      {
        property: "og:description",
        content: "Set up your sample wildlife field monitoring workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Page,
});
function Page() {
  return <Onboarding />;
}
