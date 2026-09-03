import express from "express";
import {
  ensureIndex, scan, getState, getSession, querySessions, listProjects, isValidSessionId,
} from "./indexer.js";
import { parseTranscript } from "./transcript.js";
import { searchTranscripts } from "./search.js";
import { openInTerminal, openInVSCode, cwdExists, resumeCommand } from "./actions.js";
import { guardRemoteActions } from "./auth.js";
import { isLoopbackClient, ALLOW_REMOTE_ACTIONS, runtime } from "./config.js";

export const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", wrap(async (req, res) => {
  const st = await ensureIndex();
  res.json({
    ok: true,
    sessions: st.sessions.length,
    skipped: st.skipped,
    scannedAt: st.scannedAt,
    scanMs: st.scanMs,
    node: process.version,
    capabilities: {
      lan: runtime.exposed,
      remote: !isLoopbackClient(req),
      actions: isLoopbackClient(req) || ALLOW_REMOTE_ACTIONS,
    },
  });
}));

router.get("/sessions", wrap(async (req, res) => {
  await ensureIndex();
  const { project, source, from, to, q, sort } = req.query;
  const includeExpired = req.query.expired === "1";
  const sessions = querySessions({ project, source, from, to, q, sort, includeExpired });
  const all = getState().sessions;
  res.json({
    sessions,
    total: all.filter((s) => !s.expired).length,
    expiredTotal: all.filter((s) => s.expired).length,
    scannedAt: getState().scannedAt,
  });
}));

router.post("/rescan", wrap(async (req, res) => {
  const st = await scan({ force: req.query.force === "1" });
  res.json({ sessions: st.sessions, scannedAt: st.scannedAt, scanMs: st.scanMs });
}));

router.get("/projects", wrap(async (req, res) => {
  await ensureIndex();
  res.json({ projects: listProjects() });
}));

router.get("/search", wrap(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "Query must be at least 2 characters." });
  await ensureIndex();
  const t0 = Date.now();
  const results = await searchTranscripts(q, { sessionsById: getState().byId });
  res.json({ query: q, results, ms: Date.now() - t0 });
}));

router.get("/sessions/:id/transcript", wrap(async (req, res) => {
  const { id } = req.params;
  if (!isValidSessionId(id)) return res.status(400).json({ error: "Invalid session id." });
  await ensureIndex();
  const session = getSession(id);
  if (!session) return res.status(404).json({ error: "Session not found." });
  if (session.expired || !session.file) {
    return res.status(410).json({
      error: "This transcript was deleted by Claude Code's cleanup sweep, so there is nothing left to read.",
      session,
    });
  }
  const { messages, truncated, totalLines } = await parseTranscript(session.file);
  res.json({ session, messages, truncated, totalLines });
}));

router.post("/sessions/:id/resume", guardRemoteActions, wrap(async (req, res) => {
  const { id } = req.params;
  if (!isValidSessionId(id)) return res.status(400).json({ error: "Invalid session id." });
  await ensureIndex();
  const session = getSession(id);
  if (!session) return res.status(404).json({ error: "Session not found." });
  if (session.expired) {
    return res.status(410).json({
      error: "Claude Code deleted this transcript, so it can no longer be resumed. Raise cleanupPeriodDays in settings.json to keep future sessions longer.",
    });
  }
  if (!cwdExists(session.cwd)) {
    return res.status(409).json({
      error: `Folder no longer exists: ${session.cwd}`,
      command: resumeCommand(session.cwd || "~", id),
    });
  }
  const app = String(req.body?.app || "terminal").toLowerCase();
  try {
    const result = app === "vscode"
      ? await openInVSCode(session.cwd, id)
      : await openInTerminal(session.cwd, id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      hint: app === "terminal"
        ? "macOS may need Automation permission: System Settings → Privacy & Security → Automation."
        : "Could not launch VS Code.",
      command: resumeCommand(session.cwd, id),
    });
  }
}));
