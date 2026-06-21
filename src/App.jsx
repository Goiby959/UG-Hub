import { useState, useEffect, useRef, useCallback } from "react";

/* ════════════════════════════════════════════════════════════
   UG HUB — single app: Home + Wiki, sharing one global account
   system (signup/login + admin roles) via Supabase.

   Uses plain fetch() against Supabase's REST + Auth HTTP API —
   no SDK import needed, keeping this dependency-light.
   ════════════════════════════════════════════════════════════ */

const SUPABASE_URL = "https://stuvbeomwuaholmimurt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Ww3lGC3lRZaYgsqVnufiuw_bRmhSwJ_";

const AUTH_URL = SUPABASE_URL + "/auth/v1";
const REST_URL = SUPABASE_URL + "/rest/v1";
const SESSION_STORAGE_KEY = "ughub_session";

/* Session persisted in localStorage, so refreshing the page or
   closing and reopening the tab keeps the person signed in. */
function loadStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function storeSession(session) {
  try {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) — session
    // will just live in memory for this page load instead.
  }
}

let currentSession = loadStoredSession(); // { access_token, refresh_token, user }

function authHeaders(useUserToken = true) {
  const token = useUserToken && currentSession ? currentSession.access_token : SUPABASE_ANON_KEY;
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
}

async function supabaseSignUp(email, password, username) {
  try {
    const res = await fetch(AUTH_URL + "/signup", {
      method: "POST",
      headers: authHeaders(false),
      body: JSON.stringify({ email, password, data: { username } }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.msg || data.error_description || "Sign up failed." };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: "Network error. Please try again." };
  }
}

async function supabaseSignIn(email, password) {
  try {
    const res = await fetch(AUTH_URL + "/token?grant_type=password", {
      method: "POST",
      headers: authHeaders(false),
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.error_description || data.msg || "Incorrect email or password." };
    currentSession = data;
    storeSession(data);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: "Network error. Please try again." };
  }
}

function supabaseSignOut() {
  currentSession = null;
  storeSession(null);
}

async function dbSelect(table, query = "") {
  try {
    const res = await fetch(`${REST_URL}/${table}?${query}`, {
      headers: authHeaders(true),
    });
    if (!res.ok) return { ok: false, data: null };
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, data: null };
  }
}

async function dbInsert(table, row) {
  try {
    const res = await fetch(`${REST_URL}/${table}`, {
      method: "POST",
      headers: { ...authHeaders(true), Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.message || "Save failed.", data: null };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: "Network error.", data: null };
  }
}

async function dbUpdate(table, query, patch) {
  try {
    const res = await fetch(`${REST_URL}/${table}?${query}`, {
      method: "PATCH",
      headers: { ...authHeaders(true), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data.message || "Update failed.", data: null };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: "Network error.", data: null };
  }
}

async function dbDelete(table, query) {
  try {
    const res = await fetch(`${REST_URL}/${table}?${query}`, {
      method: "DELETE",
      headers: authHeaders(true),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false };
  }
}

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days + "d ago";
}

/* ──────────────── DESIGN TOKENS ──────────────── */

const tokens = {
  peat: "#1A1208",
  soil: "#241808",
  surface: "#2A1E10",
  moss: "#4A7C3F",
  moss2: "#6BAD5C",
  bone: "#D9C8A8",
  cream: "#F2EAD3",
  amber: "#C98A2E",
  sky: "#5BAFD4",
  danger: "#C24A3A",
  border: "rgba(217,200,168,0.14)",
  borderStrong: "rgba(217,200,168,0.28)",
};

/* ──────────────── ICONS ──────────────── */

const Icon = {
  Lock: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  Plus: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Edit: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  Trash: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  ),
  Shield: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 2 4 5v6c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5l-8-3Z" />
    </svg>
  ),
  X: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Search: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Bold: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 4h7a3.5 3.5 0 0 1 0 7H6z" />
      <path d="M6 11h8a3.5 3.5 0 0 1 0 7H6z" />
    </svg>
  ),
  Italic: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="14" y1="4" x2="9" y2="20" />
      <line x1="16" y1="4" x2="10" y2="4" />
      <line x1="13" y1="20" x2="7" y2="20" />
    </svg>
  ),
  Underline: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <line x1="5" y1="20" x2="19" y2="20" />
    </svg>
  ),
  AlignLeft: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="14" y2="12" />
      <line x1="4" y1="18" x2="17" y2="18" />
    </svg>
  ),
  AlignCenter: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="5.5" y1="18" x2="18.5" y2="18" />
    </svg>
  ),
  AlignRight: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="7" y1="18" x2="20" y2="18" />
    </svg>
  ),
  List: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
    </svg>
  ),
  Link: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" />
    </svg>
  ),
  Image: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5.5-5.5a2 2 0 0 0-2.8 0L3 20" />
    </svg>
  ),
};

/* ════════════════════════════════════════════════════════════
   ROOT APP
   ════════════════════════════════════════════════════════════ */

export default function UGHub() {
  const [currentUser, setCurrentUser] = useState(null); // { id, username, role, email }
  const [route, setRoute] = useState({ name: "home" });
  const [pageIndex, setPageIndex] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [restoringSession, setRestoringSession] = useState(!!currentSession);

  const showToast = useCallback((msg, kind = "info") => {
    setToast({ msg, kind, id: Date.now() });
  }, []);

  // On load, if a session was restored from localStorage, fetch the
  // matching profile so the person doesn't have to log in again.
  useEffect(() => {
    if (!currentSession) {
      setRestoringSession(false);
      return;
    }
    (async () => {
      const res = await dbSelect("profiles", `id=eq.${currentSession.user.id}&select=id,username,role`);
      if (res.ok && res.data.length > 0) {
        const profile = res.data[0];
        setCurrentUser({ id: profile.id, username: profile.username, role: profile.role, email: currentSession.user.email });
      } else {
        // Session token is stale/invalid — clear it.
        supabaseSignOut();
      }
      setRestoringSession(false);
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshPageIndex = useCallback(async () => {
    // Pulls the page list respecting RLS: admins see private pages too,
    // everyone else only sees public ones — enforced by the database.
    const res = await dbSelect("wiki_pages", "select=slug,title,is_private,updated_at,updated_by&order=updated_at.desc");
    if (res.ok) {
      setPageIndex(
        res.data.map((p) => ({
          slug: p.slug,
          title: p.title,
          isPrivate: p.is_private,
          updatedAt: p.updated_at,
          updatedBy: p.updated_by,
        }))
      );
    }
  }, []);

  const isAdmin = currentUser?.role === "admin";
  const isOwner = currentUser?.username === "GoibyJr";

  const navigate = (r) => {
    setRoute(r);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });

    if (r.name === "wiki" || r.name === "wiki-page") {
      refreshPageIndex();
    }
  };

  return (
    <div style={styles.appShell}>
      <GlobalStyle />

      {/* Menu button — fixed top right, present on every route */}
      <button
        onClick={() => setMenuOpen((m) => !m)}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        style={{ ...styles.menuBtn, ...(menuOpen ? styles.menuBtnOpen : {}) }}
      >
        <span style={{ ...styles.menuBar, ...(menuOpen ? styles.menuBarTop : {}) }} />
        <span style={{ ...styles.menuBar, ...(menuOpen ? styles.menuBarMid : {}) }} />
        <span style={{ ...styles.menuBar, ...(menuOpen ? styles.menuBarBot : {}) }} />
      </button>

      <SideMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        currentUser={currentUser}
        isAdmin={isAdmin}
        isOwner={isOwner}
        onNavigate={navigate}
        onLogout={() => {
          supabaseSignOut();
          setCurrentUser(null);
          showToast("Logged out", "info");
          navigate({ name: "home" });
        }}
      />

      {route.name === "home" ? (
        <HomeRoute />
      ) : (
        <WikiShell>
          {route.name === "wiki" ? (
            <HomeView
              pageIndex={pageIndex}
              isAdmin={isAdmin}
              onOpenPage={(slug) => navigate({ name: "wiki-page", slug })}
              onNewPage={() => navigate({ name: "wiki-editor", slug: null })}
            />
          ) : route.name === "wiki-page" ? (
            <PageView
              slug={route.slug}
              currentUser={currentUser}
              isAdmin={isAdmin}
              onEdit={(slug) => navigate({ name: "wiki-editor", slug })}
              onBack={() => navigate({ name: "wiki" })}
              onDeleted={async () => {
                await refreshPageIndex();
                showToast("Page deleted", "success");
                navigate({ name: "wiki" });
              }}
            />
          ) : route.name === "wiki-editor" ? (
            isAdmin ? (
              <EditorView
                slug={route.slug}
                currentUser={currentUser}
                onSaved={async (slug) => {
                  await refreshPageIndex();
                  showToast("Page saved", "success");
                  navigate({ name: "wiki-page", slug });
                }}
                onCancel={() => navigate({ name: "wiki" })}
              />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "admin" ? (
            isOwner ? (
              <AdminView currentUser={currentUser} showToast={showToast} />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "login" ? (
            <LoginView
              onSuccess={(user) => {
                setCurrentUser(user);
                showToast("Welcome, " + user.username + "!", "success");
                navigate({ name: "wiki" });
              }}
            />
          ) : null}
        </WikiShell>
      )}

      {toast && <Toast toast={toast} />}
    </div>
  );
}

const styles = {
  appShell: {
    minHeight: "100vh",
    background: tokens.peat,
    color: tokens.bone,
    fontFamily: "'Rubik', sans-serif",
  },
  menuBtn: {
    position: "fixed",
    top: 20,
    right: 20,
    zIndex: 60,
    width: 48,
    height: 48,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    background: "rgba(26,18,8,0.6)",
    border: `2px solid ${tokens.border}`,
    borderRadius: 8,
    cursor: "pointer",
    backdropFilter: "blur(6px)",
  },
  menuBtnOpen: {
    borderColor: tokens.moss2,
    background: "rgba(26,18,8,0.85)",
  },
  menuBar: {
    width: 22,
    height: 2,
    background: tokens.bone,
    borderRadius: 2,
    transition: "transform 0.25s ease, opacity 0.2s ease",
  },
  menuBarTop: { transform: "translateY(7px) rotate(45deg)" },
  menuBarMid: { opacity: 0 },
  menuBarBot: { transform: "translateY(-7px) rotate(-45deg)" },
};

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,400;0,500;0,600;0,700;0,900;1,400&family=Bebas+Neue&display=swap');
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body { margin: 0; }
      .ughub-scroll::-webkit-scrollbar { width: 8px; }
      .ughub-scroll::-webkit-scrollbar-track { background: transparent; }
      .ughub-scroll::-webkit-scrollbar-thumb { background: ${tokens.moss}; border-radius: 4px; }
      .ughub-editor-content { overflow-wrap: anywhere; word-break: break-word; }
      .ughub-wiki-card { transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease; }
      .ughub-wiki-card:hover {
        border-color: ${tokens.borderStrong};
        transform: translateY(-1px);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 14px rgba(0,0,0,0.32);
      }
      .ughub-wiki-card span[aria-hidden="true"] { transition: opacity 0.18s ease, width 0.18s ease; }
      .ughub-wiki-card:hover span[aria-hidden="true"] { opacity: 1 !important; width: 4px; }
      .ughub-wiki-card-arrow { transition: transform 0.18s ease; }
      .ughub-wiki-card:hover .ughub-wiki-card-arrow { transform: translateX(2px); }
      @media (prefers-reduced-motion: reduce) {
        .ughub-wiki-card, .ughub-wiki-card span[aria-hidden="true"], .ughub-wiki-card-arrow { transition: none !important; }
      }
      .ughub-editor-content a { color: ${tokens.sky}; text-decoration: underline; }
      .ughub-editor-content ul { padding-left: 22px; margin: 8px 0; }
      .ughub-editor-content img { max-width: 100%; border-radius: 6px; margin: 8px 0; }
      .ughub-editor-content p { margin: 0 0 10px 0; }
      input::placeholder, textarea::placeholder { color: rgba(217,200,168,0.35); }
      @keyframes ughub-particle-drift {
        from { transform: translateY(110vh) rotate(0deg); opacity: 0; }
        10%  { opacity: 1; }
        90%  { opacity: 0.6; }
        to   { transform: translateY(-10vh) rotate(720deg); opacity: 0; }
      }
      @keyframes ughub-logo-land {
        from { opacity: 0; transform: translateY(-60px) scale(0.85); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes ughub-slide-up {
        from { opacity: 0; transform: translateY(48px); letter-spacing: 0.25em; }
        to   { opacity: 1; transform: translateY(0); letter-spacing: -0.02em; }
      }
      @keyframes ughub-line-grow {
        from { width: 0; opacity: 0; }
        to   { width: 200px; opacity: 1; }
      }
      @keyframes ughub-fade-in {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes ughub-bob {
        0%, 100% { transform: rotate(45deg) translateY(0); }
        50%       { transform: rotate(45deg) translateY(5px); }
      }
    `}</style>
  );
}

/* ──────────────── TOAST / SPINNER / GUARDS ──────────────── */

function Toast({ toast }) {
  const colors = { success: tokens.moss2, error: tokens.danger, info: tokens.sky };
  return (
    <div
      key={toast.id}
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        background: tokens.soil,
        border: `1px solid ${colors[toast.kind] || tokens.border}`,
        color: tokens.cream,
        padding: "12px 20px",
        borderRadius: 8,
        fontSize: "0.85rem",
        fontWeight: 600,
        zIndex: 90,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {toast.msg}
    </div>
  );
}

function CenterSpinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "120px 0", color: "rgba(217,200,168,0.4)" }}>
      Loading…
    </div>
  );
}

function NotAllowed({ onBack }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <Icon.Lock color={tokens.danger} width={32} height={32} />
      <h2 style={{ fontFamily: "'Rubik'", marginTop: 16 }}>Admins only</h2>
      <p style={{ color: "rgba(217,200,168,0.6)", marginTop: 8 }}>You don't have permission to view this page.</p>
      <button onClick={onBack} style={{ ...buttonStyles.primarySmall, marginTop: 20, padding: "10px 24px" }}>
        Go Back
      </button>
    </div>
  );
}

const buttonStyles = {
  primarySmall: {
    background: `linear-gradient(135deg, ${tokens.moss}, ${tokens.moss2})`,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 16px",
    fontWeight: 700,
    fontSize: "0.8rem",
    cursor: "pointer",
    fontFamily: "'Rubik', sans-serif",
  },
  ghostSmall: {
    background: "transparent",
    color: tokens.bone,
    border: `1px solid ${tokens.border}`,
    borderRadius: 6,
    padding: "7px 14px",
    fontWeight: 600,
    fontSize: "0.78rem",
    cursor: "pointer",
    fontFamily: "'Rubik', sans-serif",
  },
};

const inputStyle = {
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: 8,
  padding: "12px 14px",
  color: tokens.cream,
  fontSize: "0.92rem",
  fontFamily: "'Rubik'",
  width: "100%",
};

const linkBtnStyle = {
  background: "none",
  border: "none",
  color: tokens.moss2,
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "0.82rem",
  padding: 0,
  fontFamily: "'Rubik'",
};

/* ════════════════════════════════════════════════════════════
   SIDE MENU (global — logo links Home, plus Wiki/Admin/Login)
   ════════════════════════════════════════════════════════════ */

function SideMenu({ open, onClose, currentUser, isAdmin, isOwner, onNavigate, onLogout }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 55,
          background: "rgba(10,7,3,0.55)",
          backdropFilter: "blur(2px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />
      <nav
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          zIndex: 58,
          width: "min(300px, 82vw)",
          height: "100%",
          background: `linear-gradient(180deg, ${tokens.soil} 0%, ${tokens.peat} 100%)`,
          borderLeft: `1px solid ${tokens.border}`,
          boxShadow: "-12px 0 40px rgba(0,0,0,0.5)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s cubic-bezier(0.22,1,0.36,1)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 0",
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 16px 8px" }}>
          <button onClick={onClose} style={{ ...buttonStyles.ghostSmall, padding: 8 }}>
            <Icon.X />
          </button>
        </div>

        <button
          onClick={() => onNavigate({ name: "home" })}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "8px 24px 20px",
          }}
        >
          <img src={ASSETS.logo} alt="UG logo" style={{ width: 90, height: "auto", filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.5))" }} draggable="false" />
          <span style={{ fontFamily: "'Rubik'", fontWeight: 700, fontSize: "0.85rem", color: tokens.bone, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Home
          </span>
        </button>

        <div style={{ height: 1, background: tokens.border, margin: "0 20px 8px" }} />

        <MenuLink label="Wiki" onClick={() => onNavigate({ name: "wiki" })} />
        {isAdmin && <MenuLink label="New Wiki Page" onClick={() => onNavigate({ name: "wiki-editor", slug: null })} />}
        {isOwner && <MenuLink label="Admin · Manage Users" icon={<Icon.Shield color={tokens.amber} />} onClick={() => onNavigate({ name: "admin" })} />}

        <div style={{ marginTop: "auto" }}>
          <div style={{ height: 1, background: tokens.border, margin: "8px 20px" }} />
          {currentUser ? (
            <div style={{ padding: "10px 24px 4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: tokens.bone, marginBottom: 10 }}>
                {isAdmin && <Icon.Shield color={tokens.amber} />}
                Signed in as <strong>{currentUser.username}</strong>
              </div>
              <button onClick={onLogout} style={{ ...buttonStyles.ghostSmall, width: "100%" }}>
                Log out
              </button>
            </div>
          ) : (
            <MenuLink label="Log In / Sign Up" onClick={() => onNavigate({ name: "login" })} />
          )}
          <div style={{ padding: "16px 24px 4px", fontSize: "0.7rem", color: "rgba(217,200,168,0.35)" }}>
            UG Hub is the official UG website.
          </div>
        </div>
      </nav>
    </>
  );
}

function MenuLink({ label, onClick, icon }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: hover ? "rgba(107,173,92,0.1)" : "transparent",
        border: "none",
        color: tokens.bone,
        textAlign: "left",
        padding: "14px 24px",
        fontSize: "0.92rem",
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "'Rubik', sans-serif",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/* ════════════════════════════════════════════════════════════
   HOME ROUTE (the original landing page, recreated in React)
   ════════════════════════════════════════════════════════════ */

function HomeRoute() {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    const sizes = [40, 60, 80, 100, 120, 160];
    const list = Array.from({ length: 18 }).map((_, i) => ({
      id: i,
      size: sizes[Math.floor(Math.random() * sizes.length)],
      left: Math.random() * 100,
      duration: 18 + Math.random() * 30,
      delay: -(Math.random() * 40),
    }));
    setParticles(list);
  }, []);

  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      {/* Ambient background */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          background:
            "radial-gradient(ellipse 70% 55% at 50% 110%, rgba(74,124,63,0.18) 0%, transparent 70%)," +
            "radial-gradient(ellipse 100% 40% at 50% 100%, rgba(44,26,14,0.9) 0%, transparent 80%)," +
            "radial-gradient(ellipse 120% 60% at 20% -10%, rgba(91,175,212,0.07) 0%, transparent 60%)",
          pointerEvents: "none",
        }}
      />

      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "fixed",
            zIndex: 0,
            borderRadius: "50%",
            background: "rgba(140,123,107,0.08)",
            width: p.size,
            height: p.size,
            left: p.left + "vw",
            animation: `ughub-particle-drift linear infinite`,
            animationDuration: p.duration + "s",
            animationDelay: p.delay + "s",
            pointerEvents: "none",
          }}
        />
      ))}

      <main
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px 80px",
        }}
      >
        <div style={{ marginBottom: 32 }}>
          <img
            src={ASSETS.logo}
            alt="UG logo – chunky stone letters with mossy patches"
            draggable="false"
            style={{
              width: "min(340px, 80vw)",
              height: "auto",
              filter: "drop-shadow(0 12px 40px rgba(74,124,63,0.5)) drop-shadow(0 4px 16px rgba(0,0,0,0.7))",
              animation: "ughub-logo-land 1s cubic-bezier(0.22,1,0.36,1) both",
            }}
          />
        </div>

        <div style={{ textAlign: "center", marginBottom: 20, overflow: "hidden" }}>
          <h1
            style={{
              fontFamily: "'Rubik', sans-serif",
              fontWeight: 900,
              fontSize: "clamp(3.2rem, 12vw, 7rem)",
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: "#FFFFFF",
              margin: 0,
              animation: "ughub-slide-up 0.9s cubic-bezier(0.22,1,0.36,1) 0.35s both",
            }}
          >
            UG Hub
          </h1>
          <span
            style={{
              display: "block",
              width: 0,
              height: 3,
              background: `linear-gradient(90deg, ${tokens.moss}, ${tokens.amber}, ${tokens.moss2})`,
              margin: "8px auto 0",
              borderRadius: 2,
              animation: "ughub-line-grow 0.7s cubic-bezier(0.22,1,0.36,1) 1s both",
            }}
          />
        </div>

        <p
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: "clamp(1.4rem, 4.5vw, 2.2rem)",
            color: "#FFFFFF",
            textAlign: "center",
            marginBottom: 48,
            letterSpacing: "0.04em",
            animation: "ughub-fade-in 0.8s ease 1.1s both",
          }}
        >
          Everything UG, Here In UG Hub!
        </p>

        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            justifyContent: "center",
            animation: "ughub-fade-in 0.8s ease 1.4s both",
          }}
        >
          <a
            href="https://www.youtube.com/@UG_vr"
            target="_blank"
            rel="noreferrer"
            style={{ ...ctaStyles.base, ...ctaStyles.outline }}
          >
            <img
              src={ASSETS.youtube}
              alt=""
              style={{ width: 24, height: 24, objectFit: "contain", background: "#fff", borderRadius: 5, padding: 2 }}
            />
            UG Subscribe
          </a>
          <a
            href="https://www.meta.com/experiences/ug/8485526434899813/"
            target="_blank"
            rel="noreferrer"
            style={{ ...ctaStyles.base, ...ctaStyles.primary }}
          >
            <img
              src={ASSETS.dino}
              alt=""
              style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }}
            />
            UG Play Free
          </a>
        </div>
      </main>
    </div>
  );
}

const ctaStyles = {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 32px",
    borderRadius: 6,
    fontFamily: "'Rubik', sans-serif",
    fontWeight: 700,
    fontSize: "0.95rem",
    letterSpacing: "0.04em",
    textDecoration: "none",
    border: "none",
    cursor: "pointer",
  },
  primary: {
    background: `linear-gradient(135deg, ${tokens.moss} 0%, ${tokens.moss2} 100%)`,
    color: "#fff",
    boxShadow: "0 4px 20px rgba(74,124,63,0.45)",
  },
  outline: {
    background: "transparent",
    color: tokens.bone,
    border: "2px solid rgba(217,200,168,0.35)",
  },
};

/* ════════════════════════════════════════════════════════════
   WIKI SHELL (top bar + content width wrapper for wiki routes)
   ════════════════════════════════════════════════════════════ */

function WikiShell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(ellipse 90% 50% at 50% 0%, rgba(74,124,63,0.10) 0%, transparent 60%), ${tokens.peat}` }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "90px 20px 80px" }}>{children}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   WIKI: HOME LIST
   ════════════════════════════════════════════════════════════ */

function HomeView({ pageIndex, isAdmin, onOpenPage, onNewPage }) {
  const [query, setQuery] = useState("");

  const visiblePages = pageIndex.filter((p) => {
    if (p.isPrivate && !isAdmin) return false;
    if (!query.trim()) return true;
    return p.title.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 4 }}>
          Knowledge Base
        </p>
        <h1 style={{ fontFamily: "'Rubik'", fontWeight: 900, fontSize: "2.4rem", color: tokens.cream, margin: 0 }}>
          The Wiki
        </h1>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(217,200,168,0.4)" }}>
            <Icon.Search />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages…"
            style={{ ...inputStyle, padding: "11px 14px 11px 38px" }}
          />
        </div>
        {isAdmin && (
          <button onClick={onNewPage} style={{ ...buttonStyles.primarySmall, display: "flex", alignItems: "center", gap: 6, padding: "10px 18px" }}>
            <Icon.Plus /> New Page
          </button>
        )}
      </div>

      {visiblePages.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", border: `1px dashed ${tokens.border}`, borderRadius: 10, color: "rgba(217,200,168,0.45)" }}>
          {pageIndex.length === 0 ? (
            <>
              <p style={{ marginBottom: 12 }}>No pages yet. The wiki is waiting for its first entry.</p>
              {isAdmin && (
                <button onClick={onNewPage} style={{ ...buttonStyles.primarySmall, padding: "10px 22px" }}>
                  Create the first page
                </button>
              )}
            </>
          ) : (
            <p>No pages match "{query}".</p>
          )}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {visiblePages
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .map((p) => (
              <button
                key={p.slug}
                onClick={() => onOpenPage(p.slug)}
                className="ughub-wiki-card"
                style={{
                  position: "relative",
                  textAlign: "left",
                  background: `linear-gradient(135deg, #2F2212 0%, ${tokens.surface} 100%)`,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: 10,
                  padding: "17px 18px 17px 22px",
                  cursor: "pointer",
                  color: tokens.bone,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  overflow: "hidden",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 1px 2px rgba(0,0,0,0.2)",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: p.isPrivate ? tokens.amber : tokens.moss,
                    opacity: 0.55,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: "1.05rem",
                        color: tokens.cream,
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                    >
                      {p.title}
                    </span>
                    {p.isPrivate && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: "0.66rem",
                          fontWeight: 600,
                          color: tokens.amber,
                          border: "1px solid rgba(201,138,46,0.35)",
                          background: "rgba(201,138,46,0.08)",
                          padding: "2px 7px",
                          borderRadius: 4,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          flexShrink: 0,
                        }}
                      >
                        <Icon.Lock />
                        Private
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.76rem", color: "rgba(217,200,168,0.45)", marginTop: 5 }}>
                    Updated {timeAgo(p.updatedAt)} by {p.updatedBy || "unknown"}
                  </div>
                </div>
                <span className="ughub-wiki-card-arrow" style={{ color: tokens.moss2, fontSize: "1.2rem", flexShrink: 0 }}>
                  →
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   WIKI: PAGE VIEW
   ════════════════════════════════════════════════════════════ */

function PageView({ slug, currentUser, isAdmin, onEdit, onBack, onDeleted }) {
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const res = await dbSelect("wiki_pages", `slug=eq.${encodeURIComponent(slug)}&select=*`);
      const row = res.ok && res.data.length > 0 ? res.data[0] : null;
      setPage(
        row
          ? {
              title: row.title,
              content: row.content,
              isPrivate: row.is_private,
              updatedAt: row.updated_at,
              updatedBy: row.updated_by,
            }
          : null
      );
      setLoading(false);
    })();
  }, [slug]);

  if (loading) return <CenterSpinner />;

  if (!page) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <p style={{ color: "rgba(217,200,168,0.6)" }}>This page doesn't exist.</p>
        <button onClick={onBack} style={{ ...buttonStyles.primarySmall, marginTop: 16, padding: "10px 24px" }}>
          Back to Wiki
        </button>
      </div>
    );
  }

  if (page.isPrivate && !isAdmin) {
    return <NotAllowed onBack={onBack} />;
  }

  const handleDelete = async () => {
    await dbDelete("wiki_pages", `slug=eq.${encodeURIComponent(slug)}`);
    onDeleted();
  };

  return (
    <div>
      <button onClick={onBack} style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>
        ← Back to Wiki
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 8, minWidth: 0 }}>
        <h1
          style={{
            fontFamily: "'Rubik'",
            fontWeight: 900,
            fontSize: "2.1rem",
            color: tokens.cream,
            margin: 0,
            minWidth: 0,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          {page.title}
        </h1>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={() => onEdit(slug)} style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.Edit /> Edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 6, color: tokens.danger, borderColor: "rgba(194,74,58,0.4)" }}
            >
              <Icon.Trash /> Delete
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
        {page.isPrivate && (
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: tokens.amber, border: "1px solid rgba(201,138,46,0.3)", padding: "3px 9px", borderRadius: 4 }}>
            <Icon.Lock /> Private — admins only
          </span>
        )}
        <span style={{ fontSize: "0.76rem", color: "rgba(217,200,168,0.4)" }}>
          Updated {timeAgo(page.updatedAt)} by {page.updatedBy}
        </span>
      </div>

      <div
        className="ughub-editor-content"
        style={{ fontSize: "1rem", lineHeight: 1.7, color: tokens.bone }}
        dangerouslySetInnerHTML={{ __html: page.content || "<p>(This page is empty.)</p>" }}
      />

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)}>
          <h3 style={{ fontFamily: "'Rubik'", marginBottom: 10 }}>Delete "{page.title}"?</h3>
          <p style={{ color: "rgba(217,200,168,0.6)", fontSize: "0.88rem", marginBottom: 20 }}>This can't be undone.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setConfirmDelete(false)} style={buttonStyles.ghostSmall}>
              Cancel
            </button>
            <button onClick={handleDelete} style={{ ...buttonStyles.primarySmall, background: tokens.danger }}>
              Delete Page
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,7,3,0.65)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: tokens.soil, border: `1px solid ${tokens.border}`, borderRadius: 12, padding: 24, maxWidth: 400, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
      >
        {children}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   LOGIN / SIGNUP (global account system)
   ════════════════════════════════════════════════════════════ */

function LoginView({ onSuccess }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchProfile = async (userId) => {
    const res = await dbSelect("profiles", `id=eq.${userId}&select=id,username,role`);
    if (!res.ok || !res.data || res.data.length === 0) return null;
    return res.data[0];
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && !username.trim()) {
      setError("Choose a username.");
      return;
    }
    setSubmitting(true);

    if (mode === "login") {
      const signInRes = await supabaseSignIn(email.trim(), password);
      if (!signInRes.ok) {
        setError(signInRes.error);
        setSubmitting(false);
        return;
      }
      const profile = await fetchProfile(signInRes.data.user.id);
      if (!profile) {
        setError("Signed in, but no profile was found for this account.");
        setSubmitting(false);
        return;
      }
      onSuccess({ id: profile.id, username: profile.username, role: profile.role, email: signInRes.data.user.email });
    } else {
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        setSubmitting(false);
        return;
      }
      const signUpRes = await supabaseSignUp(email.trim(), password, username.trim());
      if (!signUpRes.ok) {
        setError(signUpRes.error);
        setSubmitting(false);
        return;
      }
      // Supabase sign-up logs the person in immediately if email
      // confirmation is off, returning a session directly.
      if (signUpRes.data.access_token) {
        currentSession = signUpRes.data;
        storeSession(signUpRes.data);
      } else {
        // Email confirmation is required — fall back to a manual sign-in.
        const signInRes = await supabaseSignIn(email.trim(), password);
        if (!signInRes.ok) {
          setError("Account created — check your email to confirm, then log in.");
          setSubmitting(false);
          setMode("login");
          return;
        }
      }
      // The profile row is created automatically by a database trigger
      // (on_auth_user_created) the moment the auth user is inserted —
      // no client-side insert needed, which avoids RLS/timing issues.
      const userId = (signUpRes.data.user || signUpRes.data).id;
      onSuccess({ id: userId, username: username.trim(), role: "viewer", email: email.trim() });
    }
    setSubmitting(false);
  };

  return (
    <div style={{ maxWidth: 360, margin: "40px auto" }}>
      <h1 style={{ fontFamily: "'Rubik'", fontWeight: 900, fontSize: "1.9rem", color: tokens.cream, textAlign: "center", marginBottom: 6 }}>
        {mode === "login" ? "Log In" : "Sign Up"}
      </h1>
      <p style={{ textAlign: "center", color: "rgba(217,200,168,0.5)", fontSize: "0.85rem", marginBottom: 28 }}>
        {mode === "login" ? "Welcome back to UG Hub." : "New accounts start as viewers — an admin can upgrade you."}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          style={inputStyle}
        />
        {mode === "signup" && (
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="username" style={inputStyle} />
        )}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit(e);
          }}
          placeholder="Password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          style={inputStyle}
        />

        {error && <div style={{ color: tokens.danger, fontSize: "0.82rem" }}>{error}</div>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            ...buttonStyles.primarySmall,
            padding: "12px",
            fontSize: "0.9rem",
            marginTop: 4,
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Please wait…" : mode === "login" ? "Log In" : "Create Account"}
        </button>
      </div>

      <p style={{ textAlign: "center", fontSize: "0.82rem", color: "rgba(217,200,168,0.5)", marginTop: 18 }}>
        {mode === "login" ? (
          <>
            No account?{" "}
            <button onClick={() => { setMode("signup"); setError(""); }} style={linkBtnStyle}>
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have one?{" "}
            <button onClick={() => { setMode("login"); setError(""); }} style={linkBtnStyle}>
              Log in
            </button>
          </>
        )}
      </p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   ADMIN: MANAGE USERS
   ════════════════════════════════════════════════════════════ */

function AdminView({ currentUser, showToast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await dbSelect("profiles", "select=id,username,role&order=username.asc");
    setUsers(res.ok ? res.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setRole = async (id, username, role) => {
    const res = await dbUpdate("profiles", `id=eq.${id}`, { role });
    if (!res.ok) {
      showToast("Couldn't update role: " + res.error, "error");
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    showToast(`${username} is now ${role}`, "success");
  };

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <p style={{ fontFamily: "'Rubik'", color: tokens.amber, fontSize: "0.72rem", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 8 }}>
        Admin Tools
      </p>
      <h1 style={{ fontFamily: "'Rubik'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, marginTop: 0, marginBottom: 8 }}>Manage Users</h1>
      <p style={{ color: "rgba(217,200,168,0.55)", fontSize: "0.88rem", marginBottom: 24 }}>
        Grant or revoke admin access. Admins can create, edit, delete, and privatize wiki pages.
      </p>

      <div style={{ display: "grid", gap: 8 }}>
        {users.map((u) => (
          <div
            key={u.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: tokens.surface,
              border: `1px solid ${tokens.border}`,
              borderRadius: 8,
              padding: "12px 16px",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {u.role === "admin" && <Icon.Shield color={tokens.amber} />}
              <span style={{ fontWeight: 700, color: tokens.cream }}>{u.username}</span>
              {u.id === currentUser?.id && <span style={{ fontSize: "0.7rem", color: "rgba(217,200,168,0.4)" }}>(you)</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {u.role !== "admin" ? (
                <button onClick={() => setRole(u.id, u.username, "admin")} style={{ ...buttonStyles.ghostSmall, color: tokens.amber, borderColor: "rgba(201,138,46,0.35)" }}>
                  Make Admin
                </button>
              ) : (
                <button onClick={() => setRole(u.id, u.username, "viewer")} style={buttonStyles.ghostSmall}>
                  Revoke Admin
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   EDITOR (rich text — bold/italic/underline/align/list/
   link/image/font size/font color)
   ════════════════════════════════════════════════════════════ */

function EditorView({ slug, currentUser, onSaved, onCancel }) {
  const [title, setTitle] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(!!slug);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const isNewPage = !slug;
  const [fontSize, setFontSize] = useState("3");
  const [fontColor, setFontColor] = useState("#D9C8A8");
  const [activeStates, setActiveStates] = useState({});
  const [popover, setPopover] = useState(null); // null | "link" | "image"
  const savedRangeRef = useRef(null);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }
    (async () => {
      const res = await dbSelect("wiki_pages", `slug=eq.${encodeURIComponent(slug)}&select=*`);
      const row = res.ok && res.data.length > 0 ? res.data[0] : null;
      if (row) {
        setTitle(row.title);
        setIsPrivate(!!row.is_private);
        if (editorRef.current) editorRef.current.innerHTML = row.content || "";
      }
      setLoading(false);
    })();
  }, [slug]);

  // Track which formatting commands are active at the current cursor
  // position, so toolbar buttons can show a real pressed/active state
  // instead of being purely decorative.
  const refreshActiveStates = useCallback(() => {
    if (!editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current.contains(sel.anchorNode)) return;
    try {
      setActiveStates({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        justifyLeft: document.queryCommandState("justifyLeft"),
        justifyCenter: document.queryCommandState("justifyCenter"),
        justifyRight: document.queryCommandState("justifyRight"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
      });
    } catch (e) {
      // queryCommandState can throw in some browsers for some commands —
      // safe to ignore, toolbar just won't show active state that tick.
    }
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", refreshActiveStates);
    return () => document.removeEventListener("selectionchange", refreshActiveStates);
  }, [refreshActiveStates]);

  const exec = (cmd, value = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    refreshActiveStates();
  };

  const applyFontSize = (size) => {
    setFontSize(size);
    exec("fontSize", size);
  };

  const applyFontColor = (color) => {
    setFontColor(color);
    exec("foreColor", color);
  };

  // Remember the current text selection before opening a popover, since
  // clicking into the popover's input will otherwise lose it.
  const openPopover = (kind) => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    } else {
      savedRangeRef.current = null;
    }
    setPopover(kind);
  };

  const restoreSelection = () => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (savedRangeRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  };

  const confirmLink = (url) => {
    if (!url.trim()) {
      setPopover(null);
      return;
    }
    const finalUrl = /^https?:\/\//i.test(url.trim()) ? url.trim() : "https://" + url.trim();
    restoreSelection();
    document.execCommand("createLink", false, finalUrl);
    setPopover(null);
  };

  const confirmImage = (url) => {
    if (!url.trim()) {
      setPopover(null);
      return;
    }
    restoreSelection();
    document.execCommand("insertImage", false, url.trim());
    setPopover(null);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      window.alert("Give the page a title first.");
      return;
    }
    setSaving(true);
    const content = editorRef.current?.innerHTML || "";

    if (isNewPage) {
      let finalSlug = slugify(title);
      let unique = finalSlug || "page";
      let n = 2;
      // Ensure slug uniqueness by checking existing pages
      while (true) {
        const check = await dbSelect("wiki_pages", `slug=eq.${encodeURIComponent(unique)}&select=slug`);
        if (!check.ok || check.data.length === 0) break;
        unique = finalSlug + "-" + n;
        n++;
      }
      const insertRes = await dbInsert("wiki_pages", {
        slug: unique,
        title: title.trim(),
        content,
        is_private: isPrivate,
        updated_by: currentUser.username,
      });
      setSaving(false);
      if (!insertRes.ok) {
        window.alert("Couldn't save the page: " + insertRes.error);
        return;
      }
      onSaved(unique);
    } else {
      const updateRes = await dbUpdate("wiki_pages", `slug=eq.${encodeURIComponent(slug)}`, {
        title: title.trim(),
        content,
        is_private: isPrivate,
        updated_at: new Date().toISOString(),
        updated_by: currentUser.username,
      });
      setSaving(false);
      if (!updateRes.ok) {
        window.alert("Couldn't save the page: " + updateRes.error);
        return;
      }
      onSaved(slug);
    }
  };

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <button onClick={onCancel} style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>
        ← Cancel
      </button>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Page title…"
        style={{
          ...inputStyle,
          fontSize: "1.6rem",
          fontWeight: 800,
          fontFamily: "'Rubik'",
          marginBottom: 14,
          background: "transparent",
          border: "none",
          borderBottom: `2px solid ${tokens.border}`,
          borderRadius: 0,
          padding: "8px 2px",
        }}
      />

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", color: "rgba(217,200,168,0.7)", marginBottom: 20, cursor: "pointer" }}>
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
        <Icon.Lock color={tokens.amber} />
        Make this page private (admins only)
      </label>

      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            alignItems: "center",
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: "10px 10px 0 0",
            padding: "8px 10px",
          }}
        >
          <ToolBtn onClick={() => exec("bold")} title="Bold" active={activeStates.bold}>
            <Icon.Bold />
          </ToolBtn>
          <ToolBtn onClick={() => exec("italic")} title="Italic" active={activeStates.italic}>
            <Icon.Italic />
          </ToolBtn>
          <ToolBtn onClick={() => exec("underline")} title="Underline" active={activeStates.underline}>
            <Icon.Underline />
          </ToolBtn>
          <Divider />
          <ToolBtn onClick={() => exec("justifyLeft")} title="Align left" active={activeStates.justifyLeft}>
            <Icon.AlignLeft />
          </ToolBtn>
          <ToolBtn onClick={() => exec("justifyCenter")} title="Align center" active={activeStates.justifyCenter}>
            <Icon.AlignCenter />
          </ToolBtn>
          <ToolBtn onClick={() => exec("justifyRight")} title="Align right" active={activeStates.justifyRight}>
            <Icon.AlignRight />
          </ToolBtn>
          <Divider />
          <ToolBtn onClick={() => exec("insertUnorderedList")} title="Bullet list" active={activeStates.insertUnorderedList}>
            <Icon.List />
          </ToolBtn>
          <Divider />
          <ToolBtn onClick={() => openPopover("link")} title="Insert link" active={popover === "link"}>
            <Icon.Link />
          </ToolBtn>
          <ToolBtn onClick={() => openPopover("image")} title="Insert image" active={popover === "image"}>
            <Icon.Image />
          </ToolBtn>
          <Divider />
          <select value={fontSize} onChange={(e) => applyFontSize(e.target.value)} title="Font size" style={selectStyle}>
            <option value="1">Small</option>
            <option value="3">Normal</option>
            <option value="5">Large</option>
            <option value="7">XL</option>
          </select>
          <input
            type="color"
            value={fontColor}
            onChange={(e) => applyFontColor(e.target.value)}
            title="Font color"
            style={{ width: 32, height: 32, border: `1px solid ${tokens.border}`, borderRadius: 6, background: "none", cursor: "pointer", padding: 2 }}
          />
        </div>

        {popover && (
          <ToolbarPopover
            kind={popover}
            onConfirm={popover === "link" ? confirmLink : confirmImage}
            onClose={() => setPopover(null)}
          />
        )}

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="ughub-editor-content ughub-editor-body"
          onKeyUp={refreshActiveStates}
          onMouseUp={refreshActiveStates}
          onFocus={refreshActiveStates}
          style={{
            minHeight: 320,
            background: tokens.peat,
            border: `1px solid ${tokens.border}`,
            borderTop: "none",
            borderRadius: "0 0 10px 10px",
            padding: 18,
            fontSize: "1rem",
            lineHeight: 1.7,
            color: tokens.bone,
            outline: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
        <button onClick={onCancel} style={buttonStyles.ghostSmall}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} style={{ ...buttonStyles.primarySmall, padding: "10px 24px" }}>
          {saving ? "Saving…" : "Save Page"}
        </button>
      </div>
    </div>
  );
}

function ToolbarPopover({ kind, onConfirm, onClose }) {
  const [value, setValue] = useState("");
  const inputRef = useRef(null);
  const isLink = kind === "link";

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => onConfirm(value);

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 20,
        top: "100%",
        left: 0,
        marginTop: 6,
        background: tokens.soil,
        border: `1px solid ${tokens.borderStrong}`,
        borderRadius: 10,
        padding: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        display: "flex",
        gap: 8,
        alignItems: "center",
        width: "min(100%, 340px)",
      }}
    >
      <span style={{ color: tokens.moss2, flexShrink: 0 }}>{isLink ? <Icon.Link /> : <Icon.Image />}</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={isLink ? "example.com" : "Image URL…"}
        style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: "0.86rem" }}
      />
      <button onClick={submit} style={{ ...buttonStyles.primarySmall, padding: "8px 14px", fontSize: "0.82rem", flexShrink: 0 }}>
        Add
      </button>
      <button onClick={onClose} style={{ ...buttonStyles.ghostSmall, padding: 8, flexShrink: 0 }}>
        <Icon.X width={14} height={14} />
      </button>
    </div>
  );
}

function ToolBtn({ onClick, title, active, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={title}
      aria-pressed={!!active}
      style={{
        minWidth: 34,
        height: 34,
        padding: "0 9px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "rgba(107,173,92,0.28)" : hover ? "rgba(107,173,92,0.14)" : "rgba(217,200,168,0.05)",
        border: `1px solid ${active ? tokens.moss2 : tokens.border}`,
        borderRadius: 6,
        color: active ? tokens.moss2 : tokens.bone,
        cursor: "pointer",
        transition: "background 0.12s ease, border-color 0.12s ease, color 0.12s ease",
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 22, background: tokens.border, margin: "0 2px", flexShrink: 0 }} />;
}

const selectStyle = {
  background: tokens.peat,
  border: `1px solid ${tokens.border}`,
  borderRadius: 6,
  color: tokens.bone,
  fontSize: "0.78rem",
  padding: "6px 8px",
  fontFamily: "'Rubik'",
  cursor: "pointer",
};

/* ════════════════════════════════════════════════════════════
   ASSETS (filled in after creation — see build step)
   ════════════════════════════════════════════════════════════ */

const ASSETS = {
  logo: "/images/logo.png",
  dino: "/images/dino.png",
  youtube: "/images/youtube.png",
};
