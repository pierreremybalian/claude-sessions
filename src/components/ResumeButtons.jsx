import React, { useEffect, useState } from "react";
import { api, capabilities } from "../api.js";

export default function ResumeButtons({ session, size = "sm", onToast }) {
  const [busy, setBusy] = useState(null);
  const [caps, setCaps] = useState({ actions: true, remote: false });

  useEffect(() => {
    capabilities().then(setCaps);
  }, []);

  async function launch(app, e) {
    e.stopPropagation();
    setBusy(app);
    try {
      const r = await api.resume(session.id, app);
      onToast?.({
        kind: "success",
        text:
          app === "vscode"
            ? `VS Code opened at ${session.project}${r.copied ? " — resume command copied, paste it in the integrated terminal (Ctrl+\`)" : ""}`
            : `Terminal opened — resuming in ${session.project}`,
      });
    } catch (err) {
      onToast?.({ kind: "danger", text: err.message, command: err.body?.command });
    } finally {
      setBusy(null);
    }
  }

  // Browsers only expose navigator.clipboard in a secure context, and the LAN URL
  // is plain http — so fall back to showing the command for manual copying.
  function copy(e) {
    e.stopPropagation();
    const cmd = `cd '${session.cwd}' && claude --resume ${session.id}`;
    const ok = () => onToast?.({ kind: "info", text: "Resume command copied to clipboard." });
    const fail = () => onToast?.({ kind: "info", text: "Copy this command:", command: cmd });
    try {
      navigator.clipboard.writeText(cmd).then(ok, fail);
    } catch {
      fail();
    }
  }

  // Launching Terminal from a phone would open a window on the host Mac, so the
  // remote view offers the command instead of pretending the button works.
  if (!caps.actions) {
    return (
      <div className={`btn-group btn-group-${size}`} role="group">
        <button
          className="btn btn-outline-secondary"
          onClick={copy}
          title="Copy the resume command — resume is disabled for remote clients"
        >
          Copy resume command
        </button>
      </div>
    );
  }

  return (
    <div className={`btn-group btn-group-${size}`} role="group">
      <button
        className="btn btn-outline-success"
        onClick={(e) => launch("terminal", e)}
        disabled={busy === "terminal"}
        title="Open Terminal.app and resume this session"
      >
        {busy === "terminal" ? <span className="spinner-border spinner-border-sm" /> : "Terminal"}
      </button>
      <button
        className="btn btn-outline-primary"
        onClick={(e) => launch("vscode", e)}
        disabled={busy === "vscode"}
        title="Open the folder in VS Code and copy the resume command"
      >
        {busy === "vscode" ? <span className="spinner-border spinner-border-sm" /> : "VS Code"}
      </button>
      <button className="btn btn-outline-secondary" onClick={copy} title="Copy the resume command">
        Copy
      </button>
    </div>
  );
}
