import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The e2e suite runs its own Vite on an offset port (E2E_WEB_PORT) so it
    // never reuses or clashes with the dev server on 5173. Unset → default 5173.
    ...(process.env.E2E_WEB_PORT
      ? { port: Number(process.env.E2E_WEB_PORT), strictPort: true }
      : {}),
    proxy: {
      // arxiv's API sends no CORS headers, so the browser can't call it
      // directly. Proxy through the dev server (same-origin) instead. In
      // production this path should point at a Cloud Function doing the same.
      "/arxiv-api": {
        target: "https://export.arxiv.org/api",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/arxiv-api/, ""),
      },
      // In production, Firebase Hosting rewrites /api/<fn>/** to each Cloud
      // Function. Local dev/e2e has no hosting layer, so map the same
      // same-origin /api/* paths onto the Functions emulator (one entry per
      // function). The handlers' routePath() tolerates the stripped prefix, so
      // routing is identical to production.
      ...Object.fromEntries(
        [
          ["projects", "projectsApi"],
          ["papers", "papersApi"],
          ["device", "deviceApi"],
          ["library", "libraryApi"],
        ].map(([mount, fn]) => [
          `/api/${mount}`,
          {
            // Defaults to the standard Functions emulator; the e2e suite sets
            // E2E_FUNCTIONS_PORT to point at its isolated emulator instead.
            target: `http://127.0.0.1:${process.env.E2E_FUNCTIONS_PORT ?? 5001}`,
            changeOrigin: true,
            rewrite: (path: string) =>
              path.replace(`/api/${mount}`, `/paper-baker/us-central1/${fn}`),
          },
        ]),
      ),
    },
  },
});
