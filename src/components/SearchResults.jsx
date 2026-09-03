import React from "react";
import { relativeTime, sourceMeta } from "../api.js";
import ResumeButtons from "./ResumeButtons.jsx";

export default function SearchResults({ query, results, ms, onOpen, onToast }) {
  if (!results.length) {
    return (
      <div className="text-center text-secondary py-5">
        <p className="mb-0">No transcripts contain “{query}”.</p>
      </div>
    );
  }

  return (
    <>
      <p className="small text-secondary">
        {results.length} session{results.length === 1 ? "" : "s"} mention “{query}” ({ms}ms)
      </p>
      {results.map(({ session, hits }) => {
        const meta = sourceMeta(session.source);
        return (
          <div className="card mb-3 cs-row" key={session.id} onClick={() => onOpen(session.id)}>
            <div className="card-body py-3">
              <div className="d-flex justify-content-between gap-3 align-items-start mb-2">
                <div>
                  <div className="fw-semibold">{session.title}</div>
                  <div className="cs-path">{session.cwd}</div>
                </div>
                <div className="text-end flex-shrink-0">
                  <div className="mb-2">
                    <span className={`badge ${meta.cls} me-2`}>{meta.label}</span>
                    <span className="small text-secondary">{relativeTime(session.lastActiveAt)}</span>
                  </div>
                  <ResumeButtons session={session} onToast={onToast} />
                </div>
              </div>
              {hits.map((h, i) => (
                <div key={i} className="cs-snippet mb-1">
                  <span className="badge text-bg-dark me-2">{h.role === "user" ? "you" : "claude"}</span>
                  {h.snippet}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
