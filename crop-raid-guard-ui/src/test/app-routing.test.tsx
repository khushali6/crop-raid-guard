import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
  it.each([
    "/videos",
    "/videos/camera-01",
    "/videos/camera-01/processing",
    "/fields/new",
    "/fields/north",
    "/wildlife/wild-boar",
    "/alerts",
    "/reports/weekly",
    "/upload",
    "/settings",
    "/api-docs",
    "/ask",
    "/review",
    "/claims",
    "/claims/3f1c2a4e-0000-4000-8000-000000000001",
    "/login",
    "/onboarding",
  ])("matches the screen at %s", (path) => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(router.matchRoutes(path).at(-1)?.routeId).not.toBe(rootRouteId);
  });
  it("keeps only safe search params", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const video = router.matchRoutes("/videos/abc", { t: "12.5" }).at(-1);
    expect(video?.search).toMatchObject({ t: 12.5 });
    const claims = router.matchRoutes("/claims", { event: "not-a-uuid" }).at(-1);
    expect((claims?.search as { event?: string }).event).toBeUndefined();
  });
});
