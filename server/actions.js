import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const run = promisify(execFile);

/** Single-quote for /bin/sh: close quote, escaped quote, reopen. */
export function shellQuote(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

/** Escape for embedding inside an AppleScript double-quoted string literal. */
export function escapeForAppleScript(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function resumeCommand(cwd, sessionId) {
  return `cd ${shellQuote(cwd)} && claude --resume ${sessionId}`;
}

/** Terminals that can be told to run a command, most preferred first. */
const TERMINALS = [
  {
    name: "iTerm",
    script: (cmd) => [
      'tell application "iTerm"',
      "  activate",
      "  set newWindow to (create window with default profile)",
      `  tell current session of newWindow to write text "${escapeForAppleScript(cmd)}"`,
      "end tell",
    ],
  },
  {
    name: "Terminal",
    script: (cmd) => [
      'tell application "Terminal"',
      "  activate",
      `  do script "${escapeForAppleScript(cmd)}"`,
      "end tell",
    ],
  },
];

async function isInstalled(name) {
  try {
    await run("osascript", ["-e", `id of app "${name}"`]);
    return true;
  } catch {
    return false;
  }
}

let terminalPromise = null;

/**
 * Whichever terminal is actually installed, iTerm first — opening Terminal.app on
 * a Mac where nobody uses it is worse than useless. CS_TERMINAL overrides.
 */
export function preferredTerminal() {
  terminalPromise ||= (async () => {
    const forced = process.env.CS_TERMINAL;
    if (forced) {
      const known = TERMINALS.find((t) => t.name.toLowerCase() === forced.toLowerCase());
      if (known) return known;
      return { name: forced, script: TERMINALS[1].script };
    }
    for (const t of TERMINALS) {
      if (await isInstalled(t.name)) return t;
    }
    return TERMINALS[1];
  })();
  return terminalPromise;
}

/** Open a new terminal window in cwd and resume the session there. */
export async function openInTerminal(cwd, sessionId) {
  const cmd = resumeCommand(cwd, sessionId);
  const terminal = await preferredTerminal();
  await run("osascript", ["-e", terminal.script(cmd).join("\n")]);
  return { app: terminal.name, command: cmd };
}

async function copyToClipboard(text) {
  await new Promise((resolve, reject) => {
    const child = execFile("pbcopy", (err) => (err ? reject(err) : resolve()));
    child.stdin.end(text);
  });
}

/**
 * The VS Code extension's resume UI isn't scriptable, so open the folder and
 * put the resume command on the clipboard for the integrated terminal.
 */
export async function openInVSCode(cwd, sessionId) {
  const cmd = resumeCommand(cwd, sessionId);
  let opened = "code";
  try {
    await run("code", [cwd]);
  } catch {
    await run("open", ["-a", "Visual Studio Code", cwd]);
    opened = "open -a";
  }
  let copied = true;
  try {
    await copyToClipboard(`claude --resume ${sessionId}`);
  } catch {
    copied = false;
  }
  return { app: "VS Code", via: opened, copied, command: cmd };
}

export function cwdExists(cwd) {
  try {
    return !!cwd && fs.statSync(cwd).isDirectory();
  } catch {
    return false;
  }
}
