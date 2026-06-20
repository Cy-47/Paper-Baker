import { ArxivProvider } from "@paper-baker/providers";

// The browser can't call export.arxiv.org directly (no CORS headers), so point
// the provider at the same-origin dev proxy (see vite.config.ts). In production
// this path should be served by a Cloud Function. Reusing ArxivProvider keeps
// search + metadata parsing identical to the CLI.
export const arxiv = new ArxivProvider("/arxiv-api/query");
