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

/** Open a new Terminal.app window in cwd and resume the session there. */
export async function openInTerminal(cwd, sessionId) {
  const cmd = resumeCommand(cwd, sessionId);
  const script = [
    'tell application "Terminal"',
    "  activate",
    `  do script "${escapeForAppleScript(cmd)}"`,
    "end tell",
  ].join("\n");
  await run("osascript", ["-e", script]);
  return { app: "Terminal", command: cmd };
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
