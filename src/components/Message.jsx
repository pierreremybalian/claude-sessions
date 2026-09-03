import React from "react";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

function ToolBlock({ block }) {
  return (
    <details className="cs-tool my-2">
      <summary>
        <span className={block.isError ? "text-danger" : "text-info"}>
          {block.isError ? "✗" : "▸"} {block.name}
        </span>
        <span className="cs-tool-summary">{block.summary}</span>
      </summary>
      <pre className="mb-0">{JSON.stringify(block.input, null, 2)}</pre>
      {block.result && (
        <pre className={`mb-0 ${block.isError ? "text-danger" : "text-secondary"}`}>{block.result}</pre>
      )}
    </details>
  );
}

export default function Message({ msg }) {
  if (msg.role === "user") {
    return (
      <div className="cs-msg cs-msg-user rounded p-3 mb-3">
        <div className="small text-secondary mb-1">
          You{msg.ts ? ` · ${new Date(msg.ts).toLocaleString()}` : ""}
        </div>
        <div className="cs-user-text">{msg.text}</div>
      </div>
    );
  }

  return (
    <div className="cs-msg cs-msg-assistant rounded p-3 mb-3">
      <div className="small text-secondary mb-1">
        Claude{msg.model ? ` · ${msg.model}` : ""}
        {msg.ts ? ` · ${new Date(msg.ts).toLocaleString()}` : ""}
      </div>
      {msg.blocks.map((b, i) => {
        if (b.kind === "tool_use") return <ToolBlock key={i} block={b} />;
        if (b.kind === "thinking") {
          return (
            <details key={i} className="cs-tool my-2">
              <summary>
                <span className="text-secondary">◇ thinking</span>
                <span className="cs-tool-summary">{b.text.slice(0, 120)}</span>
              </summary>
              <pre className="mb-0 text-secondary">{b.text}</pre>
            </details>
          );
        }
        return (
          <div
            key={i}
            className="cs-msg-body"
            dangerouslySetInnerHTML={{ __html: marked.parse(b.text) }}
          />
        );
      })}
    </div>
  );
}
