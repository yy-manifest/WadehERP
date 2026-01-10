"use client";

import { useEffect, useMemo, useState } from "react";

type MeResponse =
  | { user: { id: string; email: string; tenantId: string; createdAt: string } }
  | { error: string };

type SignupResponse =
  | {
      tenantId: string;
      user: { id: string; email: string };
      session: { token: string; expiresAt: string };
    }
  | { error: string; issues?: any[] };

const TOKEN_KEY = "wadeherp_token";

export default function Home() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("password123");
  const [tenantName, setTenantName] = useState("Test Store");

  const [token, setToken] = useState<string>("");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY) || "";
    setToken(t);
  }, []);

  const authHeaders = useMemo(() => {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (token) h["authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);

  async function signup() {
    setStatus("Signing up...");
    setMe(null);

    const res = await fetch(`${API_URL}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, tenantName }),
    });

    const data = (await res.json()) as SignupResponse;

    if ("error" in data) {
      setStatus(`Signup failed: ${data.error}`);
      return;
    }

    localStorage.setItem(TOKEN_KEY, data.session.token);
    setToken(data.session.token);
    setStatus(`Signup OK. Token stored. Expires: ${data.session.expiresAt}`);
  }

  async function fetchMe() {
    setStatus("Fetching /me ...");
    const res = await fetch(`${API_URL}/me`, {
      method: "GET",
      headers: authHeaders,
    });

    const data = (await res.json()) as MeResponse;
    setMe(data);
    if ("error" in data) setStatus(`Me failed: ${data.error}`);
    else setStatus("Me OK");
  }

  async function logout() {
    setStatus("Logging out...");
    setMe(null);

    const res = await fetch(`${API_URL}/auth/logout`, {
      method: "POST",
      headers: authHeaders,
    });

    if (res.status !== 204) {
      // API returns {error} on non-204
      let msg = `Logout failed: ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = `Logout failed: ${j.error}`;
      } catch {}
      setStatus(msg);
      return;
    }

    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setStatus("Logged out. Token cleared.");
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setStatus("Local token cleared.");
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>WadehERP – Frontend M0.1</h1>
      <p style={{ opacity: 0.8, marginBottom: 24 }}>
        API: <code>{API_URL}</code>
      </p>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Signup</h2>

        <div style={{ display: "grid", gap: 8 }}>
          <label>
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
            />
          </label>

          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
            />
          </label>

          <label>
            Tenant Name
            <input
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
            />
          </label>

          <button
            onClick={signup}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #111", cursor: "pointer" }}
          >
            Create account
          </button>
        </div>
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Session</h2>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14 }}>
            Token present: <b>{token ? "YES" : "NO"}</b>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={fetchMe}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #111", cursor: "pointer" }}
            >
              GET /me
            </button>

            <button
              onClick={logout}
              disabled={!token}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #111",
                cursor: token ? "pointer" : "not-allowed",
                opacity: token ? 1 : 0.5,
              }}
            >
              POST /auth/logout
            </button>

            <button
              onClick={clearToken}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", cursor: "pointer" }}
            >
              Clear local token
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 14, opacity: 0.9 }}>
            Status: <code>{status || "—"}</code>
          </div>
        </div>
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Response</h2>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
          {me ? JSON.stringify(me, null, 2) : "—"}
        </pre>
      </section>
    </main>
  );
}
