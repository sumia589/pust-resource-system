/* Small fetch wrapper that talks to the Express backend */
const TOKEN_KEY = "rms_token";
const USER_KEY = "rms_user";

const Auth = {
  token: () => localStorage.getItem(TOKEN_KEY),
  user: () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (Auth.token()) headers.Authorization = "Bearer " + Auth.token();

  let res;
  try {
    res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Cannot reach the server. Is it running?");
  }

  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }

  if (res.status === 401 && !path.startsWith("/auth/")) {
    Auth.clear();
    window.location.href = "index.html";
    throw new Error("Session expired.");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
