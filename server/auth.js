import { isLoopbackClient, tokensMatch, ALLOW_REMOTE_ACTIONS } from "./config.js";

const COOKIE = "cs_token";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

function wantsJson(req) {
  return req.path.startsWith("/api/") || (req.headers.accept || "").includes("application/json");
}

const DENIED_HTML = `<!doctype html><meta charset="utf-8">
<title>Claude Sessions — token required</title>
<style>body{font:15px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;color:#111}
code{background:#f2f2f2;padding:.15rem .35rem;border-radius:.25rem}</style>
<h1>Token required</h1>
<p>This Claude Sessions server is reachable over the network, so it needs the access
token appended once:</p>
<p><code>http://this-host:PORT/?token=YOUR_TOKEN</code></p>
<p>Print it on the machine running the server with <code>claude-sessions token</code>.</p>`;

/**
 * Loopback clients are already inside the trust boundary, so they skip the token.
 * Anything arriving over the network presents it once via ?token= and then rides
 * a cookie, which keeps the secret out of every subsequent URL and the browser bar.
 */
export function requireToken(token) {
  return (req, res, next) => {
    if (isLoopbackClient(req)) return next();

    const supplied = bearer(req) || req.query?.token || readCookie(req, COOKIE);
    if (!tokensMatch(supplied, token)) {
      if (wantsJson(req)) {
        return res.status(401).json({ error: "Access token required or invalid." });
      }
      return res.status(401).type("html").send(DENIED_HTML);
    }

    // Promote a query token to a cookie, then drop it from the address bar.
    if (req.query?.token && !readCookie(req, COOKIE)) {
      res.cookie(COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: THIRTY_DAYS * 1000,
      });
      if (req.method === "GET" && !req.path.startsWith("/api/")) {
        const url = new URL(req.originalUrl, "http://placeholder");
        url.searchParams.delete("token");
        return res.redirect(302, url.pathname + (url.search || ""));
      }
    }
    next();
  };
}

/**
 * Resume opens a Terminal window on the host machine — useful sitting at that Mac,
 * surprising from a phone. Remote clients get a read-only app unless told otherwise.
 */
export function guardRemoteActions(req, res, next) {
  if (isLoopbackClient(req) || ALLOW_REMOTE_ACTIONS) return next();
  res.status(403).json({
    error:
      "Resume is disabled for remote clients — it would open a Terminal window on the host Mac. " +
      "Use Copy instead, or start the server with ALLOW_REMOTE_ACTIONS=1.",
  });
}
