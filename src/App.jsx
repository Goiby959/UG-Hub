import { useState, useEffect, useRef, useCallback, useMemo } from "react";

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
const STORAGE_URL = SUPABASE_URL + "/storage/v1";
const IMAGE_BUCKET = "wiki-images";
const FAN_ART_BUCKET = "fan-art";
const HOF_BUCKET = "hall-of-fame";
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

// Supabase's Data API (PostgREST) caps any single request at 1000 rows
// by default. For tables that can realistically grow past that — like
// fan_art_boosts and fan_art_likes once the site has real traffic —
// use this instead of dbSelect so results don't silently truncate.
// It pages through with the Range header until a page comes back
// shorter than the page size, meaning there's nothing left to fetch.
async function dbSelectAll(table, query = "", pageSize = 1000) {
  let all = [];
  let from = 0;
  try {
    while (true) {
      const res = await fetch(`${REST_URL}/${table}?${query}`, {
        headers: {
          ...authHeaders(true),
          Range: `${from}-${from + pageSize - 1}`,
          "Range-Unit": "items",
        },
      });
      if (!res.ok) return { ok: false, data: null };
      const page = await res.json();
      all = all.concat(page);
      if (page.length < pageSize) break; // last page reached
      from += pageSize;
    }
    return { ok: true, data: all };
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

async function dbRpc(fn, params = {}) {
  try {
    const res = await fetch(`${REST_URL}/rpc/${fn}`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: (data && data.message) || "Request failed.", data: null };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: "Network error.", data: null };
  }
}

// Automatic badge kinds that boil down to "count or sum a column from a
// table, filtered to this user, compare to a threshold." Adding a future
// kind like this is just one more entry here.
const AUTO_BADGE_RULES = {
  fan_art_likes: { table: "fan_art", filterCol: "user_id", select: "like_count", reduce: (rows) => rows.reduce((s, r) => s + (r.like_count || 0), 0) },
  fan_art_posts: { table: "fan_art", filterCol: "user_id", select: "id", reduce: (rows) => rows.length },
  followers: { table: "fan_art_follows", filterCol: "following_id", select: "id", reduce: (rows) => rows.length },
  comments: { table: "fan_art_comments", filterCol: "user_id", select: "id", reduce: (rows) => rows.length },
};

// Works out which badges a given user currently qualifies for.
// Manual badges come straight from user_badges. Automatic badges are
// computed live from existing data, so they're always in sync and
// never go stale.
async function getUserBadges(userId, userRole) {
  const badgesRes = await dbSelect("badges", "select=*&order=created_at.asc");
  if (!badgesRes.ok || !userId) return [];
  const allBadges = badgesRes.data;
  const earned = [];

  const manualBadges = allBadges.filter((b) => b.kind === "manual");
  if (manualBadges.length > 0) {
    const uRes = await dbSelect("user_badges", "user_id=eq." + userId + "&select=badge_id");
    const heldIds = new Set(uRes.ok ? uRes.data.map((r) => r.badge_id) : []);
    manualBadges.forEach((b) => { if (heldIds.has(b.id)) earned.push(b); });
  }

  if (userRole === "admin") {
    allBadges.forEach((b) => { if (b.kind === "admin") earned.push(b); });
  }

  const hofBadges = allBadges.filter((b) => b.kind === "hall_of_fame");
  if (hofBadges.length > 0) {
    const hofRes = await dbSelect("hall_of_fame", "linked_user_id=eq." + userId + "&select=id&limit=1");
    if (hofRes.ok && hofRes.data.length > 0) hofBadges.forEach((b) => earned.push(b));
  }

  const ageBadges = allBadges.filter((b) => b.kind === "account_age");
  if (ageBadges.length > 0) {
    const pRes = await dbSelect("profiles", "id=eq." + userId + "&select=created_at");
    const joined = pRes.ok && pRes.data.length > 0 ? pRes.data[0].created_at : null;
    if (joined) {
      const days = (Date.now() - new Date(joined).getTime()) / 86400000;
      ageBadges.forEach((b) => { if (days >= (b.threshold || 0)) earned.push(b); });
    }
  }

  for (const kind of Object.keys(AUTO_BADGE_RULES)) {
    const rules = allBadges.filter((b) => b.kind === kind);
    if (rules.length === 0) continue;
    const rule = AUTO_BADGE_RULES[kind];
    const res = await dbSelect(rule.table, rule.filterCol + "=eq." + userId + "&select=" + rule.select);
    const total = res.ok ? rule.reduce(res.data) : 0;
    rules.forEach((b) => { if (total >= (b.threshold || 0)) earned.push(b); });
  }

  return earned;
}

// Uploads an image file to the fan-art Storage bucket.
async function uploadFanArt(file) {
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const res = await fetch(`${STORAGE_URL}/object/${FAN_ART_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + (currentSession ? currentSession.access_token : SUPABASE_ANON_KEY),
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.message || data.error || "Upload failed." };
    }
    return { ok: true, url: `${STORAGE_URL}/object/public/${FAN_ART_BUCKET}/${path}` };
  } catch (e) {
    return { ok: false, error: "Network error during upload." };
  }
}


// Uploads an image file to the wiki-images Storage bucket and returns its
// public URL. Filenames are namespaced with a timestamp + random suffix
// so two people uploading "photo.jpg" at once never collide.
async function uploadImage(file) {
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const res = await fetch(`${STORAGE_URL}/object/${IMAGE_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + (currentSession ? currentSession.access_token : SUPABASE_ANON_KEY),
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.message || data.error || "Upload failed." };
    }
    return { ok: true, url: `${STORAGE_URL}/object/public/${IMAGE_BUCKET}/${path}` };
  } catch (e) {
    return { ok: false, error: "Network error during upload." };
  }
}

// Uploads an image file to the hall-of-fame Storage bucket.
async function uploadHallOfFame(file) {
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const res = await fetch(`${STORAGE_URL}/object/${HOF_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: "Bearer " + (currentSession ? currentSession.access_token : SUPABASE_ANON_KEY),
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.message || data.error || "Upload failed." };
    }
    return { ok: true, url: `${STORAGE_URL}/object/public/${HOF_BUCKET}/${path}` };
  } catch (e) {
    return { ok: false, error: "Network error during upload." };
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

// Finds unique @username patterns in a piece of text (comment bodies).
function extractMentionedUsernames(text) {
  const matches = [...text.matchAll(/@(\w+)/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

// "3m ago" / "5h ago" / "2d ago" style formatting for notifications.
function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  if (days < 7) return days + "d ago";
  return new Date(dateStr).toLocaleDateString();
}

// Strips HTML tags from a page's rich-text content and trims it down to a
// short plain-text snippet, for showing as a preview on the wiki list card.
// Returns the CSS class for a post's boost tier
function boostClass(boostCount) {
  if (!boostCount || boostCount <= 0) return "";
  if (boostCount <= 2) return "boost-1";
  if (boostCount <= 5) return "boost-2";
  if (boostCount <= 9) return "boost-3";
  return "boost-4";
}

// Weighted shuffle — posts with more boosts/likes/follows are more likely
// to appear higher, but there's enough randomness that the order changes
// each load and isn't perfectly deterministic.
function weightedSort(posts, followedUserIds = [], likedArtistIds = []) {
  return [...posts]
    .map((p) => {
      const followBonus = followedUserIds.includes(p.user_id) ? 4 : 0;
      const likedArtistBonus = likedArtistIds.includes(p.user_id) ? 2 : 0;
      const score =
        (p.boost_count || 0) * 2 +
        (p.owner_liked ? 5 : 0) +
        (p.like_count || 0) * 0.5 +
        followBonus +
        likedArtistBonus +
        Math.random() * 3; // jitter so it reshuffles each load
      return { ...p, _score: score };
    })
    .sort((a, b) => b._score - a._score);
}

function htmlToPreviewText(html, maxLength = 160) {
  if (!html) return "";
  let text;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Insert a space before block-level elements so adjacent items like
    // list entries don't run together when their tags are stripped.
    doc.querySelectorAll("p, li, h1, h2, h3, h4, div, br").forEach((el) => {
      el.prepend(document.createTextNode(" "));
    });
    text = doc.body.textContent || "";
  } catch (e) {
    text = html.replace(/<[^>]*>/g, " ");
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, "") + "…";
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
  Heading: (p) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 5v14" />
      <path d="M17 5v14" />
      <path d="M5 12h12" />
    </svg>
  ),
  Person: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  ),
  Gallery: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),
  Heart: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  HeartFilled: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  Share: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  ),
  Comment: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  UserPlus: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3.2-6.5 7-6.5s7 2.5 7 6.5" />
      <line x1="18" y1="6" x2="18" y2="12" />
      <line x1="15" y1="9" x2="21" y2="9" />
    </svg>
  ),
  UserCheck: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3.2-6.5 7-6.5s7 2.5 7 6.5" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  ),
  Coffee: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4Z" />
      <line x1="6" y1="2" x2="6" y2="4" />
      <line x1="10" y1="2" x2="10" y2="4" />
      <line x1="14" y1="2" x2="14" y2="4" />
    </svg>
  ),
  Book: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5" />
      <path d="M4 4.5v16A2.5 2.5 0 0 0 6.5 23H20" />
    </svg>
  ),
  DollarSign: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  DotsVertical: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none" {...p}>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
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
  Trophy: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4" />
      <path d="M17 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" />
      <path d="M12 14v3" />
      <path d="M8 21h8" />
      <path d="M9.5 21c0-2 1-2.5 2.5-3.5 1.5 1 2.5 1.5 2.5 3.5" />
    </svg>
  ),
  ArrowUp: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  ),
  ArrowDown: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="18 13 12 19 6 13" />
    </svg>
  ),
  Star: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none" {...p}>
      <path d="M12 2.5l2.9 6.6 7.1.7-5.4 4.8 1.7 7-6.3-3.8-6.3 3.8 1.7-7-5.4-4.8 7.1-.7z" />
    </svg>
  ),
  Crown: (p) => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" />
      <line x1="5" y1="21" x2="19" y2="21" />
    </svg>
  ),
  GripVertical: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none" {...p}>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  ),
  Bell: (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  ),
};

const BADGE_ICON_OPTIONS = ["Star", "Trophy", "Crown", "Shield", "Heart", "Coffee", "DollarSign", "UserCheck"];
const BADGE_COLOR_OPTIONS = [
  { label: "Amber", value: tokens.amber },
  { label: "Moss", value: tokens.moss2 },
  { label: "Sky", value: tokens.sky },
  { label: "Danger", value: tokens.danger },
  { label: "Bone", value: tokens.bone },
];

// Kinds that need a numeric threshold, and what to call it in the editor.
const THRESHOLD_KIND_LABELS = {
  fan_art_likes: "LIKES NEEDED",
  fan_art_posts: "FAN ART POSTS NEEDED",
  followers: "FOLLOWERS NEEDED",
  comments: "COMMENTS NEEDED",
  account_age: "DAYS AS A MEMBER",
};

/* ════════════════════════════════════════════════════════════
   ROOT APP
   ════════════════════════════════════════════════════════════ */

export default function UGHub() {
  const [currentUser, setCurrentUser] = useState(null); // { id, username, role, email }
  const [unreadCount, setUnreadCount] = useState(0);
  const [route, setRoute] = useState(() => {
    // Support deep links: ug-hub.vercel.app/#fan-art/POST_ID
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("fan-art/")) {
      const postId = hash.slice("fan-art/".length);
      if (postId) return { name: "fan-art-post", postId };
    }
    return { name: "home" };
  });
  const [pageIndex, setPageIndex] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [restoringSession, setRestoringSession] = useState(!!currentSession);

  const showToast = useCallback((msg, kind = "info") => {
    setToast({ msg, kind, id: Date.now() });
  }, []);

  // Keeps the side menu's notification badge current — re-checked on
  // login and on every navigation (cheap single-column count query),
  // since there's no live/push mechanism in this app.
  useEffect(() => {
    if (!currentUser) { setUnreadCount(0); return; }
    (async () => {
      const res = await dbSelect("notifications", "user_id=eq." + currentUser.id + "&read=eq.false&select=id");
      setUnreadCount(res.ok ? res.data.length : 0);
    })();
  }, [currentUser, route.name]);

  // On load, if a session was restored from localStorage, fetch the
  // matching profile so the person doesn't have to log in again.
  // First refresh the token in case it's expired (Supabase JWTs last
  // 1 hour — a stored session can easily be stale on next visit).
  useEffect(() => {
    if (!currentSession) {
      setRestoringSession(false);
      return;
    }
    (async () => {
      // Attempt token refresh using the stored refresh_token.
      if (currentSession.refresh_token) {
        try {
          const refreshRes = await fetch(AUTH_URL + "/token?grant_type=refresh_token", {
            method: "POST",
            headers: authHeaders(false),
            body: JSON.stringify({ refresh_token: currentSession.refresh_token }),
          });
          if (refreshRes.ok) {
            const refreshed = await refreshRes.json();
            currentSession = refreshed;
            storeSession(refreshed);
          }
          // If refresh fails (e.g. refresh token also expired), we fall
          // through and try the profile fetch anyway; if that also fails
          // we'll sign out below.
        } catch (e) {
          // Network error — continue with existing token.
        }
      }

      const res = await dbSelect("profiles", `id=eq.${currentSession.user.id}&select=id,username,role,banned_until,display_name,avatar_url,bio`);
      if (res.ok && res.data.length > 0) {
        const profile = res.data[0];
        const bannedUntil = profile.banned_until || null;
        setCurrentUser({ id: profile.id, username: profile.username, role: profile.role, email: currentSession.user.email, bannedUntil, displayName: profile.display_name || "", avatarUrl: profile.avatar_url || "", bio: profile.bio || "" });
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
    const res = await dbSelect("wiki_pages", "select=slug,title,is_private,header_image,content&order=title.asc");
    if (res.ok) {
      setPageIndex(
        res.data.map((p) => ({
          slug: p.slug,
          title: p.title,
          isPrivate: p.is_private,
          headerImage: p.header_image || null,
          preview: htmlToPreviewText(p.content),
        }))
      );
    }
  }, []);

  const isAdmin = currentUser?.role === "admin";
  const isOwner = currentUser?.username === "GoibyJr";
  const isBannedUser = currentUser?.bannedUntil
    ? new Date(currentUser.bannedUntil) > new Date()
    : false;

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

      {isBannedUser && <BanBanner bannedUntil={currentUser.bannedUntil} />}

      {/* Push content down when ban banner is showing */}
      {isBannedUser && <div style={{ height: 74 }} />}

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
        isBannedUser={isBannedUser}
        unreadCount={unreadCount}
        onNavigate={navigate}
        onLogout={() => {
          supabaseSignOut();
          setCurrentUser(null);
          showToast("Logged out", "info");
          navigate({ name: "home" });
        }}
      />

      {route.name === "home" ? (
        <HomeRoute onNavigate={navigate} />
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
            isAdmin ? (
              <AdminView currentUser={currentUser} showToast={showToast} onNavigate={navigate} />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "profile" ? (
            currentUser ? (
              <ProfileView
                currentUser={currentUser}
                onSaved={(updated) => setCurrentUser((prev) => ({ ...prev, ...updated }))}
                showToast={showToast}
              />
            ) : (
              <LoginRequired onLogin={() => navigate({ name: "login", returnTo: route })} onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "notifications" ? (
            currentUser ? (
              <NotificationsView currentUser={currentUser} onNavigate={navigate} />
            ) : (
              <LoginRequired onLogin={() => navigate({ name: "login", returnTo: route })} onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "fan-art" ? (
            currentUser ? (
              <FanArtGallery key={route.ts || "gallery"} currentUser={currentUser} isBannedUser={isBannedUser} onNavigate={navigate} showToast={showToast} />
            ) : (
              <LoginRequired onLogin={() => navigate({ name: "login", returnTo: route })} onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "fan-art-post" ? (
            currentUser ? (
              <FanArtPost
                postId={route.postId}
                currentUser={currentUser}
                isBannedUser={isBannedUser}
                onBack={(opts) => {
                  if (opts?.edit) {
                    navigate({ name: "fan-art-upload", editId: opts.edit });
                  } else {
                    navigate({ name: "fan-art", ts: Date.now() });
                  }
                }}
                onNavigate={navigate}
                showToast={showToast}
              />
            ) : (
              <LoginRequired onLogin={() => navigate({ name: "login", returnTo: route })} onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "fan-art-upload" ? (
            currentUser && !isBannedUser ? (
              <FanArtUpload
                currentUser={currentUser}
                editId={route.editId || null}
                onSaved={(id) => navigate({ name: "fan-art-post", postId: id })}
                onCancel={() => navigate({ name: "fan-art" })}
                showToast={showToast}
              />
            ) : !currentUser ? (
              <LoginRequired onLogin={() => navigate({ name: "login", returnTo: route })} onBack={() => navigate({ name: "fan-art" })} />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "fan-art" })} />
            )
          ) : route.name === "artist-profile" ? (
            currentUser ? (
              <ArtistProfile
                userId={route.userId}
                username={route.username}
                currentUser={currentUser}
                onNavigate={navigate}
                onBack={() => navigate({ name: "fan-art" })}
                showToast={showToast}
              />
            ) : (
              <LoginRequired onLogin={() => navigate({ name: "login", returnTo: route })} onBack={() => navigate({ name: "fan-art" })} />
            )
          ) : route.name === "hall-of-fame" ? (
            <HallOfFameGallery isAdmin={isAdmin} onNavigate={navigate} />
          ) : route.name === "hall-of-fame-entry" ? (
            <HallOfFameEntryView
              entryId={route.entryId}
              currentUser={currentUser}
              isAdmin={isAdmin}
              onBack={() => navigate({ name: "hall-of-fame" })}
              onEdit={(id) => navigate({ name: "hall-of-fame-editor", editId: id })}
              onDeleted={() => navigate({ name: "hall-of-fame" })}
              onNavigate={navigate}
              showToast={showToast}
            />
          ) : route.name === "hall-of-fame-editor" ? (
            isAdmin ? (
              <HallOfFameEditor
                editId={route.editId || null}
                currentUser={currentUser}
                onSaved={(id) => navigate({ name: "hall-of-fame-entry", entryId: id })}
                onCancel={() => navigate({ name: route.editId ? "hall-of-fame-entry" : "hall-of-fame-manage", entryId: route.editId })}
                showToast={showToast}
              />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "hall-of-fame" })} />
            )
          ) : route.name === "hall-of-fame-manage" ? (
            isAdmin ? (
              <HallOfFameManage
                onNavigate={navigate}
                showToast={showToast}
              />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "hall-of-fame" })} />
            )
          ) : route.name === "admin-hub" ? (
            isAdmin ? (
              <AdminHub onNavigate={navigate} />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "badges-manage" ? (
            isAdmin ? (
              <ManageBadges onNavigate={navigate} showToast={showToast} />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "badge-editor" ? (
            isAdmin ? (
              <BadgeEditor
                editId={route.editId || null}
                onSaved={() => navigate({ name: "badges-manage" })}
                onCancel={() => navigate({ name: "badges-manage" })}
                showToast={showToast}
              />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "badge-assign" ? (
            isAdmin ? (
              <BadgeAssign badgeId={route.badgeId} onNavigate={navigate} showToast={showToast} />
            ) : (
              <NotAllowed onBack={() => navigate({ name: "wiki" })} />
            )
          ) : route.name === "user-profile" ? (
            <UserProfileView
              userId={route.userId}
              onBack={() => navigate(route.returnTo || { name: "admin" })}
            />
          ) : route.name === "login" ? (
            <LoginView
              onSuccess={(user) => {
                setCurrentUser(user);
                showToast("Welcome, " + user.username + "!", "success");
                navigate(route.returnTo || { name: "wiki" });
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
        .ughub-jump-btn { transition: none !important; }
        html { scroll-behavior: auto !important; }
      }
      .ughub-jump-btn { transition: border-color 0.15s ease, color 0.15s ease; }
      .ughub-art-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
      .ughub-art-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
      .ughub-art-card.focused { transform: scale(1.04); z-index: 2; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
      .ughub-art-card.dimmed { transform: scale(0.96); opacity: 0.6; }
      .ughub-comment-menu-btn:hover { background: rgba(217,200,168,0.08) !important; }

      /* Owner-liked: gold highlight */
      .ughub-art-card.owner-liked { border: 2px solid ${tokens.amber}; box-shadow: 0 0 12px rgba(201,138,46,0.35); }

      /* Boost tier 1 (1-2 boosts): thin solid blue */
      .ughub-art-card.boost-1 { border: 2px solid #5bafd4 !important; }

      /* Boost tier 2 (3-5 boosts): thicker glowing blue */
      .ughub-art-card.boost-2 { border: 2px solid #5bafd4 !important; box-shadow: 0 0 10px rgba(91,175,212,0.55), 0 0 20px rgba(91,175,212,0.25) !important; }

      /* Boost tier 3 (6-9 boosts): pulsing blue */
      .ughub-art-card.boost-3 { border: 2px solid #5bafd4 !important; box-shadow: 0 0 12px rgba(91,175,212,0.7), 0 0 28px rgba(91,175,212,0.35) !important; animation: ughub-boost-pulse 2s ease-in-out infinite !important; }

      /* Boost tier 4 (10+ boosts): animated rainbow glow - uses box-shadow animation only, no border tricks */
      .ughub-art-card.boost-4 { border: 2px solid #a78bfa !important; animation: ughub-boost-rainbow 3s linear infinite !important; }
      .ughub-art-card.boost-4 > div { border: none !important; }

      @keyframes ughub-boost-rainbow {
        0%   { border-color: #5bafd4; box-shadow: 0 0 16px rgba(91,175,212,0.9), 0 0 32px rgba(91,175,212,0.5); }
        25%  { border-color: #a78bfa; box-shadow: 0 0 16px rgba(167,139,250,0.9), 0 0 32px rgba(167,139,250,0.5); }
        50%  { border-color: #38bdf8; box-shadow: 0 0 16px rgba(56,189,248,0.9), 0 0 32px rgba(56,189,248,0.5); }
        75%  { border-color: #818cf8; box-shadow: 0 0 16px rgba(129,140,248,0.9), 0 0 32px rgba(129,140,248,0.5); }
        100% { border-color: #5bafd4; box-shadow: 0 0 16px rgba(91,175,212,0.9), 0 0 32px rgba(91,175,212,0.5); }
      }

      @keyframes ughub-boost-pulse {
        0%, 100% { box-shadow: 0 0 12px rgba(91,175,212,0.7), 0 0 28px rgba(91,175,212,0.35); }
        50%       { box-shadow: 0 0 20px rgba(91,175,212,1), 0 0 40px rgba(91,175,212,0.6); }
      }
      .ughub-editor-content a { color: ${tokens.sky}; text-decoration: underline; }
      .ughub-editor-content ul { padding-left: 22px; margin: 8px 0; }
      .ughub-editor-content img { max-width: 100%; border-radius: 6px; margin: 8px 0; }
      .ughub-editor-content p { margin: 0 0 10px 0; }
      .ughub-editor-content h2 {
        font-family: 'Bebas Neue', 'Rubik', sans-serif;
        font-size: 1.5rem;
        letter-spacing: 0.04em;
        color: ${tokens.moss2};
        margin: 28px 0 12px;
        padding-top: 4px;
        border-top: 1px solid ${tokens.border};
        scroll-margin-top: 16px;
      }
      .ughub-editor-content h2:first-child { margin-top: 0; border-top: none; padding-top: 0; }
      .ughub-jump-btn:hover { border-color: ${tokens.moss2} !important; color: ${tokens.cream} !important; }
      input::placeholder, textarea::placeholder { color: rgba(217,200,168,0.35); }

      /* ── Foundational interactive states ──
         Buttons and inputs previously had zero hover/active/focus feedback
         anywhere in the app. This is the base layer every screen inherits. */
      .ughub-btn-primary {
        transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
      }
      .ughub-btn-primary:hover:not(:disabled) {
        filter: brightness(1.08);
        box-shadow: 0 4px 14px rgba(74,124,63,0.35);
      }
      .ughub-btn-primary:active:not(:disabled) {
        transform: translateY(1px) scale(0.99);
        filter: brightness(0.96);
      }
      .ughub-btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        filter: none;
      }

      .ughub-btn-ghost {
        transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease, transform 0.12s ease;
      }
      .ughub-btn-ghost:hover:not(:disabled) {
        border-color: ${tokens.borderStrong};
        background: rgba(217,200,168,0.06);
      }
      .ughub-btn-ghost:active:not(:disabled) {
        transform: translateY(1px) scale(0.99);
      }
      .ughub-btn-ghost:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .ughub-input {
        transition: border-color 0.12s ease, box-shadow 0.12s ease;
      }
      .ughub-input:hover {
        border-color: ${tokens.borderStrong};
      }
      .ughub-input:focus {
        outline: none;
        border-color: ${tokens.moss2};
        box-shadow: 0 0 0 3px rgba(107,173,92,0.15);
      }

      /* Keyboard focus ring for anything else interactive (accessibility) */
      button:focus-visible, a:focus-visible, [tabindex]:focus-visible {
        outline: 2px solid ${tokens.moss2};
        outline-offset: 2px;
      }

      /* Generic hoverable list row — used across admin/data screens for
         a consistent "this is clickable" affordance where nothing existed before */
      .ughub-row {
        transition: border-color 0.12s ease, background 0.12s ease, transform 0.12s ease;
      }
      .ughub-row:hover {
        border-color: ${tokens.borderStrong};
        background: rgba(217,200,168,0.04);
      }

      @media (prefers-reduced-motion: reduce) {
        .ughub-btn-primary, .ughub-btn-ghost, .ughub-input, .ughub-row {
          transition: none !important;
        }
      }
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
      @keyframes ughub-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
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
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "120px 0", color: "rgba(217,200,168,0.4)" }}>
      <Spinner size={28} />
      <span style={{ fontSize: "0.85rem" }}>Loading…</span>
    </div>
  );
}

function Spinner({ size = 16 }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "2px solid rgba(217,200,168,0.25)",
        borderTopColor: "currentColor",
        borderRadius: "50%",
        animation: "ughub-spin 0.7s linear infinite",
      }}
    />
  );
}

// A single earned-badge pill — icon + name, tinted with the badge's color.
function BadgeChip({ badge, onClick }) {
  const IconComp = Icon[badge.icon] || Icon.Star;
  const color = badge.color || tokens.amber;
  return (
    <div
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 999,
        background: color + "1A",
        border: `1px solid ${color}55`,
        fontSize: "0.78rem",
        fontWeight: 700,
        color,
        whiteSpace: "nowrap",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <IconComp width={13} height={13} />
      {badge.name}
    </div>
  );
}

// Wraps a set of earned badges. Renders nothing if the list is empty so
// callers can drop it in unconditionally. Tapping a badge opens its
// description, since hover tooltips don't really work on mobile.
function BadgeRow({ badges }) {
  const [selected, setSelected] = useState(null);
  if (!badges || badges.length === 0) return null;
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {badges.map((b) => <BadgeChip key={b.id} badge={b} onClick={() => setSelected(b)} />)}
      </div>
      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <div style={{ marginBottom: 12 }}><BadgeChip badge={selected} /></div>
          <p style={{ color: tokens.bone, fontSize: "0.9rem", lineHeight: 1.6, margin: "0 0 20px" }}>
            {selected.description || "No description yet."}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => setSelected(null)} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>Close</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// Powers "@" mention autocomplete for any single-line text input. Each
// compose box (new comment, reply, edit) gets its own instance of this.
function useMentionAutocomplete() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(false);
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!active || query.length < 1) { setResults([]); return; }
    const t = setTimeout(async () => {
      const res = await dbSelect("profiles", "username=ilike." + encodeURIComponent(query) + "*&select=id,username&order=username.asc&limit=6");
      setResults(res.ok ? res.data : []);
    }, 250);
    return () => clearTimeout(t);
  }, [query, active]);

  // Call from the input's onChange with the new value and cursor position.
  const onChange = (value, cursor, setValue) => {
    setValue(value);
    const match = value.slice(0, cursor).match(/@(\w*)$/);
    if (match) { setQuery(match[1]); setActive(true); }
    else { setActive(false); setQuery(""); }
  };

  // Call when a suggestion is tapped — replaces the partial @word with
  // the full username and puts the cursor right after it.
  const select = (username, value, setValue) => {
    const el = inputRef.current;
    const cursor = el ? el.selectionStart : value.length;
    const before = value.slice(0, cursor).replace(/@\w*$/, "@" + username + " ");
    const after = value.slice(cursor);
    setValue(before + after);
    setActive(false);
    setResults([]);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  return { inputRef, active, results, onChange, select, close: () => setActive(false) };
}

function MentionDropdown({ mention, value, setValue }) {
  if (!mention.active || mention.results.length === 0) return null;
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      style={{ position: "absolute", top: "100%", left: 0, zIndex: 20, background: tokens.soil, border: `1px solid ${tokens.border}`, borderRadius: 8, marginTop: 4, minWidth: 160, maxHeight: 180, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
    >
      {mention.results.map((u) => (
        <button
          key={u.id}
          onClick={() => mention.select(u.username, value, setValue)}
          style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: `1px solid ${tokens.border}`, padding: "8px 12px", cursor: "pointer", color: tokens.cream, fontSize: "0.84rem" }}
        >
          @{u.username}
        </button>
      ))}
    </div>
  );
}

// Splits comment text on @mentions, styling and linking the ones that
// match a real, known account (mentionMap: username -> user id).
function renderCommentBody(text, mentionMap, onNavigate) {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) => {
    const match = part.match(/^@(\w+)$/);
    const userId = match && mentionMap.get(match[1]);
    if (userId) {
      return (
        <span
          key={i}
          onClick={(e) => { e.stopPropagation(); onNavigate({ name: "user-profile", userId }); }}
          style={{ color: tokens.sky, fontWeight: 700, cursor: "pointer" }}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

// Counts down to a future ISO timestamp, updating every second.
// Returns a formatted string like "6d 4h 12m 33s" or "Permanent".
function useBanCountdown(bannedUntil) {
  const [display, setDisplay] = useState("");
  useEffect(() => {
    if (!bannedUntil) { setDisplay(""); return; }
    const target = new Date(bannedUntil);
    if (target.getFullYear() >= 2099) { setDisplay("Permanent"); return; }
    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) { setDisplay("Expired"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const parts = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0 || d > 0) parts.push(`${h}h`);
      if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
      parts.push(`${s}s`);
      setDisplay(parts.join(" "));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [bannedUntil]);
  return display;
}

function formatBanDate(bannedUntil) {
  if (!bannedUntil) return "";
  const d = new Date(bannedUntil);
  if (d.getFullYear() >= 2099) return "Permanently";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

function BanBanner({ bannedUntil }) {
  const countdown = useBanCountdown(bannedUntil);
  const isPerm = bannedUntil && new Date(bannedUntil).getFullYear() >= 2099;
  if (!bannedUntil || new Date(bannedUntil) <= new Date()) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: "rgba(194,74,58,0.95)",
        backdropFilter: "blur(4px)",
        color: "#fff",
        padding: "10px 18px",
        fontSize: "0.82rem",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
      }}
    >
      <span style={{ fontWeight: 700 }}>
        {isPerm ? "Your account is permanently banned." : `Your account is banned · ${countdown} remaining`}
      </span>
      {!isPerm && (
        <span style={{ opacity: 0.85, fontSize: "0.76rem" }}>
          Unbanned on {formatBanDate(bannedUntil)}
        </span>
      )}
      <span style={{ opacity: 0.75, fontSize: "0.74rem", marginTop: 1 }}>
        You can browse the wiki, but account features are disabled.
      </span>
    </div>
  );
}

function NotAllowed({ onBack }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <Icon.Lock color={tokens.danger} width={32} height={32} />
      <h2 style={{ fontFamily: "'Rubik'", marginTop: 16 }}>Admins only</h2>
      <p style={{ color: "rgba(217,200,168,0.6)", marginTop: 8 }}>You don't have permission to view this page.</p>
      <button onClick={onBack} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, marginTop: 20, padding: "10px 24px" }}>
        Go Back
      </button>
    </div>
  );
}

// Distinct from NotAllowed — this is for pages that just need someone
// logged in (fan art, profiles), not actual admin-only pages. Saying
// "Admins only" there was confusing regular logged-out visitors who
// followed a shared link, like a fan art post.
function LoginRequired({ onLogin, onBack }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 0" }}>
      <Icon.Lock color={tokens.amber} width={32} height={32} />
      <h2 style={{ fontFamily: "'Rubik'", marginTop: 16 }}>Log in to continue</h2>
      <p style={{ color: "rgba(217,200,168,0.6)", marginTop: 8 }}>You'll need a UG Hub account to view this page.</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
        <button onClick={onBack} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>Go Back</button>
        <button onClick={onLogin} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "10px 24px" }}>Log In</button>
      </div>
    </div>
  );
}

const buttonStyles = {
  primarySmall: {
    background: `linear-gradient(135deg, ${tokens.moss}, ${tokens.moss2})`,
    color: "#fff",
    border: "none",
    borderRadius: 8,
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
    borderRadius: 8,
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

function SideMenu({ open, onClose, currentUser, isAdmin, isOwner, isBannedUser, unreadCount, onNavigate, onLogout }) {
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
          <button onClick={onClose} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, padding: 8 }}>
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

        <MenuLink label="Wiki" icon={<Icon.Book />} onClick={() => onNavigate({ name: "wiki" })} />
        <MenuLink label="Notifications" icon={<Icon.Bell />} badge={unreadCount} onClick={() => {
          if (!currentUser) { onNavigate({ name: "login", returnTo: { name: "notifications" } }); return; }
          onNavigate({ name: "notifications" });
        }} />
        <MenuLink label="Fan Art" icon={<Icon.Gallery />} onClick={() => {
          if (!currentUser) { onNavigate({ name: "login", returnTo: { name: "fan-art" } }); return; }
          onNavigate({ name: "fan-art" });
        }} />
        <MenuLink label="Hall of Fame" icon={<Icon.Trophy />} onClick={() => onNavigate({ name: "hall-of-fame" })} />
        {isAdmin && <MenuLink label="Admin" icon={<Icon.Shield color={tokens.amber} />} onClick={() => onNavigate({ name: "admin-hub" })} />}

        <div style={{ marginTop: "auto" }}>
          <div style={{ height: 1, background: tokens.border, margin: "8px 20px" }} />
          {currentUser ? (
            <div style={{ padding: "10px 24px 4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                {currentUser.avatarUrl ? (
                  <img
                    src={currentUser.avatarUrl}
                    alt=""
                    style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: `2px solid ${tokens.border}`, flexShrink: 0 }}
                  />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: tokens.surface, border: `2px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon.Person color="rgba(217,200,168,0.5)" />
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.88rem", color: tokens.cream, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {isAdmin && <Icon.Shield color={tokens.amber} width={13} height={13} />}
                    {currentUser.displayName || currentUser.username}
                  </div>
                  {currentUser.displayName && (
                    <div style={{ fontSize: "0.72rem", color: "rgba(217,200,168,0.45)" }}>@{currentUser.username}</div>
                  )}
                </div>
              </div>
              <button onClick={() => { onNavigate({ name: "profile" }); }} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, width: "100%", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Icon.Person /> My Profile
              </button>
              <button onClick={onLogout} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, width: "100%" }}>
                Log out
              </button>
            </div>
          ) : (
            <div style={{ padding: "10px 24px 4px" }}>
              <MenuLink label="Log In / Sign Up" onClick={() => onNavigate({ name: "login" })} />
            </div>
          )}

          <p style={{ padding: "8px 24px 4px", fontSize: "0.7rem", color: "rgba(217,200,168,0.3)", textAlign: "center" }}>
            UG Hub is a fan-made project and is not affiliated with or endorsed by ContinuumXR.
          </p>
        </div>
      </nav>
    </>
  );
}

function MenuLink({ label, onClick, icon, badge }) {
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
      {!!badge && (
        <span style={{ background: tokens.danger, color: "#fff", fontSize: "0.7rem", fontWeight: 700, borderRadius: 999, padding: "1px 7px", marginLeft: "auto" }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/* ════════════════════════════════════════════════════════════
   HOME ROUTE (the original landing page, recreated in React)
   ════════════════════════════════════════════════════════════ */

function HomeRoute({ onNavigate }) {
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
        <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
          Knowledge Base
        </p>
        <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2.4rem", color: tokens.cream, margin: 0 }}>
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
            className="ughub-input" style={{ ...inputStyle, padding: "11px 14px 11px 38px" }}
          />
        </div>
        {isAdmin && (
          <button onClick={onNewPage} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, display: "flex", alignItems: "center", gap: 6, padding: "10px 18px" }}>
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
                <button onClick={onNewPage} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "10px 22px" }}>
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
            .sort((a, b) => a.title.localeCompare(b.title))
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
                {p.headerImage && (
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 8,
                      overflow: "hidden",
                      flexShrink: 0,
                      background: tokens.peat,
                      border: `1px solid ${tokens.border}`,
                    }}
                  >
                    <img
                      src={p.headerImage}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
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
                  {p.preview && (
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "rgba(217,200,168,0.6)",
                        marginTop: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {p.preview}
                    </div>
                  )}
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

  const sections = useMemo(() => {
    if (!page?.content) return [];
    try {
      const doc = new DOMParser().parseFromString(page.content, "text/html");
      return Array.from(doc.querySelectorAll("h2"))
        .filter((h) => h.id && h.textContent.trim())
        .map((h) => ({ id: h.id, text: h.textContent.trim() }));
    } catch (e) {
      return [];
    }
  }, [page?.content]);

  const jumpToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
              headerImage: row.header_image || null,
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
        <button onClick={onBack} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, marginTop: 16, padding: "10px 24px" }}>
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={onBack} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>
          ← Back to Wiki
        </button>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={() => onEdit(slug)} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.Edit /> Edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 6, color: tokens.danger, borderColor: "rgba(194,74,58,0.4)" }}
            >
              <Icon.Trash /> Delete
            </button>
          </div>
        )}
      </div>

      {page.headerImage && (
        <div
          style={{
            width: "100%",
            aspectRatio: "16 / 7",
            borderRadius: 12,
            overflow: "hidden",
            marginBottom: 20,
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
          }}
        >
          <img
            src={page.headerImage}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      )}

      <h1
        style={{
          fontFamily: "'Bebas Neue'",
          fontWeight: 900,
          fontSize: "2.1rem",
          color: tokens.cream,
          margin: "0 0 8px",
          minWidth: 0,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
      >
        {page.title}
      </h1>

      {page.isPrivate && (
        <div style={{ marginBottom: 28 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: tokens.amber, border: "1px solid rgba(201,138,46,0.3)", padding: "3px 9px", borderRadius: 4, width: "fit-content" }}>
            <Icon.Lock /> Private — admins only
          </span>
        </div>
      )}

      {sections.length > 1 && (
        <div
          style={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            borderRadius: 10,
            padding: "14px 16px",
            marginBottom: 24,
          }}
        >
          <p
            style={{
              fontFamily: "'Bebas Neue'",
              color: tokens.moss2,
              fontSize: "0.82rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              margin: "0 0 8px",
            }}
          >
            Jump to
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => jumpToSection(s.id)}
                className="ughub-jump-btn"
                style={{
                  background: "rgba(217,200,168,0.05)",
                  border: `1px solid ${tokens.border}`,
                  borderRadius: 6,
                  padding: "6px 12px",
                  color: tokens.bone,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  overflowWrap: "anywhere",
                }}
              >
                {s.text}
              </button>
            ))}
          </div>
        </div>
      )}

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
            <button onClick={() => setConfirmDelete(false)} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>
              Cancel
            </button>
            <button onClick={handleDelete} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, background: tokens.danger }}>
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
    const res = await dbSelect("profiles", `id=eq.${userId}&select=id,username,role,banned_until,display_name,avatar_url,bio`);
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
      onSuccess({ id: profile.id, username: profile.username, role: profile.role, email: signInRes.data.user.email, bannedUntil: profile.banned_until || null, displayName: profile.display_name || "", avatarUrl: profile.avatar_url || "", bio: profile.bio || "" });
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
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "1.9rem", color: tokens.cream, textAlign: "center", marginBottom: 6 }}>
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
          className="ughub-input" style={inputStyle}
        />
        {mode === "signup" && (
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="username" className="ughub-input" style={inputStyle} />
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
          className="ughub-input" style={inputStyle}
        />

        {error && <div style={{ color: tokens.danger, fontSize: "0.82rem" }}>{error}</div>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="ughub-btn-primary"
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

function BanControls({ u, onBan, onUnban }) {
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState("days");
  const units = [
    { label: "Seconds", value: "seconds" },
    { label: "Minutes", value: "minutes" },
    { label: "Hours", value: "hours" },
    { label: "Days", value: "days" },
    { label: "Weeks", value: "weeks" },
    { label: "Months (30d)", value: "months" },
    { label: "Years", value: "years" },
  ];
  const handleBan = () => {
    const n = parseFloat(amount);
    if (!n || n <= 0) return;
    const ms = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000, years: 31536000000 }[unit];
    const until = new Date(Date.now() + n * ms).toISOString();
    onBan(until);
  };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <input
        type="number"
        min="1"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{ ...selectStyle, width: 56, padding: "6px 8px" }}
      />
      <select value={unit} onChange={(e) => setUnit(e.target.value)} style={selectStyle}>
        {units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
      </select>
      <button
        onClick={handleBan}
        className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, color: tokens.danger, borderColor: "rgba(194,74,58,0.35)", fontSize: "0.78rem" }}
      >
        Ban
      </button>
      <button
        onClick={() => onBan("2099-01-01T00:00:00Z")}
        className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, color: tokens.danger, borderColor: "rgba(194,74,58,0.35)", fontSize: "0.78rem" }}
      >
        Ban ∞
      </button>
    </div>
  );
}

function AdminView({ currentUser, showToast, onNavigate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const isOwner = currentUser?.username === "GoibyJr";

  const load = useCallback(async () => {
    const res = await dbSelect("profiles", "select=id,username,display_name,role,banned_until&order=username.asc");
    setUsers(res.ok ? res.data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const isBanned = (u) => u.banned_until && new Date(u.banned_until) > new Date();

  const setRole = async (id, username, role) => {
    const res = await dbUpdate("profiles", `id=eq.${id}`, { role });
    if (!res.ok) { showToast("Couldn't update role: " + res.error, "error"); return; }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    showToast(`${username} is now ${role}`, "success");
  };

  const applyBan = async (u, until) => {
    const res = await dbUpdate("profiles", `id=eq.${u.id}`, { banned_until: until });
    if (!res.ok) { showToast("Couldn't update ban: " + res.error, "error"); return; }
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, banned_until: until } : x)));
    const isPerm = until && new Date(until).getFullYear() >= 2099;
    showToast(isPerm ? `${u.username} permanently banned` : `${u.username} banned`, "error");
  };

  const unban = async (u) => {
    const res = await dbUpdate("profiles", `id=eq.${u.id}`, { banned_until: null });
    if (!res.ok) { showToast("Couldn't unban: " + res.error, "error"); return; }
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, banned_until: null } : x)));
    showToast(`${u.username} unbanned`, "success");
  };

  const [search, setSearch] = useState("");

  if (loading) return <CenterSpinner />;

  const q = search.trim().toLowerCase();
  const matches = (u) => !q
    || u.username.toLowerCase().includes(q)
    || (u.display_name || "").toLowerCase().includes(q)
    || u.id.toLowerCase().includes(q);

  const viewers = users.filter((u) => u.role !== "admin" && matches(u));
  const admins = users.filter((u) => u.role === "admin" && matches(u));

  return (
    <div>
      <button onClick={() => onNavigate({ name: "admin-hub" })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Admin Panel</button>

      <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
        Admin Tools
      </p>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, marginTop: 0, marginBottom: 16 }}>
        Manage Users
      </h1>

      <div style={{ position: "relative", marginBottom: 24 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(217,200,168,0.4)", pointerEvents: "none" }}>
          <Icon.Search />
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by username, display name, or user ID…"
          className="ughub-input" style={{ ...inputStyle, paddingLeft: 38, width: "100%" }}
        />
      </div>

      {admins.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <p style={{ fontFamily: "'Bebas Neue'", color: tokens.amber, fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>
            Admins
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {admins.map((u) => (
              <div key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8, padding: "12px 16px", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <Icon.Shield color={tokens.amber} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <button
                        onClick={() => onNavigate({ name: "user-profile", userId: u.id })}
                        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, color: tokens.cream, textDecoration: "underline", textDecorationColor: "rgba(217,200,168,0.3)", fontSize: "inherit" }}
                      >
                        {u.username}
                      </button>
                      {u.display_name && <span style={{ fontSize: "0.78rem", color: "rgba(217,200,168,0.5)" }}>({u.display_name})</span>}
                      {u.id === currentUser?.id && <span style={{ fontSize: "0.7rem", color: "rgba(217,200,168,0.4)" }}>(you)</span>}
                    </div>
                    <div style={{ fontSize: "0.64rem", color: "rgba(217,200,168,0.28)", marginTop: 2, fontFamily: "monospace", overflowWrap: "anywhere" }}>{u.id}</div>
                  </div>
                </div>
                {isOwner && u.id !== currentUser?.id && (
                  <button onClick={() => setRole(u.id, u.username, "viewer")} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>
                    Revoke Admin
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p style={{ fontFamily: "'Bebas Neue'", color: "rgba(217,200,168,0.5)", fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>
          Viewers
        </p>
        {viewers.length === 0 ? (
          <p style={{ color: "rgba(217,200,168,0.4)", fontSize: "0.88rem" }}>No viewer accounts yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {viewers.map((u) => (
              <ViewerRow
                key={u.id}
                u={u}
                currentUser={currentUser}
                isOwner={isOwner}
                isBanned={isBanned(u)}
                onRole={(role) => setRole(u.id, u.username, role)}
                onBan={(until) => applyBan(u, until)}
                onUnban={() => unban(u)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ViewerRow({ u, currentUser, isOwner, isBanned, onRole, onBan, onUnban, onNavigate }) {
  const countdown = useBanCountdown(u.banned_until);
  const isPerm = u.banned_until && new Date(u.banned_until).getFullYear() >= 2099;

  return (
    <div
      style={{
        background: isBanned ? "rgba(194,74,58,0.07)" : tokens.surface,
        border: `1px solid ${isBanned ? "rgba(194,74,58,0.35)" : tokens.border}`,
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {isBanned && <Icon.Lock color={tokens.danger} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button
                onClick={() => onNavigate({ name: "user-profile", userId: u.id })}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: 700, color: isBanned ? "rgba(217,200,168,0.45)" : tokens.cream, textDecoration: "underline", textDecorationColor: "rgba(217,200,168,0.3)", fontSize: "inherit", overflowWrap: "anywhere" }}
              >
                {u.username}
              </button>
              {u.display_name && (
                <span style={{ fontSize: "0.78rem", color: "rgba(217,200,168,0.5)" }}>({u.display_name})</span>
              )}
              {u.id === currentUser?.id && <span style={{ fontSize: "0.7rem", color: "rgba(217,200,168,0.4)" }}>(you)</span>}
            </div>
            <div style={{ fontSize: "0.64rem", color: "rgba(217,200,168,0.28)", marginTop: 2, fontFamily: "monospace", overflowWrap: "anywhere" }}>
              {u.id}
            </div>
          </div>
        </div>
        {isOwner && !isBanned && (
          <button
            onClick={() => onRole("admin")}
            className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, color: tokens.amber, borderColor: "rgba(201,138,46,0.35)" }}
          >
            Make Admin
          </button>
        )}
        {isBanned && (
          <button onClick={onUnban} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, fontSize: "0.78rem" }}>
            Unban
          </button>
        )}
      </div>

      {isBanned ? (
        <div style={{ fontSize: "0.78rem", color: tokens.danger, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 700 }}>
            {isPerm ? "Permanently banned" : `${countdown} remaining`}
          </span>
          {!isPerm && (
            <span style={{ opacity: 0.8 }}>
              Unbanned on {formatBanDate(u.banned_until)}
            </span>
          )}
        </div>
      ) : (
        <BanControls u={u} onBan={onBan} onUnban={onUnban} />
      )}
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
  const [headerImage, setHeaderImage] = useState("");
  const [loading, setLoading] = useState(!!slug);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const isNewPage = !slug;
  const [fontSize, setFontSize] = useState("3");
  const [fontColor, setFontColor] = useState("#D9C8A8");
  const [activeStates, setActiveStates] = useState({});
  const [popover, setPopover] = useState(null); // null | "link" (image insert now uses a file picker instead)
  const [hasTextSelection, setHasTextSelection] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const savedRangeRef = useRef(null);
  const inlineFileInputRef = useRef(null);
  const headerFileInputRef = useRef(null);
  const pendingContentRef = useRef(""); // content fetched from DB, applied once the editor DOM node exists

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
        setHeaderImage(row.header_image || "");
        pendingContentRef.current = row.content || "";
      }
      setLoading(false);
    })();
  }, [slug]);

  // The contentEditable div only mounts once loading flips to false, so
  // editorRef.current is guaranteed not to exist yet at the point the
  // fetch above resolves. This effect runs after that render instead,
  // once the div is actually in the DOM, and applies the fetched content
  // then. Without this, an existing page's content would silently fail
  // to load into the editor (editorRef.current was still null).
  useEffect(() => {
    if (!loading && editorRef.current) {
      editorRef.current.innerHTML = pendingContentRef.current;
    }
  }, [loading]);

  // Track which formatting commands are active at the current cursor
  // position, so toolbar buttons can show a real pressed/active state
  // instead of being purely decorative.
  const refreshActiveStates = useCallback(() => {
    if (!editorRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current.contains(sel.anchorNode)) return;
    try {
      let node = sel.anchorNode;
      let isHeading = false;
      while (node && node !== editorRef.current) {
        if (node.nodeType === 1 && node.tagName === "H2") {
          isHeading = true;
          break;
        }
        node = node.parentNode;
      }
      setActiveStates({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        justifyLeft: document.queryCommandState("justifyLeft"),
        justifyCenter: document.queryCommandState("justifyCenter"),
        justifyRight: document.queryCommandState("justifyRight"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
        heading: isHeading,
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

  const toggleHeading = () => {
    editorRef.current?.focus();
    document.execCommand("formatBlock", false, activeStates.heading ? "p" : "h2");
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
      setHasTextSelection(!sel.getRangeAt(0).collapsed);
    } else {
      savedRangeRef.current = null;
      setHasTextSelection(false);
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

  const confirmLink = (url, displayText) => {
    if (!url.trim()) {
      setPopover(null);
      return;
    }
    const finalUrl = /^https?:\/\//i.test(url.trim()) ? url.trim() : "https://" + url.trim();
    restoreSelection();
    if (hasTextSelection) {
      // Text was already selected — turn that selection into the link,
      // keeping whatever text the editor had highlighted.
      document.execCommand("createLink", false, finalUrl);
    } else {
      // No selection — use the editor's chosen display text (falling back
      // to the URL itself if they left it blank) and insert a real anchor
      // tag directly, so the link text can differ from the link target.
      const text = (displayText || "").trim() || finalUrl;
      const safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const safeUrl = finalUrl.replace(/"/g, "&quot;");
      document.execCommand("insertHTML", false, `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`);
    }
    setPopover(null);
  };

  const handleInlineImageFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Please choose an image file.");
      return;
    }
    setUploadingImage(true);
    restoreSelection();
    const res = await uploadImage(file);
    setUploadingImage(false);
    if (!res.ok) {
      window.alert("Couldn't upload the image: " + res.error);
      return;
    }
    restoreSelection();
    document.execCommand("insertImage", false, res.url);
  };

  const handleHeaderImageFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Please choose an image file.");
      return;
    }
    setUploadingHeader(true);
    const res = await uploadImage(file);
    setUploadingHeader(false);
    if (!res.ok) {
      window.alert("Couldn't upload the image: " + res.error);
      return;
    }
    setHeaderImage(res.url);
  };

  // Give every section heading a stable, unique id (slugified from its
  // text) so the page view can build a "Jump to" nav that links directly
  // to each one. Runs directly on the live editor DOM right before save.
  const assignHeadingIds = () => {
    if (!editorRef.current) return;
    const headings = editorRef.current.querySelectorAll("h2");
    const seen = {};
    headings.forEach((h) => {
      let base = slugify(h.textContent || "") || "section";
      let id = base;
      let n = 2;
      while (seen[id]) {
        id = base + "-" + n;
        n++;
      }
      seen[id] = true;
      h.id = id;
    });
  };

  const handleSave = async () => {
    if (!title.trim()) {
      window.alert("Give the page a title first.");
      return;
    }
    setSaving(true);
    assignHeadingIds();
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
        header_image: headerImage.trim() || null,
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
        header_image: headerImage.trim() || null,
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
      <button onClick={onCancel} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>
        ← Cancel
      </button>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Page title…"
        className="ughub-input"
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

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
        {headerImage.trim() ? (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 8,
              overflow: "hidden",
              flexShrink: 0,
              background: tokens.peat,
              border: `1px solid ${tokens.border}`,
            }}
          >
            <img
              src={headerImage.trim()}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              onError={(e) => { e.currentTarget.style.opacity = 0.25; }}
            />
          </div>
        ) : (
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 8,
              flexShrink: 0,
              background: tokens.surface,
              border: `1px solid ${tokens.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(217,200,168,0.3)",
            }}
          >
            <Icon.Image />
          </div>
        )}
        <div style={{ flex: 1, display: "flex", gap: 8 }}>
          <button
            onClick={() => headerFileInputRef.current?.click()}
            disabled={uploadingHeader}
            className="ughub-btn-ghost"
            style={{
              ...buttonStyles.ghostSmall,
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 14px",
            }}
          >
            {uploadingHeader ? <Spinner size={15} /> : <Icon.Image />}
            {uploadingHeader ? "Uploading…" : headerImage ? "Change header image" : "Add header image"}
          </button>
          {headerImage && (
            <button
              onClick={() => setHeaderImage("")}
              className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, padding: "10px 12px", color: tokens.danger, borderColor: "rgba(194,74,58,0.4)" }}
              title="Remove header image"
            >
              <Icon.X width={14} height={14} />
            </button>
          )}
        </div>
        <input
          ref={headerFileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            handleHeaderImageFile(file);
            e.target.value = "";
          }}
        />
      </div>

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
          <ToolBtn onClick={toggleHeading} title="Section heading" active={activeStates.heading}>
            <Icon.Heading />
          </ToolBtn>
          <Divider />
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
          <ToolBtn
            onClick={() => {
              openPopover(null); // not a real popover kind, just reuses the selection-saving logic
              inlineFileInputRef.current?.click();
            }}
            title="Insert image"
            active={uploadingImage}
          >
            {uploadingImage ? <Spinner size={15} /> : <Icon.Image />}
          </ToolBtn>
          <input
            ref={inlineFileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              handleInlineImageFile(file);
              e.target.value = "";
            }}
          />
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

        {popover === "link" && (
          <ToolbarPopover
            showDisplayTextField={!hasTextSelection}
            onConfirm={confirmLink}
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
        <button onClick={onCancel} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "10px 24px" }}>
          {saving ? "Saving…" : "Save Page"}
        </button>
      </div>
    </div>
  );
}

function ToolbarPopover({ showDisplayTextField, onConfirm, onClose }) {
  const [url, setUrl] = useState("");
  const [displayText, setDisplayText] = useState("");
  const urlInputRef = useRef(null);

  useEffect(() => {
    urlInputRef.current?.focus();
  }, []);

  const submit = () => onConfirm(url, displayText);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

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
        flexDirection: "column",
        gap: 8,
        width: "min(100%, 340px)",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ color: tokens.moss2, flexShrink: 0 }}><Icon.Link /></span>
        <input
          ref={urlInputRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="example.com"
          className="ughub-input"
          style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: "0.86rem" }}
        />
      </div>

      {showDisplayTextField && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 15, flexShrink: 0 }} aria-hidden="true" />
          <input
            value={displayText}
            onChange={(e) => setDisplayText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Display text (optional)"
            className="ughub-input" style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: "0.86rem" }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, padding: "8px 12px", fontSize: "0.82rem" }}>
          <Icon.X width={14} height={14} />
        </button>
        <button onClick={submit} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "8px 16px", fontSize: "0.82rem" }}>
          Add
        </button>
      </div>
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
   FAN ART
   ════════════════════════════════════════════════════════════ */

function FanArtGallery({ currentUser, isBannedUser, onNavigate, showToast }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [focusedId, setFocusedId] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [postsRes, likesRes, boostsRes, followsRes, myLikesRes] = await Promise.all([
        dbSelect("fan_art", "select=id,title,image_url,username,user_id,created_at,owner_liked&order=created_at.desc"),
        dbSelectAll("fan_art_likes", "select=art_id"),
        dbSelectAll("fan_art_boosts", "select=art_id,expires_at"),
        dbSelect("fan_art_follows", "follower_id=eq." + currentUser.id + "&select=following_id"),
        dbSelect("fan_art_likes", "user_id=eq." + currentUser.id + "&select=art_id"),
      ]);
      if (postsRes.ok) {
        const likeMap = {};
        if (likesRes.ok) likesRes.data.forEach((l) => { likeMap[l.art_id] = (likeMap[l.art_id] || 0) + 1; });
        const boostMap = {};
        if (boostsRes.ok) {
          boostsRes.data
            .filter((b) => !b.expires_at || new Date(b.expires_at) > new Date())
            .forEach((b) => { boostMap[b.art_id] = (boostMap[b.art_id] || 0) + 1; });
        }
        const followedUserIds = followsRes.ok ? followsRes.data.map((f) => f.following_id) : [];
        const likedArtIds = myLikesRes.ok ? myLikesRes.data.map((l) => l.art_id) : [];
        const likedArtistIds = postsRes.data.filter((p) => likedArtIds.includes(p.id)).map((p) => p.user_id);
        const withCounts = postsRes.data.map((p) => ({
          ...p,
          like_count: likeMap[p.id] || 0,
          boost_count: boostMap[p.id] || 0,
        }));
        setPosts(weightedSort(withCounts, followedUserIds, likedArtistIds));
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!focusedId) return;
    const handler = (e) => { if (!e.target.closest(".ughub-art-card")) setFocusedId(null); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [focusedId]);

  if (loading) return <CenterSpinner />;

  const filtered = search.trim()
    ? posts.filter((p) =>
        p.title.toLowerCase().includes(search.toLowerCase()) ||
        p.username.toLowerCase().includes(search.toLowerCase())
      )
    : posts;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 }}>
        <div>
          <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>Community</p>
          <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: 0 }}>Fan Art</h1>
        </div>
        {!isBannedUser && (
          <button onClick={() => onNavigate({ name: "fan-art-upload" })} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, display: "flex", alignItems: "center", gap: 6, padding: "10px 16px" }}>
            <Icon.Image /> Upload
          </button>
        )}
      </div>

      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "rgba(217,200,168,0.4)", pointerEvents: "none" }}>
          <Icon.Search />
        </span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title or artist…"
          className="ughub-input" style={{ ...inputStyle, paddingLeft: 38, width: "100%" }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(217,200,168,0.4)" }}>
          <Icon.Gallery color="rgba(217,200,168,0.2)" width={48} height={48} />
          <p style={{ marginTop: 16 }}>{search ? "No results found." : "No fan art yet — be the first to upload!"}</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {filtered.map((p) => {
            const isFocused = focusedId === p.id;
            const isDimmed = focusedId && !isFocused;
            const bc = boostClass(p.boost_count);
            const cardClass = ["ughub-art-card", isFocused ? "focused" : "", isDimmed ? "dimmed" : "", p.owner_liked ? "owner-liked" : bc].filter(Boolean).join(" ");
            return (
              <button
                key={p.id}
                onClick={(e) => {
                  if (focusedId === p.id) { onNavigate({ name: "fan-art-post", postId: p.id }); }
                  else { e.stopPropagation(); setFocusedId(p.id); }
                }}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", position: "relative" }}
              >
                <div className={cardClass} style={{ borderRadius: 10, transition: "transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease" }}>
                  <div style={{ background: "linear-gradient(135deg, #2F2212 0%, " + tokens.surface + " 100%)", border: "1px solid " + tokens.border, borderRadius: 9, overflow: "hidden" }}>
                    <div style={{ width: "100%", aspectRatio: "1/1", overflow: "hidden", background: tokens.peat }}>
                      <img src={p.image_url} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </div>
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: 700, fontSize: "0.88rem", color: tokens.cream, overflowWrap: "anywhere", marginBottom: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {p.title}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); onNavigate({ name: "artist-profile", userId: p.user_id, username: p.username }); }}
                          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "0.72rem", color: "rgba(217,200,168,0.45)", textDecoration: "underline", textDecorationColor: "rgba(217,200,168,0.2)" }}
                        >
                          {p.username}
                        </button>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {p.boost_count > 0 && <span style={{ fontSize: "0.68rem", color: tokens.sky }}>↑ {p.boost_count}</span>}
                          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: "rgba(217,200,168,0.5)" }}>
                            <Icon.Heart width={12} height={12} /> {p.like_count}
                          </span>
                        </div>
                      </div>
                      {isFocused && <div style={{ marginTop: 8, fontSize: "0.72rem", color: tokens.moss2, textAlign: "center", fontWeight: 600 }}>Tap again to open →</div>}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FanArtPost({ postId, currentUser, isBannedUser, onBack, onNavigate, showToast }) {
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [boosted, setBoosted] = useState(false);
  const [boostCount, setBoostCount] = useState(0);
  const [boostsList, setBoostsList] = useState([]); // full list for owner removal
  const [boostsRemaining, setBoostsRemaining] = useState(null);
  const [boostPopoverOpen, setBoostPopoverOpen] = useState(false);
  const [boostQty, setBoostQty] = useState("1");
  const [isUnlimitedBoosts] = useState(currentUser?.username === "GoibyJr");
  const [commentBody, setCommentBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingBody, setEditingBody] = useState("");
  const [replyingTo, setReplyingTo] = useState(null); // { parentId, username }
  const [expandedThreads, setExpandedThreads] = useState(new Set());
  const [mentionMap, setMentionMap] = useState(new Map());
  const composeMention = useMentionAutocomplete();
  const editMention = useMentionAutocomplete();

  // Close boost popover when tapping outside
  useEffect(() => {
    if (!boostPopoverOpen) return;
    const handler = () => setBoostPopoverOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [boostPopoverOpen]);

  // Close the comment menu when tapping anywhere outside it
  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [openMenuId]);

  useEffect(() => {
    (async () => {
      const [postRes, likeRes, allLikesRes, commentRes, boostRes, allBoostsRes, balanceRes] = await Promise.all([
        dbSelect("fan_art", "id=eq." + postId + "&select=*"),
        dbSelect("fan_art_likes", "art_id=eq." + postId + "&user_id=eq." + currentUser.id + "&select=id"),
        dbSelectAll("fan_art_likes", "art_id=eq." + postId + "&select=id"),
        dbSelect("fan_art_comments", "art_id=eq." + postId + "&select=*&order=created_at.asc"),
        dbSelect("fan_art_boosts", "art_id=eq." + postId + "&user_id=eq." + currentUser.id + "&select=id,expires_at"),
        dbSelectAll("fan_art_boosts", "art_id=eq." + postId + "&select=id,user_id,created_at,expires_at,profiles(username)&order=created_at.desc"),
        dbSelect("user_boosts", "user_id=eq." + currentUser.id + "&select=boosts_remaining,week_start"),
      ]);
      const p = postRes.ok && postRes.data.length > 0 ? postRes.data[0] : null;
      setPost(p);
      setLikeCount(allLikesRes.ok ? allLikesRes.data.length : (p?.like_count || 0));
      setLiked(likeRes.ok && likeRes.data.length > 0);
      // Only count non-expired boosts
      const now = new Date();
      const allBoosts = allBoostsRes.ok ? allBoostsRes.data : [];
      const activeBoosts = allBoosts.filter((b) => !b.expires_at || new Date(b.expires_at) > now);
      setBoosted(boostRes.ok && boostRes.data.some((b) => !b.expires_at || new Date(b.expires_at) > now));
      setBoostCount(activeBoosts.length);
      setBoostsList(allBoosts); // show all in owner log including expired
      if (balanceRes.ok && balanceRes.data.length > 0) {
        const bal = balanceRes.data[0];
        const daysSince = Math.floor((now - new Date(bal.week_start)) / 86400000);
        if (daysSince >= 7 && bal.boosts_remaining !== -1) {
          await dbUpdate("user_boosts", "user_id=eq." + currentUser.id, { boosts_remaining: 2, week_start: now.toISOString().slice(0, 10) });
          setBoostsRemaining(2);
        } else {
          setBoostsRemaining(bal.boosts_remaining);
        }
      } else if (balanceRes.ok) {
        setBoostsRemaining(0);
      }
      const loadedComments = commentRes.ok ? commentRes.data : [];
      setComments(loadedComments);
      setLoading(false);
      refreshMentionMap(loadedComments);
    })();
  }, [postId]);

  // Looks up which @usernames mentioned across the current comments are
  // real accounts, so renderCommentBody knows which ones to link.
  const refreshMentionMap = async (commentList) => {
    const usernames = new Set();
    commentList.forEach((c) => extractMentionedUsernames(c.body).forEach((u) => usernames.add(u)));
    if (usernames.size === 0) { setMentionMap(new Map()); return; }
    const inList = [...usernames].map(encodeURIComponent).join(",");
    const res = await dbSelect("profiles", "username=in.(" + inList + ")&select=id,username");
    if (res.ok) setMentionMap(new Map(res.data.map((u) => [u.username, u.id])));
  };

  const toggleLike = async () => {
    if (isBannedUser) return;
    const newLiked = !liked;
    setLiked(newLiked);
    setLikeCount((c) => newLiked ? c + 1 : c - 1);

    if (liked) {
      await dbDelete("fan_art_likes", `art_id=eq.${postId}&user_id=eq.${currentUser.id}`);
    } else {
      await dbInsert("fan_art_likes", { art_id: postId, user_id: currentUser.id });
    }

    // If GoibyJr liked/unliked, update owner_liked flag for gallery highlighting
    if (isUnlimitedBoosts) {
      await dbUpdate("fan_art", `id=eq.${postId}`, { owner_liked: newLiked });
    }

    // Sync like_count column
    const countRes = await dbSelect("fan_art_likes", `art_id=eq.${postId}&select=id`);
    if (countRes.ok) {
      setLikeCount(countRes.data.length);
      await dbUpdate("fan_art", `id=eq.${postId}`, { like_count: countRes.data.length });
    }
  };

  const applyBoost = async (qty = 1) => {
    if (isBannedUser) return;
    const n = Math.max(1, Math.floor(Number(qty)));
    if (!isUnlimitedBoosts && (boostsRemaining === null || boostsRemaining < n)) {
      showToast("Not enough boosts remaining", "error");
      return;
    }
    setBoostPopoverOpen(false);
    // Insert n boost rows one by one
    const newEntries = [];
    for (let i = 0; i < n; i++) {
      const res = await dbInsert("fan_art_boosts", { art_id: postId, user_id: currentUser.id });
      if (!res.ok) { showToast("Boost failed", "error"); break; }
      newEntries.push({ ...(res.data[0] || {}), profiles: { username: currentUser.username } });
    }
    if (newEntries.length === 0) return;
    setBoosted(true);
    setBoostCount((c) => c + newEntries.length);
    setBoostsList((prev) => [...newEntries.reverse(), ...prev]);
    if (!isUnlimitedBoosts) {
      const newBal = (boostsRemaining || 0) - newEntries.length;
      await dbUpdate("user_boosts", `user_id=eq.${currentUser.id}`, { boosts_remaining: newBal });
      setBoostsRemaining(newBal);
    }
    // Sync boost_count column
    const countRes = await dbSelectAll("fan_art_boosts", `art_id=eq.${postId}&select=id`);
    if (countRes.ok) await dbUpdate("fan_art", `id=eq.${postId}`, { boost_count: countRes.data.length });
    showToast(newEntries.length === 1 ? "Boosted!" : "Boosted x" + newEntries.length + "!", "success");
  };

  const removeBoost = async (boostId) => {
    // GoibyJr only — removes a single boost row by its ID
    await dbDelete("fan_art_boosts", `id=eq.${boostId}`);
    const newList = boostsList.filter((b) => b.id !== boostId);
    setBoostsList(newList);
    setBoostCount(newList.length);
    if (newList.length === 0) setBoosted(false);
    await dbUpdate("fan_art", `id=eq.${postId}`, { boost_count: newList.length });
  };

  const canBoost = isUnlimitedBoosts || (boostsRemaining !== null && boostsRemaining > 0);

  const submitComment = async () => {
    if (!commentBody.trim() || isBannedUser) return;
    const trimmed = commentBody.trim();
    setSubmittingComment(true);
    const res = await dbInsert("fan_art_comments", {
      art_id: postId,
      user_id: currentUser.id,
      username: currentUser.username,
      body: trimmed,
      parent_comment_id: replyingTo ? replyingTo.parentId : null,
    });
    setSubmittingComment(false);
    if (!res.ok) { showToast("Couldn't post comment", "error"); return; }
    const newComment = { ...res.data[0], username: currentUser.username, body: trimmed, created_at: new Date().toISOString(), parent_comment_id: replyingTo ? replyingTo.parentId : null };
    const nextComments = [...comments, newComment];
    setComments(nextComments);
    if (replyingTo) setExpandedThreads((prev) => new Set(prev).add(replyingTo.parentId));
    refreshMentionMap(nextComments);
    notifyMentions(trimmed, res.data[0].id);
    setCommentBody("");
    setReplyingTo(null);
  };

  // Notifies anyone @mentioned in a comment (skipping the author, and
  // skipping usernames that don't match a real account).
  const notifyMentions = async (body, commentId) => {
    const mentioned = extractMentionedUsernames(body).filter((u) => u.toLowerCase() !== currentUser.username.toLowerCase());
    if (mentioned.length === 0) return;
    const inList = mentioned.map(encodeURIComponent).join(",");
    const res = await dbSelect("profiles", "username=in.(" + inList + ")&select=id,username");
    if (!res.ok || res.data.length === 0) return;
    const preview = body.length > 80 ? body.slice(0, 80) + "…" : body;
    await Promise.all(res.data.map((u) => dbInsert("notifications", {
      user_id: u.id,
      type: "mention",
      actor_username: currentUser.username,
      art_id: postId,
      comment_id: commentId,
      preview,
    })));
  };

  const startReply = (c) => {
    setReplyingTo({ parentId: c.parent_comment_id || c.id, username: c.username });
    setCommentBody("@" + c.username + " ");
    requestAnimationFrame(() => composeMention.inputRef.current?.focus());
  };

  const deletePost = async () => {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    await dbDelete("fan_art", `id=eq.${postId}`);
    showToast("Post deleted", "success");
    onBack();
  };

  const deleteComment = async (commentId) => {
    await dbDelete("fan_art_comments", `id=eq.${commentId}`);
    // Cascades in the database too, so drop any replies under it locally.
    setComments((prev) => prev.filter((c) => c.id !== commentId && c.parent_comment_id !== commentId));
    setOpenMenuId(null);
  };

  const startEdit = (c) => {
    setEditingCommentId(c.id);
    setEditingBody(c.body);
    setOpenMenuId(null);
  };

  const cancelEdit = () => {
    setEditingCommentId(null);
    setEditingBody("");
    editMention.close();
  };

  const saveEdit = async (commentId) => {
    if (!editingBody.trim()) return;
    const trimmed = editingBody.trim();
    const res = await dbUpdate("fan_art_comments", `id=eq.${commentId}`, { body: trimmed });
    if (!res.ok) { showToast("Couldn't update comment", "error"); return; }
    const nextComments = comments.map((c) => c.id === commentId ? { ...c, body: trimmed } : c);
    setComments(nextComments);
    refreshMentionMap(nextComments);
    setEditingCommentId(null);
    setEditingBody("");
  };

  const share = async () => {
    const base = window.location.origin + window.location.pathname;
    const url = base + "#fan-art/" + postId;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Couldn't copy link", "error");
    }
  };

  if (loading) return <CenterSpinner />;
  if (!post) return (
    <div>
      <button onClick={onBack} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Back</button>
      <p style={{ color: "rgba(217,200,168,0.5)" }}>Post not found.</p>
    </div>
  );

  const isOwner = currentUser.id === post.user_id;
  const canDelete = isOwner || currentUser.role === "admin";
  const isAdmin = currentUser.role === "admin";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <button onClick={onBack} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>← Fan Art</button>
        <div style={{ display: "flex", gap: 8 }}>
          {isOwner && (
            <button onClick={() => onBack({ edit: postId })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.Edit /> Edit
            </button>
          )}
          {canDelete && (
            <button onClick={deletePost} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, color: tokens.danger, borderColor: "rgba(194,74,58,0.35)", display: "flex", alignItems: "center", gap: 6 }}>
              <Icon.Trash /> Delete
            </button>
          )}
        </div>
      </div>

      <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 16, background: tokens.peat, border: "1px solid " + tokens.border }}>
        <img src={post.image_url} alt={post.title} style={{ width: "100%", display: "block", maxHeight: "70vh", objectFit: "contain" }} />
      </div>

      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "1.6rem", color: tokens.cream, margin: "0 0 6px", overflowWrap: "anywhere" }}>
        {post.title}
      </h1>
      <button
        onClick={() => onNavigate({ name: "artist-profile", userId: post.user_id, username: post.username })}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "0.82rem", color: tokens.sky, margin: "0 0 12px", display: "block", textDecoration: "underline", textDecorationColor: "rgba(91,175,212,0.4)" }}
      >
        by {post.username}
      </button>

      {post.description && (
        <p style={{ fontSize: "0.92rem", color: tokens.bone, lineHeight: 1.6, margin: "0 0 16px", overflowWrap: "anywhere" }}>
          {post.description}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
        <button
          onClick={toggleLike}
          disabled={isBannedUser}
          className="ughub-btn-ghost"
          style={{
            ...buttonStyles.ghostSmall,
            display: "flex", alignItems: "center", gap: 6,
            color: liked ? "#e05a6a" : tokens.bone,
            borderColor: liked ? "rgba(224,90,106,0.5)" : tokens.border,
            background: liked ? "rgba(224,90,106,0.1)" : "transparent",
          }}
        >
          {liked ? <Icon.HeartFilled color="#e05a6a" /> : <Icon.Heart />}
          {likeCount}
        </button>

        <div style={{ position: "relative" }}>
          <button
            onClick={(e) => { e.stopPropagation(); if (canBoost && !isBannedUser) setBoostPopoverOpen((o) => !o); }}
            disabled={isBannedUser || !canBoost}
            className="ughub-btn-ghost"
            style={{
              ...buttonStyles.ghostSmall,
              display: "flex", alignItems: "center", gap: 6,
              color: boostCount > 0 ? tokens.sky : (canBoost ? tokens.bone : "rgba(217,200,168,0.3)"),
              borderColor: boostPopoverOpen ? tokens.sky : boostCount > 0 ? "rgba(91,175,212,0.6)" : (canBoost ? tokens.border : "rgba(217,200,168,0.15)"),
              background: boostPopoverOpen ? "rgba(91,175,212,0.15)" : boostCount > 0 ? "rgba(91,175,212,0.12)" : "transparent",
            }}
          >
            <span style={{ fontSize: "1rem", lineHeight: 1 }}>↑</span>
            {boostCount > 0 ? boostCount : "Boost"}
            {isUnlimitedBoosts
              ? <span style={{ fontSize: "0.68rem", opacity: 0.6 }}>∞</span>
              : boostsRemaining !== null && boostsRemaining > 0
                ? <span style={{ fontSize: "0.68rem", opacity: 0.6 }}>({boostsRemaining} left)</span>
                : null}
          </button>
        </div>

        <button onClick={share} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon.Share /> {copied ? "Copied!" : "Share"}
        </button>
      </div>

      {boostPopoverOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: tokens.soil,
            border: "1px solid " + tokens.borderStrong,
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          <p style={{ margin: "0 0 6px", fontSize: "0.88rem", color: tokens.cream, fontWeight: 700 }}>
            Boost this piece
          </p>
          {!isUnlimitedBoosts && (
            <p style={{ margin: "0 0 12px", fontSize: "0.76rem", color: "rgba(217,200,168,0.5)" }}>
              {boostsRemaining} boost{boostsRemaining !== 1 ? "s" : ""} remaining this week
            </p>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <label style={{ fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", flexShrink: 0 }}>How many?</label>
            <input
              type="number"
              min="1"
              max={isUnlimitedBoosts ? 999 : (boostsRemaining || 1)}
              value={boostQty}
              onChange={(e) => setBoostQty(e.target.value)}
              style={{ ...selectStyle, width: 72, padding: "6px 8px" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setBoostPopoverOpen(false)}
              className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, flex: 1 }}
            >
              Cancel
            </button>
            <button
              onClick={() => applyBoost(boostQty)}
              disabled={!boostQty || Number(boostQty) < 1 || (!isUnlimitedBoosts && Number(boostQty) > boostsRemaining)}
              className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, flex: 1 }}
            >
              Confirm ↑
            </button>
          </div>
        </div>
      )}

      {boostCount > 0 && (
        <div
          className={"ughub-art-card " + boostClass(boostCount)}
          style={{ padding: "8px 14px", marginBottom: 16, borderRadius: 8, fontSize: "0.78rem", color: tokens.sky, display: "flex", alignItems: "center", gap: 6, background: "transparent" }}
        >
          <span>↑</span>
          {boostCount >= 10 ? "Hyper Boosted" : boostCount >= 6 ? "Super Boosted" : boostCount >= 3 ? "Well Boosted" : "Boosted"} · {boostCount} boost{boostCount !== 1 ? "s" : ""}
        </div>
      )}

      {isUnlimitedBoosts && boostsList.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontFamily: "'Bebas Neue'", color: "rgba(91,175,212,0.7)", fontSize: "0.82rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 8px" }}>
            Boost Log (Owner View)
          </p>
          <div style={{ display: "grid", gap: 6 }}>
            {boostsList.map((b, i) => (
              <div key={b.id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 6, padding: "7px 12px" }}>
                <span style={{ fontSize: "0.76rem", color: "rgba(217,200,168,0.55)", fontFamily: "monospace" }}>
                  Boost #{boostsList.length - i} · {b.profiles?.username || b.user_id?.slice(0, 8) || "unknown"}
                </span>
                <button
                  onClick={() => removeBoost(b.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: tokens.danger, padding: "2px 4px", display: "flex", alignItems: "center" }}
                  title="Remove this boost"
                >
                  <Icon.X width={13} height={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontFamily: "'Bebas Neue'", color: "rgba(217,200,168,0.5)", fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 12px" }}>
          Comments ({comments.length})
        </p>
        {comments.length === 0 && (
          <p style={{ color: "rgba(217,200,168,0.35)", fontSize: "0.85rem", marginBottom: 12 }}>No comments yet.</p>
        )}
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {comments.filter((c) => !c.parent_comment_id).map((c) => {
            const replies = comments.filter((r) => r.parent_comment_id === c.id);
            const expanded = expandedThreads.has(c.id);
            return (
              <div key={c.id}>
                <CommentItem
                  comment={c}
                  isReply={false}
                  currentUser={currentUser}
                  isAdmin={isAdmin}
                  mentionMap={mentionMap}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  editingCommentId={editingCommentId}
                  editingBody={editingBody}
                  setEditingBody={setEditingBody}
                  editMention={editMention}
                  startEdit={startEdit}
                  saveEdit={saveEdit}
                  cancelEdit={cancelEdit}
                  deleteComment={deleteComment}
                  onReply={startReply}
                  onNavigate={onNavigate}
                />
                {replies.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {!expanded ? (
                      <button
                        onClick={() => setExpandedThreads((prev) => new Set(prev).add(c.id))}
                        style={{ background: "none", border: "none", padding: "4px 0 4px 22px", cursor: "pointer", fontSize: "0.78rem", color: tokens.sky, fontWeight: 600 }}
                      >
                        View {replies.length} {replies.length === 1 ? "reply" : "replies"}
                      </button>
                    ) : (
                      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                        {replies.map((r) => (
                          <CommentItem
                            key={r.id}
                            comment={r}
                            isReply={true}
                            currentUser={currentUser}
                            isAdmin={isAdmin}
                            mentionMap={mentionMap}
                            openMenuId={openMenuId}
                            setOpenMenuId={setOpenMenuId}
                            editingCommentId={editingCommentId}
                            editingBody={editingBody}
                            setEditingBody={setEditingBody}
                            editMention={editMention}
                            startEdit={startEdit}
                            saveEdit={saveEdit}
                            cancelEdit={cancelEdit}
                            deleteComment={deleteComment}
                            onReply={startReply}
                            onNavigate={onNavigate}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!isBannedUser && (
          <div>
            {replyingTo && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, fontSize: "0.78rem", color: "rgba(217,200,168,0.55)" }}>
                <span>Replying to <span style={{ color: tokens.amber, fontWeight: 700 }}>@{replyingTo.username}</span></span>
                <button
                  onClick={() => { setReplyingTo(null); setCommentBody(""); }}
                  style={{ background: "none", border: "none", padding: 4, cursor: "pointer", color: "rgba(217,200,168,0.5)", display: "flex" }}
                >
                  <Icon.X width={13} height={13} />
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <input
                  ref={composeMention.inputRef}
                  value={commentBody}
                  onChange={(e) => composeMention.onChange(e.target.value, e.target.selectionStart, setCommentBody)}
                  onBlur={() => setTimeout(composeMention.close, 150)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComment(); } }}
                  placeholder={replyingTo ? "Write a reply…" : "Add a comment…"}
                  maxLength={500}
                  className="ughub-input" style={{ ...inputStyle, width: "100%" }}
                />
                <MentionDropdown mention={composeMention} value={commentBody} setValue={setCommentBody} />
              </div>
              <button
                onClick={submitComment}
                disabled={!commentBody.trim() || submittingComment}
                className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "10px 16px", flexShrink: 0 }}
              >
                {submittingComment ? <Spinner size={14} /> : <Icon.Comment />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CommentItem({ comment, isReply, currentUser, isAdmin, mentionMap, openMenuId, setOpenMenuId, editingCommentId, editingBody, setEditingBody, editMention, startEdit, saveEdit, cancelEdit, deleteComment, onReply, onNavigate }) {
  const isOwnComment = currentUser.id === comment.user_id;
  const canManage = isOwnComment || isAdmin;
  const isEditing = editingCommentId === comment.id;
  const menuOpen = openMenuId === comment.id;

  return (
    <div style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8, padding: "10px 14px", position: "relative", marginLeft: isReply ? 22 : 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: "0.82rem", color: tokens.amber }}>{comment.username}</span>
        {canManage && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={(e) => { e.stopPropagation(); setOpenMenuId(menuOpen ? null : comment.id); }}
              style={{ background: "none", border: "none", padding: "2px 4px", cursor: "pointer", color: menuOpen ? tokens.cream : "rgba(217,200,168,0.4)", borderRadius: 4, display: "flex", alignItems: "center" }}
            >
              <Icon.DotsVertical width={14} height={14} />
            </button>
            {menuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute", right: 0, top: "100%", zIndex: 30,
                  background: tokens.soil, border: `1px solid ${tokens.borderStrong}`,
                  borderRadius: 8, padding: 4, minWidth: 130,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.4)", marginTop: 4,
                }}
              >
                {isOwnComment && (
                  <button
                    onClick={() => startEdit(comment)}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "8px 12px", cursor: "pointer", color: tokens.bone, fontSize: "0.84rem", borderRadius: 6, textAlign: "left" }}
                  >
                    <Icon.Edit width={14} height={14} /> Edit
                  </button>
                )}
                <button
                  onClick={() => deleteComment(comment.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "8px 12px", cursor: "pointer", color: tokens.danger, fontSize: "0.84rem", borderRadius: 6, textAlign: "left" }}
                >
                  <Icon.Trash width={14} height={14} /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isEditing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <textarea
              ref={editMention.inputRef}
              value={editingBody}
              onChange={(e) => editMention.onChange(e.target.value, e.target.selectionStart, setEditingBody)}
              onBlur={() => setTimeout(editMention.close, 150)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(comment.id); } if (e.key === "Escape") { cancelEdit(); } }}
              maxLength={500}
              rows={3}
              autoFocus
              className="ughub-input" style={{ ...inputStyle, width: "100%", resize: "none", fontFamily: "'Rubik'", lineHeight: 1.5, fontSize: "0.88rem" }}
            />
            <MentionDropdown mention={editMention} value={editingBody} setValue={setEditingBody} />
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button onClick={cancelEdit} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, fontSize: "0.78rem", padding: "6px 10px" }}>Cancel</button>
            <button onClick={() => saveEdit(comment.id)} disabled={!editingBody.trim()} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, fontSize: "0.78rem", padding: "6px 12px" }}>Save</button>
          </div>
        </div>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: "0.88rem", color: tokens.bone, lineHeight: 1.5, overflowWrap: "anywhere" }}>
            {renderCommentBody(comment.body, mentionMap, onNavigate)}
          </p>
          <button
            onClick={() => onReply(comment)}
            style={{ background: "none", border: "none", padding: 0, marginTop: 6, cursor: "pointer", fontSize: "0.76rem", color: "rgba(217,200,168,0.5)", fontWeight: 600 }}
          >
            Reply
          </button>
        </>
      )}
    </div>
  );
}

function ArtistProfile({ userId, username, currentUser, onNavigate, onBack, showToast }) {
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const isSelf = currentUser.id === userId;

  useEffect(() => {
    (async () => {
      const [profileRes, postsRes, followRes, followerCountRes] = await Promise.all([
        dbSelect("profiles", "id=eq." + userId + "&select=id,username,display_name,bio,avatar_url"),
        dbSelect("fan_art", "user_id=eq." + userId + "&select=id,title,image_url,created_at&order=created_at.desc"),
        dbSelect("fan_art_follows", "follower_id=eq." + currentUser.id + "&following_id=eq." + userId + "&select=id"),
        dbSelect("fan_art_follows", "following_id=eq." + userId + "&select=id"),
      ]);
      setProfile(profileRes.ok && profileRes.data.length > 0 ? profileRes.data[0] : { username });
      setPosts(postsRes.ok ? postsRes.data : []);
      setFollowing(followRes.ok && followRes.data.length > 0);
      setFollowerCount(followerCountRes.ok ? followerCountRes.data.length : 0);
      setLoading(false);
    })();
  }, [userId]);

  const toggleFollow = async () => {
    if (following) {
      await dbDelete("fan_art_follows", "follower_id=eq." + currentUser.id + "&following_id=eq." + userId);
      setFollowing(false);
      setFollowerCount((c) => Math.max(0, c - 1));
    } else {
      const res = await dbInsert("fan_art_follows", { follower_id: currentUser.id, following_id: userId });
      if (!res.ok) { showToast("Couldn't follow", "error"); return; }
      setFollowing(true);
      setFollowerCount((c) => c + 1);
    }
  };

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <button onClick={onBack} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Fan Art</button>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "3px solid " + tokens.border, flexShrink: 0 }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: tokens.surface, border: "3px solid " + tokens.border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon.Person color="rgba(217,200,168,0.4)" width={32} height={32} />
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "1.5rem", color: tokens.cream, margin: 0, overflowWrap: "anywhere" }}>
            {profile.display_name || profile.username}
          </h1>
          {profile.display_name && (
            <div style={{ fontSize: "0.8rem", color: "rgba(217,200,168,0.5)", marginTop: 2 }}>@{profile.username}</div>
          )}
          <div style={{ fontSize: "0.76rem", color: "rgba(217,200,168,0.45)", marginTop: 4 }}>
            {followerCount} follower{followerCount !== 1 ? "s" : ""} · {posts.length} piece{posts.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {!isSelf && (
        <button
          onClick={toggleFollow}
          className="ughub-btn-ghost"
          style={{
            ...buttonStyles.ghostSmall,
            width: "100%",
            marginBottom: 16,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            color: following ? tokens.moss2 : tokens.bone,
            borderColor: following ? "rgba(107,173,92,0.5)" : tokens.border,
            background: following ? "rgba(107,173,92,0.1)" : "transparent",
          }}
        >
          {following ? <Icon.UserCheck /> : <Icon.UserPlus />}
          {following ? "Following" : "Follow"}
        </button>
      )}

      {profile.bio && (
        <div style={{ background: tokens.surface, border: "1px solid " + tokens.border, borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: "0.9rem", color: tokens.bone, lineHeight: 1.6, overflowWrap: "anywhere" }}>
          {profile.bio}
        </div>
      )}

      <p style={{ fontFamily: "'Bebas Neue'", color: "rgba(217,200,168,0.5)", fontSize: "0.85rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 12px" }}>
        Art by {profile.display_name || profile.username}
      </p>

      {posts.length === 0 ? (
        <p style={{ color: "rgba(217,200,168,0.4)", fontSize: "0.88rem", textAlign: "center", padding: "30px 0" }}>No art uploaded yet.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {posts.map((p) => (
            <button
              key={p.id}
              onClick={() => onNavigate({ name: "fan-art-post", postId: p.id })}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
            >
              <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid " + tokens.border, background: tokens.surface }}>
                <div style={{ width: "100%", aspectRatio: "1/1", overflow: "hidden", background: tokens.peat }}>
                  <img src={p.image_url} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </div>
                <div style={{ padding: "8px 10px", fontSize: "0.8rem", color: tokens.cream, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.title}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FanArtUpload({ currentUser, editId, onSaved, onCancel, showToast }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const fileRef = useRef(null);
  const isEditing = !!editId;

  useEffect(() => {
    if (!editId) { setLoading(false); return; }
    (async () => {
      const res = await dbSelect("fan_art", "id=eq." + editId + "&select=*");
      if (res.ok && res.data.length > 0) {
        const p = res.data[0];
        if (p.user_id !== currentUser.id) {
          showToast("You can only edit your own art", "error");
          onCancel();
          return;
        }
        setTitle(p.title);
        setDescription(p.description || "");
        setImageUrl(p.image_url);
      }
      setLoading(false);
    })();
  }, [editId]);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { window.alert("Please choose an image file."); return; }
    setUploading(true);
    const res = await uploadFanArt(file);
    setUploading(false);
    if (!res.ok) { window.alert("Couldn't upload: " + res.error); return; }
    setImageUrl(res.url);
  };

  const handleSave = async () => {
    if (!title.trim()) { window.alert("Please add a title."); return; }
    if (!imageUrl) { window.alert("Please upload an image."); return; }
    setSaving(true);
    if (isEditing) {
      const res = await dbUpdate("fan_art", "id=eq." + editId, {
        title: title.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
      });
      setSaving(false);
      if (!res.ok) { showToast("Couldn't save changes: " + res.error, "error"); return; }
      showToast("Changes saved", "success");
      onSaved(editId);
    } else {
      const res = await dbInsert("fan_art", {
        user_id: currentUser.id,
        username: currentUser.username,
        title: title.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
      });
      setSaving(false);
      if (!res.ok) { showToast("Couldn't post: " + res.error, "error"); return; }
      onSaved(res.data[0].id);
    }
  };

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <button onClick={onCancel} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Cancel</button>
      <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>
        Community
      </p>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: "0 0 24px" }}>
        {isEditing ? "Edit Fan Art" : "Upload Fan Art"}
      </h1>

      <div
        onClick={() => !imageUrl && fileRef.current?.click()}
        style={{
          width: "100%",
          aspectRatio: "16/9",
          borderRadius: 12,
          border: `2px dashed ${imageUrl ? tokens.moss : tokens.border}`,
          background: tokens.surface,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: imageUrl ? "default" : "pointer",
          marginBottom: 16,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {imageUrl ? (
          <>
            <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            <button
              onClick={(e) => { e.stopPropagation(); setImageUrl(""); }}
              style={{ position: "absolute", top: 10, right: 10, background: "rgba(10,7,3,0.7)", border: `1px solid ${tokens.border}`, borderRadius: 6, color: tokens.bone, padding: "4px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem" }}
            >
              <Icon.X width={12} height={12} /> Change
            </button>
          </>
        ) : uploading ? (
          <>
            <Spinner size={32} />
            <p style={{ color: "rgba(217,200,168,0.5)", marginTop: 12, fontSize: "0.88rem" }}>Uploading…</p>
          </>
        ) : (
          <>
            <Icon.Gallery color="rgba(217,200,168,0.3)" width={40} height={40} />
            <p style={{ color: "rgba(217,200,168,0.5)", marginTop: 12, fontSize: "0.88rem" }}>Tap to choose an image</p>
          </>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />

      {!imageUrl && !uploading && (
        <button onClick={() => fileRef.current?.click()} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, width: "100%", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Icon.Image /> Choose image
        </button>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>TITLE</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name your artwork…" maxLength={80} className="ughub-input" style={{ ...inputStyle, width: "100%" }} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>DESCRIPTION (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell us about this piece…"
          maxLength={500}
          rows={3}
          className="ughub-input" style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "'Rubik'", lineHeight: 1.5 }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onCancel} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>Cancel</button>
        <button onClick={handleSave} disabled={saving || !imageUrl || !title.trim()} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "10px 24px" }}>
          {saving ? (isEditing ? "Saving…" : "Posting…") : (isEditing ? "Save Changes" : "Post")}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   HALL OF FAME (public showcase of notable community members —
   players, artists, mods, etc. — curated by admins)
   ════════════════════════════════════════════════════════════ */

// Controls how much room an entry takes on the public gallery grid,
// and scales its photo shape and text size to match.
const HOF_SIZE_CONFIG = {
  small: { span: 1, aspect: "1/1", nameSize: "0.88rem", titleSize: "0.72rem", pad: "10px 12px" },
  medium: { span: 1, aspect: "4/5", nameSize: "0.96rem", titleSize: "0.76rem", pad: "12px 14px" },
  large: { span: 2, aspect: "16/9", nameSize: "1.15rem", titleSize: "0.84rem", pad: "14px 16px" },
};

// A gold gradient "frame" around a photo — used only for Hall of Fame
// portraits, since that's the one place a bit of trophy-case shine fits.
function GoldFrame({ src, alt, aspectRatio = "1/1" }) {
  return (
    <div
      style={{
        padding: 5,
        borderRadius: 14,
        background: "linear-gradient(135deg, #F0CE7C 0%, #C98A2E 45%, #8A5A1C 100%)",
        boxShadow: "0 6px 20px rgba(201,138,46,0.35), inset 0 0 0 1px rgba(255,230,170,0.5)",
      }}
    >
      <div style={{ width: "100%", aspectRatio, overflow: "hidden", borderRadius: 10, background: tokens.peat }}>
        <img src={src} alt={alt} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    </div>
  );
}

function HallOfFameGallery({ isAdmin, onNavigate }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await dbSelect("hall_of_fame", "select=id,name,title,photo_url,size&order=display_order.asc");
      setEntries(res.ok ? res.data : []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16, gap: 12 }}>
        <div>
          <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>Community</p>
          <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: 0 }}>Hall of Fame</h1>
        </div>
        {isAdmin && (
          <button onClick={() => onNavigate({ name: "hall-of-fame-manage" })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <Icon.Shield color={tokens.amber} /> Manage
          </button>
        )}
      </div>

      <p style={{ color: "rgba(217,200,168,0.55)", fontSize: "0.88rem", lineHeight: 1.5, margin: "0 0 20px" }}>
        Honoring the players, artists, and community members who make UG what it is.
      </p>

      {entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(217,200,168,0.4)" }}>
          <Icon.Trophy color="rgba(217,200,168,0.2)" width={48} height={48} />
          <p style={{ marginTop: 16 }}>No inductees yet — check back soon.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, gridAutoFlow: "row dense", alignItems: "start" }}>
          {entries.map((e) => {
            const cfg = HOF_SIZE_CONFIG[e.size] || HOF_SIZE_CONFIG.small;
            return (
              <button
                key={e.id}
                onClick={() => onNavigate({ name: "hall-of-fame-entry", entryId: e.id })}
                style={{ gridColumn: cfg.span === 2 ? "span 2" : "auto", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
              >
                <div style={{ background: "linear-gradient(135deg, #2F2212 0%, " + tokens.surface + " 100%)", border: "1px solid " + tokens.border, borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: 6 }}>
                    <GoldFrame src={e.photo_url} alt={e.name} aspectRatio={cfg.aspect} />
                  </div>
                  <div style={{ padding: cfg.pad, paddingTop: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: cfg.nameSize, color: tokens.cream, overflowWrap: "anywhere", marginBottom: e.title ? 4 : 0 }}>
                      {e.name}
                    </div>
                    {e.title && (
                      <div style={{ fontSize: cfg.titleSize, color: tokens.amber, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.title}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HallOfFameEntryView({ entryId, currentUser, isAdmin, onBack, onEdit, onDeleted, onNavigate, showToast }) {
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await dbSelect("hall_of_fame", "id=eq." + entryId + "&select=*");
      const e = res.ok && res.data.length > 0 ? res.data[0] : null;
      setEntry(e);
      setMessageDraft((e && e.personal_message) || "");
      setLoading(false);
    })();
  }, [entryId]);

  const handleDelete = async () => {
    if (!window.confirm("Remove this Hall of Fame entry? This can't be undone.")) return;
    setDeleting(true);
    const res = await dbDelete("hall_of_fame", "id=eq." + entryId);
    setDeleting(false);
    if (!res.ok) { showToast("Couldn't delete entry", "error"); return; }
    showToast("Entry removed", "success");
    onDeleted();
  };

  const isLinkedUser = !!(currentUser && entry && entry.linked_user_id === currentUser.id);

  const handleSaveMessage = async () => {
    setSavingMessage(true);
    const res = await dbRpc("set_hall_of_fame_message", { entry_id: entryId, message: messageDraft });
    setSavingMessage(false);
    if (!res.ok) { showToast("Couldn't save your message: " + res.error, "error"); return; }
    const cleaned = messageDraft.trim() || "";
    setMessageDraft(cleaned);
    setEntry((prev) => ({ ...prev, personal_message: cleaned || null }));
    showToast("Message saved", "success");
  };

  if (loading) return <CenterSpinner />;
  if (!entry) {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <p style={{ color: "rgba(217,200,168,0.5)", marginBottom: 16 }}>This entry couldn't be found.</p>
        <button onClick={onBack} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>← Back to Hall of Fame</button>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Hall of Fame</button>

      <div style={{ width: "100%", maxWidth: 320, margin: "0 auto 20px" }}>
        <GoldFrame src={entry.photo_url} alt={entry.name} aspectRatio="1/1" />
      </div>

      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: "0 0 6px" }}>
          {entry.name}
        </h1>
        {entry.title && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: tokens.amber, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            <Icon.Trophy width={14} height={14} /> {entry.title}
          </div>
        )}
        {entry.linked_username && (
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => onNavigate({ name: "user-profile", userId: entry.linked_user_id, returnTo: { name: "hall-of-fame-entry", entryId } })}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "0.78rem", color: "rgba(217,200,168,0.5)", textDecoration: "underline", textDecorationColor: "rgba(217,200,168,0.25)" }}
            >
              @{entry.linked_username}'s account →
            </button>
          </div>
        )}
      </div>

      {entry.bio && (
        <p style={{ color: tokens.bone, fontSize: "0.94rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          {entry.bio}
        </p>
      )}

      {entry.personal_message && (
        <div style={{ marginTop: 20, padding: "14px 16px", background: "rgba(107,173,92,0.08)", border: "1px solid rgba(107,173,92,0.25)", borderRadius: 10 }}>
          <p style={{ fontSize: "0.72rem", color: tokens.moss2, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", margin: "0 0 6px" }}>
            In their own words
          </p>
          <p style={{ color: tokens.cream, fontSize: "0.9rem", lineHeight: 1.6, fontStyle: "italic", whiteSpace: "pre-wrap", margin: 0 }}>
            "{entry.personal_message}"
          </p>
        </div>
      )}

      {isLinkedUser && (
        <div style={{ marginTop: 20, padding: "14px 16px", background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 10 }}>
          <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 6 }}>
            {entry.personal_message ? "Edit your message" : "This is you! Leave a message"}
          </label>
          <textarea
            value={messageDraft}
            onChange={(e) => setMessageDraft(e.target.value)}
            placeholder="Say whatever you'd like here…"
            maxLength={500}
            rows={3}
            className="ughub-input" style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "'Rubik'", lineHeight: 1.5, marginBottom: 8 }}
          />
          <button onClick={handleSaveMessage} disabled={savingMessage} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, width: "100%" }}>
            {savingMessage ? "Saving…" : "Save Message"}
          </button>
        </div>
      )}

      {isAdmin && (
        <div style={{ display: "flex", gap: 10, marginTop: 28, justifyContent: "center" }}>
          <button onClick={() => onEdit(entry.id)} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon.Edit /> Edit
          </button>
          <button onClick={handleDelete} disabled={deleting} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, color: tokens.danger, borderColor: "rgba(194,74,58,0.35)", display: "flex", alignItems: "center", gap: 6 }}>
            <Icon.Trash /> {deleting ? "Removing…" : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
}

function HallOfFameEditor({ editId, currentUser, onSaved, onCancel, showToast }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [size, setSize] = useState("small");
  const [linkedUserId, setLinkedUserId] = useState(null);
  const [linkedUsername, setLinkedUsername] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [personalMessage, setPersonalMessage] = useState(""); // read-only preview, for moderation
  const [clearingMessage, setClearingMessage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const fileRef = useRef(null);
  const isEditing = !!editId;

  useEffect(() => {
    if (!editId) { setLoading(false); return; }
    (async () => {
      const res = await dbSelect("hall_of_fame", "id=eq." + editId + "&select=*");
      if (res.ok && res.data.length > 0) {
        const e = res.data[0];
        setName(e.name);
        setTitle(e.title || "");
        setBio(e.bio || "");
        setPhotoUrl(e.photo_url);
        setSize(e.size || "small");
        setLinkedUserId(e.linked_user_id || null);
        setLinkedUsername(e.linked_username || "");
        setPersonalMessage(e.personal_message || "");
      }
      setLoading(false);
    })();
  }, [editId]);

  // Debounced username search for linking an entry to a real account
  useEffect(() => {
    const q = userQuery.trim();
    if (q.length < 2) { setUserResults([]); return; }
    setSearchingUsers(true);
    const t = setTimeout(async () => {
      const res = await dbSelect("profiles", "username=ilike.*" + encodeURIComponent(q) + "*&select=id,username,display_name&order=username.asc&limit=8");
      setUserResults(res.ok ? res.data : []);
      setSearchingUsers(false);
    }, 300);
    return () => clearTimeout(t);
  }, [userQuery]);

  // Close the search dropdown when tapping anywhere outside it
  useEffect(() => {
    if (!userQuery.trim()) return;
    const handler = (e) => { if (!e.target.closest(".hof-user-search")) setUserQuery(""); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [userQuery]);

  const selectUser = (u) => {
    setLinkedUserId(u.id);
    setLinkedUsername(u.username);
    setUserQuery("");
    setUserResults([]);
  };

  const unlinkUser = () => {
    setLinkedUserId(null);
    setLinkedUsername("");
  };

  const clearMessage = async () => {
    if (!window.confirm("Clear this person's message? This can't be undone.")) return;
    setClearingMessage(true);
    const res = await dbUpdate("hall_of_fame", "id=eq." + editId, { personal_message: null });
    setClearingMessage(false);
    if (!res.ok) { showToast("Couldn't clear message: " + res.error, "error"); return; }
    setPersonalMessage("");
    showToast("Message cleared", "success");
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { window.alert("Please choose an image file."); return; }
    setUploading(true);
    const res = await uploadHallOfFame(file);
    setUploading(false);
    if (!res.ok) { window.alert("Couldn't upload: " + res.error); return; }
    setPhotoUrl(res.url);
  };

  const handleSave = async () => {
    if (!name.trim()) { window.alert("Please add a name."); return; }
    if (!photoUrl) { window.alert("Please upload a photo."); return; }
    if (!bio.trim()) { window.alert("Please add a short bio."); return; }
    setSaving(true);
    if (isEditing) {
      const res = await dbUpdate("hall_of_fame", "id=eq." + editId, {
        name: name.trim(),
        title: title.trim() || null,
        bio: bio.trim(),
        photo_url: photoUrl,
        size,
        linked_user_id: linkedUserId,
        linked_username: linkedUserId ? linkedUsername : null,
      });
      setSaving(false);
      if (!res.ok) { showToast("Couldn't save changes: " + res.error, "error"); return; }
      showToast("Changes saved", "success");
      onSaved(editId);
    } else {
      const res = await dbInsert("hall_of_fame", {
        name: name.trim(),
        title: title.trim() || null,
        bio: bio.trim(),
        photo_url: photoUrl,
        size,
        linked_user_id: linkedUserId,
        linked_username: linkedUserId ? linkedUsername : null,
        display_order: Date.now(),
        created_by: currentUser.id,
      });
      setSaving(false);
      if (!res.ok) { showToast("Couldn't save: " + res.error, "error"); return; }
      showToast("Added to Hall of Fame", "success");
      onSaved(res.data[0].id);
    }
  };

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <button onClick={onCancel} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Cancel</button>
      <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>
        Community
      </p>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: "0 0 24px" }}>
        {isEditing ? "Edit Entry" : "Add to Hall of Fame"}
      </h1>

      <div
        onClick={() => !photoUrl && fileRef.current?.click()}
        style={{
          width: "100%",
          maxWidth: 280,
          margin: "0 auto 16px",
          aspectRatio: "1/1",
          borderRadius: 12,
          border: `2px dashed ${photoUrl ? tokens.moss : tokens.border}`,
          background: tokens.surface,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: photoUrl ? "default" : "pointer",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {photoUrl ? (
          <>
            <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button
              onClick={(e) => { e.stopPropagation(); setPhotoUrl(""); }}
              style={{ position: "absolute", top: 10, right: 10, background: "rgba(10,7,3,0.7)", border: `1px solid ${tokens.border}`, borderRadius: 6, color: tokens.bone, padding: "4px 8px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: "0.78rem" }}
            >
              <Icon.X width={12} height={12} /> Change
            </button>
          </>
        ) : uploading ? (
          <>
            <Spinner size={32} />
            <p style={{ color: "rgba(217,200,168,0.5)", marginTop: 12, fontSize: "0.88rem" }}>Uploading…</p>
          </>
        ) : (
          <>
            <Icon.Trophy color="rgba(217,200,168,0.3)" width={40} height={40} />
            <p style={{ color: "rgba(217,200,168,0.5)", marginTop: 12, fontSize: "0.88rem" }}>Tap to choose a photo</p>
          </>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />

      {!photoUrl && !uploading && (
        <button onClick={() => fileRef.current?.click()} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, width: "100%", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Icon.Image /> Choose photo
        </button>
      )}

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 6, letterSpacing: "0.04em" }}>SIZE ON THE HALL OF FAME PAGE</label>
        <div style={{ display: "flex", gap: 8 }}>
          {["small", "medium", "large"].map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className="ughub-btn-ghost"
              style={{
                flex: 1,
                padding: "10px 8px",
                borderRadius: 8,
                border: `2px solid ${size === s ? tokens.amber : tokens.border}`,
                background: size === s ? tokens.amber + "1A" : tokens.surface,
                color: size === s ? tokens.amber : "rgba(217,200,168,0.6)",
                fontWeight: 700,
                fontSize: "0.82rem",
                textTransform: "capitalize",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <p style={{ fontSize: "0.72rem", color: "rgba(217,200,168,0.4)", margin: "6px 0 0" }}>
          Large takes up the full width of the page — good for spotlighting someone.
        </p>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>NAME</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name or handle…" maxLength={80} className="ughub-input" style={{ ...inputStyle, width: "100%" }} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>TITLE (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Founding Member, Top Artist, Moderator…" maxLength={60} className="ughub-input" style={{ ...inputStyle, width: "100%" }} />
      </div>

      <div style={{ marginBottom: 14 }} className="hof-user-search">
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>LINK TO A USER (optional)</label>
        {linkedUserId ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: tokens.surface, border: `1px solid ${tokens.moss}`, borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: tokens.cream, fontWeight: 600, fontSize: "0.9rem", overflowWrap: "anywhere" }}>
              <Icon.UserCheck color={tokens.moss2} /> @{linkedUsername}
            </span>
            <button onClick={unlinkUser} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, padding: "5px 10px", flexShrink: 0 }}>Remove</button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Search by username…"
              className="ughub-input" style={{ ...inputStyle, width: "100%" }}
            />
            {userQuery.trim().length >= 2 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: tokens.soil, border: `1px solid ${tokens.border}`, borderRadius: 8, marginTop: 4, zIndex: 5, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                {searchingUsers ? (
                  <div style={{ padding: 14, textAlign: "center" }}><Spinner size={16} /></div>
                ) : userResults.length === 0 ? (
                  <div style={{ padding: 14, fontSize: "0.82rem", color: "rgba(217,200,168,0.4)" }}>No users found</div>
                ) : (
                  userResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => selectUser(u)}
                      style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: `1px solid ${tokens.border}`, padding: "10px 14px", cursor: "pointer", color: tokens.cream, fontSize: "0.88rem" }}
                    >
                      @{u.username}{u.display_name ? <span style={{ color: "rgba(217,200,168,0.5)" }}> ({u.display_name})</span> : null}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <p style={{ fontSize: "0.72rem", color: "rgba(217,200,168,0.4)", margin: "4px 0 0" }}>
          Linking lets that person add their own message to this entry.
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>BIO</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="What makes them Hall of Fame worthy…"
          maxLength={1000}
          rows={5}
          className="ughub-input" style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "'Rubik'", lineHeight: 1.5 }}
        />
      </div>

      {isEditing && personalMessage && (
        <div style={{ marginBottom: 24, padding: "12px 14px", background: "rgba(107,173,92,0.08)", border: "1px solid rgba(107,173,92,0.25)", borderRadius: 8 }}>
          <p style={{ fontSize: "0.72rem", color: tokens.moss2, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", margin: "0 0 6px" }}>
            Their message
          </p>
          <p style={{ color: tokens.bone, fontSize: "0.86rem", lineHeight: 1.5, fontStyle: "italic", whiteSpace: "pre-wrap", margin: "0 0 10px" }}>
            "{personalMessage}"
          </p>
          <button onClick={clearMessage} disabled={clearingMessage} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, color: tokens.danger, borderColor: "rgba(194,74,58,0.35)", fontSize: "0.76rem" }}>
            {clearingMessage ? "Clearing…" : "Clear message"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onCancel} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>Cancel</button>
        <button onClick={handleSave} disabled={saving || !photoUrl || !name.trim() || !bio.trim()} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "10px 24px" }}>
          {saving ? "Saving…" : isEditing ? "Save Changes" : "Add Entry"}
        </button>
      </div>
    </div>
  );
}

function HallOfFameManage({ onNavigate, showToast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const rowRefs = useRef([]);
  const entriesRef = useRef([]);
  const dragStateRef = useRef(null);
  const orderChangedRef = useRef(false);

  const load = useCallback(async () => {
    const res = await dbSelect("hall_of_fame", "select=id,name,title,photo_url,display_order,size&order=display_order.asc");
    const data = res.ok ? res.data : [];
    setEntries(data);
    entriesRef.current = data;
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  const startDrag = (e, index) => {
    e.preventDefault();
    dragStateRef.current = { index, startY: e.clientY };
    setDragIndex(index);
    setDragOffset(0);
    orderChangedRef.current = false;
  };

  useEffect(() => {
    if (dragIndex === null) return;

    const handleMove = (e) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const clientY = e.clientY;
      const delta = clientY - drag.startY;
      setDragOffset(delta);

      const draggedEl = rowRefs.current[drag.index];
      if (!draggedEl) return;
      const draggedRect = draggedEl.getBoundingClientRect();
      const draggedCenter = draggedRect.top + draggedRect.height / 2 + delta;

      const current = entriesRef.current;
      for (let i = 0; i < current.length; i++) {
        if (i === drag.index) continue;
        const el = rowRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const rowCenter = rect.top + rect.height / 2;
        const shouldSwap = (i < drag.index && draggedCenter < rowCenter) || (i > drag.index && draggedCenter > rowCenter);
        if (shouldSwap) {
          const next = [...current];
          const [moved] = next.splice(drag.index, 1);
          next.splice(i, 0, moved);
          entriesRef.current = next;
          setEntries(next);
          dragStateRef.current = { index: i, startY: clientY };
          setDragIndex(i);
          setDragOffset(0);
          orderChangedRef.current = true;
          break;
        }
      }
    };

    const finishDrag = async () => {
      setDragIndex(null);
      setDragOffset(0);
      dragStateRef.current = null;
      if (orderChangedRef.current) {
        orderChangedRef.current = false;
        const final = entriesRef.current;
        const results = await Promise.all(final.map((e, i) => dbUpdate("hall_of_fame", "id=eq." + e.id, { display_order: i })));
        if (results.some((r) => !r.ok)) showToast("Order didn't fully save — check your connection", "error");
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragIndex, showToast]);

  const handleDelete = async (entry) => {
    if (!window.confirm(`Remove "${entry.name}" from the Hall of Fame? This can't be undone.`)) return;
    setBusyId(entry.id);
    const res = await dbDelete("hall_of_fame", "id=eq." + entry.id);
    setBusyId(null);
    if (!res.ok) { showToast("Couldn't delete entry", "error"); return; }
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    showToast("Entry removed", "success");
  };

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <button onClick={() => onNavigate({ name: "admin-hub" })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Admin Panel</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>Admin Tools</p>
          <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: 0 }}>Manage Hall of Fame</h1>
        </div>
        <button onClick={() => onNavigate({ name: "hall-of-fame-editor", editId: null })} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon.Plus /> Add Entry
        </button>
      </div>

      {entries.length > 1 && (
        <p style={{ fontSize: "0.76rem", color: "rgba(217,200,168,0.4)", margin: "0 0 14px" }}>
          Drag <Icon.GripVertical style={{ verticalAlign: "middle" }} /> to reorder.
        </p>
      )}

      {entries.length === 0 ? (
        <p style={{ color: "rgba(217,200,168,0.4)", fontSize: "0.88rem" }}>No entries yet — tap "Add Entry" to induct the first one.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {entries.map((e, i) => {
            const dragging = dragIndex === i;
            return (
              <div
                key={e.id}
                ref={(el) => (rowRefs.current[i] = el)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, background: tokens.surface,
                  border: `1px solid ${dragging ? tokens.amber : tokens.border}`, borderRadius: 8, padding: "10px 12px",
                  position: "relative", transform: dragging ? `translateY(${dragOffset}px)` : "none",
                  zIndex: dragging ? 10 : 1, boxShadow: dragging ? "0 8px 20px rgba(0,0,0,0.4)" : "none",
                  touchAction: dragging ? "none" : undefined,
                }}
              >
                <button
                  onPointerDown={(e2) => startDrag(e2, i)}
                  className="ughub-btn-ghost"
                  style={{ ...buttonStyles.ghostSmall, padding: 6, cursor: "grab", touchAction: "none", color: "rgba(217,200,168,0.5)", flexShrink: 0 }}
                >
                  <Icon.GripVertical />
                </button>

                <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: tokens.peat }}>
                  <img src={e.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.88rem", color: tokens.cream, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {e.title && <span style={{ fontSize: "0.72rem", color: tokens.amber, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>}
                    <span style={{ fontSize: "0.68rem", color: "rgba(217,200,168,0.35)", textTransform: "capitalize", flexShrink: 0 }}>· {e.size || "small"}</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => onNavigate({ name: "hall-of-fame-editor", editId: e.id })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, padding: 8 }}>
                    <Icon.Edit />
                  </button>
                  <button onClick={() => handleDelete(e)} disabled={busyId === e.id} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, padding: 8, color: tokens.danger, borderColor: "rgba(194,74,58,0.35)" }}>
                    <Icon.Trash />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   ADMIN HUB — single entry point for every admin tool
   ════════════════════════════════════════════════════════════ */

function AdminHub({ onNavigate }) {
  const sections = [
    { label: "Manage Users", description: "Roles, bans, and account search.", icon: "Shield", route: "admin" },
    { label: "Hall of Fame", description: "Add, reorder, and edit inductees.", icon: "Trophy", route: "hall-of-fame-manage" },
    { label: "Badges", description: "Create badge types and assign manual ones.", icon: "Star", route: "badges-manage" },
  ];

  return (
    <div>
      <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
        Admin Tools
      </p>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, marginTop: 0, marginBottom: 24 }}>
        Admin Panel
      </h1>

      <div style={{ display: "grid", gap: 10 }}>
        {sections.map((s) => {
          const IconComp = Icon[s.icon];
          return (
            <button
              key={s.route}
              onClick={() => onNavigate({ name: s.route })}
              className="ughub-btn-ghost"
              style={{
                display: "flex", alignItems: "center", gap: 14, textAlign: "left",
                background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 10,
                padding: "16px 18px", cursor: "pointer", width: "100%",
              }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 8, background: tokens.amber + "1A", border: `1px solid ${tokens.amber}55`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <IconComp color={tokens.amber} width={18} height={18} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.96rem", color: tokens.cream }}>{s.label}</div>
                <div style={{ fontSize: "0.78rem", color: "rgba(217,200,168,0.5)", marginTop: 2 }}>{s.description}</div>
              </div>
              <Icon.ArrowUp style={{ transform: "rotate(90deg)", flexShrink: 0 }} color="rgba(217,200,168,0.3)" width={14} height={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   BADGES (admin management — creating badge types and assigning
   the manual ones; the public directory page was removed in
   favor of tapping a badge on someone's profile)
   ════════════════════════════════════════════════════════════ */

function ManageBadges({ onNavigate, showToast }) {
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const load = useCallback(async () => {
    const res = await dbSelect("badges", "select=*&order=created_at.asc");
    setBadges(res.ok ? res.data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (b) => {
    if (!window.confirm(`Delete the "${b.name}" badge? Anyone who has it will lose it. This can't be undone.`)) return;
    setDeletingId(b.id);
    const res = await dbDelete("badges", "id=eq." + b.id);
    setDeletingId(null);
    if (!res.ok) { showToast("Couldn't delete badge", "error"); return; }
    setBadges((prev) => prev.filter((x) => x.id !== b.id));
    showToast("Badge deleted", "success");
  };

  const kindLabel = (k) => ({
    manual: "Manual",
    admin: "Auto · Admin",
    hall_of_fame: "Auto · Hall of Fame",
    fan_art_likes: "Auto · Fan Art Likes",
    fan_art_posts: "Auto · Fan Art Posts",
    followers: "Auto · Followers",
    comments: "Auto · Comments",
    account_age: "Auto · Membership Age",
  }[k] || k);

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <button onClick={() => onNavigate({ name: "admin-hub" })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Admin Panel</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>Admin Tools</p>
          <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: 0 }}>Manage Badges</h1>
        </div>
        <button onClick={() => onNavigate({ name: "badge-editor", editId: null })} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, display: "flex", alignItems: "center", gap: 6 }}>
          <Icon.Plus /> New Badge
        </button>
      </div>

      {badges.length === 0 ? (
        <p style={{ color: "rgba(217,200,168,0.4)", fontSize: "0.88rem" }}>No badges yet — tap "New Badge" to create the first one.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {badges.map((b) => (
            <div key={b.id} style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <BadgeChip badge={b} />
                <span style={{ fontSize: "0.7rem", color: "rgba(217,200,168,0.4)", flexShrink: 0 }}>{kindLabel(b.kind)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {b.kind === "manual" && (
                  <button onClick={() => onNavigate({ name: "badge-assign", badgeId: b.id })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, fontSize: "0.78rem", display: "flex", alignItems: "center", gap: 5 }}>
                    <Icon.UserCheck width={13} height={13} /> Recipients
                  </button>
                )}
                <button onClick={() => onNavigate({ name: "badge-editor", editId: b.id })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, fontSize: "0.78rem", display: "flex", alignItems: "center", gap: 5 }}>
                  <Icon.Edit width={13} height={13} /> Edit
                </button>
                <button onClick={() => handleDelete(b)} disabled={deletingId === b.id} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, fontSize: "0.78rem", color: tokens.danger, borderColor: "rgba(194,74,58,0.35)", display: "flex", alignItems: "center", gap: 5 }}>
                  <Icon.Trash width={13} height={13} /> {deletingId === b.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BadgeEditor({ editId, onSaved, onCancel, showToast }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("Star");
  const [color, setColor] = useState(tokens.amber);
  const [kind, setKind] = useState("manual");
  const [threshold, setThreshold] = useState("10");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const isEditing = !!editId;

  useEffect(() => {
    if (!editId) { setLoading(false); return; }
    (async () => {
      const res = await dbSelect("badges", "id=eq." + editId + "&select=*");
      if (res.ok && res.data.length > 0) {
        const b = res.data[0];
        setName(b.name);
        setDescription(b.description || "");
        setIcon(b.icon || "Star");
        setColor(b.color || tokens.amber);
        setKind(b.kind || "manual");
        setThreshold(String(b.threshold || 10));
      }
      setLoading(false);
    })();
  }, [editId]);

  const handleSave = async () => {
    if (!name.trim()) { window.alert("Please add a name."); return; }
    if (THRESHOLD_KIND_LABELS[kind] && (!threshold || isNaN(parseInt(threshold, 10)) || parseInt(threshold, 10) < 1)) {
      window.alert("Please enter a valid number.");
      return;
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      icon,
      color,
      kind,
      threshold: THRESHOLD_KIND_LABELS[kind] ? parseInt(threshold, 10) : null,
    };
    const res = isEditing
      ? await dbUpdate("badges", "id=eq." + editId, payload)
      : await dbInsert("badges", payload);
    setSaving(false);
    if (!res.ok) { showToast("Couldn't save badge: " + res.error, "error"); return; }
    showToast(isEditing ? "Badge saved" : "Badge created", "success");
    onSaved();
  };

  const preview = { name: name.trim() || "Badge Name", icon, color, description: description.trim() };

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <button onClick={onCancel} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Cancel</button>
      <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>Admin Tools</p>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: "0 0 20px" }}>
        {isEditing ? "Edit Badge" : "New Badge"}
      </h1>

      <div style={{ marginBottom: 20 }}><BadgeChip badge={preview} /></div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>NAME</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fan Favorite" maxLength={40} className="ughub-input" style={{ ...inputStyle, width: "100%" }} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>DESCRIPTION (optional)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown on the Badges page…" maxLength={140} className="ughub-input" style={{ ...inputStyle, width: "100%" }} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 6, letterSpacing: "0.04em" }}>ICON</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {BADGE_ICON_OPTIONS.map((opt) => {
            const IconComp = Icon[opt];
            const selected = icon === opt;
            return (
              <button
                key={opt}
                onClick={() => setIcon(opt)}
                style={{
                  width: 40, height: 40, borderRadius: 8,
                  border: `2px solid ${selected ? color : tokens.border}`,
                  background: selected ? color + "1A" : tokens.surface,
                  color: selected ? color : "rgba(217,200,168,0.6)",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                }}
              >
                <IconComp width={16} height={16} />
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 6, letterSpacing: "0.04em" }}>COLOR</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {BADGE_COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setColor(opt.value)}
              title={opt.label}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                border: color === opt.value ? `2px solid ${tokens.cream}` : "2px solid transparent",
                background: opt.value, cursor: "pointer", padding: 0,
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 6, letterSpacing: "0.04em" }}>HOW IT'S EARNED</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="ughub-input" style={{ ...selectStyle, width: "100%", padding: "10px 12px", fontSize: "0.92rem" }}
        >
          <option value="manual">Manual — I'll assign it myself</option>
          <option value="fan_art_likes">Automatic — reaches X total Fan Art likes</option>
          <option value="fan_art_posts">Automatic — posts X pieces of Fan Art</option>
          <option value="followers">Automatic — reaches X followers</option>
          <option value="comments">Automatic — posts X comments</option>
          <option value="account_age">Automatic — member for X days</option>
          <option value="hall_of_fame">Automatic — linked in the Hall of Fame</option>
          <option value="admin">Automatic — is an admin</option>
        </select>
      </div>

      {THRESHOLD_KIND_LABELS[kind] && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>{THRESHOLD_KIND_LABELS[kind]}</label>
          <input
            type="number"
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            min={1}
            className="ughub-input" style={{ ...inputStyle, width: "100%" }}
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onCancel} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>Cancel</button>
        <button onClick={handleSave} disabled={saving || !name.trim()} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "10px 24px" }}>
          {saving ? "Saving…" : isEditing ? "Save Changes" : "Create Badge"}
        </button>
      </div>
    </div>
  );
}

function BadgeAssign({ badgeId, onNavigate, showToast }) {
  const [badge, setBadge] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const [bRes, rRes] = await Promise.all([
      dbSelect("badges", "id=eq." + badgeId + "&select=*"),
      dbSelect("user_badges", "badge_id=eq." + badgeId + "&select=id,user_id,profiles(id,username,display_name,avatar_url)&order=awarded_at.desc"),
    ]);
    setBadge(bRes.ok && bRes.data.length > 0 ? bRes.data[0] : null);
    setRecipients(rRes.ok ? rRes.data : []);
    setLoading(false);
  }, [badgeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const q = userQuery.trim();
    if (q.length < 2) { setUserResults([]); return; }
    setSearchingUsers(true);
    const t = setTimeout(async () => {
      const res = await dbSelect("profiles", "username=ilike.*" + encodeURIComponent(q) + "*&select=id,username,display_name&order=username.asc&limit=8");
      setUserResults(res.ok ? res.data : []);
      setSearchingUsers(false);
    }, 300);
    return () => clearTimeout(t);
  }, [userQuery]);

  useEffect(() => {
    if (!userQuery.trim()) return;
    const handler = (e) => { if (!e.target.closest(".badge-user-search")) setUserQuery(""); };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [userQuery]);

  const alreadyHas = (userId) => recipients.some((r) => r.user_id === userId);

  const addRecipient = async (u) => {
    if (alreadyHas(u.id)) { setUserQuery(""); setUserResults([]); return; }
    setBusyId(u.id);
    const res = await dbInsert("user_badges", { user_id: u.id, badge_id: badgeId });
    setBusyId(null);
    if (!res.ok) { showToast("Couldn't add: " + res.error, "error"); return; }
    setUserQuery("");
    setUserResults([]);
    load();
    showToast(`Added to @${u.username}`, "success");
  };

  const removeRecipient = async (r) => {
    setBusyId(r.id);
    const res = await dbDelete("user_badges", "id=eq." + r.id);
    setBusyId(null);
    if (!res.ok) { showToast("Couldn't remove", "error"); return; }
    setRecipients((prev) => prev.filter((x) => x.id !== r.id));
    showToast("Removed", "success");
  };

  if (loading) return <CenterSpinner />;
  if (!badge) {
    return (
      <div>
        <button onClick={() => onNavigate({ name: "badges-manage" })} className="ughub-btn-ghost" style={buttonStyles.ghostSmall}>← Manage Badges</button>
        <p style={{ color: "rgba(217,200,168,0.5)", marginTop: 16 }}>Badge not found.</p>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => onNavigate({ name: "badges-manage" })} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Manage Badges</button>

      <div style={{ marginBottom: 6 }}><BadgeChip badge={badge} /></div>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "1.6rem", color: tokens.cream, margin: "10px 0 20px" }}>Recipients</h1>

      <div className="badge-user-search" style={{ position: "relative", marginBottom: 24 }}>
        <input
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
          placeholder="Search by username to add…"
          className="ughub-input" style={{ ...inputStyle, width: "100%" }}
        />
        {userQuery.trim().length >= 2 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: tokens.soil, border: `1px solid ${tokens.border}`, borderRadius: 8, marginTop: 4, zIndex: 5, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
            {searchingUsers ? (
              <div style={{ padding: 14, textAlign: "center" }}><Spinner size={16} /></div>
            ) : userResults.length === 0 ? (
              <div style={{ padding: 14, fontSize: "0.82rem", color: "rgba(217,200,168,0.4)" }}>No users found</div>
            ) : (
              userResults.map((u) => (
                <button
                  key={u.id}
                  onClick={() => addRecipient(u)}
                  disabled={busyId === u.id}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: `1px solid ${tokens.border}`, padding: "10px 14px", cursor: "pointer", color: tokens.cream, fontSize: "0.88rem" }}
                >
                  <span>@{u.username}{u.display_name ? <span style={{ color: "rgba(217,200,168,0.5)" }}> ({u.display_name})</span> : null}</span>
                  {alreadyHas(u.id) ? <Icon.UserCheck color={tokens.moss2} width={14} height={14} /> : <Icon.Plus width={14} height={14} />}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {recipients.length === 0 ? (
        <p style={{ color: "rgba(217,200,168,0.4)", fontSize: "0.88rem" }}>Nobody has this badge yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {recipients.map((r) => {
            const p = r.profiles;
            if (!p) return null;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8, padding: "10px 12px" }}>
                {p.avatar_url ? (
                  <img src={p.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: tokens.peat, border: `1px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon.Person width={14} height={14} color="rgba(217,200,168,0.4)" />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "0.86rem", color: tokens.cream, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.display_name || p.username}
                  </div>
                  {p.display_name && <div style={{ fontSize: "0.72rem", color: "rgba(217,200,168,0.45)" }}>@{p.username}</div>}
                </div>
                <button onClick={() => removeRecipient(r)} disabled={busyId === r.id} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, padding: 8, color: tokens.danger, borderColor: "rgba(194,74,58,0.35)", flexShrink: 0 }}>
                  <Icon.Trash width={13} height={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   USER PROFILE VIEW
   ════════════════════════════════════════════════════════════ */

function UserProfileView({ userId, onBack }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [badges, setBadges] = useState([]);

  useEffect(() => {
    (async () => {
      const res = await dbSelect("profiles", `id=eq.${encodeURIComponent(userId)}&select=id,username,display_name,bio,avatar_url,role,banned_until`);
      const p = res.ok && res.data.length > 0 ? res.data[0] : null;
      setProfile(p);
      setLoading(false);
      if (p) setBadges(await getUserBadges(p.id, p.role));
    })();
  }, [userId]);

  if (loading) return <CenterSpinner />;
  if (!profile) return (
    <div>
      <button onClick={onBack} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>← Back</button>
      <p style={{ color: "rgba(217,200,168,0.5)" }}>User not found.</p>
    </div>
  );

  const isBanned = profile.banned_until && new Date(profile.banned_until) > new Date();
  const isPerm = isBanned && new Date(profile.banned_until).getFullYear() >= 2099;

  return (
    <div>
      <button onClick={onBack} className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, marginBottom: 20 }}>
        ← Back
      </button>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: `3px solid ${tokens.border}`, flexShrink: 0 }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: tokens.surface, border: `3px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon.Person color="rgba(217,200,168,0.4)" width={32} height={32} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "1.6rem", color: tokens.cream, margin: 0, overflowWrap: "anywhere" }}>
              {profile.display_name || profile.username}
            </h1>
            {profile.role === "admin" && <Icon.Shield color={tokens.amber} />}
            {isBanned && <Icon.Lock color={tokens.danger} />}
          </div>
          {profile.display_name && (
            <div style={{ fontSize: "0.82rem", color: "rgba(217,200,168,0.5)", marginTop: 2 }}>@{profile.username}</div>
          )}
        </div>
      </div>

      {profile.bio && (
        <div style={{ background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: "0.92rem", color: tokens.bone, lineHeight: 1.6, overflowWrap: "anywhere" }}>
          {profile.bio}
        </div>
      )}

      {badges.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <BadgeRow badges={badges} />
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8 }}>
          <span style={{ fontSize: "0.78rem", color: "rgba(217,200,168,0.5)" }}>Role</span>
          <span style={{ fontSize: "0.82rem", color: profile.role === "admin" ? tokens.amber : tokens.bone, fontWeight: 600 }}>{profile.role}</span>
        </div>
        <div style={{ padding: "10px 14px", background: tokens.surface, border: `1px solid ${tokens.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: "0.78rem", color: "rgba(217,200,168,0.5)", marginBottom: 4 }}>Supabase User ID</div>
          <div style={{ fontSize: "0.74rem", fontFamily: "monospace", color: "rgba(217,200,168,0.7)", overflowWrap: "anywhere" }}>{profile.id}</div>
        </div>
        {isBanned && (
          <div style={{ padding: "10px 14px", background: "rgba(194,74,58,0.08)", border: "1px solid rgba(194,74,58,0.35)", borderRadius: 8 }}>
            <div style={{ fontSize: "0.78rem", color: tokens.danger, fontWeight: 700, marginBottom: 2 }}>
              {isPerm ? "Permanently banned" : "Temporarily banned"}
            </div>
            {!isPerm && (
              <div style={{ fontSize: "0.76rem", color: "rgba(217,200,168,0.55)" }}>
                Unbanned on {formatBanDate(profile.banned_until)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   NOTIFICATIONS
   ════════════════════════════════════════════════════════════ */

function NotificationsView({ currentUser, onNavigate }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const res = await dbSelect("notifications", "user_id=eq." + currentUser.id + "&select=*&order=created_at.desc&limit=50");
      const data = res.ok ? res.data : [];
      setNotifications(data);
      setLoading(false);
      const unreadIds = data.filter((n) => !n.read).map((n) => n.id);
      if (unreadIds.length > 0) {
        await dbUpdate("notifications", "id=in.(" + unreadIds.join(",") + ")", { read: true });
      }
    })();
  }, [currentUser.id]);

  if (loading) return <CenterSpinner />;

  return (
    <div>
      <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 4px" }}>You</p>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, margin: "0 0 20px" }}>Notifications</h1>

      {notifications.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(217,200,168,0.4)" }}>
          <Icon.Bell color="rgba(217,200,168,0.2)" width={40} height={40} />
          <p style={{ marginTop: 16 }}>No notifications yet.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => onNavigate({ name: "fan-art-post", postId: n.art_id })}
              style={{
                display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                background: n.read ? tokens.surface : "rgba(91,175,212,0.08)",
                border: `1px solid ${n.read ? tokens.border : "rgba(91,175,212,0.3)"}`,
                borderRadius: 8, padding: "12px 14px",
              }}
            >
              <p style={{ margin: "0 0 4px", fontSize: "0.86rem", color: tokens.cream }}>
                <span style={{ fontWeight: 700, color: tokens.sky }}>@{n.actor_username}</span> mentioned you in a comment
              </p>
              {n.preview && (
                <p style={{ margin: "0 0 6px", fontSize: "0.8rem", color: "rgba(217,200,168,0.6)", overflowWrap: "anywhere" }}>
                  "{n.preview}"
                </p>
              )}
              <p style={{ margin: 0, fontSize: "0.7rem", color: "rgba(217,200,168,0.4)" }}>{timeAgo(n.created_at)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   PROFILE VIEW
   ════════════════════════════════════════════════════════════ */

function ProfileView({ currentUser, onSaved, showToast }) {
  const [displayName, setDisplayName] = useState(currentUser.displayName || "");
  const [bio, setBio] = useState(currentUser.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(currentUser.avatarUrl || "");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarFileRef = useRef(null);
  const [followerCount, setFollowerCount] = useState(null);
  const [followers, setFollowers] = useState([]);
  const [followersExpanded, setFollowersExpanded] = useState(false);
  const [followersLoaded, setFollowersLoaded] = useState(false);
  const [loadingFollowers, setLoadingFollowers] = useState(false);
  const [badges, setBadges] = useState([]);

  useEffect(() => {
    (async () => {
      const res = await dbSelect("fan_art_follows", "following_id=eq." + currentUser.id + "&select=id");
      setFollowerCount(res.ok ? res.data.length : 0);
    })();
    (async () => {
      setBadges(await getUserBadges(currentUser.id, currentUser.role));
    })();
  }, []);

  const toggleFollowersList = async () => {
    if (!followersExpanded && !followersLoaded) {
      setLoadingFollowers(true);
      // Join through to get each follower's profile (avatar, name)
      const res = await dbSelect(
        "fan_art_follows",
        "following_id=eq." + currentUser.id + "&select=created_at,profiles!fan_art_follows_follower_id_fkey(id,username,display_name,avatar_url)&order=created_at.desc"
      );
      setFollowers(res.ok ? res.data : []);
      setFollowersLoaded(true);
      setLoadingFollowers(false);
    }
    setFollowersExpanded((e) => !e);
  };

  const handleAvatarFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      window.alert("Please choose an image file.");
      return;
    }
    setUploadingAvatar(true);
    const res = await uploadImage(file);
    setUploadingAvatar(false);
    if (!res.ok) {
      window.alert("Couldn't upload avatar: " + res.error);
      return;
    }
    setAvatarUrl(res.url);
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await dbUpdate("profiles", `id=eq.${currentUser.id}`, {
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
      avatar_url: avatarUrl.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      showToast("Couldn't save profile: " + res.error, "error");
      return;
    }
    onSaved({ displayName: displayName.trim(), bio: bio.trim(), avatarUrl: avatarUrl.trim() });
    showToast("Profile saved!", "success");
  };

  return (
    <div>
      <p style={{ fontFamily: "'Bebas Neue'", color: tokens.moss2, fontSize: "1rem", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
        Account
      </p>
      <h1 style={{ fontFamily: "'Bebas Neue'", fontWeight: 900, fontSize: "2rem", color: tokens.cream, marginTop: 0, marginBottom: 24 }}>
        My Profile
      </h1>

      {/* Avatar */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 28 }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", border: `3px solid ${tokens.border}`, display: "block" }}
              onError={(e) => { e.currentTarget.style.opacity = 0.3; }}
            />
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: tokens.surface, border: `3px solid ${tokens.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon.Person color="rgba(217,200,168,0.4)" width={36} height={36} />
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          <button
            onClick={() => avatarFileRef.current?.click()}
            disabled={uploadingAvatar}
            className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}
          >
            {uploadingAvatar ? <Spinner size={15} /> : <Icon.Image />}
            {uploadingAvatar ? "Uploading…" : avatarUrl ? "Change photo" : "Upload photo"}
          </button>
          {avatarUrl && (
            <button
              onClick={() => setAvatarUrl("")}
              className="ughub-btn-ghost" style={{ ...buttonStyles.ghostSmall, color: tokens.danger, borderColor: "rgba(194,74,58,0.35)", display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}
            >
              <Icon.X width={13} height={13} /> Remove photo
            </button>
          )}
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => { handleAvatarFile(e.target.files?.[0]); e.target.value = ""; }}
          />
        </div>
      </div>

      {badges.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <BadgeRow badges={badges} />
        </div>
      )}

      {/* Username — read only */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>
          USERNAME (cannot be changed)
        </label>
        <div style={{ ...inputStyle, color: "rgba(217,200,168,0.45)", cursor: "default" }}>
          @{currentUser.username}
        </div>
      </div>

      {/* Display name */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>
          DISPLAY NAME
        </label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={currentUser.username + " (default)"}
          maxLength={40}
          className="ughub-input" style={{ ...inputStyle, width: "100%" }}
        />
        <div style={{ fontSize: "0.72rem", color: "rgba(217,200,168,0.35)", marginTop: 4 }}>
          {displayName.length}/40 — shown instead of your username across the site
        </div>
      </div>

      {/* Bio */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: "block", fontSize: "0.78rem", color: "rgba(217,200,168,0.55)", marginBottom: 4, letterSpacing: "0.04em" }}>
          BIO
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Tell the community a bit about yourself…"
          maxLength={280}
          rows={4}
          className="ughub-input"
          style={{
            ...inputStyle,
            width: "100%",
            resize: "vertical",
            minHeight: 90,
            fontFamily: "'Rubik'",
            lineHeight: 1.5,
          }}
        />
        <div style={{ fontSize: "0.72rem", color: "rgba(217,200,168,0.35)", marginTop: 4 }}>
          {bio.length}/280
        </div>
      </div>

      {/* Followers — private, only visible to the account owner */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={toggleFollowersList}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: tokens.cream,
            fontSize: "0.92rem",
            fontWeight: 700,
          }}
        >
          <Icon.Person width={15} height={15} color="rgba(217,200,168,0.6)" />
          Followers: {followerCount === null ? "…" : followerCount}
          {followerCount > 0 && (
            <span style={{ color: "rgba(217,200,168,0.4)", transform: followersExpanded ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", fontSize: "0.8rem" }}>
              ▾
            </span>
          )}
        </button>

        {followersExpanded && (
          <div style={{ marginTop: 10 }}>
            {loadingFollowers ? (
              <div style={{ padding: "12px 0" }}><Spinner size={18} /></div>
            ) : followers.length === 0 ? (
              <p style={{ color: "rgba(217,200,168,0.4)", fontSize: "0.84rem" }}>No followers yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {followers.map((f) => {
                  const p = f.profiles;
                  if (!p) return null;
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: tokens.surface,
                        border: "1px solid " + tokens.border,
                        borderRadius: 8,
                        padding: "8px 12px",
                      }}
                    >
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: tokens.peat, border: "1px solid " + tokens.border, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Icon.Person width={14} height={14} color="rgba(217,200,168,0.4)" />
                        </div>
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.86rem", color: tokens.cream, fontWeight: 600, overflowWrap: "anywhere" }}>
                          {p.display_name || p.username}
                        </div>
                        {p.display_name && (
                          <div style={{ fontSize: "0.72rem", color: "rgba(217,200,168,0.45)" }}>@{p.username}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={handleSave} disabled={saving} className="ughub-btn-primary" style={{ ...buttonStyles.primarySmall, padding: "10px 28px" }}>
          {saving ? "Saving…" : "Save Profile"}
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   ASSETS (filled in after creation — see build step)
   ════════════════════════════════════════════════════════════ */

const ASSETS = {
  logo: "/images/logo.png",
  dino: "/images/dino.png",
  youtube: "/images/youtube.png",
};
