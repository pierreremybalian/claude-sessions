import React, { useEffect, useState } from "react";
import { api, relativeTime, sourceMeta } from "../api.js";
import Message from "./Message.jsx";
import ResumeButtons from "./ResumeButtons.jsx";

export default function SessionDetail({ id, onBack, onToast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    setGone(false);
    api.transcript(id).then(
      (d) => alive && setData(d),
      (e) => {
        if (!alive) return;
        setGone(e.status === 410);
        setError(e.message);
      }
    );
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) {
    return (
      <div className="container py-4" style={{ maxWidth: 760 }}>
        <button className="btn btn-sm btn-outline-secondary mb-3" onClick={onBack}>← All sessions</button>
        <div className={`alert ${gone ? "alert-secondary" : "alert-danger"}`}>
          <p className="mb-2">{error}</p>
          {gone && (
            <p className="mb-0 small">
              Claude Code deletes transcripts older than <code>cleanupPeriodDays</code> (currently 14 in
              your <code>settings.json</code>). Raise that number to keep future sessions around longer —
              it cannot bring this one back.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container py-5 text-center text-secondary">
        <div className="spinner-border" role="status" />
        <p className="mt-3 mb-0">Reading transcript…</p>
      </div>
    );
  }

  const { session, messages, truncated, totalLines } = data;
  const meta = sourceMeta(session.source);

  return (
    <div className="container py-4" style={{ maxWidth: 960 }}>
      <button className="btn btn-sm btn-outline-secondary mb-3" onClick={onBack}>← All sessions</button>

      <div className="card mb-4">
        <div className="card-body">
          <div className="d-flex flex-wrap gap-3 justify-content-between align-items-start">
            <div className="flex-grow-1">
              <h5 className="mb-1 d-flex align-items-center gap-2 flex-wrap">
                {session.live && <span className="badge text-bg-danger cs-live">● live</span>}
                {session.name || session.title}
              </h5>
              {session.name && <div className="small text-secondary mb-2">{session.title}</div>}
              <div className="cs-path mb-2">{session.cwd}</div>
              <div className="d-flex flex-wrap gap-2 align-items-center small text-secondary">
                <span className={`badge ${meta.cls}`}>{meta.label}</span>
                {session.gitBranch && <span className="badge text-bg-dark">{session.gitBranch}</span>}
                {session.version && <span>v{session.version}</span>}
                <span>{messages.length} messages</span>
                {session.runs?.length > 1 && (
                  <span title={session.runs.map((r) => new Date(r.firstAt).toLocaleString()).join("\n")}>
                    resumed {session.runs.length}×
                  </span>
                )}
                <span>last active {relativeTime(session.lastActiveAt)}</span>
              </div>
            </div>
            <ResumeButtons session={session} onToast={onToast} />
          </div>
        </div>
      </div>

      {truncated && (
        <div className="alert alert-warning py-2 small">
          This transcript is long ({totalLines.toLocaleString()} records) — showing the first{" "}
          {messages.length.toLocaleString()} messages. Resume the session to see the rest.
        </div>
      )}

      {messages.map((m, i) => (
        <Message key={m.uuid || i} msg={m} />
      ))}
    </div>
  );
}
