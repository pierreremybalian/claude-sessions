import fs from "node:fs";
import readline from "node:readline";

const MAX_MESSAGES = 2000;
const RESULT_SNIPPET = 300;

/** IDE-injected context blocks are noise in the reader, not something you typed. */
function stripIdeBlocks(s) {
  return String(s)
    .replace(/<(ide_[a-z_]+)>[\s\S]*?<\/\1>/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<(local-command-[a-z]+|caveat)>[\s\S]*?<\/\1>/g, "")
    .trim();
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n\n");
}

function isToolResultOnly(content) {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((b) => b && (b.type === "tool_result" || b.type === "image"))
  );
}

/** A short human-readable label for a tool call, e.g. the command or file path. */
function toolSummary(name, input) {
  if (!input || typeof input !== "object") return "";
  const pick =
    input.command ??
    input.file_path ??
    input.path ??
    input.pattern ??
    input.query ??
    input.prompt ??
    input.description;
  const s = typeof pick === "string" ? pick : JSON.stringify(input);
  const one = String(s).replace(/\s+/g, " ").trim();
  return one.length > 160 ? one.slice(0, 160) + "…" : one;
}

function resultText(block) {
  const c = block.content;
  let s = "";
  if (typeof c === "string") s = c;
  else if (Array.isArray(c)) s = textOf(c) || JSON.stringify(c);
  s = String(s).trim();
  return s.length > RESULT_SNIPPET ? s.slice(0, RESULT_SNIPPET) + "…" : s;
}

/**
 * Reduce a session jsonl to a renderable message list. Streams line by line so
 * very large transcripts never land in memory whole.
 */
export async function parseTranscript(filePath, { max = MAX_MESSAGES } = {}) {
  const messages = [];
  const toolsById = new Map(); // tool_use id -> block, so results can attach later
  let truncated = false;
  let totalLines = 0;

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      totalLines++;
      if (!line || line[0] !== "{") continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.isSidechain) continue;
      if (o.type !== "user" && o.type !== "assistant") continue;
      const msg = o.message;
      if (!msg) continue;

      if (o.type === "user") {
        // Tool results arrive as user turns; fold them into the calling tool block.
        if (isToolResultOnly(msg.content)) {
          for (const b of msg.content) {
            if (b.type !== "tool_result") continue;
            const target = toolsById.get(b.tool_use_id);
            if (target) {
              target.result = resultText(b);
              target.isError = !!b.is_error;
            }
          }
          continue;
        }
        const text = stripIdeBlocks(textOf(msg.content));
        if (!text.trim()) continue;
        if (messages.length >= max) {
          truncated = true;
          break;
        }
        messages.push({ role: "user", text, ts: o.timestamp || null, uuid: o.uuid });
      } else {
        const blocks = [];
        const content = Array.isArray(msg.content) ? msg.content : [];
        for (const b of content) {
          if (!b) continue;
          if (b.type === "text" && b.text?.trim()) {
            blocks.push({ kind: "text", text: b.text });
          } else if (b.type === "thinking" && b.thinking?.trim()) {
            blocks.push({ kind: "thinking", text: b.thinking });
          } else if (b.type === "tool_use") {
            const block = {
              kind: "tool_use",
              name: b.name,
              summary: toolSummary(b.name, b.input),
              input: b.input,
              result: null,
              isError: false,
            };
            toolsById.set(b.id, block);
            blocks.push(block);
          }
        }
        if (!blocks.length) continue;
        if (messages.length >= max) {
          truncated = true;
          break;
        }
        messages.push({
          role: "assistant",
          blocks,
          ts: o.timestamp || null,
          uuid: o.uuid,
          model: msg.model || null,
        });
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return { messages, truncated, totalLines };
}
