import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import Filters from "./components/Filters.jsx";
import SessionList from "./components/SessionList.jsx";
import SessionDetail from "./components/SessionDetail.jsx";
import SearchResults from "./components/SearchResults.jsx";

const EMPTY_FILTERS = { project: "", source: "", from: "", sort: "recent", expired: false };

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const match = /^#\/session\/([0-9a-f-]+)/i.exec(hash);
  return { sessionId: match?.[1] || null, navigate: (h) => (window.location.hash = h) };
}

export default function App() {
  const { sessionId, navigate } = useHashRoute();
  const [sessions, setSessions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [total, setTotal] = useState(0);
  const [expiredTotal, setExpiredTotal] = useState(0);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [titleQuery, setTitleQuery] = useState("");
  const [deepSearch, setDeepSearch] = useState(false);
  const [searchState, setSearchState] = useState(null); // {query, results, ms} | 'loading'
  const [rescanning, setRescanning] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  const showToast = useCallback((t) => {
    setToast(t);
    if (t?.kind !== "danger") setTimeout(() => setToast(null), 5000);
  }, []);

  const load = useCallback(async () => {
    try {
      const params = { ...filters };
      params.expired = filters.expired ? "1" : "";
      if (params.from) params.from = new Date(params.from).toISOString();
      if (!deepSearch && titleQuery) params.q = titleQuery;
      const [s, p] = await Promise.all([api.sessions(params), api.projects()]);
      setSessions(s.sessions);
      setTotal(s.total);
      setExpiredTotal(s.expiredTotal || 0);
      setProjects(p.projects);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [filters, titleQuery, deepSearch]);

  useEffect(() => {
    load();
  }, [load]);

  // Full-text search runs against transcripts, debounced.
  useEffect(() => {
    if (!deepSearch || titleQuery.trim().length < 2) {
      setSearchState(null);
      return;
    }
    const q = titleQuery.trim();
    setSearchState("loading");
    const t = setTimeout(() => {
      api.search(q).then(
        (r) => setSearchState({ query: q, results: r.results, ms: r.ms }),
        (e) => {
          setSearchState(null);
          showToast({ kind: "danger", text: e.message });
        }
      );
    }, 350);
    return () => clearTimeout(t);
  }, [deepSearch, titleQuery, showToast]);

  async function rescan() {
    setRescanning(true);
    try {
      await api.rescan();
      await load();
      showToast({ kind: "info", text: "Index refreshed." });
    } catch (e) {
      showToast({ kind: "danger", text: e.message });
    } finally {
      setRescanning(false);
    }
  }

  const open = (id) => navigate(`#/session/${id}`);

  const body = useMemo(() => {
    if (sessionId) {
      return <SessionDetail id={sessionId} onBack={() => navigate("#/")} onToast={showToast} />;
    }
    return (
      <div className="container py-4" style={{ maxWidth: 1200 }}>
        {error && <div className="alert alert-danger">{error}</div>}
        <Filters
          projects={projects}
          filters={filters}
          onChange={setFilters}
          onRescan={rescan}
          rescanning={rescanning}
          total={filters.expired ? total + expiredTotal : total}
          shown={sessions.length}
          expiredTotal={expiredTotal}
        />
        {deepSearch ? (
          searchState === "loading" ? (
            <div className="text-center text-secondary py-5">
              <div className="spinner-border" role="status" />
              <p className="mt-3 mb-0">Searching transcripts…</p>
            </div>
          ) : searchState ? (
            <SearchResults {...searchState} onOpen={open} onToast={showToast} />
          ) : (
            <div className="text-center text-secondary py-5">
              Type at least 2 characters to search inside every transcript.
            </div>
          )
        ) : (
          <SessionList sessions={sessions} onOpen={open} onToast={showToast} />
        )}
      </div>
    );
  }, [sessionId, error, projects, filters, rescanning, total, expiredTotal, sessions, deepSearch, searchState, showToast]);

  return (
    <>
      <nav className="cs-nav py-2 px-3 mb-0">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <a href="#/" className="navbar-brand mb-0 h5 text-decoration-none text-light">
            Claude Sessions
          </a>
          <div className="flex-grow-1" style={{ maxWidth: 520 }}>
            <input
              className="form-control form-control-sm"
              placeholder={deepSearch ? "Search inside all transcripts…" : "Filter by title or folder…"}
              value={titleQuery}
              onChange={(e) => setTitleQuery(e.target.value)}
            />
          </div>
          <div className="form-check form-switch mb-0">
            <input
              className="form-check-input"
              type="checkbox"
              id="deep"
              checked={deepSearch}
              onChange={(e) => setDeepSearch(e.target.checked)}
            />
            <label className="form-check-label small" htmlFor="deep">
              Search inside transcripts
            </label>
          </div>
        </div>
      </nav>

      {body}

      {toast && (
        <div className={`cs-toast alert alert-${toast.kind} shadow d-flex gap-2 align-items-start`}>
          <div className="flex-grow-1 small">
            {toast.text}
            {toast.command && <pre className="mb-0 mt-2 small">{toast.command}</pre>}
          </div>
          <button className="btn-close" onClick={() => setToast(null)} />
        </div>
      )}
    </>
  );
}
