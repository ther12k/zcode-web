// Route identity (ZWUI-006): /w/:workspace (new chat in cwd) and
// /w/:workspace/s/:sessionId (continue). workspace = encoded absolute dir.
// The root route is a pure pass-through — App renders exactly once.
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { App } from "./App";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspace",
  component: App,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspace/s/$sessionId",
  component: App,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: App,
});

const routeTree = rootRoute.addChildren([indexRoute, workspaceRoute, sessionRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
