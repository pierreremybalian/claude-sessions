import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { PROJECTS_DIR, HISTORY_FILE, CACHE_FILE, LIVE_SESSIONS_DIR } from "./paths.js";

const TITLE_MAX = 140;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let state = { sessions: [], byId: new Map(), scannedAt: null, scanMs: 0, skipped: 0 };
let cache = new Map(); // filePath -> { mtimeMs, size, meta }
let scanning = null;

export function isValidSessionId(id) {
  return typeof id === "string" && UUID_RE.test(id);
}

function isTempCwd(p) {
  if (!p) return false;
  return /^\/private\/tmp\//.test(p) || /^\/tmp\//.test(p) || p.includes("scratchpad");
}

/** Pull plain text out of a message content field (string or block array). */
function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function isHumanPrompt(o) {
  return (
    o.type === "user" &&
    !o.isSidechain &&
    o.message &&
    o.message.role === "user" &&
    (o.origin?.kind === "human" || o.promptSource === "typed" || typeof o.message.content === "string")
  );
}

function cleanTitle(text) {
  const t = String(text || "")
    .replace(/<(command-name|command-message|command-args|local-command-[a-z]+|caveat)>[\s\S]*?<\/\1>/g, " ")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ")
    // VS Code sessions prepend IDE context blocks ahead of the real prompt.
    .replace(/<(ide_[a-z_]+)>[\s\S]*?<\/\1>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX).trimEnd() + "…" : t;
}

/**
 * Scan a whole session file. A full pass over the largest transcript here
 * (183MB) takes ~250ms, and results are cached by mtime, so there is no reason
 * to settle for the partial metadata a head-only read would give.
 */
async function readSession(filePath) {
  const meta = {
    cwd: null, title: "", aiTitle: null, source: null, startedAt: null, endedAt: null,
    gitBranch: null, version: null, userPrompts: 0, assistantMessages: 0, runs: [],
  };
  const runs = new Map();

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line || line[0] !== "{") continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }

      // Claude Code's own generated name for the session; the last one wins.
      if (o.type === "ai-title" && o.aiTitle) {
        meta.aiTitle = o.aiTitle;
        continue;
      }
      if (o.type === "agent-name" && o.agentName && !meta.aiTitle) {
        meta.aiTitle = o.agentName;
        continue;
      }

      if (!meta.cwd && typeof o.cwd === "string") meta.cwd = o.cwd;
      if (typeof o.gitBranch === "string") meta.gitBranch = o.gitBranch;
      if (typeof o.version === "string") meta.version = o.version;
      if (!meta.source && typeof o.entrypoint === "string") meta.source = o.entrypoint;
      if (o.timestamp) meta.endedAt = o.timestamp;

      // Each launch/resume of a session gets its own session_id ("run").
      const runId = o.session_id;
      if (runId && o.timestamp) {
        let r = runs.get(runId);
        if (!r) {
          r = { id: runId, firstAt: o.timestamp, lastAt: o.timestamp, prompts: 0 };
          runs.set(runId, r);
        }
        if (o.timestamp < r.firstAt) r.firstAt = o.timestamp;
        if (o.timestamp > r.lastAt) r.lastAt = o.timestamp;
      }

      if (o.isSidechain) continue;
      if (o.type === "assistant") meta.assistantMessages++;
      if (isHumanPrompt(o)) {
        const t = cleanTitle(contentText(o.message.content));
        if (!t) continue;
        meta.userPrompts++;
        if (runId && runs.has(runId)) runs.get(runId).prompts++;
        if (!meta.title || meta.title.length < 12) {
          // Prefer the first substantive prompt over a one-word opener like "ls".
          meta.title = t;
          if (!meta.startedAt) meta.startedAt = o.timestamp || null;
          if (typeof o.entrypoint === "string") meta.source = o.entrypoint;
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  meta.runs = [...runs.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt));
  return meta;
}

/** One pass over history.jsonl: prompt counts + fallback titles per session. */
async function readHistory() {
  const map = new Map();
  if (!fs.existsSync(HISTORY_FILE)) return map;
  const rl = readline.createInterface({
    input: fs.createReadStream(HISTORY_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const id = o.sessionId;
    if (!id) continue;
    let e = map.get(id);
    if (!e) {
      e = { count: 0, firstDisplay: "", lastTimestamp: 0, project: o.project || null };
      map.set(id, e);
    }
    e.count++;
    if (!e.firstDisplay && o.display) e.firstDisplay = cleanTitle(o.display);
    if (o.timestamp && o.timestamp > e.lastTimestamp) e.lastTimestamp = o.timestamp;
  }
  return map;
}

async function loadCache() {
  try {
    const raw = await fsp.readFile(CACHE_FILE, "utf8");
    const obj = JSON.parse(raw);
    cache = new Map(Object.entries(obj.files || {}));
  } catch {
    cache = new Map();
  }
}

async function saveCache() {
  try {
    await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    const files = Object.fromEntries(cache);
    await fsp.writeFile(CACHE_FILE, JSON.stringify({ version: 1, files }), "utf8");
  } catch (err) {
    console.warn("[indexer] could not write cache:", err.message);
  }
}

/** Every *.jsonl one level deep inside ~/.claude/projects. */
async function listSessionFiles() {
  const out = [];
  let dirs;
  try {
    dirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error("[indexer] cannot read", PROJECTS_DIR, err.message);
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    if (d.name.includes("scratchpad") || d.name.startsWith("-private-tmp") || d.name.startsWith("-tmp")) continue;
    const dir = path.join(PROJECTS_DIR, d.name);
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of entries) {
      if (f.isFile() && f.name.endsWith(".jsonl")) out.push(path.join(dir, f.name));
    }
  }
  return out;
}


/**
 * ~/.claude/sessions/<pid>.json describes each currently running session.
 * Gives us the live flag and the friendly name Claude Code is using right now.
 */
async function readLiveSessions() {
  const live = new Map();
  let files;
  try {
    files = await fsp.readdir(LIVE_SESSIONS_DIR);
  } catch {
    return live;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const o = JSON.parse(await fsp.readFile(path.join(LIVE_SESSIONS_DIR, f), "utf8"));
      if (!o.sessionId) continue;
      let running = false;
      try {
        process.kill(o.pid, 0); // signal 0 only tests for existence
        running = true;
      } catch {
        running = false;
      }
      live.set(o.sessionId, { name: o.name || null, pid: o.pid, running, cwd: o.cwd });
    } catch {
      /* a session record being rewritten as we read it */
    }
  }
  return live;
}

/**
 * Sessions history.jsonl remembers but whose transcript is gone — Claude Code
 * deletes transcripts older than `cleanupPeriodDays`. Not resumable, but still
 * worth showing so the folder does not look emptier than the work you did in it.
 */
function buildExpired(history, knownIds) {
  const out = [];
  for (const [id, h] of history) {
    if (knownIds.has(id)) continue;
    if (!h.project || isTempCwd(h.project)) continue;
    out.push({
      id,
      file: null,
      cwd: h.project,
      project: path.basename(h.project),
      name: null,
      title: h.firstDisplay || "(no prompt recorded)",
      source: "cli",
      startedAt: h.lastTimestamp ? new Date(h.lastTimestamp).toISOString() : null,
      lastActiveAt: h.lastTimestamp ? new Date(h.lastTimestamp).toISOString() : "",
      gitBranch: null,
      version: null,
      sizeBytes: 0,
      promptCount: h.count,
      runs: [],
      live: false,
      expired: true,
    });
  }
  return out;
}

export async function scan({ force = false } = {}) {
  if (scanning) return scanning;
  scanning = (async () => {
    const t0 = Date.now();
    if (!cache.size && !force) await loadCache();
    if (force) cache = new Map();

    const [files, history, live] = await Promise.all([listSessionFiles(), readHistory(), readLiveSessions()]);
    const seen = new Set();
    const sessions = [];
    let skipped = 0;
    let reparsed = 0;

    for (const filePath of files) {
      let st;
      try {
        st = await fsp.stat(filePath);
      } catch {
        continue;
      }
      if (st.size === 0) {
        skipped++;
        continue;
      }
      seen.add(filePath);
      const cached = cache.get(filePath);
      let meta;
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        meta = cached.meta;
      } else {
        try {
          meta = await readSession(filePath);
          reparsed++;
        } catch (err) {
          console.warn("[indexer] unreadable:", filePath, err.message);
          skipped++;
          continue;
        }
        cache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, meta });
      }

      const id = path.basename(filePath, ".jsonl");
      const hist = history.get(id);
      const cwd = meta.cwd || hist?.project || null;
      if (isTempCwd(cwd)) {
        skipped++;
        continue;
      }
      const title = meta.title || hist?.firstDisplay || "(no prompt)";
      const startedAt = meta.startedAt || (hist?.lastTimestamp ? new Date(hist.lastTimestamp).toISOString() : st.birthtime.toISOString());

      sessions.push({
        id,
        file: filePath,
        cwd,
        project: cwd ? path.basename(cwd) : "(unknown)",
        name: meta.aiTitle || null,
        title,
        source: meta.source || "cli",
        startedAt,
        lastActiveAt: st.mtime.toISOString(),
        gitBranch: meta.gitBranch || null,
        version: meta.version || null,
        sizeBytes: st.size,
        // Prompts counted from the transcript itself; history.jsonl only records
        // prompts typed in the terminal, so it undercounts VS Code sessions.
        promptCount: meta.userPrompts || hist?.count || 0,
        runs: meta.runs || [],
        live: false,
        expired: false,
      });
    }

    for (const key of [...cache.keys()]) if (!seen.has(key)) cache.delete(key);

    // A session id from history that is a run inside a file we already have is
    // not a separate session, so it must not resurface as an expired one.
    const knownIds = new Set();
    for (const s of sessions) {
      knownIds.add(s.id);
      for (const r of s.runs) knownIds.add(r.id);
      const l = live.get(s.id);
      if (l) {
        s.live = l.running;
        if (l.name && !s.name) s.name = l.name;
      }
    }

    const expired = buildExpired(history, knownIds);
    const expiredCount = expired.length;
    sessions.push(...expired);
    sessions.sort((a, b) => (b.lastActiveAt || "").localeCompare(a.lastActiveAt || ""));

    state = {
      sessions,
      byId: new Map(sessions.map((s) => [s.id, s])),
      scannedAt: new Date().toISOString(),
      scanMs: Date.now() - t0,
      skipped,
    };
    await saveCache();
    console.log(`[indexer] ${sessions.length} sessions (${reparsed} parsed, ${expiredCount} expired, ${skipped} skipped) in ${state.scanMs}ms`);
    return state;
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

export async function ensureIndex() {
  if (!state.scannedAt) await scan();
  return state;
}

export function getState() {
  return state;
}

export function getSession(id) {
  return state.byId.get(id) || null;
}

/** Filter + sort the in-memory index for the list endpoint. */
export function querySessions({ project, source, from, to, q, sort = "recent", includeExpired = false } = {}) {
  let rows = state.sessions;
  if (!includeExpired) rows = rows.filter((s) => !s.expired);
  if (project) rows = rows.filter((s) => s.cwd === project);
  if (source) rows = rows.filter((s) => s.source === source);
  if (from) rows = rows.filter((s) => s.lastActiveAt >= from);
  if (to) rows = rows.filter((s) => s.lastActiveAt <= to);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        (s.name || "").toLowerCase().includes(needle) ||
        (s.cwd || "").toLowerCase().includes(needle)
    );
  }
  const sorted = [...rows];
  if (sort === "oldest") sorted.sort((a, b) => a.lastActiveAt.localeCompare(b.lastActiveAt));
  else if (sort === "size") sorted.sort((a, b) => b.sizeBytes - a.sizeBytes);
  else if (sort === "prompts") sorted.sort((a, b) => b.promptCount - a.promptCount);
  else sorted.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  return sorted;
}

export function listProjects() {
  const map = new Map();
  for (const s of state.sessions) {
    if (!s.cwd) continue;
    const e = map.get(s.cwd) || { cwd: s.cwd, name: s.project, count: 0, expired: 0, lastActiveAt: "" };
    if (s.expired) e.expired++;
    else e.count++;
    if (s.lastActiveAt > e.lastActiveAt) e.lastActiveAt = s.lastActiveAt;
    map.set(s.cwd, e);
  }
  return [...map.values()].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}
