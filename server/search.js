import { spawn } from "node:child_process";
import path from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { PROJECTS_DIR } from "./paths.js";

const MAX_SESSIONS = 50;
const MAX_HITS_PER_SESSION = 5;
const CONTEXT = 90;

function snippetAround(text, query) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const i = flat.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return flat.slice(0, CONTEXT * 2) + (flat.length > CONTEXT * 2 ? "…" : "");
  const start = Math.max(0, i - CONTEXT);
  const end = Math.min(flat.length, i + query.length + CONTEXT);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

function messageText(o) {
  const msg = o.message;
  if (!msg) return "";
  const c = msg.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  const parts = [];
  for (const b of c) {
    if (!b) continue;
    if (b.type === "text" && b.text) parts.push(b.text);
    else if (b.type === "thinking" && b.thinking) parts.push(b.thinking);
  }
  return parts.join("\n");
}

/**
 * Full-text search across session transcripts using the bundled ripgrep
 * binary, then filter down to hits that occur in actual message content.
 */
export function searchTranscripts(query, { sessionsById }) {
  return new Promise((resolve, reject) => {
    const args = [
      "--json",
      "--ignore-case",
      "--fixed-strings",
      "--max-count", String(MAX_HITS_PER_SESSION * 8),
      "--max-filesize", "400M",
      "--max-depth", "2",
      "--glob", "*.jsonl",
      "-e", query,
      PROJECTS_DIR,
    ];
    const child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const bySession = new Map();
    let buf = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type !== "match") continue;
        const file = evt.data?.path?.text;
        if (!file) continue;
        const id = path.basename(file, ".jsonl");
        const session = sessionsById.get(id);
        if (!session) continue; // nested subagent/workflow file, or filtered dir

        let entry = bySession.get(id);
        if (!entry) {
          if (bySession.size >= MAX_SESSIONS) continue;
          entry = { session, hits: [] };
          bySession.set(id, entry);
        }
        if (entry.hits.length >= MAX_HITS_PER_SESSION) continue;

        const raw = evt.data?.lines?.text || "";
        let o;
        try {
          o = JSON.parse(raw);
        } catch {
          continue;
        }
        if (o.type !== "user" && o.type !== "assistant") continue;
        const text = messageText(o);
        if (!text.toLowerCase().includes(query.toLowerCase())) continue; // matched metadata, not content
        entry.hits.push({
          role: o.type,
          ts: o.timestamp || null,
          isSidechain: !!o.isSidechain,
          snippet: snippetAround(text, query),
        });
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && code !== 1) return reject(new Error(stderr.trim() || `ripgrep exited ${code}`));
      const results = [...bySession.values()]
        .filter((r) => r.hits.length)
        .sort((a, b) => b.session.lastActiveAt.localeCompare(a.session.lastActiveAt));
      resolve(results);
    });
  });
}
