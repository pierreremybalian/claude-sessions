import React from "react";
import { SOURCES } from "../api.js";

export default function Filters({ projects, filters, onChange, onRescan, rescanning, total, shown, expiredTotal }) {
  const set = (patch) => onChange({ ...filters, ...patch });

  return (
    <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
      <select
        className="form-select form-select-sm"
        style={{ maxWidth: 280 }}
        value={filters.project}
        onChange={(e) => set({ project: e.target.value })}
      >
        <option value="">All folders ({total})</option>
        {projects.map((p) => (
          <option key={p.cwd} value={p.cwd}>
            {p.name} ({p.count}{p.expired ? ` +${p.expired}` : ""})
          </option>
        ))}
      </select>

      <div className="btn-group btn-group-sm" role="group">
        <button
          className={`btn btn-outline-secondary ${!filters.source ? "active" : ""}`}
          onClick={() => set({ source: "" })}
        >
          All
        </button>
        {Object.entries(SOURCES).map(([key, meta]) => (
          <button
            key={key}
            className={`btn btn-outline-secondary ${filters.source === key ? "active" : ""}`}
            onClick={() => set({ source: filters.source === key ? "" : key })}
          >
            {meta.label}
          </button>
        ))}
      </div>

      <select
        className="form-select form-select-sm"
        style={{ maxWidth: 170 }}
        value={filters.sort}
        onChange={(e) => set({ sort: e.target.value })}
      >
        <option value="recent">Most recent</option>
        <option value="oldest">Oldest first</option>
        <option value="prompts">Most prompts</option>
        <option value="size">Largest</option>
      </select>

      <input
        type="date"
        className="form-control form-control-sm"
        style={{ maxWidth: 160 }}
        value={filters.from}
        onChange={(e) => set({ from: e.target.value })}
        title="Active since"
      />

      <div className="form-check form-switch mb-0 ms-1">
        <input
          className="form-check-input"
          type="checkbox"
          id="expired"
          checked={filters.expired}
          onChange={(e) => set({ expired: e.target.checked })}
        />
        <label className="form-check-label small text-secondary" htmlFor="expired">
          Include expired ({expiredTotal})
        </label>
      </div>

      {(filters.project || filters.source || filters.from) && (
        <button
          className="btn btn-sm btn-link text-decoration-none"
          onClick={() => set({ project: "", source: "", from: "" })}
        >
          Clear
        </button>
      )}

      <div className="ms-auto d-flex align-items-center gap-3">
        <span className="text-secondary small">
          {shown} of {total}
        </span>
        <button className="btn btn-sm btn-outline-light" onClick={onRescan} disabled={rescanning}>
          {rescanning ? <span className="spinner-border spinner-border-sm" /> : "Refresh"}
        </button>
      </div>
    </div>
  );
}
