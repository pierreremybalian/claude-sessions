import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR } from "./config.js";

export const CLAUDE_DIR = path.join(os.homedir(), ".claude");
export const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
export const HISTORY_FILE = path.join(CLAUDE_DIR, "history.jsonl");

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");
export const CACHE_FILE = path.join(CONFIG_DIR, "index.json");
export const DIST_DIR = path.join(REPO_ROOT, "dist");

export const LIVE_SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");
