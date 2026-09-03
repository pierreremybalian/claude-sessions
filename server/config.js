import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Everything the app writes lives here, not in the install directory — a global
 * npm install may sit somewhere the user can't write to.
 */
export const CONFIG_DIR = path.join(os.homedir(), ".claude-sessions");
export const TOKEN_FILE = path.join(CONFIG_DIR, "token");

export const PORT = Number(process.env.PORT || 5178);
export const HOST = process.env.HOST || "127.0.0.1";

/** Resume opens a Terminal window on the machine running the server, so it is
 *  off for remote clients unless the user deliberately turns it back on. */
export const ALLOW_REMOTE_ACTIONS = process.env.ALLOW_REMOTE_ACTIONS === "1";

/** A loopback bind is unreachable from the network, so it needs no token. */
export function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function isLoopbackClient(req) {
  const addr = req.socket?.remoteAddress || "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

export function readToken() {
  try {
    const t = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Create the token on first use; 0600 so other accounts on the Mac can't read it. */
export function ensureToken() {
  const existing = readToken();
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_FILE, token + "\n", { mode: 0o600 });
  return token;
}

export function resetToken() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {}
  return ensureToken();
}

export function tokensMatch(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
