import React from "react";
import { relativeTime, formatBytes, sourceMeta } from "../api.js";
import ResumeButtons from "./ResumeButtons.jsx";

export default function SessionList({ sessions, onOpen, onToast }) {
  if (!sessions.length) {
    return (
      <div className="text-center text-secondary py-5">
        <p className="mb-1">No sessions match these filters.</p>
        <p className="small mb-0">Try clearing the filters, or turn on “Include expired”.</p>
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-hover align-middle mb-0">
        <thead>
          <tr className="small text-secondary">
            <th style={{ minWidth: 340 }}>Session</th>
            <th style={{ width: 110 }}>Source</th>
            <th style={{ width: 90 }} className="text-end">Prompts</th>
            <th style={{ width: 110 }}>Last active</th>
            <th style={{ width: 210 }}></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const meta = sourceMeta(s.source);
            return (
              <tr
                key={s.id}
                className={`cs-row ${s.expired ? "cs-expired" : ""}`}
                onClick={() => onOpen(s.id)}
              >
                <td>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    {s.live && <span className="badge text-bg-danger cs-live">● live</span>}
                    {s.expired && <span className="badge text-bg-secondary">expired</span>}
                    <span className="fw-semibold">{s.name || s.title}</span>
                    {s.runs?.length > 1 && (
                      <span className="badge text-bg-dark" title={`Resumed ${s.runs.length} times`}>
                        {s.runs.length} runs
                      </span>
                    )}
                  </div>
                  {s.name && <div className="cs-title small text-secondary mt-1">{s.title}</div>}
                  <div className="cs-path">
                    {s.cwd || "unknown folder"}
                    {s.gitBranch ? ` · ${s.gitBranch}` : ""}
                    {s.sizeBytes ? ` · ${formatBytes(s.sizeBytes)}` : ""}
                  </div>
                </td>
                <td>
                  {s.expired ? (
                    <span className="text-secondary small">—</span>
                  ) : (
                    <span className={`badge ${meta.cls}`}>{meta.label}</span>
                  )}
                </td>
                <td className="text-end text-secondary">{s.promptCount || "–"}</td>
                <td
                  className="text-secondary small"
                  title={s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleString() : ""}
                >
                  {relativeTime(s.lastActiveAt)}
                </td>
                <td className="text-end">
                  {s.expired ? (
                    <span className="small text-secondary" title="Claude Code deleted this transcript during its cleanup sweep">
                      transcript deleted
                    </span>
                  ) : (
                    <ResumeButtons session={s} onToast={onToast} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
