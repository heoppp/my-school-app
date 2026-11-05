// Tiny Supabase client: sign-in and table access over Supabase's REST API.
(function () {
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  function config() {
    const saved = LS.get("sr_server");
    const c = window.SR_CONFIG || {};
    const url = (c.url || (saved && saved.url) || "").replace(/\/+$/, "");
    const key = c.key || (saved && saved.key) || "";
    return url && key ? { url, key, builtIn: !!(c.url && c.key) } : null;
  }

  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }

  let session = LS.get("sr_session");
  let refreshing = null;

  async function raw(path, { method = "GET", body, headers = {}, token } = {}) {
    const c = config();
    if (!c) throw new ApiError("The app isn't connected to a server yet.", 0, "no_config");
    let res;
    try {
      res = await fetch(c.url + path, {
        method,
        headers: {
          apikey: c.key,
          Authorization: "Bearer " + (token || c.key),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new ApiError("No internet connection. Check your connection and try again.", 0, "offline");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.msg || data.message || data.error_description || data.error)) || ("Request failed (" + res.status + ")");
      throw new ApiError(String(msg), res.status, data && (data.code || data.error_code || data.error));
    }
    return { data, headers: res.headers };
  }

  function saveSession(s) {
    if (s && s.access_token) {
      session = {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
        user: s.user ? { id: s.user.id, email: s.user.email, name: (s.user.user_metadata && s.user.user_metadata.name) || "" } : (session && session.user)
      };
    } else session = null;
    LS.set("sr_session", session);
  }

  async function token() {
    if (!session) throw new ApiError("Please log in again.", 401, "no_session");
    if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
    if (!refreshing) {
      refreshing = raw("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } })
        .then(r => saveSession(r.data))
        .catch(e => { if (e.status >= 400 && e.status < 500) saveSession(null); throw e; })
        .finally(() => { refreshing = null; });
    }
    await refreshing;
    if (!session) throw new ApiError("Please log in again.", 401, "no_session");
    return session.access_token;
  }

  async function rest(path, opts = {}) {
    const t = await token();
    try {
      return (await raw("/rest/v1/" + path, { ...opts, token: t })).data;
    } catch (e) {
      if (e.status === 401) { saveSession(null); e.message = "Please log in again."; }
      throw e;
    }
  }

  // Reads every row, 1000 at a time.
  async function all(path) {
    const out = [];
    const t = await token();
    for (let from = 0; ; from += 1000) {
      const { data } = await raw("/rest/v1/" + path, { token: t, headers: { "Range-Unit": "items", Range: `${from}-${from + 999}` } });
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  window.API = {
    LS, ApiError, config,
    saveServer(url, key) { LS.set("sr_server", { url: url.trim(), key: key.trim() }); },
    get user() { return session && session.user; },
    get signedIn() { return !!session; },

    async signUp(email, password, name) {
      const { data } = await raw("/auth/v1/signup", { method: "POST", body: { email, password, data: { name } } });
      if (data && data.access_token) { saveSession(data); return { signedIn: true }; }
      return { signedIn: false }; // email confirmation is switched on
    },
    async signIn(email, password) {
      const { data } = await raw("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
      saveSession(data);
    },
    async resetPassword(email) { await raw("/auth/v1/recover", { method: "POST", body: { email } }); },
    // Uses the 6-digit code from the reset email, then sets the new password.
    async finishReset(email, code, password) {
      const { data } = await raw("/auth/v1/verify", { method: "POST", body: { type: "recovery", email, token: code } });
      saveSession(data);
      await raw("/auth/v1/user", { method: "PUT", body: { password }, token: data.access_token });
    },
    async signOut() {
      const t = session && session.access_token;
      saveSession(null);
      if (t) raw("/auth/v1/logout", { method: "POST", token: t }).catch(() => {});
    },

    select: (table, query = "") => all(`${table}?${query}`),
    async insert(table, row) {
      const d = await rest(table, { method: "POST", body: row, headers: { Prefer: "return=representation" } });
      return Array.isArray(d) ? d[0] : d;
    },
    upsert: (table, row, onConflict) =>
      rest(`${table}?on_conflict=${onConflict}`, { method: "POST", body: row, headers: { Prefer: "resolution=merge-duplicates,return=minimal" } }),
    async update(table, filter, patch) {
      const d = await rest(`${table}?${filter}`, { method: "PATCH", body: patch, headers: { Prefer: "return=representation" } });
      return Array.isArray(d) ? d[0] : d;
    },
    remove: (table, filter) => rest(`${table}?${filter}`, { method: "DELETE" }),
    rpc: (fn, args) => rest("rpc/" + fn, { method: "POST", body: args }),
    // For students and parents: no login, just a code.
    async report(code) { return (await raw("/rest/v1/rpc/get_report", { method: "POST", body: { code } })).data; }
  };
})();
