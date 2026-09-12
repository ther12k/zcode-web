// ZWUI-006: route identity and strict state ownership.
//
// URL owns: selected project root (path param), selected session (path param),
// settings/palette open state (search params). Refresh/deep-link restores view.
// Session storage owns: per-session drafts, device prefs.
// Memory owns (reducer): the run — a running job is bound to its jobId, NOT
// to the selected route; navigating away never retargets or cancels it.

import {
  createRootRoute, createRoute, createRouter, redirect,
} from "@tanstack/react-router";
import { App } from "./app";
import { ProjectView } from "./routes/project";
import { SessionView } from "./routes/session";
import { SettingsView } from "./routes/settings";

const rootRoute = createRootRoute({ component: App });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // default workspace view
    throw redirect({ to: "/w/$workspace", params: { workspace: "default" } });
  },
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspace",
  component: ProjectView,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspace/s/$sessionId",
  component: SessionView,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsView,
});

const routeTree = rootRoute.addChildren([indexRoute, projectRoute, sessionRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
