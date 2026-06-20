import * as fs from "node:fs";
import * as path from "node:path";
import {
  type PaperMetadata,
  PROJECT_README,
  generateProjectReadme,
} from "@paper-baker/core";
import { getProjectDir } from "../config.js";

// The guide's text lives in @paper-baker/core (single source of truth, shared
// with the web docs page). This module only owns the filesystem write.
export { PROJECT_README, generateProjectReadme };

/**
 * Write the full guide to `paperbaker/README.md`. It sits alongside the metadata
 * and the tex it describes, so coding agents discover the reading guide via
 * search — and the root brief (helpers/root-brief.ts) links here for detail.
 */
export function writeProjectReadme(papers: PaperMetadata[], cwd?: string): void {
  fs.writeFileSync(
    path.join(getProjectDir(cwd), PROJECT_README),
    generateProjectReadme(papers),
  );
}
