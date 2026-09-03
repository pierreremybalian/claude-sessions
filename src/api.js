async function json(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { body, status: res.status });
  return body;
}

/** Fetched once per page load: whether this client may trigger Terminal/VS Code. */
let capsPromise = null;
export function capabilities() {
  capsPromise ||= json("/api/health")
    .then((h) => h.capabilities || { actions: true, remote: false })
    .catch(() => ({ actions: true, remote: false }));
  return capsPromise;
}

export const api = {
  sessions: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return json(`/api/sessions?${qs}`);
  },
  projects: () => json("/api/projects"),
  rescan: () => json("/api/rescan", { method: "POST" }),
  search: (q) => json(`/api/search?q=${encodeURIComponent(q)}`),
  transcript: (id) => json(`/api/sessions/${id}/transcript`),
  resume: (id, app) =>
    json(`/api/sessions/${id}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app }),
    }),
};

export function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export const SOURCES = {
  cli: { label: "Terminal", icon: "▮", cls: "text-bg-success" },
  "claude-vscode": { label: "VS Code", icon: "◧", cls: "text-bg-primary" },
  "sdk-cli": { label: "SDK", icon: "◇", cls: "text-bg-secondary" },
};
export const sourceMeta = (s) => SOURCES[s] || { label: s || "unknown", icon: "◦", cls: "text-bg-secondary" };
