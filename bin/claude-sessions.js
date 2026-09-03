#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server/index.js";
import { ensureToken, readToken, resetToken, PORT, TOKEN_FILE } from "../server/config.js";
import { lanAddress, bonjourHost } from "../server/net.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));

const HELP = `claude-sessions ${pkg.version} — browse and resume Claude Code sessions

Usage
  claude-sessions                 serve on http://localhost:${PORT} (this Mac only)
  claude-sessions --lan           also serve on the local network, gated by a token
  claude-sessions token           print the access token and the LAN link
  claude-sessions token --reset   issue a new token, invalidating the old one

Options
  --lan              bind 0.0.0.0 instead of 127.0.0.1
  --host <addr>      bind a specific address (implies a token if not loopback)
  --port <n>         port to listen on (default ${PORT}, or $PORT)
  --open             open the UI in your browser once it is up
  --no-qr            skip the QR code when serving on the LAN
  --allow-remote-actions
                     let remote clients trigger Terminal resume on this Mac
  -h, --help         this text
  -v, --version      print the version
`;

const argv = process.argv.slice(2);
const has = (...flags) => flags.some((f) => argv.includes(f));
function value(flag, fallback) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

if (has("-h", "--help")) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (has("-v", "--version")) {
  console.log(pkg.version);
  process.exit(0);
}

function lanUrlWithToken(port, token) {
  const host = lanAddress() || bonjourHost();
  return host ? `http://${host}:${port}/?token=${token}` : null;
}

if (argv[0] === "token") {
  const token = has("--reset") ? resetToken() : ensureToken();
  const url = lanUrlWithToken(Number(value("--port", PORT)), token);
  console.log(token);
  if (url) console.log(`\n${url}`);
  console.log(`\nstored in ${TOKEN_FILE}`);
  process.exit(0);
}

if (has("--allow-remote-actions")) process.env.ALLOW_REMOTE_ACTIONS = "1";

const host = has("--lan") ? "0.0.0.0" : value("--host", process.env.HOST || "127.0.0.1");
const port = Number(value("--port", process.env.PORT || PORT));

let info;
try {
  info = await startServer({ host, port });
} catch (err) {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use — another claude-sessions is probably running.`);
    console.error(`Open http://localhost:${port} or stop it with: pkill -f claude-sessions`);
    process.exit(1);
  }
  throw err;
}

console.log(`\n  claude-sessions  ${info.localUrl}`);

if (info.exposed) {
  const url = lanUrlWithToken(info.port, info.token);
  if (url) {
    console.log(`  on the network   ${url}`);
    if (info.bonjourUrl) console.log(`                   ${info.bonjourUrl}/?token=${info.token}`);
    if (!has("--no-qr")) await printQr(url);
  } else {
    console.log("  on the network   no LAN address found — is wifi off?");
  }
  console.log("\n  The token is asked for once per browser, then remembered in a cookie.");
} else {
  console.log("  bound to loopback — add --lan to reach it from your phone\n");
}

if (has("--open")) execFile("open", [info.localUrl], () => {});

async function printQr(url) {
  try {
    const { default: qr } = await import("qrcode-terminal");
    console.log("");
    await new Promise((resolve) => qr.generate(url, { small: true }, (code) => {
      console.log(code.replace(/^/gm, "  "));
      resolve();
    }));
  } catch {
    // qrcode-terminal is optional; the printed URL is enough on its own.
  }
}
