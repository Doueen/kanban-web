/* fetch wrapper: Basic Auth header + 401 → login state + error normalization. */

let _on401 = null;

export function setOnUnauthorized(fn) {
  _on401 = fn;
}

export function authHeader() {
  try {
    const a = JSON.parse(localStorage.getItem("kb-auth") || "null");
    return a ? "Basic " + btoa(a.u + ":" + a.p) : "";
  } catch (_) {
    return "";
  }
}

function handle401() {
  if (_on401) _on401();
}

export async function api(path, opts = {}) {
  const h = authHeader();
  if (h) opts.headers = { ...(opts.headers || {}), Authorization: h };
  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* non-JSON body */
  }
  if (res.status === 401) {
    handle401();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

export async function apiText(path) {
  const h = authHeader();
  const res = await fetch(path, h ? { headers: { Authorization: h } } : {});
  if (res.status === 401) {
    handle401();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const d = await res.json();
      if (d && d.detail) detail = d.detail;
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.text();
}

export const jsonOpts = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
