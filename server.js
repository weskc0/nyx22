import express from "express";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

// Using the process root keeps this file compatible with Netlify's CommonJS
// function bundle while preserving normal `node server.js` behavior.
const __dirname = resolve(process.env.NYX_PROJECT_ROOT || process.cwd());
const require = createRequire(join(__dirname, "package.json"));
const { uvPath } = require("@titaniumnetwork-dev/ultraviolet");
const { baremuxPath } = require("@mercuryworkshop/bare-mux/node");
const { scramjetPath } = require("@mercuryworkshop/scramjet/path");
const scramjetControllerPath = dirname(require.resolve("@mercuryworkshop/scramjet-controller"));
const epoxyPath = join(dirname(require.resolve("@mercuryworkshop/epoxy-transport")), "..", "dist");
const libcurlPath = dirname(require.resolve("@mercuryworkshop/libcurl-transport"));
const erudaPath = require.resolve("eruda");
let cinebyAppCache = { source: "", expires: 0 };
const gameCoverLookupCache = new Map();
let duckMathGamesCache = { games: [], expires: 0, promise: null };
let catClassGamesCache = { games: [], expires: 0, promise: null };
const app = express();

function normalizePublicWispUrl(value) {
  try {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const url = new URL(raw);
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return "";
    if (!url.pathname || url.pathname === "/") url.pathname = "/wisp/";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

const externalWispUrl = normalizePublicWispUrl(process.env.WISP_URL);
const presenceSessions = new Map();
const presenceTtlMs = 45_000;
const presenceCollectionName = "nyxPresenceSessions";
const presenceCleanupIntervalMs = 5 * 60_000;
let lastPresenceCleanupAt = 0;
const profileImageDataLimit = 850_000;
const profileImageDocumentLimit = 900_000;
const profileMediaEncodedLimit = 11_250_000;
const profileMediaChunkLimit = 450_000;
const profileMediaChunkCountLimit = 32;
const ownerDashboardUserScanLimit = 5_000;
const ownerDashboardPageSizeLimit = 100;
const signedInOnlineWindowMs = 90_000;
const userActivityEventWindowMs = 15 * 60_000;
const userActivityEventTimes = new Map();
const nyxAccountSignInAttempts = new Map();
const nyxAccountRegisterAttempts = new Map();
const nyxAccountPasswordResetAttempts = new Map();
const nyxAccountSignInWindowMs = 15 * 60_000;
const nyxAccountSignInMaxAttempts = 10;
const nyxAccountRegisterMaxAttempts = 5;
const nyxAccountPasswordResetMaxAttempts = 5;
const ownerDashboardSnapshotTtlMs = 30_000;
let ownerDashboardSnapshotCache = { expiresAt: 0, value: null, promise: null };
const linkGeneratorAttempts = new Map();
const linkGeneratorWindowMs = 15 * 60 * 1000;
const linkGeneratorMaxAttempts = 5;
const freeLinkDailyLimit = 3;
const freeNetworkDailyLimit = 25;
const premiumImmediateCooldownAt = 5;
const premiumAccumulatedLimit = 30;
const premiumCooldownMs = 10 * 60 * 1000;
const premiumGenerationUsage = new Map();
const downloadSafetyCache = new Map();
const downloadSafetyAttempts = new Map();
const downloadSafetyWindowMs = 60_000;
const downloadSafetyMaxAttempts = 60;
let linkGeneratorFirebasePromise;
app.use(express.json({ limit: "2mb" }));
app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "Invalid JSON request body." });
    return;
  }
  next(error);
});
const uvHandlerPath = join(uvPath, "uv.handler.js");
const uvBundlePath = join(uvPath, "uv.bundle.js");
const baremuxIndexPath = join(baremuxPath, "index.mjs");
const scramjetRuntimePath = join(scramjetPath, "scramjet.js");

app.use((req, res, next) => {
  const noStorePaths = new Set([
    "/",
    "/index.html",
    "/app.webmanifest",
    "/script.js",
    "/startup.js",
    "/styles.css",
    "/uv.sw.js",
    "/uv.config.js",
    "/uv/uv.bundle.js",
    "/uv/uv.client.js",
    "/scramjet.sw.js",
    "/uv/uv.handler.js",
    "/baremux/index.mjs",
    "/scramjet/scramjet.js",
    "/nyx-scramjet-runtime-guard.js"
  ]);
  const noStorePrefix = /^\/(?:assets\/(?:gms-games|reds-misc)\/|gms-games-|reds-misc-)/i.test(req.path);
  if (noStorePaths.has(req.path) || noStorePrefix) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function gameTitleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(?:online|unblocked|play|game)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 100);
}

function gameCoverResultScore(page, titleKey) {
  if (!page?.thumbnail?.source) return -Infinity;
  const pageKey = gameTitleKey(page.title);
  const description = String(page.terms?.description?.[0] || "").toLowerCase();
  const isExactTitle = pageKey === titleKey;
  const isGameArticle = /video game|browser game|arcade game|platform game|puzzle game|sports game|racing game/.test(description);
  if (!isExactTitle && !isGameArticle) return -Infinity;
  let score = 0;
  if (isExactTitle) score += 100;
  else if (pageKey.includes(titleKey) || titleKey.includes(pageKey)) score += 55;
  if (isGameArticle) score += 45;
  if (/film|album|song|novel|television|company|person/.test(description)) score -= 60;
  return score;
}

async function findOnlineGameCover(title) {
  const cleanTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 90);
  const titleKey = gameTitleKey(cleanTitle);
  if (!cleanTitle || !titleKey) return "";
  if (gameCoverLookupCache.has(titleKey)) return gameCoverLookupCache.get(titleKey);
  const lookup = (async () => {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: `${cleanTitle} video game`,
      gsrnamespace: "0",
      gsrlimit: "6",
      prop: "pageimages|pageterms",
      piprop: "thumbnail",
      pithumbsize: "512",
      pilimit: "6",
      wbptterms: "description",
      redirects: "1"
    });
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: {
        "accept": "application/json",
        "user-agent": "nyx-local-game-library/1.0"
      },
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return "";
    const payload = await response.json();
    const pages = Array.isArray(payload?.query?.pages) ? payload.query.pages : [];
    const match = pages
      .map(page => ({ page, score: gameCoverResultScore(page, titleKey) }))
      .filter(result => result.score >= 40)
      .sort((a, b) => b.score - a.score)[0]?.page;
    const source = String(match?.thumbnail?.source || "");
    try {
      const imageUrl = new URL(source);
      return imageUrl.protocol === "https:" && imageUrl.hostname === "upload.wikimedia.org" ? imageUrl.href : "";
    } catch {
      return "";
    }
  })().catch(() => "");
  gameCoverLookupCache.set(titleKey, lookup);
  return lookup;
}

app.get("/game-cover", async (req, res) => {
  const title = String(req.query.title || "");
  if (!title.trim() || title.length > 100) {
    res.status(400).type("text/plain").send("Invalid game title");
    return;
  }
  const cover = await findOnlineGameCover(title);
  if (!cover) {
    res.status(404).type("text/plain").send("No online cover found");
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.redirect(302, cover);
});

const duckMathGameHosts = new Set([
  "classroomlesson.github.io",
  "db2.duckmath.org",
  "mathlete.pages.dev",
  "turbowarp.org",
  "noclip.website",
  "dives05.github.io"
]);

function safeDuckMathGameUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !duckMathGameHosts.has(url.hostname)) return "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return "";
  }
}

async function loadDuckMathGames() {
  const now = Date.now();
  if (duckMathGamesCache.games.length && duckMathGamesCache.expires > now) {
    return duckMathGamesCache.games;
  }
  if (duckMathGamesCache.promise) return duckMathGamesCache.promise;

  duckMathGamesCache.promise = (async () => {
    const page = await fetchText("https://duckmath.org/");
    const bundlePath = page.match(/<script[^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/i)?.[1];
    if (!bundlePath) throw new Error("DuckMath game bundle was not found");
    const bundleUrl = new URL(bundlePath, "https://duckmath.org/").href;
    const bundle = await fetchText(bundleUrl, { accept: "text/javascript,*/*;q=0.8" });
    const games = [];
    const seen = new Set();
    const entryPattern = /\{link:"([^"]+)"[\s\S]{0,900}?title:"([^"]+)"/g;
    let match;
    while ((match = entryPattern.exec(bundle))) {
      const url = safeDuckMathGameUrl(match[1]);
      const title = String(match[2] || "").replace(/\\(["'\\/bfnrt])/g, "$1").trim();
      const key = `${title.toLowerCase()}\n${url}`;
      if (!url || !title || seen.has(key)) continue;
      seen.add(key);
      games.push({ title, url });
    }
    if (games.length < 50) throw new Error("DuckMath returned an incomplete game list");
    duckMathGamesCache = {
      games,
      expires: Date.now() + 60 * 60 * 1000,
      promise: null
    };
    return games;
  })();

  try {
    return await duckMathGamesCache.promise;
  } finally {
    duckMathGamesCache.promise = null;
  }
}

app.get("/duckmath-games", async (_req, res) => {
  try {
    const games = await loadDuckMathGames();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ games });
  } catch (error) {
    res.status(502).json({ error: `DuckMath list network error: ${error?.message || error}` });
  }
});

const catClassCatalogEndpoints = Object.freeze([
  { id: "catclass", url: "https://catclass.net/json/g.json" },
  { id: "selenite", url: "https://catclass.net/api/g4m3-sources/selenite" },
  { id: "velara", url: "https://catclass.net/api/g4m3-sources/velara" },
  { id: "edurocks", url: "https://catclass.net/api/g4m3-sources/edurocks" },
  { id: "truffled", url: "https://catclass.net/api/g4m3-sources/truffled" }
]);

function safeCatalogUrl(value, base) {
  try {
    const url = new URL(String(value || "").trim(), base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function catClassCatalogItems(source, payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.games) ? payload.games : [];
  return items.flatMap(item => {
    let title = "";
    let url = "";
    let cover = "";

    if (source === "catclass") {
      title = item?.name;
      url = safeCatalogUrl(item?.url, "https://catclass.net/");
      cover = safeCatalogUrl(item?.img, "https://catclass.net/");
    } else if (source === "selenite") {
      const directory = String(item?.directory || "").replace(/^\/+/, "");
      const image = String(item?.image || "").replace(/^\/+/, "");
      title = item?.name;
      url = directory ? safeCatalogUrl(directory, "https://selenite.cc/resources/semag/") : "";
      cover = directory && image
        ? safeCatalogUrl(`${directory}/${image}`, "https://selenite.cc/resources/semag/")
        : "";
    } else if (source === "velara") {
      title = item?.title;
      if (!title || title === "!!DMCA" || title === "!!G4m3 Request" || title.includes("[!]") || String(item?.location || "").includes("astra")) return [];
      url = safeCatalogUrl(item?.location, "https://velara.cc/");
      cover = safeCatalogUrl(item?.image, "https://velara.cc/");
    } else if (source === "edurocks") {
      title = item?.name;
      if (String(title || "").includes("[!]")) return [];
      url = safeCatalogUrl(String(item?.url || "").replace(/^\.\//, ""), "https://edunet.climaref.cl/");
      cover = safeCatalogUrl(String(item?.img || "").replace(/^\.\//, ""), "https://edunet.climaref.cl/");
    } else if (source === "truffled") {
      title = item?.name;
      url = safeCatalogUrl(item?.url, "https://truffled.lol/");
      cover = safeCatalogUrl(item?.thumbnail, "https://truffled.lol/");
    }

    title = String(title || "").replace(/\s+/g, " ").trim().slice(0, 120);
    return title && url ? [{ title, url, cover, provider: source }] : [];
  });
}

async function loadCatClassGames() {
  const now = Date.now();
  if (catClassGamesCache.games.length && catClassGamesCache.expires > now) return catClassGamesCache.games;
  if (catClassGamesCache.promise) return catClassGamesCache.promise;

  catClassGamesCache.promise = (async () => {
    const results = await Promise.allSettled(catClassCatalogEndpoints.map(async source => {
      const response = await fetch(source.url, {
        headers: { "accept": "application/json", "user-agent": "nyx/1.0" },
        signal: AbortSignal.timeout(12_000)
      });
      if (!response.ok) throw new Error(`${source.id} returned ${response.status}`);
      return catClassCatalogItems(source.id, await response.json());
    }));
    const games = [];
    const seen = new Set();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const game of result.value) {
        const key = `${game.title.toLowerCase()}\n${game.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        games.push(game);
      }
    }
    if (!games.length) throw new Error("No CatClass catalog source was available");
    catClassGamesCache = { games, expires: Date.now() + 30 * 60 * 1000, promise: null };
    return games;
  })();

  try {
    return await catClassGamesCache.promise;
  } finally {
    catClassGamesCache.promise = null;
  }
}

app.get("/catclass-games", async (_req, res) => {
  try {
    const games = await loadCatClassGames();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ games });
  } catch (error) {
    res.status(502).json({ error: `CatClass list network error: ${error?.message || error}` });
  }
});

function patchedUvHandler() {
  const source = readFileSync(uvHandlerPath, "utf8");
  const original = "t.respondWith(h?l(t.target,[t.data.message,t.data.transfer],t.that):l(t.target,[t.data.message,t.data.origin,t.data.transfer],t.that))";
  const patched = `(()=>{let n=t.data.transfer||[];try{const o=new Set(n);const i=new Set;const a=e=>{if(!e||typeof e!="object"||i.has(e))return;i.add(e);let t="";try{t=Object.prototype.toString.call(e)}catch{}if(typeof MessagePort!="undefined"&&e instanceof MessagePort||t==="[object MessagePort]"){o.add(e);return}if(Array.isArray(e)){for(const t of e)a(t);return}for(const t of Object.values(e))a(t)};a(t.data.message);n=[...o]}catch{}return t.respondWith(h?l(t.target,[t.data.message,n],t.that):l(t.target,[t.data.message,t.data.origin,n],t.that))})()`;
  return source.includes(original) ? source.replace(original, patched) : source;
}

function patchedBareMuxIndex() {
  return readFileSync(baremuxIndexPath, "utf8")
    .replace(
      'const e=(await self.clients.matchAll({type:"window",includeUncontrolled:!0})).map',
      'const e=(await self.clients.matchAll({type:"window",includeUncontrolled:!0})).filter((e=>{try{const t=new URL(e.url);return t.origin===self.location.origin&&!t.pathname.startsWith("/service/")&&!t.pathname.startsWith("/~/sj/")}catch{return!1}})).map'
    )
    .replace(/setTimeout\(([^,]+),1e3,new TypeError\("timeout"\)\)/g, 'setTimeout($1,5000,new TypeError("timeout"))')
    .replace(/within 1s/g, "within 5s");
}

function patchedUvBundle() {
  const source = readFileSync(uvBundlePath, "utf8");
  const original = "rewriteImport(t,r,n=this.meta){return this.rewriteUrl(t,{...n,base:r})}";
  const patched = "rewriteImport(t,r,n=this.meta){return this.rewriteUrl(r,{...n,base:t})}";
  if (!source.includes(original)) throw new Error("Ultraviolet dynamic import signature changed");
  return source.replace(original, patched);
}

function patchedScramjetRuntime() {
  const source = readFileSync(scramjetRuntimePath, "utf8");
  const original = 'if(u.origin===new i.xP(e.rawUrl).origin)throw new i.$D("attempted to fetch from same origin - this means the site has obtained a reference to the real origin, aborting");';
  const patched = 'if(u.origin===new i.xP(e.rawUrl).origin&&u.pathname.startsWith(t.context.prefix.pathname))u=new i.xP((0,n.v2)(u,t.context));else if(u.origin===new i.xP(e.rawUrl).origin)throw new i.$D("attempted to fetch from same origin - this means the site has obtained a reference to the real origin, aborting");';
  return source.includes(original) ? source.replace(original, patched) : source;
}

function scramjetRuntimeGuard() {
  return `(() => {
  if (typeof window === "undefined" || window.__nyxScramjetGuards) return;
  window.__nyxScramjetGuards = true;
  const nativeOpen = window.open?.bind(window);
  if (!window.trustedTypes) {
    try {
      Object.defineProperty(window, "trustedTypes", {
        configurable: true,
        value: {
          createPolicy(_name, rules = {}) {
            return {
              createHTML(value) {
                return typeof rules.createHTML === "function" ? rules.createHTML(value) : value;
              },
              createScript(value) {
                return typeof rules.createScript === "function" ? rules.createScript(value) : value;
              },
              createScriptURL(value) {
                return typeof rules.createScriptURL === "function" ? rules.createScriptURL(value) : value;
              }
            };
          }
        }
      });
    } catch {}
  }
  try {
    const nativeCurrentScript = Object.getOwnPropertyDescriptor(Document.prototype, "currentScript");
    const fallbackScript = document.createElement("script");
    fallbackScript.setAttribute("nonce", "");
    Object.defineProperty(Document.prototype, "currentScript", {
      configurable: true,
      get() {
        let current = null;
        try {
          current = nativeCurrentScript?.get?.call(this) || null;
        } catch {}
        if (current) return current;
        return this.querySelector?.("script[src],script") || fallbackScript;
      }
    });
  } catch {}
  try {
    if (!window.__nyxRuntimeShortcuts) {
      window.__nyxRuntimeShortcuts = true;
      const isEditingTarget = target => !!(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName || "")));
      const selectedTextFromTarget = target => {
        try {
          if (/^(INPUT|TEXTAREA)$/i.test(target?.tagName || "")) return String(target.value || "").slice(target.selectionStart || 0, target.selectionEnd || 0);
          return String(getSelection?.() || "");
        } catch {
          return "";
        }
      };
      const replaceSelectionInTarget = (target, text) => {
        try {
          if (/^(INPUT|TEXTAREA)$/i.test(target?.tagName || "")) {
            const start = target.selectionStart || 0;
            const end = target.selectionEnd || 0;
            const value = String(target.value || "");
            target.value = value.slice(0, start) + text + value.slice(end);
            const cursor = start + String(text).length;
            target.setSelectionRange(cursor, cursor);
            target.dispatchEvent(new Event("input", { bubbles: true }));
            return;
          }
          document.execCommand?.("insertText", false, text);
        } catch {}
      };
      const writeClipboard = async text => {
        try {
          await navigator.clipboard?.writeText(String(text || ""));
        } catch {
          try { document.execCommand?.("copy"); } catch {}
        }
      };
      const shortcutParent = (() => { try { return window.parent; } catch { return null; } })();
      const shortcutTop = (() => { try { return window.top; } catch { return null; } })();
      const postAltShortcut = payload => {
        try { shortcutParent?.postMessage(payload, "*"); } catch {}
        try {
          if (shortcutTop && shortcutTop !== shortcutParent) shortcutTop.postMessage(payload, "*");
        } catch {}
        try { window.parent?.postMessage(payload, "*"); } catch {}
        try {
          if (window.top && window.top !== window.parent) window.top.postMessage(payload, "*");
        } catch {}
      };
      window.addEventListener("keydown", event => {
        const key = String(event.key || "").toLowerCase();
        if (event.altKey && !event.ctrlKey && !event.metaKey && event.location !== 2 && key === "alt") {
          event.preventDefault();
          event.stopPropagation();
          postAltShortcut({ type: "nyx:alt-prime" });
          return;
        }
        if (event.altKey && !event.ctrlKey && !event.metaKey && event.location !== 2 && isEditingTarget(event.target) && /^[acxvzy]$/.test(key)) {
          event.preventDefault();
          event.stopPropagation();
          if (key === "a") {
            if (event.target?.select) event.target.select();
            else document.execCommand?.("selectAll");
            return;
          }
          if (key === "c") {
            writeClipboard(selectedTextFromTarget(event.target));
            return;
          }
          if (key === "x") {
            const selected = selectedTextFromTarget(event.target);
            writeClipboard(selected);
            replaceSelectionInTarget(event.target, "");
            return;
          }
          if (key === "v") {
            navigator.clipboard?.readText?.().then(text => replaceSelectionInTarget(event.target, text)).catch(() => {
              try { document.execCommand?.("paste"); } catch {}
            });
            return;
          }
          if (key === "z") {
            document.execCommand?.("undo");
            return;
          }
          if (key === "y") {
            document.execCommand?.("redo");
            return;
          }
        }
        if (event.altKey && !event.ctrlKey && !event.metaKey && event.location !== 2 && (/^[1-9]$/.test(key) || ["l", "d", "t", "w", "r", "arrowleft", "arrowright", "tab"].includes(key))) {
          event.preventDefault();
          event.stopPropagation();
          postAltShortcut({ type: "nyx:alt-shortcut", key, code: event.code || "", location: event.location || 0, shiftKey: !!event.shiftKey });
          return;
        }
      }, true);
    }
  } catch {}
  const blockedHtml = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>nyx://blocked67haha</title><style>html,body{margin:0;width:100%;height:100%;background:#fff;color:#111;font:28px Raleway,Arial,sans-serif}body{display:grid;place-items:center;text-align:center}main{padding:24px}</style></head><body><main>are you trying to hack me scamma???</main></body></html>';
  const popupProtectionEnabled = () => {
    try {
      return JSON.parse(localStorage.getItem("nyx.popupProtection") ?? "true") !== false;
    } catch {
      return true;
    }
  };
  const writeBlocked = popup => {
    if (!popup) return false;
    try {
      popup.document.open();
      popup.document.write(blockedHtml);
      popup.document.close();
      popup.focus?.();
      return true;
    } catch {
      return false;
    }
  };
  const opennyxPopupWarning = () => {
    // Popup protection must never create a real popup just to display a
    // warning. Return a browser-like inert handle to the calling site.
    const popup = null;
    return {
      closed: false,
      focus() { try { popup?.focus?.(); } catch {} },
      blur() { try { popup?.blur?.(); } catch {} },
      close() { try { popup?.close?.(); } catch {} this.closed = true; },
      postMessage() {},
      document: {
        open() { writeBlocked(popup); return this; },
        write() { writeBlocked(popup); },
        writeln() { writeBlocked(popup); },
        close() { writeBlocked(popup); }
      },
      location: {
        href: "nyx://blocked67haha",
        assign() { opennyxPopupWarning(); },
        replace() { opennyxPopupWarning(); },
        reload() { writeBlocked(popup); },
        toString() { return "nyx://blocked67haha"; }
      }
    };
  };
  const isDownloadUrl = value => {
    const rawHref = String(value || "").trim();
    // Blob/data URLs and script-like paths are also used by verification
    // challenges, workers, and client-side navigation. Treating them as
    // downloads breaks those flows before they can complete. Explicit
    // Explicit download links are still handled by isDownloadLink below.
    if (/^(?:blob|data):/i.test(rawHref)) return false;
    const href = rawHref.split(/[?#]/)[0].toLowerCase();
    return /\.(?:apk|appx|bat|bin|cmd|com|crx|deb|dmg|exe|iso|jar|msi|pkg|scr|wsf|zip|7z|rar)$/i.test(href);
  };
  const postDownloadRequest = (value, filename = "") => {
    const href = String(value || "").trim();
    if (!href || !window.parent || window.parent === window) return false;
    try {
      window.parent.postMessage({
        type: "nyx:download-request",
        url: href,
        filename: String(filename || ""),
        sourceUrl: String(location.href || "")
      }, "*");
      return true;
    } catch {
      return false;
    }
  };
  let guardedOpen = (...args) => {
    if (isDownloadUrl(args[0]) && postDownloadRequest(args[0])) return null;
    if (!popupProtectionEnabled() && nativeOpen) return nativeOpen(...args);
    return opennyxPopupWarning();
  };
  try {
    if (typeof nativeOpen === "function" && typeof Proxy === "function") {
      guardedOpen = new Proxy(nativeOpen, {
        apply(target, thisArg, args) {
          if (isDownloadUrl(args[0]) && postDownloadRequest(args[0])) return null;
          if (!popupProtectionEnabled()) return Reflect.apply(target, thisArg, args);
          return opennyxPopupWarning();
        },
        construct(target, args, newTarget) {
          if (!popupProtectionEnabled()) {
            try {
              return Reflect.construct(target, args, newTarget);
            } catch {
              return Reflect.apply(target, window, args);
            }
          }
          return opennyxPopupWarning();
        },
        get(target, prop, receiver) {
          if (prop === "__nyxPopupGuard") return true;
          if (prop === "toString") return () => "function open() { [native code] }";
          return Reflect.get(target, prop, receiver);
        }
      });
    }
  } catch {}
  const shouldTrapPopupTarget = target => {
    const value = String(target || "").toLowerCase();
    return value && !["_self", "_parent", "_top"].includes(value);
  };
  const isDownloadLink = link => {
    if (!link) return false;
    if (link.hasAttribute("download")) return true;
    return isDownloadUrl(link.href || link.getAttribute("href") || "");
  };
  try {
    Object.defineProperty(window, "open", { value: guardedOpen, writable: true, configurable: true });
  } catch {
    window.open = guardedOpen;
  }
  try {
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      if (isDownloadLink(this) && postDownloadRequest(this.href || this.getAttribute("href"), this.getAttribute("download") || "")) return;
      if (popupProtectionEnabled() && shouldTrapPopupTarget(this.target)) {
        opennyxPopupWarning();
        return;
      }
      return nativeAnchorClick.call(this);
    };
  } catch {}
  if (document && !window.__nyxPopupWarningListeners) {
    window.__nyxPopupWarningListeners = true;
    document.addEventListener("click", event => {
      const link = event.target?.closest?.("a[href]");
      if (!link) return;
      if (isDownloadLink(link) && postDownloadRequest(link.href || link.getAttribute("href"), link.getAttribute("download") || "")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!popupProtectionEnabled() || !shouldTrapPopupTarget(link.getAttribute("target"))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      opennyxPopupWarning();
    }, true);
    document.addEventListener("auxclick", event => {
      const link = event.target?.closest?.("a[href]");
      if (!link) return;
      if (isDownloadLink(link) && postDownloadRequest(link.href || link.getAttribute("href"), link.getAttribute("download") || "")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!popupProtectionEnabled() || !shouldTrapPopupTarget(link.getAttribute("target"))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      opennyxPopupWarning();
    }, true);
    document.addEventListener("submit", event => {
      if (!popupProtectionEnabled()) return;
      const form = event.target;
      if (!form || String(form.tagName || "").toUpperCase() !== "FORM" || !shouldTrapPopupTarget(form.getAttribute("target"))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      opennyxPopupWarning();
    }, true);
  }
  const wrapCue = name => {
    const Native = window[name];
    if (typeof Native !== "function" || Native.__nyxWrapped) return;
    function SafeCue(start, end, text) {
      let safeStart = Number(start);
      let safeEnd = Number(end);
      if (!Number.isFinite(safeStart) || safeStart < 0) safeStart = 0;
      if (!Number.isFinite(safeEnd) || safeEnd <= safeStart) safeEnd = safeStart + 0.001;
      return Reflect.construct(Native, [safeStart, safeEnd, text == null ? "" : String(text)], new.target || SafeCue);
    }
    try {
      Object.setPrototypeOf(SafeCue, Native);
      SafeCue.prototype = Native.prototype;
      Object.defineProperty(SafeCue, "__nyxWrapped", { value: true });
      window[name] = SafeCue;
    } catch {}
  };
  wrapCue("VTTCue");
  wrapCue("TextTrackCue");
})();`;
}

function safeSeraphPath(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || !/^[a-z0-9_./-]+$/i.test(clean)) return "";
  if (/(^|\/)(?:404|408)\.html$/i.test(clean)) return "";
  return clean;
}

app.get("/seraph-fetch", async (req, res) => {
  const path = safeSeraphPath(req.query.path);
  if (!path) {
    res.status(400).type("text/plain").send("Invalid Seraph path");
    return;
  }
  const upstreamUrl = `https://cdn.jsdelivr.net/gh/a456pur/seraph@main/games/${path}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "nyx/1.0"
      }
    });
    if (!upstream.ok) {
      res.status(upstream.status).type("text/plain").send(`Seraph upstream returned ${upstream.status}`);
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("html").send(await upstream.text());
  } catch (error) {
    res.status(502).type("text/plain").send(`Seraph network error: ${error?.message || error}`);
  }
});

function safeSeraphAssetPath(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || !/^[a-z0-9_./?&=%-]+$/i.test(clean)) return "";
  return clean;
}

function rewriteSeraphCss(css, assetPath) {
  const base = new URL(String(assetPath || ""), "https://seraph.local/");
  return String(css || "").replace(/url\(\s*(["']?)(?![a-z][a-z0-9+.-]*:|\/\/|#|data:|blob:)([^"')]+)\1\s*\)/gi, (match, quote, raw) => {
    try {
      const resolved = new URL(String(raw || "").trim(), base).pathname.replace(/^\/+/, "");
      return `url(${quote}/seraph-asset?path=${encodeURIComponent(resolved)}${quote})`;
    } catch {
      return match;
    }
  });
}

app.get("/seraph-asset", async (req, res) => {
  const path = safeSeraphAssetPath(req.query.path);
  if (!path) {
    res.status(400).type("text/plain").send("Invalid Seraph asset path");
    return;
  }
  const upstreamUrl = `https://cdn.jsdelivr.net/gh/a456pur/seraph@main/${path}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        "accept": "*/*",
        "user-agent": "nyx/1.0"
      }
    });
    if (!upstream.ok) {
      res.status(upstream.status).type("text/plain").send(`Seraph asset returned ${upstream.status}`);
      return;
    }
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(/text\/css/i.test(contentType || "") || /\.css(?:$|\?)/i.test(path) ? Buffer.from(rewriteSeraphCss(buffer.toString("utf8"), path)) : buffer);
  } catch (error) {
    res.status(502).type("text/plain").send(`Seraph asset network error: ${error?.message || error}`);
  }
});

const gnMathGamesCache = { timestamp: 0, games: [] };
const gnMathTitleCache = new Map();
const gnMathRepos = new Set(["html", "covers", "assets"]);

function safeGnMathPath(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || !/^[a-z0-9_./?&=%-]+$/i.test(clean)) return "";
  return clean;
}

function safeGnMathHtmlPath(path) {
  const clean = safeGnMathPath(path);
  if (!clean || !/^[a-z0-9_.-]+\.html$/i.test(clean)) return "";
  return clean;
}

function gnMathCoverName(path) {
  const id = String(path || "").match(/^\d+/)?.[0];
  return id ? `${id}.png` : "";
}

function extractTitle(html, fallback) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? match[1].replace(/\s+/g, " ").trim() : "";
  return title || fallback;
}

async function fetchText(url, headers = {}) {
  const upstream = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "nyx/1.0",
      ...headers
    }
  });
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  return upstream.text();
}

app.get("/gn-math-games", async (_req, res) => {
  const now = Date.now();
  if (gnMathGamesCache.games.length && now - gnMathGamesCache.timestamp < 10 * 60 * 1000) {
    res.json({ games: gnMathGamesCache.games });
    return;
  }
  try {
    const [htmlResponse, coverResponse] = await Promise.all([
      fetch("https://api.github.com/repos/gn-math/html/contents/", {
        headers: { "accept": "application/vnd.github+json", "user-agent": "nyx/1.0" }
      }),
      fetch("https://api.github.com/repos/gn-math/covers/contents/", {
        headers: { "accept": "application/vnd.github+json", "user-agent": "nyx/1.0" }
      })
    ]);
    if (!htmlResponse.ok) throw new Error(`HTML HTTP ${htmlResponse.status}`);
    if (!coverResponse.ok) throw new Error(`Covers HTTP ${coverResponse.status}`);
    const items = await htmlResponse.json();
    const covers = new Set((await coverResponse.json())
      .filter(item => item?.type === "file")
      .map(item => item.name));
    const games = (Array.isArray(items) ? items : [])
      .filter(item => item?.type === "file" && /\.html?$/i.test(item.name))
      .map(item => {
        const cover = gnMathCoverName(item.name);
        return {
          path: item.name,
          title: gnMathTitleCache.get(item.name) || "",
          cover: cover && covers.has(cover) ? `/gn-math-asset?repo=covers&path=${encodeURIComponent(cover)}` : ""
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    gnMathGamesCache.timestamp = now;
    gnMathGamesCache.games = games;
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ games });
  } catch (error) {
    res.status(502).json({ error: `GN Math list network error: ${error?.message || error}` });
  }
});

app.get("/gn-math-title", async (req, res) => {
  const path = safeGnMathHtmlPath(req.query.path);
  if (!path) {
    res.status(400).json({ error: "Invalid GN Math path" });
    return;
  }
  if (gnMathTitleCache.has(path)) {
    res.json({ title: gnMathTitleCache.get(path) });
    return;
  }
  try {
    const html = await fetchText(`https://raw.githubusercontent.com/gn-math/html/main/${path}`);
    const title = extractTitle(html, "");
    if (title) gnMathTitleCache.set(path, title);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({ title });
  } catch (error) {
    res.status(502).json({ error: `GN Math title network error: ${error?.message || error}` });
  }
});

app.get("/gn-math-fetch", async (req, res) => {
  const path = safeGnMathHtmlPath(req.query.path);
  if (!path) {
    res.status(400).type("text/plain").send("Invalid GN Math path");
    return;
  }
  try {
    const html = await fetchText(`https://raw.githubusercontent.com/gn-math/html/main/${path}`);
    const title = extractTitle(html, "");
    if (title) gnMathTitleCache.set(path, title);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("html").send(html);
  } catch (error) {
    res.status(502).type("text/plain").send(`GN Math network error: ${error?.message || error}`);
  }
});

app.get("/gn-math-asset", async (req, res) => {
  const repo = String(req.query.repo || "");
  const path = safeGnMathPath(req.query.path);
  if (!gnMathRepos.has(repo) || !path) {
    res.status(400).type("text/plain").send("Invalid GN Math asset path");
    return;
  }
  try {
    const upstream = await fetch(`https://raw.githubusercontent.com/gn-math/${repo}/main/${path}`, {
      headers: {
        "accept": "*/*",
        "user-agent": "nyx/1.0"
      }
    });
    if (!upstream.ok) {
      res.status(upstream.status).type("text/plain").send(`GN Math asset returned ${upstream.status}`);
      return;
    }
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    res.status(502).type("text/plain").send(`GN Math asset network error: ${error?.message || error}`);
  }
});

const gnMathProxyHosts = new Set([
  "cdn.jsdelivr.net",
  "raw.githubusercontent.com",
  "rawcdn.githack.com",
  "raw.githack.com"
]);

function safeGnMathProxyUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!gnMathProxyHosts.has(url.hostname)) return null;
    if (/(?:googletagmanager|google-analytics|googlesyndication|doubleclick|facebook|recaptcha|pagead|cdn\.r9x\.in)/i.test(url.href)) return null;
    return url;
  } catch {
    return null;
  }
}

async function directProxyFetch(url) {
  let upstream;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      upstream = await fetch(url, {
        headers: {
          "accept": "*/*",
          "user-agent": "nyx/1.0"
        }
      });
      if (upstream.ok || ![429, 500, 502, 503, 504].includes(upstream.status)) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 180 + attempt * 260));
  }
  if (!upstream && lastError) throw lastError;
  if (!upstream.ok) {
    const error = new Error(`HTTP ${upstream.status}`);
    error.status = upstream.status;
    throw error;
  }
  const body = Buffer.from(await upstream.arrayBuffer());
  return {
    body,
    contentType: upstream.headers.get("content-type") || "application/octet-stream",
    cacheControl: "no-store"
  };
}

function isHtmlProxyPayload(url, result) {
  const pathname = String(url?.pathname || "").toLowerCase();
  const executable = /\.(?:js|mjs|cjs|json|wasm|data|unityweb|mem|symbols\.json)(?:$|[?#])/i.test(pathname);
  if (!executable) return false;
  const contentType = String(result?.contentType || "").toLowerCase();
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) return true;
  const start = result?.body?.subarray?.(0, 512)?.toString("utf8").replace(/^\uFEFF/, "").trimStart() || "";
  return /^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(start);
}

function gnMathProxyCandidates(url) {
  const candidates = [url];
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "cdn.jsdelivr.net" && parts[0] === "gh" && parts.length >= 4) {
    const [owner, repoRef, ...resourcePath] = parts.slice(1);
    const separator = repoRef.lastIndexOf("@");
    if (separator > 0) {
      const repository = repoRef.slice(0, separator);
      const ref = repoRef.slice(separator + 1);
      candidates.push(new URL(`https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${resourcePath.join("/")}`));
      candidates.push(new URL(`https://raw.githack.com/${owner}/${repository}/${ref}/${resourcePath.join("/")}`));
    }
  } else if (
    ["raw.githubusercontent.com", "raw.githack.com", "rawcdn.githack.com"].includes(url.hostname) &&
    parts.length >= 4
  ) {
    const [owner, repository, ref, ...resourcePath] = parts;
    candidates.push(new URL(`https://raw.githubusercontent.com/${owner}/${repository}/${ref}/${resourcePath.join("/")}`));
    candidates.push(new URL(`https://cdn.jsdelivr.net/gh/${owner}/${repository}@${ref}/${resourcePath.join("/")}`));
    candidates.push(new URL(`https://raw.githack.com/${owner}/${repository}/${ref}/${resourcePath.join("/")}`));
  }
  return candidates.filter((candidate, index, list) =>
    list.findIndex(item => item.href === candidate.href) === index
  );
}

function gnMathResourceContentType(url, upstreamType) {
  const pathname = String(url?.pathname || "").toLowerCase();
  if (/\.(?:js|mjs|cjs)$/.test(pathname)) return "application/javascript; charset=utf-8";
  if (/\.json$/.test(pathname)) return "application/json; charset=utf-8";
  if (/\.wasm$/.test(pathname)) return "application/wasm";
  if (/\.css$/.test(pathname)) return "text/css; charset=utf-8";
  return upstreamType;
}

function rewriteGnMathJsonAssets(url, result) {
  if (!/\.json$/i.test(url.pathname)) return result;
  try {
    const data = JSON.parse(result.body.toString("utf8"));
    const rewrite = value => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]));
      }
      if (
        typeof value !== "string" ||
        !/\.(?:js|mjs|cjs|json|wasm|data|unityweb|mem|symbols\.json)(?:[?#].*)?$/i.test(value)
      ) return value;
      if (/^(?:data|blob|javascript|about):/i.test(value)) return value;
      const asset = new URL(value, url);
      return safeGnMathProxyUrl(asset)
        // Unity prepends the JSON file's directory to these values. Keeping
        // this relative avoids the double-slash path that an absolute value
        // would create (//gn-math-proxy), which Netlify treats as the SPA.
        ? `gn-math-proxy?url=${encodeURIComponent(asset.href)}`
        : value;
    };
    return {
      ...result,
      body: Buffer.from(JSON.stringify(rewrite(data))),
      contentType: "application/json; charset=utf-8"
    };
  } catch {
    return result;
  }
}

app.get("/gn-math-proxy", async (req, res) => {
  const url = safeGnMathProxyUrl(req.query.url);
  if (!url) {
    res.status(400).type("text/plain").send("Invalid GN Math proxy URL");
    return;
  }
  let lastError;
  for (const candidate of gnMathProxyCandidates(url)) {
    try {
      let result = await directProxyFetch(candidate);
      if (isHtmlProxyPayload(candidate, result)) {
        const error = new Error("upstream returned HTML for a game resource");
        error.status = 502;
        throw error;
      }
      result = rewriteGnMathJsonAssets(candidate, result);
      res.setHeader("Cache-Control", result.cacheControl);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type(gnMathResourceContentType(candidate, result.contentType));
      res.send(result.body);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  res.status(lastError?.status || 502).type("text/plain").send(`GN Math proxy error: ${lastError?.message || lastError}`);
});

const redsMiscProxyHosts = new Set([
  "raw.githubusercontent.com",
  "cdn.jsdelivr.net",
  "rawcdn.githack.com",
  "raw.githack.com"
]);

function safeRedsMiscPath(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  if (
    !/^misc\/[a-z0-9_.() -]+(?:\/[a-z0-9_.() -]+)*\.html?$/i.test(clean) ||
    clean.includes("..") ||
    clean.includes("\\")
  ) return "";
  return clean;
}

function safeRedsMiscProxyUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const isGithubPages = url.hostname === "github.io" || url.hostname.endsWith(".github.io");
    if (!redsMiscProxyHosts.has(url.hostname) && !isGithubPages) return null;
    if (url.hostname === "raw.githubusercontent.com") {
      const allowed = /^\/isaacduh123\/reds-exploit-corner\/main\//i.test(url.pathname);
      if (!allowed) return null;
    }
    if (/(?:googletagmanager|google-analytics|googlesyndication|doubleclick|facebook|recaptcha|pagead|cdn\.r9x\.in)/i.test(url.href)) return null;
    return url;
  } catch {
    return null;
  }
}

function rewriteGmsCssUrls(buffer, baseUrl) {
  const css = buffer.toString("utf8");
  return Buffer.from(css.replace(/url\(\s*(["']?)(?![a-z][a-z0-9+.-]*:|\/\/|#|data:|blob:)([^"')]+)\1\s*\)/gi, (_match, quote, raw) => {
    try {
      const next = new URL(String(raw || "").trim(), baseUrl).href;
      return `url(${quote}/gms-games-proxy?url=${encodeURIComponent(next)}${quote})`;
    } catch {
      return _match;
    }
  }), "utf8");
}

async function handleGmsGamesFetch(req, res) {
  const path = safeRedsMiscPath(req.query.path);
  if (!path) {
    res.status(400).type("text/plain").send("Invalid GMS path");
    return;
  }
  try {
    const url = new URL(`https://raw.githubusercontent.com/isaacduh123/reds-exploit-corner/main/${path}`);
    const result = await directProxyFetch(url);
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(result.body);
  } catch (error) {
    res.status(error?.status || 502).type("text/plain").send(`GMS network error: ${error?.message || error}`);
  }
}

async function handleGmsGamesProxy(req, res) {
  const url = safeRedsMiscProxyUrl(req.query.url);
  if (!url) {
    res.status(400).type("text/plain").send("Invalid GMS proxy URL");
    return;
  }
  try {
    const result = await directProxyFetch(url);
    const isCss = /text\/css/i.test(result.contentType) || /\.css(?:$|\?)/i.test(url.pathname);
    const body = isCss ? rewriteGmsCssUrls(result.body, url.href) : result.body;
    res.setHeader("Cache-Control", result.cacheControl);
    res.type(result.contentType);
    res.send(body);
  } catch (error) {
    res.status(error?.status || 502).type("text/plain").send(`GMS proxy error: ${error?.message || error}`);
  }
}

app.get("/gms-games-fetch", handleGmsGamesFetch);
app.get("/gms-games-proxy", handleGmsGamesProxy);
app.get("/reds-misc-fetch", handleGmsGamesFetch);
app.get("/reds-misc-proxy", handleGmsGamesProxy);

const nyxAiModels = {
  "chatgpt-5.4-mini": process.env.NYX_AI_MODEL_CHATGPT_54_MINI || "navy:gpt-5.4-mini"
};

const nyxAiFallbackCatalog = [
  ["llama-3.3-70b-versatile", "Llama 3.3 70B (Versatile)"],
  ["openai/gpt-oss-120b", "GPT-OSS 120B"],
  ["qwen/qwen3-32b", "Qwen3 32B"],
  ["meta-llama/llama-4-scout-17b-16e-instruct", "Llama 4 Scout (Vision)"],
  ["navy:gpt-5.4-mini", "ChatGPT 5.4 Mini"],
  ["navy:claude-opus-5", "Claude Opus 5"],
  ["navy:gpt-4o-mini-search-preview", "GPT-4o Mini Search (Preview)"],
  ["navy:gemini-3.1-pro-preview", "Gemini 3.1 Pro (Preview)"],
  ["navy:gemini-3.5-flash", "Gemini 3.5 Flash"],
  ["navy:grok-4.3", "Grok 4.3"],
  ["navy:grok-4.1-fast-reasoning", "Grok 4.1 Fast (Reasoning)"],
  ["navy:deepseek-v4-pro", "DeepSeek V4 Pro"],
  ["navy:llama-4-scout", "Llama 4 Scout"],
  ["navy:mistral-medium-latest", "Mistral Medium"],
  ["navy:kimi-k2.6", "Kimi K2.6"],
  ["navy:nemotron-3-super", "Nemotron 3 Super"],
  ["navy:mimo-v2.5-pro", "MiMo V2.5 Pro"],
  ["navy:c4ai-aya-expanse-32b", "Aya Expanse 32B"],
  ["navy:gpt-4o", "GPT-4o"],
  ["navy:kimi-k2.5", "Kimi K2.5"],
  ["navy:qwen3.5-397b-a17b", "Qwen3.5 397B A17B"],
  ["navy:hermes-4-405b", "Hermes 4 405B"],
  ["navy:mistral-medium-3.5", "Mistral Medium 3.5"]
].map(([id, label]) => ({ id, label }));

let nyxAiCatalogCache = { expiresAt: 0, models: nyxAiFallbackCatalog };

function nyxAiKey() {
  return process.env.NYX_AI_API_KEY || "";
}

function nyxAiEndpoint() {
  const explicitEndpoint = String(process.env.NYX_AI_ENDPOINT || "").trim();
  if (explicitEndpoint) return explicitEndpoint;
  const baseUrl = String(process.env.NYX_AI_BASE_URL || "https://vilen.sbs").trim().replace(/\/+$/, "");
  return /\/api\/ai$/i.test(baseUrl) ? baseUrl : `${baseUrl}/api/ai`;
}

function nyxAiCatalogEndpoint() {
  const explicitEndpoint = String(process.env.NYX_AI_MODELS_ENDPOINT || "").trim();
  if (explicitEndpoint) return explicitEndpoint;
  return `${nyxAiEndpoint().replace(/\/+$/, "")}/config`;
}

function nyxAiNormalizeCatalog(models) {
  if (!Array.isArray(models)) return [];
  const seen = new Set();
  return models.flatMap(item => {
    const id = String(item?.id || "").trim();
    if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/i.test(id) || seen.has(id) || (item?.audience && item.audience !== "all")) return [];
    seen.add(id);
    return [{
      id,
      label: String(item?.label || id).trim().slice(0, 100) || id,
      company: String(item?.company || "").trim().slice(0, 50),
      vision: Boolean(item?.vision),
      reasoning: Boolean(item?.reasoning)
    }];
  });
}

async function nyxAiAvailableModels() {
  const now = Date.now();
  if (nyxAiCatalogCache.expiresAt > now) return nyxAiCatalogCache.models;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(nyxAiCatalogEndpoint(), {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    const models = response.ok ? nyxAiNormalizeCatalog(data?.models) : [];
    if (!models.length) throw new Error("The AI model catalog was empty.");
    nyxAiCatalogCache = { expiresAt: now + 300_000, models };
  } catch {
    nyxAiCatalogCache = { expiresAt: now + 60_000, models: nyxAiFallbackCatalog };
  } finally {
    clearTimeout(timeout);
  }
  return nyxAiCatalogCache.models;
}

async function nyxAiResolveModel(requestedModel) {
  const alias = nyxAiModels[requestedModel];
  if (alias) return alias;
  const models = await nyxAiAvailableModels();
  return models.some(item => item.id === requestedModel) ? requestedModel : "";
}

function nyxAiErrorMessage(data, status) {
  const error = data?.error;
  return String(
    (error && typeof error === "object" ? error.message : error)
    || data?.message
    || `Model request failed (${status}).`
  );
}

function nyxAiStreamText(data) {
  if (!data || typeof data !== "object") return "";
  if (data.type === "delta") return String(data.text || data.delta || "");
  return String(data?.choices?.[0]?.delta?.content || data?.choices?.[0]?.text || "");
}

function nyxAiWriteStreamChunk(res, text, model) {
  if (!text) return;
  res.write(`data: ${JSON.stringify({
    id: "nyx-ai",
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta: { content: String(text) }, finish_reason: null }]
  })}\n\n`);
}

const nyxAiUsage = new Map();
let nyxAiActiveRequests = 0;
const nyxAiLimit = (name, fallback) => {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const nyxAiLimits = {
  minute: nyxAiLimit("NYX_AI_REQUESTS_PER_MINUTE", 6),
  daily: nyxAiLimit("NYX_AI_REQUESTS_PER_DAY", 60),
  perIpConcurrent: nyxAiLimit("NYX_AI_CONCURRENT_PER_IP", 2),
  globalConcurrent: nyxAiLimit("NYX_AI_CONCURRENT_GLOBAL", 3),
  promptChars: nyxAiLimit("NYX_AI_MAX_PROMPT_CHARS", 4000),
  contextChars: nyxAiLimit("NYX_AI_MAX_CONTEXT_CHARS", 24000),
  timeoutMs: nyxAiLimit("NYX_AI_TIMEOUT_MS", 45000)
};

function nyxAiClientId(req) {
  const forwarded = process.env.NYX_TRUST_PROXY === "true"
    ? String(req.get("cf-connecting-ip") || req.get("x-forwarded-for") || "").split(",")[0].trim()
    : "";
  return forwarded || req.socket.remoteAddress || "unknown";
}

function nyxAiRateLimit(req, res, next) {
  const now = Date.now();
  const clientId = nyxAiClientId(req);
  const usage = nyxAiUsage.get(clientId) || { minute: [], day: [], active: 0, seen: now };
  usage.minute = usage.minute.filter(time => now - time < 60_000);
  usage.day = usage.day.filter(time => now - time < 86_400_000);
  usage.seen = now;
  nyxAiUsage.set(clientId, usage);
  res.setHeader("x-ratelimit-limit-minute", nyxAiLimits.minute);
  res.setHeader("x-ratelimit-remaining-minute", Math.max(0, nyxAiLimits.minute - usage.minute.length));
  res.setHeader("x-ratelimit-limit-day", nyxAiLimits.daily);
  res.setHeader("x-ratelimit-remaining-day", Math.max(0, nyxAiLimits.daily - usage.day.length));
  if (usage.minute.length >= nyxAiLimits.minute || usage.day.length >= nyxAiLimits.daily) {
    const retryAfter = usage.minute.length >= nyxAiLimits.minute
      ? Math.max(1, Math.ceil((60_000 - (now - usage.minute[0])) / 1000))
      : Math.max(1, Math.ceil((86_400_000 - (now - usage.day[0])) / 1000));
    res.setHeader("retry-after", retryAfter);
    res.status(429).json({ error: "Nyx AI usage limit reached. Please try again later." });
    return;
  }
  if (usage.active >= nyxAiLimits.perIpConcurrent || nyxAiActiveRequests >= nyxAiLimits.globalConcurrent) {
    res.setHeader("retry-after", "10");
    res.status(429).json({ error: "Nyx AI is busy. Please wait for another response to finish." });
    return;
  }
  usage.minute.push(now);
  usage.day.push(now);
  usage.active += 1;
  nyxAiActiveRequests += 1;
  let released = false;
  req.nyxAiRelease = () => {
    if (released) return;
    released = true;
    usage.active = Math.max(0, usage.active - 1);
    nyxAiActiveRequests = Math.max(0, nyxAiActiveRequests - 1);
  };
  res.once("close", req.nyxAiRelease);
  res.once("finish", req.nyxAiRelease);
  next();
}

setInterval(() => {
  const cutoff = Date.now() - 86_400_000;
  for (const [clientId, usage] of nyxAiUsage) {
    if (!usage.active && usage.seen < cutoff) nyxAiUsage.delete(clientId);
  }
}, 3_600_000).unref();

app.get("/api/nyx-ai/models", async (_req, res) => {
  const models = await nyxAiAvailableModels();
  const defaultProviderId = nyxAiModels["chatgpt-5.4-mini"];
  const exposedModels = models.map(item => item.id === defaultProviderId
    ? { ...item, id: "chatgpt-5.4-mini", providerId: item.id }
    : item);
  if (!exposedModels.some(item => item.id === "chatgpt-5.4-mini")) {
    exposedModels.unshift({
      id: "chatgpt-5.4-mini",
      providerId: defaultProviderId,
      label: "ChatGPT 5.4 Mini",
      company: "ChatGPT",
      vision: true,
      reasoning: true
    });
  }
  exposedModels.sort((left, right) => Number(right.id === "chatgpt-5.4-mini") - Number(left.id === "chatgpt-5.4-mini"));
  res.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=240");
  res.json({ models: exposedModels });
});

app.post("/api/nyx-ai", nyxAiRateLimit, async (req, res) => {
  const key = nyxAiKey();
  if (!key) {
    res.status(503).json({
      error: "Nyx AI is not configured. Set NYX_AI_API_KEY in the server environment."
    });
    return;
  }
  const requestedModel = String(req.body?.model || "chatgpt-5.4-mini");
  const model = await nyxAiResolveModel(requestedModel);
  if (!model) {
    res.status(400).json({ error: "Unknown Nyx AI model." });
    return;
  }
  const message = String(req.body?.message || "").trim();
  const imageContext = String(req.body?.imageContext || "").trim();
  if (message.length > nyxAiLimits.promptChars) {
    res.status(413).json({ error: `Message is too long. The limit is ${nyxAiLimits.promptChars} characters.` });
    return;
  }
  const history = Array.isArray(req.body?.messages)
    ? req.body.messages.slice(-20).map(item => ({
        role: item?.role === "assistant" ? "assistant" : "user",
        content: String(item?.content || "").slice(0, 12000)
      })).filter(item => item.content.trim())
    : [];
  let contextChars = imageContext.length;
  for (const item of history) contextChars += item.content.length;
  if (contextChars > nyxAiLimits.contextChars) {
    res.status(413).json({ error: "This conversation is too long. Clear the chat and try again." });
    return;
  }
  if (!message && !imageContext && !history.length) {
    res.status(400).json({ error: "Message is required." });
    return;
  }
  const endpoint = nyxAiEndpoint();
  const prompt = imageContext ? `${message || "Answer the attached image."}\n\nImage context from Nyx OCR/analysis:\n${imageContext}` : message;
  const messages = history.length ? history : [{ role: "user", content: prompt }];
  if (history.length && imageContext) messages[messages.length - 1] = { role: "user", content: prompt };
  const wantsStream = req.body?.stream !== false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), nyxAiLimits.timeoutMs);
  res.once("close", () => controller.abort());
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        system: "You are Nyx AI inside the Nyx browser. Be helpful, direct, and accurate. If you do not know something, say so plainly.",
        messages,
        temperature: Number(process.env.NYX_AI_TEMPERATURE || 0.7),
        max_tokens: Number(process.env.NYX_AI_MAX_TOKENS || 1200),
        stream: wantsStream
      })
    });
    if (wantsStream && upstream.ok) {
      res.status(200);
      res.setHeader("content-type", "text/event-stream; charset=utf-8");
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("connection", "keep-alive");
      res.flushHeaders?.();
      const reader = upstream.body?.getReader();
      if (!reader) throw new Error("AI provider did not return a response stream.");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          const event = JSON.parse(raw);
          if (event?.type === "error") {
            nyxAiWriteStreamChunk(res, `Nyx AI error: ${nyxAiErrorMessage(event, upstream.status)}`, model);
            continue;
          }
          nyxAiWriteStreamChunk(res, nyxAiStreamText(event), model);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim().startsWith("data:")) {
        const raw = buffer.trim().slice(5).trim();
        if (raw && raw !== "[DONE]") {
          const event = JSON.parse(raw);
          nyxAiWriteStreamChunk(res, nyxAiStreamText(event), model);
        }
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: nyxAiErrorMessage(data, upstream.status)
      });
      return;
    }
    const text = data?.response || data?.text || data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
    res.json({ text: String(text || "").trim(), model });
  } catch (error) {
    if (!res.headersSent) {
      const timedOut = error?.name === "AbortError";
      res.status(timedOut ? 504 : 502).json({ error: timedOut ? "Nyx AI timed out. Please try again." : `Nyx AI request failed: ${error?.message || error}` });
    } else if (!res.writableEnded) {
      res.end();
    }
  } finally {
    clearTimeout(timeout);
    req.nyxAiRelease?.();
  }
});

app.use((req, res, next) => {
  const referer = String(req.get("referer") || "");
  const fromGmsRunner = /\/assets\/(?:gms-games|reds-misc)\/play\.html/i.test(referer);
  if (fromGmsRunner && (req.path === "/" || req.path === "/index.html")) {
    res.status(409).type("html").send(`<!doctype html>
<meta charset="utf-8">
<title>GMS navigation blocked</title>
<style>
  html,body{margin:0;width:100%;height:100%;display:grid;place-items:center;background:#0b0f17;color:#f8fafc;font:16px Outfit,Arial,sans-serif}
  main{max-width:420px;padding:24px;text-align:center}
</style>
<main>This GMS game tried to open Nyx inside itself, so Nyx blocked that redirect.</main>`);
    return;
  }
  next();
});

app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "nyx",
    wisp: externalWispUrl ? "external" : "embedded"
  });
});

function pruneLocalPresence(now = Date.now()) {
  for (const [sessionId, lastSeen] of presenceSessions) {
    if (now - lastSeen > presenceTtlMs) presenceSessions.delete(sessionId);
  }
  return presenceSessions.size;
}

function setPresenceCors(res) {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  });
}

async function cleanupSharedPresence(collection, cutoff, now) {
  if (now - lastPresenceCleanupAt < presenceCleanupIntervalMs) return;
  lastPresenceCleanupAt = now;
  try {
    const stale = await collection.where("lastSeen", "<", cutoff).limit(100).get();
    if (stale.empty) return;
    const firebase = await linkGeneratorFirebase();
    const batch = firebase.firestore.batch();
    stale.docs.forEach(document => batch.delete(document.ref));
    await batch.commit();
  } catch (error) {
    console.warn("Nyx presence cleanup was skipped:", error?.message || error);
  }
}

async function sharedPresenceCount(now = Date.now()) {
  const firebase = await linkGeneratorFirebase();
  if (!firebase) return null;
  const cutoff = now - presenceTtlMs;
  const collection = firebase.firestore.collection(presenceCollectionName);
  const aggregate = await collection.where("lastSeen", ">=", cutoff).count().get();
  void cleanupSharedPresence(collection, cutoff, now);
  return Number(aggregate.data().count) || 0;
}

async function recordSharedPresence(sessionId, now = Date.now()) {
  presenceSessions.set(sessionId, now);
  const firebase = await linkGeneratorFirebase();
  if (!firebase) return pruneLocalPresence(now);
  const collection = firebase.firestore.collection(presenceCollectionName);
  await collection.doc(sessionId).set({ lastSeen: now, updatedAt: new Date(now).toISOString() });
  const aggregate = await collection.where("lastSeen", ">=", now - presenceTtlMs).count().get();
  void cleanupSharedPresence(collection, now - presenceTtlMs, now);
  return Number(aggregate.data().count) || 0;
}

async function presenceCount(now = Date.now()) {
  try {
    const shared = await sharedPresenceCount(now);
    if (shared !== null) return shared;
  } catch (error) {
    console.warn("Nyx shared presence is unavailable; using this server:", error?.message || error);
  }
  return pruneLocalPresence(now);
}

async function sendPresence(res, status = 200, countPromise = presenceCount()) {
  setPresenceCors(res);
  const online = await countPromise;
  res.status(status)
    .set("Cache-Control", "no-store")
    .json({ online, ttl: presenceTtlMs });
}

app.options(["/presence", "/api/presence"], (_req, res) => {
  setPresenceCors(res);
  res.set("Cache-Control", "no-store").sendStatus(204);
});

app.get(["/presence", "/api/presence"], async (_req, res) => {
  await sendPresence(res);
});

app.post(["/presence", "/api/presence"], express.text({ type: "text/plain", limit: "2kb" }), async (req, res) => {
  try {
    const sessionId = String(JSON.parse(req.body || "{}").sessionId || "");
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId)) {
      await sendPresence(res, 400);
      return;
    }
    const now = Date.now();
    let count;
    try {
      count = await recordSharedPresence(sessionId, now);
    } catch (error) {
      console.warn("Nyx shared presence heartbeat failed; using this server:", error?.message || error);
      presenceSessions.set(sessionId, now);
      count = pruneLocalPresence(now);
    }
    await sendPresence(res, 200, Promise.resolve(count));
  } catch {
    await sendPresence(res, 400);
  }
});

app.get("/runtime-config.js", (_req, res) => {
  const publicOrigin = linkGeneratorConfig().origin;
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(
    `globalThis.__NYX_RUNTIME_CONFIG__=Object.freeze(${JSON.stringify({
      wispUrl: externalWispUrl,
      presenceUrl: publicOrigin ? `${publicOrigin}/api/presence` : ""
    })});`
  );
});

app.get("/uv/uv.handler.js", (_req, res) => {
  res.type("application/javascript").send(patchedUvHandler());
});
app.get("/uv/uv.bundle.js", (_req, res) => {
  res.type("application/javascript").send(patchedUvBundle());
});
app.get("/baremux/index.mjs", (_req, res) => {
  res.type("application/javascript").send(patchedBareMuxIndex());
});
app.get("/scramjet/scramjet.js", (_req, res) => {
  res.type("application/javascript").send(patchedScramjetRuntime());
});
app.get("/nyx-scramjet-runtime-guard.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(scramjetRuntimeGuard());
});
app.get("/nyx-compat/cineby-app.js", async (_req, res) => {
  try {
    if (!cinebyAppCache.source || cinebyAppCache.expires < Date.now()) {
      const pageResponse = await fetch("https://www.cineby.at/");
      if (!pageResponse.ok) throw new Error(`Cineby returned ${pageResponse.status}`);
      const html = await pageResponse.text();
      const match = html.match(/<script[^>]+src=["']([^"']*\/_app-[^"']+\.js)["']/i);
      if (!match) throw new Error("Cineby app bundle was not found");
      const scriptUrl = new URL(match[1], "https://www.cineby.at/");
      const scriptResponse = await fetch(scriptUrl);
      if (!scriptResponse.ok) throw new Error(`Cineby app bundle returned ${scriptResponse.status}`);
      const original = await scriptResponse.text();
      const devtoolPatched = original.replace(
        /ignore:\(\)=>\[[^\]]*\]\.includes\(location\.href\)/,
        "ignore:()=>true"
      );
      if (devtoolPatched === original) throw new Error("Cineby DevTools detector signature changed");
      const patched = devtoolPatched.replace(
        /let e=\[\{id:"adstag-gk",src:"\/scripts\/os\.js"\},\{id:"adstag-2",src:"\/\/[^"\\]+"\}\];/,
        "let e=[];"
      );
      if (patched === devtoolPatched) throw new Error("Cineby ad loader signature changed");
      cinebyAppCache = { source: patched, expires: Date.now() + 5 * 60 * 1000 };
    }
    res.setHeader("Cache-Control", "no-store");
    res.type("application/javascript").send(cinebyAppCache.source);
  } catch (error) {
    res.status(502).type("application/javascript").send(`throw new Error(${JSON.stringify(`Nyx Cineby compatibility failed: ${error.message}`)});`);
  }
});
app.get("/assets/vendor/eruda.min.js", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.type("application/javascript").sendFile(erudaPath);
});

function linkGeneratorConfig() {
  const maxZones = Math.max(1, Math.min(10_000, Number.parseInt(process.env.LINK_GENERATOR_MAX_ZONES || "100", 10) || 100));
  const premiumBatchLimit = Math.max(1, Math.min(10, Number.parseInt(process.env.LINK_GENERATOR_PREMIUM_BATCH_LIMIT || "10", 10) || 10));
  let origin = "";
  try {
    const parsed = new URL(process.env.NYX_PUBLIC_ORIGIN || "https://nyxlearning.netlify.app");
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      parsed.pathname = parsed.pathname.replace(/\/$/, "");
      parsed.search = "";
      parsed.hash = "";
      origin = parsed.href.replace(/\/$/, "");
    }
  } catch {}
  return {
    apiKey: String(process.env.BUNNY_API_KEY || "").trim(),
    accessCode: String(process.env.LINK_GENERATOR_ACCESS_CODE || ""),
    origin,
    maxZones,
    premiumBatchLimit
  };
}

function linkGeneratorFirebaseConfig() {
  return {
    webApiKey: String(process.env.FIREBASE_WEB_API_KEY || "").trim(),
    projectId: String(process.env.FIREBASE_PROJECT_ID || "").trim(),
    clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || "").trim(),
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim()
  };
}

function firebaseAdminModeConfigured() {
  const { projectId, clientEmail, privateKey } = linkGeneratorFirebaseConfig();
  return Boolean(projectId && clientEmail && privateKey);
}

function firebaseAccountModeConfigured() {
  return firebaseAdminModeConfigured() && Boolean(linkGeneratorFirebaseConfig().webApiKey);
}

async function linkGeneratorFirebase() {
  if (!firebaseAdminModeConfigured()) return null;
  if (!linkGeneratorFirebasePromise) {
    linkGeneratorFirebasePromise = (async () => {
      const config = linkGeneratorFirebaseConfig();
      const [{ cert, getApps, initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
        import("firebase-admin/app"),
        import("firebase-admin/auth"),
        import("firebase-admin/firestore")
      ]);
      let firebaseApp = getApps().find(item => item.name === "nyx-link-generator");
      if (!firebaseApp) {
        firebaseApp = initializeApp({
          credential: cert({ projectId: config.projectId, clientEmail: config.clientEmail, privateKey: config.privateKey }),
          projectId: config.projectId
        }, "nyx-link-generator");
      }
      return { auth: getAuth(firebaseApp), firestore: getFirestore(firebaseApp) };
    })().catch(error => {
      linkGeneratorFirebasePromise = null;
      throw error;
    });
  }
  return linkGeneratorFirebasePromise;
}

function secretMatches(actual, expected) {
  const left = createHash("sha256").update(String(actual || "")).digest();
  const right = createHash("sha256").update(String(expected || "")).digest();
  return timingSafeEqual(left, right) && Boolean(expected);
}

const founderProfileDefaults = Object.freeze({
  displayName: "1aqlla",
  handle: "@1aqlla",
  role: "Owner / Founder",
  bio: "Built Nyx for people who search, study, and create.",
  avatarUrl: "/assets/icons/founder-1aqlla.jpg",
  bannerUrl: "",
  accent: "#8fb8ff",
  accentPrimary: "#8fb8ff",
  accentSecondary: "#8ea1ff",
  bannerColor: "#8ea1ff",
  displayNameFont: "gg-sans",
  displayNameEffect: "solid",
  displayNameColorPrimary: "#ffffff",
  displayNameColorSecondary: "#8ea1ff",
  profileEffect: "none",
  customEffectPattern: "starfield",
  customEffectColorPrimary: "#ffffff",
  customEffectColorSecondary: "#8ea1ff",
  customEffectSpeed: 7,
  customEffectIntensity: 70,
  avatarDecoration: "none",
  status: "online",
  roles: ["Owner", "Developer"],
  badges: ["Founder"],
  linkLabel: "",
  linkUrl: ""
});

function founderProfileConfig() {
  return { administratorUid: String(process.env.NYX_FOUNDER_PROFILE_ADMIN_UID || "").trim() };
}

function founderProfileText(value, fallback, limit) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, limit);
  return text || fallback;
}

function founderProfileUrl(value, fallback = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw) && raw.length <= profileImageDataLimit) return raw.replace(/\s/g, "");
  if (raw.length > 1_500) return fallback;
  if (/^\/assets\/[a-z0-9/_\-.]+$/i.test(raw)) return raw;
  if (/^\/api\/profile-media\/[A-Za-z0-9_-]{8,128}\/(?:avatar|banner)\/[A-Za-z0-9_-]{12,80}$/.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return fallback;
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch {
    return fallback;
  }
}

function normalizeFounderProfile(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const roles = Array.isArray(source.roles) ? source.roles : founderProfileDefaults.roles;
  const badges = Array.isArray(source.badges) ? source.badges : [];
  const accentPrimary = /^#[0-9a-f]{6}$/i.test(String(source.accentPrimary || source.accent || "").trim()) ? String(source.accentPrimary || source.accent).trim().toLowerCase() : founderProfileDefaults.accentPrimary;
  const accentSecondary = /^#[0-9a-f]{6}$/i.test(String(source.accentSecondary || "").trim()) ? String(source.accentSecondary).trim().toLowerCase() : founderProfileDefaults.accentSecondary;
  const bannerColor = /^#[0-9a-f]{6}$/i.test(String(source.bannerColor || "").trim()) ? String(source.bannerColor).trim().toLowerCase() : accentSecondary;
  const displayNameColorPrimary = /^#[0-9a-f]{6}$/i.test(String(source.displayNameColorPrimary || "").trim()) ? String(source.displayNameColorPrimary).trim().toLowerCase() : founderProfileDefaults.displayNameColorPrimary;
  const displayNameColorSecondary = /^#[0-9a-f]{6}$/i.test(String(source.displayNameColorSecondary || "").trim()) ? String(source.displayNameColorSecondary).trim().toLowerCase() : accentSecondary;
  const customEffectColorPrimary = /^#[0-9a-f]{6}$/i.test(String(source.customEffectColorPrimary || "").trim()) ? String(source.customEffectColorPrimary).trim().toLowerCase() : founderProfileDefaults.customEffectColorPrimary;
  const customEffectColorSecondary = /^#[0-9a-f]{6}$/i.test(String(source.customEffectColorSecondary || "").trim()) ? String(source.customEffectColorSecondary).trim().toLowerCase() : accentSecondary;
  return {
    displayName: founderProfileText(source.displayName, founderProfileDefaults.displayName, 48),
    handle: founderProfileText(source.handle, founderProfileDefaults.handle, 40),
    role: founderProfileText(source.role, founderProfileDefaults.role, 64),
    bio: founderProfileText(source.bio, founderProfileDefaults.bio, 500),
    avatarUrl: founderProfileUrl(source.avatarUrl, founderProfileDefaults.avatarUrl),
    bannerUrl: founderProfileUrl(source.bannerUrl),
    accent: accentPrimary,
    accentPrimary,
    accentSecondary,
    bannerColor,
    displayNameFont: ["gg-sans", "headline", "rounded", "wide", "slab", "condensed", "mono-block", "tempo", "sakura", "jellybean", "modern", "medieval", "eight-bit", "vampyre"].includes(String(source.displayNameFont || "").toLowerCase()) ? String(source.displayNameFont).toLowerCase() : founderProfileDefaults.displayNameFont,
    displayNameEffect: ["solid", "gradient", "neon", "toon", "pop"].includes(String(source.displayNameEffect || "").toLowerCase()) ? String(source.displayNameEffect).toLowerCase() : founderProfileDefaults.displayNameEffect,
    displayNameColorPrimary,
    displayNameColorSecondary,
    profileEffect: ["none", "glow", "sparkle", "aurora", "holographic", "fireflies", "cosmic-dust", "electric-storm", "meteor-shower", "cyber-grid", "plasma", "snowfall", "embers", "bubbles", "custom"].includes(String(source.profileEffect || "").toLowerCase()) ? String(source.profileEffect).toLowerCase() : founderProfileDefaults.profileEffect,
    customEffectPattern: ["starfield", "aurora", "comets", "grid"].includes(String(source.customEffectPattern || "").toLowerCase()) ? String(source.customEffectPattern).toLowerCase() : founderProfileDefaults.customEffectPattern,
    customEffectColorPrimary,
    customEffectColorSecondary,
    customEffectSpeed: Math.max(2, Math.min(18, Number(source.customEffectSpeed) || founderProfileDefaults.customEffectSpeed)),
    customEffectIntensity: Math.max(20, Math.min(100, Number(source.customEffectIntensity) || founderProfileDefaults.customEffectIntensity)),
    avatarDecoration: ["none", "starfall", "orbit", "laurel", "neon-wings"].includes(String(source.avatarDecoration || "").toLowerCase()) ? String(source.avatarDecoration).toLowerCase() : founderProfileDefaults.avatarDecoration,
    status: ["online", "idle", "dnd", "offline"].includes(String(source.status || "").toLowerCase()) ? String(source.status).toLowerCase() : founderProfileDefaults.status,
    roles: roles.map(role => founderProfileText(role, "", 32)).filter(Boolean).slice(0, 8),
    badges: badges.map(badge => founderProfileText(badge, "", 32)).filter(Boolean).slice(0, 8),
    linkLabel: founderProfileText(source.linkLabel, "", 40),
    linkUrl: founderProfileUrl(source.linkUrl)
  };
}

async function verifiedFounderOwner(req) {
  const config = founderProfileConfig();
  if (!config.administratorUid || !firebaseAdminModeConfigured()) {
    return { enabled: false, owner: false, dashboard: false, role: "member", roleLabel: "Member", permissions: [] };
  }
  const match = String(req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return { enabled: true, owner: false, dashboard: false, role: "member", roleLabel: "Member", permissions: [] };
  try {
    const firebase = await linkGeneratorFirebase();
    const token = await firebase?.auth.verifyIdToken(match[1], true);
    if (!token) throw new Error("The account session is unavailable.");
    const administration = token.uid === config.administratorUid
      ? { role: "owner" }
      : (await firebase.firestore.collection("nyxUserAdministration").doc(token.uid).get()).data();
    const role = nyxRoleForUser(token.uid, administration, config.administratorUid);
    const actor = { role, permissions: nyxRolePolicy(role).permissions };
    return { enabled: true, ...nyxOwnerAccessPayload(actor) };
  } catch {
    return { enabled: true, owner: false, dashboard: false, role: "member", roleLabel: "Member", permissions: [] };
  }
}

function nyxUsernameFromToken(token = {}) {
  const email = String(token.email || "");
  const username = email.split("@")[0].replace(/[^a-z0-9_.-]/gi, "").slice(0, 32);
  return username || "nyx-user";
}

function nyxProfileUsername(value, fallback = "nyx-user") {
  const username = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9_.-]{3,32}$/.test(username) ? username : fallback;
}

function nyxProfileImage(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(raw) && raw.length <= profileImageDataLimit) return raw.replace(/\s/g, "");
  return founderProfileUrl(raw, fallback);
}

function nyxProfileImagePayloadSize(profile = {}) {
  return [profile.avatarUrl, profile.bannerUrl].reduce((total, value) => {
    const image = String(value || "");
    return total + (image.startsWith("data:image/") ? image.length : 0);
  }, 0);
}

async function authenticatedNyxUser(req) {
  const match = String(req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match || !firebaseAdminModeConfigured()) {
    const error = new Error("Sign in to use Nyx Profiles.");
    error.status = 401;
    throw error;
  }
  try {
    const firebase = await linkGeneratorFirebase();
    const token = await firebase?.auth.verifyIdToken(match[1], true);
    if (!token) throw new Error("Sign-in is required.");
    return { firebase, token };
  } catch (cause) {
    const error = new Error(cause?.message === "Sign-in is required." ? cause.message : "Your sign-in has expired. Sign in again.");
    error.status = 401;
    throw error;
  }
}

function normalizeNyxUserProfile(value = {}, token = {}) {
  const source = value && typeof value === "object" ? value : {};
  const uid = String(token.uid || "");
  const username = nyxUsernameFromToken(token);
  const fallbackName = founderProfileText(token.name, username, 48);
  const fallbackUsername = nyxProfileUsername(username || uid.slice(0, 8) || "user");
  const fallbackHandle = `@${fallbackUsername}`;
  const accentPrimary = /^#[0-9a-f]{6}$/i.test(String(source.accentPrimary || source.accent || "").trim()) ? String(source.accentPrimary || source.accent).trim().toLowerCase() : "#5865f2";
  const accentSecondary = /^#[0-9a-f]{6}$/i.test(String(source.accentSecondary || source.bannerPrimary || "").trim()) ? String(source.accentSecondary || source.bannerPrimary).trim().toLowerCase() : "#8ea1ff";
  const bannerColor = /^#[0-9a-f]{6}$/i.test(String(source.bannerColor || source.bannerSecondary || "").trim()) ? String(source.bannerColor || source.bannerSecondary).trim().toLowerCase() : accentSecondary;
  const displayNameColorPrimary = /^#[0-9a-f]{6}$/i.test(String(source.displayNameColorPrimary || "").trim()) ? String(source.displayNameColorPrimary).trim().toLowerCase() : "#ffffff";
  const displayNameColorSecondary = /^#[0-9a-f]{6}$/i.test(String(source.displayNameColorSecondary || "").trim()) ? String(source.displayNameColorSecondary).trim().toLowerCase() : accentSecondary;
  const customEffectColorPrimary = /^#[0-9a-f]{6}$/i.test(String(source.customEffectColorPrimary || "").trim()) ? String(source.customEffectColorPrimary).trim().toLowerCase() : "#ffffff";
  const customEffectColorSecondary = /^#[0-9a-f]{6}$/i.test(String(source.customEffectColorSecondary || "").trim()) ? String(source.customEffectColorSecondary).trim().toLowerCase() : accentSecondary;
  return {
    displayName: founderProfileText(source.displayName, fallbackName, 48),
    handle: `@${nyxProfileUsername(source.handle, fallbackUsername)}`,
    bio: founderProfileText(source.bio, "", 280),
    customStatus: founderProfileText(source.customStatus, "", 80),
    avatarUrl: nyxProfileImage(source.avatarUrl, nyxProfileImage(token.picture)),
    bannerUrl: nyxProfileImage(source.bannerUrl),
    accent: accentPrimary,
    accentPrimary,
    accentSecondary,
    bannerColor,
    displayNameFont: ["gg-sans", "headline", "rounded", "wide", "slab", "condensed", "mono-block", "tempo", "sakura", "jellybean", "modern", "medieval", "eight-bit", "vampyre"].includes(String(source.displayNameFont || "").toLowerCase()) ? String(source.displayNameFont).toLowerCase() : "gg-sans",
    displayNameEffect: ["solid", "gradient", "neon", "toon", "pop"].includes(String(source.displayNameEffect || "").toLowerCase()) ? String(source.displayNameEffect).toLowerCase() : "solid",
    displayNameColorPrimary,
    displayNameColorSecondary,
    profileEffect: ["none", "glow", "sparkle", "aurora", "holographic", "fireflies", "cosmic-dust", "electric-storm", "meteor-shower", "cyber-grid", "plasma", "snowfall", "embers", "bubbles", "custom"].includes(String(source.profileEffect || "").toLowerCase()) ? String(source.profileEffect).toLowerCase() : "none",
    customEffectPattern: ["starfield", "aurora", "comets", "grid"].includes(String(source.customEffectPattern || "").toLowerCase()) ? String(source.customEffectPattern).toLowerCase() : "starfield",
    customEffectColorPrimary,
    customEffectColorSecondary,
    customEffectSpeed: Math.max(2, Math.min(18, Number(source.customEffectSpeed) || 7)),
    customEffectIntensity: Math.max(20, Math.min(100, Number(source.customEffectIntensity) || 70)),
    avatarDecoration: ["none", "starfall", "orbit", "laurel", "neon-wings"].includes(String(source.avatarDecoration || "").toLowerCase()) ? String(source.avatarDecoration).toLowerCase() : "none",
    status: ["online", "idle", "dnd", "offline"].includes(String(source.status || "").toLowerCase()) ? String(source.status).toLowerCase() : "online"
  };
}

async function saveNyxProfileWithUsername(firebase, token, profile, createdAt, previousProfile = null) {
  const uid = String(token.uid || "");
  const username = nyxProfileUsername(profile.handle, nyxProfileUsername(nyxUsernameFromToken(token)));
  const previousUsername = previousProfile ? nyxProfileUsername(previousProfile.handle, "") : "";
  const profileRef = firebase.firestore.collection("nyxUserProfiles").doc(uid);
  const usernameRef = firebase.firestore.collection("nyxUsernames").doc(username);
  const previousUsernameRef = previousUsername && previousUsername !== username
    ? firebase.firestore.collection("nyxUsernames").doc(previousUsername)
    : null;
  const now = new Date().toISOString();
  await firebase.firestore.runTransaction(async transaction => {
    const usernameSnapshot = await transaction.get(usernameRef);
    const previousUsernameSnapshot = previousUsernameRef ? await transaction.get(previousUsernameRef) : null;
    const duplicateProfiles = await transaction.get(
      firebase.firestore.collection("nyxUserProfiles").where("profile.handle", "==", `@${username}`).limit(2)
    );
    const claimedBy = String(usernameSnapshot.data()?.ownerUid || "");
    const duplicateOwner = duplicateProfiles.docs.find(document => document.id !== uid)?.id || "";
    if ((usernameSnapshot.exists && claimedBy !== uid) || duplicateOwner) {
      const error = new Error("That username is already taken.");
      error.status = 409;
      throw error;
    }
    transaction.set(usernameRef, {
      username,
      ownerUid: uid,
      createdAt: String(usernameSnapshot.data()?.createdAt || now),
      updatedAt: now
    }, { merge: true });
    if (previousUsernameRef && previousUsernameSnapshot?.exists && String(previousUsernameSnapshot.data()?.ownerUid || "") === uid) {
      transaction.delete(previousUsernameRef);
    }
    transaction.set(profileRef, {
      profile: { ...profile, handle: `@${username}` },
      createdAt,
      updatedAt: now
    }, { merge: true });
  });
  return { ...profile, handle: `@${username}` };
}

function safeDateIso(value, fallback = "") {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function safeActivityTime(value) {
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNyxRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ["co_owner", "admin", "manager", "developer", "moderator", "support", "tester", "contributor", "member"].includes(role) ? role : "member";
}

const nyxRolePolicies = Object.freeze({
  owner: Object.freeze({
    rank: 100,
    assignableRank: 90,
    permissions: Object.freeze(["dashboard:view", "users:view", "audit:view", "profiles:write", "roles:write", "subscriptions:write", "accounts:reset", "accounts:verify", "accounts:disable", "accounts:delete", "developer-console", "founder:write"])
  }),
  co_owner: Object.freeze({
    rank: 90,
    assignableRank: 80,
    permissions: Object.freeze(["dashboard:view", "users:view", "audit:view", "profiles:write", "roles:write", "subscriptions:write", "accounts:reset", "accounts:verify", "accounts:disable", "accounts:delete", "developer-console"])
  }),
  admin: Object.freeze({
    rank: 80,
    assignableRank: 70,
    permissions: Object.freeze(["dashboard:view", "users:view", "audit:view", "profiles:write", "roles:write", "subscriptions:write", "accounts:reset", "accounts:verify", "accounts:disable"])
  }),
  manager: Object.freeze({
    rank: 70,
    assignableRank: 0,
    permissions: Object.freeze(["dashboard:view", "users:view", "profiles:write", "subscriptions:write"])
  }),
  developer: Object.freeze({ rank: 60, assignableRank: 0, permissions: Object.freeze(["developer-console"]) }),
  moderator: Object.freeze({ rank: 50, assignableRank: 0, permissions: Object.freeze(["dashboard:view", "users:view", "accounts:disable"]) }),
  support: Object.freeze({ rank: 40, assignableRank: 0, permissions: Object.freeze(["dashboard:view", "users:view", "accounts:reset", "accounts:verify"]) }),
  tester: Object.freeze({ rank: 30, assignableRank: 0, permissions: Object.freeze([]) }),
  contributor: Object.freeze({ rank: 20, assignableRank: 0, permissions: Object.freeze([]) }),
  member: Object.freeze({ rank: 10, assignableRank: 0, permissions: Object.freeze([]) })
});

const nyxAssignableRoles = Object.freeze(["member", "contributor", "tester", "support", "moderator", "developer", "manager", "admin", "co_owner"]);
const nyxRoleLabels = Object.freeze({
  owner: "Owner",
  co_owner: "Co-owner",
  admin: "Admin",
  manager: "Manager",
  developer: "Developer",
  moderator: "Moderator",
  support: "Support",
  tester: "Tester",
  contributor: "Contributor",
  member: "Member"
});

function nyxRolePolicy(role) {
  return nyxRolePolicies[role] || nyxRolePolicies.member;
}

function nyxRoleForUser(uid, administration = {}, ownerUid = founderProfileConfig().administratorUid) {
  return uid === ownerUid ? "owner" : normalizeNyxRole(administration.role);
}

function nyxActorHasPermission(actor, permission) {
  return Boolean(actor?.permissions?.includes(permission));
}

function nyxOwnerAccessPayload(actor) {
  const policy = nyxRolePolicy(actor.role);
  return {
    role: actor.role,
    roleLabel: nyxRoleLabels[actor.role] || nyxRoleLabels.member,
    owner: actor.role === "owner",
    dashboard: nyxActorHasPermission(actor, "dashboard:view"),
    permissions: [...actor.permissions],
    assignableRoles: nyxActorHasPermission(actor, "roles:write")
      ? nyxAssignableRoles.filter(role => nyxRolePolicy(role).rank <= policy.assignableRank)
      : []
  };
}

function nyxOwnerUserCapabilities(actor, targetRole, targetUid, ownerUid = founderProfileConfig().administratorUid) {
  const actorPolicy = nyxRolePolicy(actor.role);
  const targetPolicy = nyxRolePolicy(targetRole);
  const ownerManagingSelf = actor.role === "owner" && targetRole === "owner" && actor.uid === targetUid;
  const targetProtected = targetUid === ownerUid || targetRole === "owner" || targetPolicy.rank >= actorPolicy.rank;
  const canManageTarget = !targetProtected;
  return {
    canViewAudit: nyxActorHasPermission(actor, "audit:view"),
    canEditProfile: (canManageTarget || ownerManagingSelf) && nyxActorHasPermission(actor, "profiles:write"),
    canSetRole: canManageTarget && nyxActorHasPermission(actor, "roles:write"),
    canSetSubscription: (canManageTarget || ownerManagingSelf) && nyxActorHasPermission(actor, "subscriptions:write"),
    canResetPassword: (canManageTarget || ownerManagingSelf) && nyxActorHasPermission(actor, "accounts:reset"),
    canVerifyEmail: (canManageTarget || ownerManagingSelf) && nyxActorHasPermission(actor, "accounts:verify"),
    canDisableAccount: canManageTarget && nyxActorHasPermission(actor, "accounts:disable"),
    canDeleteAccount: canManageTarget && nyxActorHasPermission(actor, "accounts:delete"),
    assignableRoles: nyxActorHasPermission(actor, "roles:write")
      ? nyxAssignableRoles.filter(role => nyxRolePolicy(role).rank <= actorPolicy.assignableRank)
      : []
  };
}

function assertNyxOwnerCapability(capabilities, capability, message) {
  if (capabilities?.[capability]) return;
  const error = new Error(message || "Your role does not have permission to perform that action.");
  error.status = 403;
  throw error;
}

function normalizeSubscriptionStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return ["free", "premium", "trialing", "past_due", "canceled"].includes(status) ? status : "free";
}

function hasPremiumSubscription(value) {
  return ["premium", "trialing"].includes(normalizeSubscriptionStatus(value));
}

function nyxDeliverableEmail(value) {
  const email = String(value || "").trim();
  return Boolean(email && !/@account\.nyx\.local$/i.test(email) && !/\.local$/i.test(email));
}

function normalizeNyxAccountEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !nyxDeliverableEmail(email)
  ) return "";
  return email;
}

async function ownerDashboardActor(req, requiredPermission = "dashboard:view") {
  const { firebase, token } = await authenticatedNyxUser(req);
  const ownerUid = founderProfileConfig().administratorUid;
  if (!ownerUid) {
    const error = new Error("Owner access has not been configured.");
    error.status = 503;
    throw error;
  }
  let administration = {};
  if (token.uid === ownerUid) {
    administration = { role: "owner" };
    await firebase.firestore.collection("nyxUserAdministration").doc(token.uid).set({
      role: "owner",
      owner: true,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } else {
    administration = (await firebase.firestore.collection("nyxUserAdministration").doc(token.uid).get()).data() || {};
  }
  const role = nyxRoleForUser(token.uid, administration, ownerUid);
  const policy = nyxRolePolicy(role);
  const actor = { uid: token.uid, role, permissions: policy.permissions, rank: policy.rank };
  if (requiredPermission && !nyxActorHasPermission(actor, requiredPermission)) {
    const error = new Error(`${nyxRoleLabels[role] || "Member"} does not have permission to open this area.`);
    error.status = 403;
    throw error;
  }
  return { firebase, token, actor, ownerUid };
}

async function nyxOwnerTargetAccess(firebase, actor, uid, ownerUid = founderProfileConfig().administratorUid) {
  const administration = uid === ownerUid
    ? { role: "owner" }
    : (await firebase.firestore.collection("nyxUserAdministration").doc(uid).get()).data() || {};
  const targetRole = nyxRoleForUser(uid, administration, ownerUid);
  return {
    targetRole,
    capabilities: nyxOwnerUserCapabilities(actor, targetRole, uid, ownerUid)
  };
}

async function firestoreDocumentsById(firestore, collectionName, ids, fieldMask = []) {
  const uniqueIds = [...new Set(ids.map(value => String(value || "")).filter(Boolean))];
  const result = new Map();
  for (let offset = 0; offset < uniqueIds.length; offset += 250) {
    const refs = uniqueIds.slice(offset, offset + 250).map(id => firestore.collection(collectionName).doc(id));
    if (!refs.length) continue;
    const snapshots = await firestore.getAll(...refs, ...(fieldMask.length ? [{ fieldMask }] : []));
    snapshots.forEach(snapshot => {
      if (snapshot.exists) result.set(snapshot.id, snapshot.data() || {});
    });
  }
  return result;
}

async function recordNyxAudit(firebase, {
  actorUid = "",
  actorEmail = "",
  action,
  targetUid = "",
  targetEmail = "",
  details = {}
}) {
  const cleanAction = String(action || "").trim().slice(0, 80);
  if (!cleanAction) return;
  const cleanDetails = {};
  Object.entries(details && typeof details === "object" ? details : {}).slice(0, 20).forEach(([key, value]) => {
    const safeKey = String(key || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    if (!safeKey) return;
    if (typeof value === "boolean" || typeof value === "number") cleanDetails[safeKey] = value;
    else cleanDetails[safeKey] = String(value ?? "").slice(0, 240);
  });
  await firebase.firestore.collection("nyxAuditLog").add({
    actorUid: String(actorUid || "").slice(0, 128),
    actorEmail: String(actorEmail || "").slice(0, 254),
    action: cleanAction,
    targetUid: String(targetUid || "").slice(0, 128),
    targetEmail: String(targetEmail || "").slice(0, 254),
    details: cleanDetails,
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now()
  });
}

async function recordNyxAuditSafe(firebase, event) {
  try {
    await recordNyxAudit(firebase, event);
  } catch (error) {
    console.error("Nyx audit event could not be recorded:", error?.message || error);
  }
}

async function listAllFirebaseUsers(auth, limit = ownerDashboardUserScanLimit) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(Math.min(1000, limit - users.length), pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken && users.length < limit);
  return { users, truncated: Boolean(pageToken) };
}

function nyxOwnerUserRecord(user, administration = {}, profileData = {}, activity = {}, ownerUid = "", includeProfileMedia = false) {
  const profile = normalizeNyxUserProfile(profileData?.profile);
  const email = String(user.email || "");
  const emailUsername = email.split("@")[0] || user.uid.slice(0, 8);
  const profileUsername = String(profile.handle || "").replace(/^@/, "");
  const role = nyxRoleForUser(user.uid, administration, ownerUid);
  const subscriptionStatus = normalizeSubscriptionStatus(administration.subscriptionStatus || administration.subscription?.status);
  const monthlyRevenueCents = Math.max(0, Math.min(100_000_000, Number(administration.monthlyRevenueCents || administration.subscription?.monthlyRevenueCents || 0) || 0));
  const lastActiveAtMs = safeActivityTime(activity.lastActiveAtMs || activity.lastActiveAt);
  const now = Date.now();
  return {
    uid: user.uid,
    displayName: String(profile.displayName || user.displayName || emailUsername).slice(0, 80),
    username: String(profileUsername || administration.username || emailUsername).slice(0, 80),
    email,
    deliverableEmail: nyxDeliverableEmail(email),
    role,
    subscriptionStatus,
    monthlyRevenueCents,
    createdAt: safeDateIso(user.metadata?.creationTime),
    lastSignInAt: safeDateIso(user.metadata?.lastSignInTime),
    lastActiveAt: lastActiveAtMs ? new Date(lastActiveAtMs).toISOString() : "",
    online: Boolean(lastActiveAtMs && now - lastActiveAtMs <= signedInOnlineWindowMs),
    emailVerified: Boolean(user.emailVerified),
    disabled: Boolean(user.disabled),
    photoUrl: includeProfileMedia ? String(profile.avatarUrl || user.photoURL || "") : (/^data:image\//i.test(String(profile.avatarUrl || user.photoURL || "")) ? "" : String(profile.avatarUrl || user.photoURL || "").slice(0, 1_500)),
    profile: {
      displayName: profile.displayName,
      handle: profile.handle,
      bio: profile.bio,
      customStatus: profile.customStatus,
      status: profile.status,
      avatarUrl: includeProfileMedia ? profile.avatarUrl : "",
      bannerUrl: includeProfileMedia ? profile.bannerUrl : "",
      accentPrimary: profile.accentPrimary,
      accentSecondary: profile.accentSecondary,
      bannerColor: profile.bannerColor,
      displayNameFont: profile.displayNameFont,
      displayNameEffect: profile.displayNameEffect,
      displayNameColorPrimary: profile.displayNameColorPrimary,
      displayNameColorSecondary: profile.displayNameColorSecondary,
      profileEffect: profile.profileEffect,
      customEffectPattern: profile.customEffectPattern,
      customEffectColorPrimary: profile.customEffectColorPrimary,
      customEffectColorSecondary: profile.customEffectColorSecondary,
      customEffectSpeed: profile.customEffectSpeed,
      customEffectIntensity: profile.customEffectIntensity,
      avatarDecoration: profile.avatarDecoration
    }
  };
}

function nyxOwnerSortUsers(users, sort, direction) {
  const allowed = new Set(["displayName", "username", "email", "role", "subscriptionStatus", "createdAt", "lastSignInAt", "lastActiveAt", "status"]);
  const key = allowed.has(sort) ? sort : "createdAt";
  const multiplier = direction === "asc" ? 1 : -1;
  return users.sort((left, right) => {
    let a = key === "status" ? (left.disabled ? "disabled" : "enabled") : left[key];
    let b = key === "status" ? (right.disabled ? "disabled" : "enabled") : right[key];
    if (key.endsWith("At")) {
      a = Date.parse(a || "") || 0;
      b = Date.parse(b || "") || 0;
      return (a - b) * multiplier;
    }
    return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base", numeric: true }) * multiplier;
  });
}

async function ownerDashboardSnapshot(firebase) {
  const now = Date.now();
  if (ownerDashboardSnapshotCache.value && ownerDashboardSnapshotCache.expiresAt > now) return ownerDashboardSnapshotCache.value;
  if (ownerDashboardSnapshotCache.promise) return ownerDashboardSnapshotCache.promise;
  ownerDashboardSnapshotCache.promise = (async () => {
    const { users: authUsers, truncated } = await listAllFirebaseUsers(firebase.auth);
    const uids = authUsers.map(user => user.uid);
    const [administration, profiles, activity] = await Promise.all([
      firestoreDocumentsById(firebase.firestore, "nyxUserAdministration", uids),
      firestoreDocumentsById(firebase.firestore, "nyxUserProfiles", uids, ["profile.displayName", "profile.handle", "profile.bio", "profile.customStatus", "profile.status"]),
      firestoreDocumentsById(firebase.firestore, "nyxUserActivity", uids)
    ]);
    const ownerUid = founderProfileConfig().administratorUid;
    return {
      users: authUsers.map(user => nyxOwnerUserRecord(
        user,
        administration.get(user.uid),
        profiles.get(user.uid),
        activity.get(user.uid),
        ownerUid
      )),
      truncated
    };
  })();
  try {
    const value = await ownerDashboardSnapshotCache.promise;
    ownerDashboardSnapshotCache = { expiresAt: Date.now() + ownerDashboardSnapshotTtlMs, value, promise: null };
    return value;
  } catch (error) {
    ownerDashboardSnapshotCache.promise = null;
    throw error;
  }
}

function invalidateOwnerDashboardSnapshot() {
  ownerDashboardSnapshotCache = { expiresAt: 0, value: null, promise: null };
}

function linkGeneratorClientId(req) {
  return String(
    req.get("x-nf-client-connection-ip") ||
    req.get("x-forwarded-for")?.split(",")[0] ||
    req.ip ||
    "unknown"
  ).trim().slice(0, 100);
}

function sameOriginRequest(req) {
  const fetchSite = String(req.get("sec-fetch-site") || "").trim().toLowerCase();
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
  if (fetchSite === "cross-site") return false;
  const origin = String(req.get("origin") || "").trim();
  if (!origin) return true;
  try {
    const forwardedHost = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
    return new URL(origin).host === forwardedHost;
  } catch {
    return false;
  }
}

function linkGeneratorRateState(clientId, now = Date.now()) {
  for (const [key, state] of linkGeneratorAttempts) {
    if (now - state.windowStarted > linkGeneratorWindowMs) linkGeneratorAttempts.delete(key);
  }
  let state = linkGeneratorAttempts.get(clientId);
  if (!state || now - state.windowStarted > linkGeneratorWindowMs) {
    state = { attempts: 0, windowStarted: now };
    linkGeneratorAttempts.set(clientId, state);
  }
  return state;
}

function normalizedDownloadSafetyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function downloadSafetyFileRisk(url, filename = "") {
  const candidate = `${String(url?.pathname || "")} ${String(filename || "")}`.toLowerCase();
  const executable = /\.(?:apk|appx|bat|cmd|com|crx|deb|dmg|exe|iso|jar|jse|msi|pkg|ps1|scr|sh|vbs|wsf)(?:$|[\s?#])/i.test(candidate);
  const archive = /\.(?:7z|rar|tar|tgz|zip)(?:$|[\s?#])/i.test(candidate);
  return executable ? "executable" : (archive ? "archive" : "ordinary");
}

function downloadSafetyRateState(clientId, now = Date.now()) {
  for (const [key, state] of downloadSafetyAttempts) {
    if (now - state.windowStarted > downloadSafetyWindowMs) downloadSafetyAttempts.delete(key);
  }
  let state = downloadSafetyAttempts.get(clientId);
  if (!state || now - state.windowStarted > downloadSafetyWindowMs) {
    state = { attempts: 0, windowStarted: now };
    downloadSafetyAttempts.set(clientId, state);
  }
  return state;
}

async function googleSafeBrowsingLookup(url) {
  const apiKey = String(process.env.NYX_SAFE_BROWSING_API_KEY || process.env.GOOGLE_SAFE_BROWSING_API_KEY || "").trim();
  if (!apiKey) return { configured: false, matches: [] };
  const cacheKey = url.href;
  const cached = downloadSafetyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "nyx-browser", clientVersion: "1.0.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url: url.href }]
        }
      })
    });
    if (!response.ok) throw new Error(`Safe Browsing returned ${response.status}`);
    const payload = await response.json().catch(() => ({}));
    const matches = Array.isArray(payload.matches) ? payload.matches.map(match => String(match?.threatType || "UNKNOWN")).filter(Boolean) : [];
    const value = { configured: true, matches };
    downloadSafetyCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, value });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

app.post("/api/download-safety/check", async (req, res) => {
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-site download checks are not allowed." });
    return;
  }
  const rate = downloadSafetyRateState(linkGeneratorClientId(req));
  rate.attempts += 1;
  if (rate.attempts > downloadSafetyMaxAttempts) {
    res.set("Retry-After", String(Math.ceil(downloadSafetyWindowMs / 1000)));
    res.status(429).json({ error: "Too many download checks. Try again in a minute." });
    return;
  }
  const target = normalizedDownloadSafetyUrl(req.body?.url);
  if (!target) {
    res.status(400).json({ error: "A valid HTTP or HTTPS download URL is required." });
    return;
  }
  const fileRisk = downloadSafetyFileRisk(target, req.body?.filename);
  try {
    const lookup = await googleSafeBrowsingLookup(target);
    const threats = [...new Set(lookup.matches)];
    const blocked = threats.length > 0;
    const caution = !blocked && fileRisk !== "ordinary";
    res.setHeader("cache-control", "no-store");
    res.json({
      verdict: blocked ? "blocked" : (caution ? "caution" : (lookup.configured ? "clear" : "unverified")),
      provider: lookup.configured ? "Google Safe Browsing" : "Nyx local checks",
      providerConfigured: lookup.configured,
      threats,
      fileRisk,
      urlChecked: lookup.configured,
      fileScanned: false,
      message: blocked
        ? "This download URL matches a known threat list."
        : (caution
          ? `This is ${fileRisk === "executable" ? "an executable or installable file" : "an archive"}; inspect it carefully before opening it.`
          : (lookup.configured
            ? "No known URL threat was reported. The file contents were not antivirus-scanned."
            : "URL reputation checking is not configured on this Nyx server. The file contents were not antivirus-scanned."))
    });
  } catch (error) {
    console.warn("Nyx download safety lookup failed:", error?.message || error);
    res.setHeader("cache-control", "no-store");
    res.json({
      verdict: fileRisk === "ordinary" ? "unverified" : "caution",
      provider: "Nyx local checks",
      providerConfigured: true,
      threats: [],
      fileRisk,
      urlChecked: false,
      fileScanned: false,
      message: "The URL reputation service could not be reached. The file contents were not antivirus-scanned."
    });
  }
});

function nyxAccountSignInRateState(clientId, now = Date.now()) {
  for (const [key, state] of nyxAccountSignInAttempts) {
    if (now - state.windowStarted > nyxAccountSignInWindowMs) nyxAccountSignInAttempts.delete(key);
  }
  let state = nyxAccountSignInAttempts.get(clientId);
  if (!state || now - state.windowStarted > nyxAccountSignInWindowMs) {
    state = { attempts: 0, windowStarted: now };
    nyxAccountSignInAttempts.set(clientId, state);
  }
  return state;
}

function nyxAccountRegisterRateState(clientId, now = Date.now()) {
  for (const [key, state] of nyxAccountRegisterAttempts) {
    if (now - state.windowStarted > nyxAccountSignInWindowMs) nyxAccountRegisterAttempts.delete(key);
  }
  let state = nyxAccountRegisterAttempts.get(clientId);
  if (!state || now - state.windowStarted > nyxAccountSignInWindowMs) {
    state = { attempts: 0, windowStarted: now };
    nyxAccountRegisterAttempts.set(clientId, state);
  }
  return state;
}

function nyxAccountPasswordResetRateState(clientId, now = Date.now()) {
  for (const [key, state] of nyxAccountPasswordResetAttempts) {
    if (now - state.windowStarted > nyxAccountSignInWindowMs) nyxAccountPasswordResetAttempts.delete(key);
  }
  let state = nyxAccountPasswordResetAttempts.get(clientId);
  if (!state || now - state.windowStarted > nyxAccountSignInWindowMs) {
    state = { attempts: 0, windowStarted: now };
    nyxAccountPasswordResetAttempts.set(clientId, state);
  }
  return state;
}

function utcQuotaDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function quotaIpKey(clientId) {
  return createHash("sha256").update(String(clientId || "unknown")).digest("hex").slice(0, 32);
}

async function reserveFreeLink(firebase, uid, clientId) {
  const day = utcQuotaDay();
  const collection = firebase.firestore.collection("nyxLinkGeneratorUsage");
  const userRef = collection.doc(`${day}_user_${uid}`);
  const ipRef = collection.doc(`${day}_ip_${quotaIpKey(clientId)}`);
  return firebase.firestore.runTransaction(async transaction => {
    const [userSnapshot, ipSnapshot] = await transaction.getAll(userRef, ipRef);
    const userCount = Number(userSnapshot.data()?.count || 0);
    const ipCount = Number(ipSnapshot.data()?.count || 0);
    if (userCount >= freeLinkDailyLimit) {
      const error = new Error(`This account has used all ${freeLinkDailyLimit} free links for today.`);
      error.status = 429;
      throw error;
    }
    if (ipCount >= freeNetworkDailyLimit) {
      const error = new Error("This network has reached the Link Generator safety limit for today.");
      error.status = 429;
      throw error;
    }
    const updatedAt = new Date().toISOString();
    transaction.set(userRef, { count: userCount + 1, day, uid, updatedAt }, { merge: true });
    transaction.set(ipRef, { count: ipCount + 1, day, updatedAt }, { merge: true });
    return { remaining: freeLinkDailyLimit - userCount - 1, userRef, ipRef };
  });
}

async function releaseFreeLink(firebase, reservation) {
  if (!reservation) return;
  try {
    await firebase.firestore.runTransaction(async transaction => {
      const snapshots = await transaction.getAll(reservation.userRef, reservation.ipRef);
      for (let index = 0; index < snapshots.length; index += 1) {
        const count = Math.max(0, Number(snapshots[index].data()?.count || 0) - 1);
        transaction.set(index === 0 ? reservation.userRef : reservation.ipRef, { count, updatedAt: new Date().toISOString() }, { merge: true });
      }
    });
  } catch (error) {
    console.error("Nyx Link Generator could not release a failed quota reservation:", error?.message || error);
  }
}

function premiumCooldownError(cooldownUntil, now = Date.now()) {
  const retryAfter = Math.max(1, Math.ceil((cooldownUntil - now) / 1000));
  const minutes = Math.floor(retryAfter / 60);
  const seconds = retryAfter % 60;
  const wait = minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
  const error = new Error(`Premium cooldown active. Try again in ${wait}.`);
  error.status = 429;
  error.retryAfter = retryAfter;
  return error;
}

function premiumReservationResult(previousCount, previousCooldownUntil, amount, cooldownUntil, version, extra = {}) {
  return {
    previousCount,
    previousCooldownUntil,
    amount,
    accumulated: previousCount + amount,
    cooldownTriggered: cooldownUntil > 0,
    cooldownUntil,
    version,
    ...extra
  };
}

async function reservePremiumGeneration(firebase, clientId, amount, now = Date.now()) {
  const key = quotaIpKey(clientId);
  if (!firebase) {
    const current = premiumGenerationUsage.get(key) || { count: 0, cooldownUntil: 0, version: 0 };
    if (current.cooldownUntil > now) throw premiumCooldownError(current.cooldownUntil, now);
    const previousCount = current.cooldownUntil ? 0 : Number(current.count || 0);
    const accumulated = previousCount + amount;
    const cooldownTriggered = amount >= premiumImmediateCooldownAt || accumulated >= premiumAccumulatedLimit;
    const next = { count: accumulated, cooldownUntil: cooldownTriggered ? now + premiumCooldownMs : 0, version: current.version + 1 };
    premiumGenerationUsage.set(key, next);
    return premiumReservationResult(previousCount, current.cooldownUntil || 0, amount, next.cooldownUntil, next.version, { key, storage: "memory" });
  }

  const ref = firebase.firestore.collection("nyxLinkGeneratorPremiumUsage").doc(key);
  return firebase.firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data() || {};
    const activeCooldown = Number(data.cooldownUntil || 0);
    if (activeCooldown > now) throw premiumCooldownError(activeCooldown, now);
    const previousCount = activeCooldown ? 0 : Number(data.count || 0);
    const accumulated = previousCount + amount;
    const cooldownTriggered = amount >= premiumImmediateCooldownAt || accumulated >= premiumAccumulatedLimit;
    const cooldownUntil = cooldownTriggered ? now + premiumCooldownMs : 0;
    const version = Number(data.version || 0) + 1;
    transaction.set(ref, { count: accumulated, cooldownUntil, version, updatedAt: new Date(now).toISOString() }, { merge: true });
    return premiumReservationResult(previousCount, activeCooldown, amount, cooldownUntil, version, { ref, storage: "firestore" });
  });
}

async function adjustPremiumGeneration(firebase, reservation, created) {
  if (!reservation || created >= reservation.amount) return reservation;
  const actual = Math.max(0, Number(created || 0));
  const immediateCooldown = reservation.amount >= premiumImmediateCooldownAt && actual > 0;
  const actualAccumulated = reservation.previousCount + actual;
  const shouldKeepCooldown = immediateCooldown || actualAccumulated >= premiumAccumulatedLimit;

  if (reservation.storage === "memory") {
    const current = premiumGenerationUsage.get(reservation.key);
    if (!current) return reservation;
    const count = Math.max(0, Number(current.count || 0) - (reservation.amount - actual));
    const sameReservation = current.version === reservation.version;
    premiumGenerationUsage.set(reservation.key, {
      count,
      cooldownUntil: sameReservation && !shouldKeepCooldown ? reservation.previousCooldownUntil : current.cooldownUntil,
      version: current.version + 1
    });
    return { ...reservation, accumulated: actualAccumulated, cooldownTriggered: shouldKeepCooldown, cooldownUntil: shouldKeepCooldown ? current.cooldownUntil : reservation.previousCooldownUntil };
  }

  try {
    return await firebase.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reservation.ref);
      const data = snapshot.data() || {};
      const sameReservation = Number(data.version || 0) === reservation.version;
      const count = Math.max(0, Number(data.count || 0) - (reservation.amount - actual));
      const cooldownUntil = sameReservation && !shouldKeepCooldown ? reservation.previousCooldownUntil : Number(data.cooldownUntil || 0);
      transaction.set(reservation.ref, { count, cooldownUntil, version: Number(data.version || 0) + 1, updatedAt: new Date().toISOString() }, { merge: true });
      return { ...reservation, accumulated: actualAccumulated, cooldownTriggered: shouldKeepCooldown, cooldownUntil: shouldKeepCooldown ? cooldownUntil : reservation.previousCooldownUntil };
    });
  } catch (error) {
    console.error("Nyx Link Generator could not adjust a Premium cooldown reservation:", error?.message || error);
    return reservation;
  }
}

async function authenticatedLinkGeneratorUser(req) {
  const match = String(req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error("Sign in with a verified account or enter your Premium access code.");
    error.status = 401;
    throw error;
  }
  const firebase = await linkGeneratorFirebase();
  if (!firebase) {
    const error = new Error("Free account access has not been configured by the Nyx administrator yet.");
    error.status = 503;
    throw error;
  }
  let token;
  try {
    token = await firebase.auth.verifyIdToken(match[1], true);
  } catch {
    const error = new Error("Your sign-in has expired. Sign in again.");
    error.status = 401;
    throw error;
  }
  const administration = await firebase.firestore.collection("nyxUserAdministration").doc(token.uid).get();
  const administrationData = administration.data() || {};
  const subscriptionStatus = normalizeSubscriptionStatus(administrationData.subscriptionStatus || administrationData.subscription?.status);
  const premiumAccess = hasPremiumSubscription(subscriptionStatus);
  if (!token.email_verified && !premiumAccess) {
    const error = new Error("Verify your email address before generating free links.");
    error.status = 403;
    throw error;
  }
  return { firebase, uid: token.uid, subscriptionStatus, premiumAccess };
}

function generatedPullZoneName(label) {
  const slug = String(label || "link")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "link";
  return `${slug}-${randomBytes(3).toString("hex")}`;
}

function generatedBunnyUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    const validHostname = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.b-cdn\.net$/i.test(parsed.hostname);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !validHostname || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizedOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function bunnyRequest(path, apiKey, options = {}) {
  const response = await fetch(`https://api.bunny.net${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      AccessKey: apiKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15_000)
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const message = String(payload?.Message || payload?.message || `Bunny API returned ${response.status}`).slice(0, 240);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function resolveNyxAccountIdentifier(firebase, value) {
  const identifier = String(value || "").trim();
  const usernameIdentifier = /^@[a-z0-9_.-]{3,32}$/i.test(identifier);
  if (identifier.includes("@") && !usernameIdentifier) {
    const authEmail = normalizeNyxAccountEmail(identifier);
    return authEmail ? { authEmail, expectedUid: "" } : null;
  }
  const username = nyxProfileUsername(identifier.replace(/^@+/, ""), "");
  if (!username) return null;
  const usernameSnapshot = await firebase.firestore.collection("nyxUsernames").doc(username).get();
  const expectedUid = String(usernameSnapshot.data()?.ownerUid || "");
  if (expectedUid) {
    const account = await firebase.auth.getUser(expectedUid);
    return { authEmail: String(account.email || ""), expectedUid, username, repairUsername: false };
  }
  const localAccountEmail = `${username}@account.nyx.local`;
  const localAccount = await firebase.auth.getUserByEmail(localAccountEmail).catch(() => null);
  if (localAccount) {
    return { authEmail: String(localAccount.email || localAccountEmail), expectedUid: localAccount.uid, username, repairUsername: true };
  }
  const handleProfiles = await firebase.firestore.collection("nyxUserProfiles").where("profile.handle", "==", `@${username}`).limit(2).get();
  if (handleProfiles.size === 1) {
    const account = await firebase.auth.getUser(handleProfiles.docs[0].id).catch(() => null);
    if (account) return { authEmail: String(account.email || ""), expectedUid: account.uid, username, repairUsername: true };
  }
  const legacyProfiles = await firebase.firestore.collection("nyxUserProfiles").where("profile.displayName", "==", username).limit(3).get();
  const legacyAccounts = (await Promise.all(legacyProfiles.docs.map(document => firebase.auth.getUser(document.id).catch(() => null))))
    .filter(account => account && String(account.displayName || "").trim().toLowerCase() === username);
  if (legacyAccounts.length === 1) {
    const account = legacyAccounts[0];
    return { authEmail: String(account.email || ""), expectedUid: account.uid, username, repairUsername: true };
  }
  const authDirectory = await listAllFirebaseUsers(firebase.auth);
  const displayNameAccounts = authDirectory.users.filter(account => String(account.displayName || "").trim().toLowerCase() === username);
  if (displayNameAccounts.length === 1) {
    const account = displayNameAccounts[0];
    return { authEmail: String(account.email || ""), expectedUid: account.uid, username, repairUsername: true };
  }
  return { authEmail: localAccountEmail, expectedUid: "", username, repairUsername: false };
}

async function repairLegacyNyxUsername(firebase, uid, username) {
  if (!uid || !username) return;
  const profileRef = firebase.firestore.collection("nyxUserProfiles").doc(uid);
  const snapshot = await profileRef.get();
  if (!snapshot.exists) return;
  const account = await firebase.auth.getUser(uid);
  const token = { uid, email: String(account.email || ""), name: String(account.displayName || username), picture: String(account.photoURL || "") };
  const previousProfile = normalizeNyxUserProfile(snapshot.data()?.profile, token);
  const nextProfile = { ...previousProfile, handle: `@${username}` };
  await saveNyxProfileWithUsername(firebase, token, nextProfile, String(snapshot.data()?.createdAt || new Date().toISOString()), previousProfile);
}

app.post("/api/account/register", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  if (!firebaseAccountModeConfigured()) {
    res.status(503).json({ error: "Nyx accounts are not configured." });
    return;
  }
  const rateState = nyxAccountRegisterRateState(linkGeneratorClientId(req));
  if (rateState.attempts >= nyxAccountRegisterMaxAttempts) {
    res.status(429).json({ error: "Too many account creation attempts. Try again in a few minutes." });
    return;
  }
  const rawUsername = String(req.body?.username || "").trim().toLowerCase().replace(/^@+/, "");
  const username = nyxProfileUsername(rawUsername, "");
  const password = String(req.body?.password || "");
  const requestedEmail = String(req.body?.email || "").trim();
  const recoveryEmail = requestedEmail ? normalizeNyxAccountEmail(requestedEmail) : "";
  if (!username || username !== rawUsername) {
    res.status(400).json({ error: "Use 3–32 letters, numbers, dots, dashes, or underscores." });
    return;
  }
  if (requestedEmail && !recoveryEmail) {
    res.status(400).json({ error: "Enter a valid email address or leave the email field blank." });
    return;
  }
  if (password.length < 8 || password.length > 256) {
    res.status(400).json({ error: "Choose a password with at least 8 characters." });
    return;
  }
  rateState.attempts += 1;
  let createdUid = "";
  try {
    const firebase = await linkGeneratorFirebase();
    const usernameRef = firebase.firestore.collection("nyxUsernames").doc(username);
    const [usernameSnapshot, duplicateProfiles] = await Promise.all([
      usernameRef.get(),
      firebase.firestore.collection("nyxUserProfiles").where("profile.handle", "==", `@${username}`).limit(1).get()
    ]);
    if (usernameSnapshot.exists || !duplicateProfiles.empty) {
      res.status(409).json({ error: "That username is already taken." });
      return;
    }
    const email = recoveryEmail || `${username}@account.nyx.local`;
    const account = await firebase.auth.createUser({
      email,
      password,
      displayName: username,
      emailVerified: false,
      disabled: false
    });
    createdUid = account.uid;
    const profileToken = { uid: account.uid, email, name: username, picture: "" };
    const profile = normalizeNyxUserProfile({ displayName: username, handle: `@${username}` }, profileToken);
    try {
      await saveNyxProfileWithUsername(firebase, profileToken, profile, new Date().toISOString());
    } catch (error) {
      await firebase.auth.deleteUser(account.uid).catch(() => {});
      createdUid = "";
      throw error;
    }
    createdUid = "";
    await firebase.firestore.collection("nyxUserAdministration").doc(account.uid).set({
      role: "member",
      disabled: false,
      subscriptionStatus: "free",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch(error => {
      console.warn("Nyx account defaults could not be stored:", error?.message || error);
    });
    await recordNyxAuditSafe(firebase, {
      actorUid: account.uid,
      actorEmail: email,
      action: "account_created",
      targetUid: account.uid,
      targetEmail: email,
      details: { username }
    });
    const customToken = await firebase.auth.createCustomToken(account.uid);
    nyxAccountRegisterAttempts.delete(linkGeneratorClientId(req));
    invalidateOwnerDashboardSnapshot();
    res.status(201).json({ customToken });
  } catch (error) {
    const duplicateEmail = error?.code === "auth/email-already-exists";
    const duplicate = duplicateEmail || error?.status === 409;
    const invalidPassword = error?.code === "auth/invalid-password";
    if (createdUid) {
      const firebase = await linkGeneratorFirebase().catch(() => null);
      await firebase?.auth.deleteUser(createdUid).catch(() => {});
    }
    res.status(duplicate ? 409 : (invalidPassword ? 400 : (error.status || 503))).json({
      error: duplicate
        ? (duplicateEmail ? "That email is already connected to an account." : "That username is already taken.")
        : invalidPassword
          ? "Choose a password with at least 8 characters."
          : (error.message || "Account creation is temporarily unavailable.")
    });
  }
});

app.post("/api/account/sign-in", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  if (!firebaseAccountModeConfigured()) {
    res.status(503).json({ error: "Nyx accounts are not configured." });
    return;
  }
  const rateState = nyxAccountSignInRateState(linkGeneratorClientId(req));
  if (rateState.attempts >= nyxAccountSignInMaxAttempts) {
    res.status(429).json({ error: "Too many sign-in attempts. Try again in a few minutes." });
    return;
  }
  const identifier = String(req.body?.identifier || "").trim();
  const password = String(req.body?.password || "");
  if (!identifier || password.length < 6 || password.length > 256) {
    res.status(400).json({ error: "Enter your username or email and password." });
    return;
  }
  rateState.attempts += 1;
  try {
    const firebase = await linkGeneratorFirebase();
    const resolved = await resolveNyxAccountIdentifier(firebase, identifier);
    if (!resolved?.authEmail) {
      res.status(401).json({ error: "Username, email, or password is incorrect." });
      return;
    }
    const { authEmail, expectedUid } = resolved;
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(linkGeneratorFirebaseConfig().webApiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: authEmail, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.localId || (expectedUid && payload.localId !== expectedUid)) {
      res.status(response.status === 429 ? 429 : 401).json({
        error: response.status === 429 ? "Too many sign-in attempts. Try again later." : "Username, email, or password is incorrect."
      });
      return;
    }
    if (resolved.repairUsername && resolved.username) {
      await repairLegacyNyxUsername(firebase, payload.localId, resolved.username).catch(error => {
        console.warn("Nyx legacy username mapping could not be repaired:", error?.message || error);
      });
    }
    const customToken = await firebase.auth.createCustomToken(payload.localId);
    nyxAccountSignInAttempts.delete(linkGeneratorClientId(req));
    res.json({ customToken });
  } catch (error) {
    const knownAccountError = ["auth/user-not-found", "auth/invalid-email"].includes(String(error?.code || ""));
    res.status(knownAccountError ? 401 : 503).json({
      error: knownAccountError ? "Username, email, or password is incorrect." : "Sign-in is temporarily unavailable."
    });
  }
});

app.post("/api/account/password-reset", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  if (!firebaseAccountModeConfigured()) {
    res.status(503).json({ error: "Nyx accounts are not configured." });
    return;
  }
  const clientId = linkGeneratorClientId(req);
  const rateState = nyxAccountPasswordResetRateState(clientId);
  if (rateState.attempts >= nyxAccountPasswordResetMaxAttempts) {
    res.status(429).json({ error: "Too many reset attempts. Try again in a few minutes." });
    return;
  }
  const identifier = String(req.body?.identifier || "").trim();
  if (identifier.length < 3 || identifier.length > 254) {
    res.status(400).json({ error: "Enter your username or email." });
    return;
  }
  rateState.attempts += 1;
  const genericMessage = "If that account has a recovery email, Firebase sent a password-reset message.";
  try {
    const firebase = await linkGeneratorFirebase();
    const resolved = await resolveNyxAccountIdentifier(firebase, identifier).catch(() => null);
    if (resolved?.authEmail && nyxDeliverableEmail(resolved.authEmail)) {
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(linkGeneratorFirebaseConfig().webApiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email: resolved.authEmail }),
        signal: AbortSignal.timeout(15_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && String(payload?.error?.message || "") !== "EMAIL_NOT_FOUND") {
        throw new Error("Firebase could not send the reset email.");
      }
      if (response.ok) {
        nyxAccountPasswordResetAttempts.delete(clientId);
        await recordNyxAuditSafe(firebase, {
          actorUid: resolved.expectedUid,
          actorEmail: resolved.authEmail,
          action: "password_reset_requested",
          targetUid: resolved.expectedUid,
          targetEmail: resolved.authEmail
        });
      }
    }
    res.status(202).json({ message: genericMessage });
  } catch (error) {
    console.warn("Nyx password reset request failed:", error?.message || error);
    res.status(202).json({ message: genericMessage });
  }
});

app.get("/api/account/me", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const [account, administration] = await Promise.all([
      firebase.auth.getUser(token.uid),
      firebase.firestore.collection("nyxUserAdministration").doc(token.uid).get()
    ]);
    const administrationData = administration.data() || {};
    const role = nyxRoleForUser(token.uid, administrationData);
    const access = nyxOwnerAccessPayload({ role, permissions: nyxRolePolicy(role).permissions });
    const subscriptionStatus = normalizeSubscriptionStatus(administrationData.subscriptionStatus || administrationData.subscription?.status);
    res.json({
      uid: token.uid,
      email: nyxDeliverableEmail(account.email) ? String(account.email) : "",
      emailVerified: Boolean(account.emailVerified),
      role,
      owner: access.owner,
      dashboard: access.dashboard,
      permissions: access.permissions,
      subscriptionStatus,
      premiumAccess: hasPremiumSubscription(subscriptionStatus)
    });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Account information is unavailable." });
  }
});

app.put("/api/account/me/email", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const email = normalizeNyxAccountEmail(req.body?.email);
    if (!email) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    const current = await firebase.auth.getUser(token.uid);
    if (String(current.email || "").toLowerCase() !== email) {
      await firebase.auth.updateUser(token.uid, { email, emailVerified: false });
      const now = new Date().toISOString();
      await firebase.firestore.collection("nyxUserAdministration").doc(token.uid).set({
        emailAttachedAt: now,
        updatedAt: now
      }, { merge: true });
      invalidateOwnerDashboardSnapshot();
      await recordNyxAuditSafe(firebase, {
        actorUid: token.uid,
        actorEmail: email,
        action: "account_email_changed",
        targetUid: token.uid,
        targetEmail: email
      });
    }
    const updated = await firebase.auth.getUser(token.uid);
    const customToken = await firebase.auth.createCustomToken(token.uid);
    res.json({
      email: String(updated.email || ""),
      emailVerified: Boolean(updated.emailVerified),
      customToken
    });
  } catch (error) {
    const duplicate = error.code === "auth/email-already-exists";
    res.status(duplicate ? 409 : (error.status || 503)).json({
      error: duplicate ? "That email is already connected to another account." : (error.message || "Your email could not be updated.")
    });
  }
});

app.get("/api/profiles/me", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const ref = firebase.firestore.collection("nyxUserProfiles").doc(token.uid);
    const snapshot = await ref.get();
    const profile = normalizeNyxUserProfile(snapshot.data()?.profile, token);
    const createdAt = String(snapshot.data()?.createdAt || new Date().toISOString());
    if (!snapshot.exists) {
      const savedProfile = await saveNyxProfileWithUsername(firebase, token, profile, createdAt);
      Object.assign(profile, savedProfile);
      invalidateOwnerDashboardSnapshot();
      await recordNyxAuditSafe(firebase, {
        actorUid: token.uid,
        actorEmail: token.email,
        action: "profile_created",
        targetUid: token.uid,
        targetEmail: token.email
      });
    }
    res.json({ uid: token.uid, profile, createdAt });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Nyx Profile is unavailable." });
  }
});

app.put("/api/profiles/me", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const ref = firebase.firestore.collection("nyxUserProfiles").doc(token.uid);
    const previous = await ref.get();
    const requestedHandle = String(req.body?.profile?.handle || "").trim().replace(/^@+/, "").toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(requestedHandle)) {
      res.status(400).json({ error: "Usernames must use 3–32 letters, numbers, dots, dashes, or underscores." });
      return;
    }
    let profile = normalizeNyxUserProfile(req.body?.profile, token);
    if (nyxProfileImagePayloadSize(profile) > profileImageDocumentLimit) {
      res.status(413).json({ error: "Your avatar and banner are too large together. Remove one or choose a smaller GIF." });
      return;
    }
    const createdAt = String(previous.data()?.createdAt || new Date().toISOString());
    const previousProfile = normalizeNyxUserProfile(previous.data()?.profile, token);
    const previousUsername = nyxProfileUsername(previousProfile.handle, "");
    profile = await saveNyxProfileWithUsername(firebase, token, profile, createdAt, previousProfile);
    invalidateOwnerDashboardSnapshot();
    await recordNyxAuditSafe(firebase, {
      actorUid: token.uid,
      actorEmail: token.email,
      action: previousUsername && previousUsername !== nyxProfileUsername(profile.handle, "") ? "username_changed" : "profile_updated",
      targetUid: token.uid,
      targetEmail: token.email,
      details: previousUsername && previousUsername !== nyxProfileUsername(profile.handle, "") ? { previousUsername, username: nyxProfileUsername(profile.handle, "") } : {}
    });
    res.json({ uid: token.uid, profile, createdAt });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Nyx Profile could not be saved." });
  }
});

function nyxProfileMediaDocumentId(uid, kind, uploadId) {
  return `${uid}--${kind}--${uploadId}`;
}

function nyxProfileMediaRouteValues(req) {
  const uid = String(req.params.uid || "").trim();
  const kind = String(req.params.kind || "").trim().toLowerCase();
  const uploadId = String(req.params.uploadId || "").trim();
  return {
    uid,
    kind,
    uploadId,
    validUid: /^[A-Za-z0-9_-]{8,128}$/.test(uid),
    validKind: kind === "avatar" || kind === "banner",
    validUploadId: /^[A-Za-z0-9_-]{12,80}$/.test(uploadId)
  };
}

async function nyxProfileMediaRecord(firebase, values) {
  if (!values.validUid || !values.validKind || !values.validUploadId) return null;
  const mediaId = nyxProfileMediaDocumentId(values.uid, values.kind, values.uploadId);
  const mediaRef = firebase.firestore.collection("nyxProfileMedia").doc(mediaId);
  const mediaSnapshot = await mediaRef.get();
  const media = mediaSnapshot.data() || {};
  const totalChunks = Number(media.totalChunks || 0);
  if (
    !mediaSnapshot.exists ||
    media.ownerUid !== values.uid ||
    media.kind !== values.kind ||
    media.complete !== true ||
    !/^image\/(?:gif|png|jpeg|webp)$/.test(String(media.mime || "")) ||
    totalChunks < 1 ||
    totalChunks > profileMediaChunkCountLimit
  ) {
    return null;
  }
  return { mediaRef, media, totalChunks };
}

app.put("/api/profile-media/:kind/:uploadId/:index", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const kind = String(req.params.kind || "").trim().toLowerCase();
    const uploadId = String(req.params.uploadId || "").trim();
    const index = Number.parseInt(String(req.params.index || ""), 10);
    const totalChunks = Number.parseInt(String(req.body?.totalChunks || ""), 10);
    const mime = String(req.body?.mime || "").trim().toLowerCase();
    const chunk = String(req.body?.chunk || "").trim();
    if (
      !["avatar", "banner"].includes(kind) ||
      !/^[A-Za-z0-9_-]{12,80}$/.test(uploadId) ||
      !Number.isInteger(index) ||
      index < 0 ||
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > profileMediaChunkCountLimit ||
      index >= totalChunks ||
      !/^image\/(?:gif|png|jpeg|webp)$/.test(mime) ||
      !chunk ||
      chunk.length > profileMediaChunkLimit ||
      !/^[A-Za-z0-9+/=]+$/.test(chunk)
    ) {
      res.status(400).json({ error: "That profile media chunk is invalid." });
      return;
    }
    const mediaId = nyxProfileMediaDocumentId(token.uid, kind, uploadId);
    const mediaRef = firebase.firestore.collection("nyxProfileMedia").doc(mediaId);
    const chunkRef = mediaRef.collection("chunks").doc(String(index).padStart(3, "0"));
    await Promise.all([
      mediaRef.set({
        ownerUid: token.uid,
        kind,
        mime,
        totalChunks,
        updatedAt: new Date().toISOString()
      }, { merge: true }),
      chunkRef.set({ index, chunk })
    ]);
    res.json({ received: index });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Profile media could not be uploaded." });
  }
});

app.post("/api/profile-media/:kind/:uploadId/complete", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const kind = String(req.params.kind || "").trim().toLowerCase();
    const uploadId = String(req.params.uploadId || "").trim();
    if (!["avatar", "banner"].includes(kind) || !/^[A-Za-z0-9_-]{12,80}$/.test(uploadId)) {
      res.status(400).json({ error: "That profile media upload is invalid." });
      return;
    }
    const mediaId = nyxProfileMediaDocumentId(token.uid, kind, uploadId);
    const mediaRef = firebase.firestore.collection("nyxProfileMedia").doc(mediaId);
    const mediaSnapshot = await mediaRef.get();
    const media = mediaSnapshot.data() || {};
    const totalChunks = Number(media.totalChunks || 0);
    if (
      !mediaSnapshot.exists ||
      media.ownerUid !== token.uid ||
      media.kind !== kind ||
      totalChunks < 1 ||
      totalChunks > profileMediaChunkCountLimit
    ) {
      res.status(404).json({ error: "That profile media upload was not found." });
      return;
    }
    const chunkSnapshots = await Promise.all(
      Array.from({ length: totalChunks }, (_, index) =>
        mediaRef.collection("chunks").doc(String(index).padStart(3, "0")).get()
      )
    );
    const encodedLength = chunkSnapshots.reduce((total, snapshot, index) => {
      const data = snapshot.data() || {};
      return total + (snapshot.exists && data.index === index ? String(data.chunk || "").length : profileMediaEncodedLimit + 1);
    }, 0);
    if (encodedLength < 1 || encodedLength > profileMediaEncodedLimit) {
      res.status(413).json({ error: "That profile image is too large or incomplete." });
      return;
    }
    const finalChunk = String(chunkSnapshots.at(-1)?.data()?.chunk || "");
    const padding = finalChunk.endsWith("==") ? 2 : (finalChunk.endsWith("=") ? 1 : 0);
    const byteLength = Math.floor(encodedLength * 3 / 4) - padding;
    await mediaRef.set({ complete: true, encodedLength, byteLength, completedAt: new Date().toISOString() }, { merge: true });
    res.json({ url: `/api/profile-media/${token.uid}/${kind}/${uploadId}` });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Profile media could not be completed." });
  }
});

app.put("/api/owner-dashboard/users/:uid/profile-media/:kind/:uploadId/:index", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  const uid = String(req.params.uid || "").trim();
  const kind = String(req.params.kind || "").trim().toLowerCase();
  const uploadId = String(req.params.uploadId || "").trim();
  const index = Number.parseInt(String(req.params.index || ""), 10);
  const totalChunks = Number.parseInt(String(req.body?.totalChunks || ""), 10);
  const mime = String(req.body?.mime || "").trim().toLowerCase();
  const chunk = String(req.body?.chunk || "").trim();
  if (
    !/^[A-Za-z0-9_-]{8,128}$/.test(uid) ||
    !["avatar", "banner"].includes(kind) ||
    !/^[A-Za-z0-9_-]{12,80}$/.test(uploadId) ||
    !Number.isInteger(index) ||
    index < 0 ||
    !Number.isInteger(totalChunks) ||
    totalChunks < 1 ||
    totalChunks > profileMediaChunkCountLimit ||
    index >= totalChunks ||
    !/^image\/(?:gif|png|jpeg|webp)$/.test(mime) ||
    !chunk ||
    chunk.length > profileMediaChunkLimit ||
    !/^[A-Za-z0-9+/=]+$/.test(chunk)
  ) {
    res.status(400).json({ error: "That profile media chunk is invalid." });
    return;
  }
  try {
    const { firebase, token, actor, ownerUid } = await ownerDashboardActor(req, "profiles:write");
    await firebase.auth.getUser(uid);
    const { capabilities } = await nyxOwnerTargetAccess(firebase, actor, uid, ownerUid);
    assertNyxOwnerCapability(capabilities, "canEditProfile", "Your role cannot edit this account's profile media.");
    const mediaId = nyxProfileMediaDocumentId(uid, kind, uploadId);
    const mediaRef = firebase.firestore.collection("nyxProfileMedia").doc(mediaId);
    const chunkRef = mediaRef.collection("chunks").doc(String(index).padStart(3, "0"));
    await Promise.all([
      mediaRef.set({
        ownerUid: uid,
        uploadedByUid: token.uid,
        kind,
        mime,
        totalChunks,
        updatedAt: new Date().toISOString()
      }, { merge: true }),
      chunkRef.set({ index, chunk })
    ]);
    res.json({ received: index });
  } catch (error) {
    const status = error.code === "auth/user-not-found" ? 404 : (error.status || 503);
    res.status(status).json({ error: status === 404 ? "User not found." : (error.message || "Profile media could not be uploaded.") });
  }
});

app.post("/api/owner-dashboard/users/:uid/profile-media/:kind/:uploadId/complete", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  const uid = String(req.params.uid || "").trim();
  const kind = String(req.params.kind || "").trim().toLowerCase();
  const uploadId = String(req.params.uploadId || "").trim();
  if (
    !/^[A-Za-z0-9_-]{8,128}$/.test(uid) ||
    !["avatar", "banner"].includes(kind) ||
    !/^[A-Za-z0-9_-]{12,80}$/.test(uploadId)
  ) {
    res.status(400).json({ error: "That profile media upload is invalid." });
    return;
  }
  try {
    const { firebase, actor, ownerUid } = await ownerDashboardActor(req, "profiles:write");
    await firebase.auth.getUser(uid);
    const { capabilities } = await nyxOwnerTargetAccess(firebase, actor, uid, ownerUid);
    assertNyxOwnerCapability(capabilities, "canEditProfile", "Your role cannot edit this account's profile media.");
    const mediaId = nyxProfileMediaDocumentId(uid, kind, uploadId);
    const mediaRef = firebase.firestore.collection("nyxProfileMedia").doc(mediaId);
    const mediaSnapshot = await mediaRef.get();
    const media = mediaSnapshot.data() || {};
    const totalChunks = Number(media.totalChunks || 0);
    if (
      !mediaSnapshot.exists ||
      media.ownerUid !== uid ||
      media.kind !== kind ||
      totalChunks < 1 ||
      totalChunks > profileMediaChunkCountLimit
    ) {
      res.status(404).json({ error: "That profile media upload was not found." });
      return;
    }
    const chunkSnapshots = await Promise.all(
      Array.from({ length: totalChunks }, (_, chunkIndex) =>
        mediaRef.collection("chunks").doc(String(chunkIndex).padStart(3, "0")).get()
      )
    );
    const encodedLength = chunkSnapshots.reduce((total, snapshot, chunkIndex) => {
      const data = snapshot.data() || {};
      return total + (snapshot.exists && data.index === chunkIndex ? String(data.chunk || "").length : profileMediaEncodedLimit + 1);
    }, 0);
    if (encodedLength < 1 || encodedLength > profileMediaEncodedLimit) {
      res.status(413).json({ error: "That profile image is too large or incomplete." });
      return;
    }
    const finalChunk = String(chunkSnapshots.at(-1)?.data()?.chunk || "");
    const padding = finalChunk.endsWith("==") ? 2 : (finalChunk.endsWith("=") ? 1 : 0);
    const byteLength = Math.floor(encodedLength * 3 / 4) - padding;
    await mediaRef.set({ complete: true, encodedLength, byteLength, completedAt: new Date().toISOString() }, { merge: true });
    res.json({ url: `/api/profile-media/${uid}/${kind}/${uploadId}` });
  } catch (error) {
    const status = error.code === "auth/user-not-found" ? 404 : (error.status || 503);
    res.status(status).json({ error: status === 404 ? "User not found." : (error.message || "Profile media could not be completed.") });
  }
});

app.get("/api/profile-media/:uid/:kind/:uploadId/manifest", async (req, res) => {
  const values = nyxProfileMediaRouteValues(req);
  if (!firebaseAdminModeConfigured()) {
    res.status(404).end();
    return;
  }
  try {
    const firebase = await linkGeneratorFirebase();
    const record = await nyxProfileMediaRecord(firebase, values);
    if (!record) {
      res.status(404).end();
      return;
    }
    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }).json({
      mime: record.media.mime,
      totalChunks: record.totalChunks,
      byteLength: Number(record.media.byteLength || 0)
    });
  } catch {
    res.status(404).end();
  }
});

app.get("/api/profile-media/:uid/:kind/:uploadId/chunks/:index", async (req, res) => {
  const values = nyxProfileMediaRouteValues(req);
  const index = Number.parseInt(String(req.params.index || ""), 10);
  if (!firebaseAdminModeConfigured() || !Number.isInteger(index) || index < 0 || index >= profileMediaChunkCountLimit) {
    res.status(404).end();
    return;
  }
  try {
    const firebase = await linkGeneratorFirebase();
    const record = await nyxProfileMediaRecord(firebase, values);
    if (!record || index >= record.totalChunks) {
      res.status(404).end();
      return;
    }
    const snapshot = await record.mediaRef.collection("chunks").doc(String(index).padStart(3, "0")).get();
    const data = snapshot.data() || {};
    const chunk = String(data.chunk || "");
    if (!snapshot.exists || data.index !== index || !chunk || chunk.length > profileMediaChunkLimit || !/^[A-Za-z0-9+/=]+$/.test(chunk)) {
      res.status(404).end();
      return;
    }
    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    }).send(chunk);
  } catch {
    res.status(404).end();
  }
});

app.get("/api/profile-media/:uid/:kind/:uploadId", async (req, res) => {
  const values = nyxProfileMediaRouteValues(req);
  if (!firebaseAdminModeConfigured()) {
    res.status(404).end();
    return;
  }
  try {
    const firebase = await linkGeneratorFirebase();
    const record = await nyxProfileMediaRecord(firebase, values);
    if (!record) {
      res.status(404).end();
      return;
    }
    const chunkSnapshots = await Promise.all(
      Array.from({ length: record.totalChunks }, (_, index) =>
        record.mediaRef.collection("chunks").doc(String(index).padStart(3, "0")).get()
      )
    );
    const encoded = chunkSnapshots.map((snapshot, index) => {
      const data = snapshot.data() || {};
      if (!snapshot.exists || data.index !== index) throw new Error("Profile media is incomplete.");
      return String(data.chunk || "");
    }).join("");
    if (!encoded || encoded.length > profileMediaEncodedLimit || !/^[A-Za-z0-9+/=]+$/.test(encoded)) {
      res.status(404).end();
      return;
    }
    res.set({
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": record.media.mime,
      "Content-Length": String(Buffer.byteLength(encoded, "base64")),
      "X-Content-Type-Options": "nosniff"
    });
    res.end(Buffer.from(encoded, "base64"));
  } catch {
    res.status(404).end();
  }
});

app.get("/api/profiles", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const search = String(req.query.search || "").trim().toLowerCase().slice(0, 80);
    const snapshot = await firebase.firestore.collection("nyxUserProfiles").limit(250).get();
    const uids = snapshot.docs.map(document => document.id);
    const [administration, activity] = await Promise.all([
      firestoreDocumentsById(firebase.firestore, "nyxUserAdministration", uids),
      firestoreDocumentsById(firebase.firestore, "nyxUserActivity", uids)
    ]);
    const ownerUid = founderProfileConfig().administratorUid;
    const now = Date.now();
    const profiles = snapshot.docs.map(document => {
      const data = document.data() || {};
      const profile = normalizeNyxUserProfile(data.profile, { uid: document.id });
      const activityData = activity.get(document.id) || {};
      const lastActiveAtMs = safeActivityTime(activityData.lastActiveAtMs || activityData.lastActiveAt);
      return {
        uid: document.id,
        profile,
        role: document.id === ownerUid ? "owner" : normalizeNyxRole(administration.get(document.id)?.role),
        online: Boolean(lastActiveAtMs && now - lastActiveAtMs <= signedInOnlineWindowMs),
        createdAt: safeDateIso(data.createdAt),
        self: document.id === token.uid
      };
    }).filter(entry => {
      if (!search) return true;
      return [entry.profile.displayName, entry.profile.handle, entry.role].some(value => String(value || "").toLowerCase().includes(search));
    }).sort((left, right) => {
      if (left.self !== right.self) return left.self ? -1 : 1;
      if (left.online !== right.online) return left.online ? -1 : 1;
      return String(left.profile.displayName || "").localeCompare(String(right.profile.displayName || ""), undefined, { sensitivity: "base", numeric: true });
    }).slice(0, 40);
    res.json({ profiles, total: profiles.length });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Profiles are unavailable." });
  }
});

app.get("/api/profiles/:uid", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const uid = String(req.params.uid || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(uid) || !firebaseAdminModeConfigured()) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }
  try {
    const firebase = await linkGeneratorFirebase();
    const snapshot = await firebase.firestore.collection("nyxUserProfiles").doc(uid).get();
    if (!snapshot.exists) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    const data = snapshot.data() || {};
    res.json({ uid, profile: normalizeNyxUserProfile(data.profile), createdAt: String(data.createdAt || "") });
  } catch {
    res.status(503).json({ error: "Profile is unavailable." });
  }
});

app.post("/api/activity/heartbeat", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const now = Date.now();
    const administrationRef = firebase.firestore.collection("nyxUserAdministration").doc(token.uid);
    const [, administration] = await Promise.all([
      firebase.firestore.collection("nyxUserActivity").doc(token.uid).set({
        lastActiveAt: new Date(now).toISOString(),
        lastActiveAtMs: now,
        onlineUntilMs: now + signedInOnlineWindowMs,
        updatedAt: new Date(now).toISOString()
      }, { merge: true }),
      administrationRef.get()
    ]);
    const administrationData = administration.data() || {};
    const role = nyxRoleForUser(token.uid, administrationData);
    const access = nyxOwnerAccessPayload({ role, permissions: nyxRolePolicy(role).permissions });
    const subscriptionStatus = normalizeSubscriptionStatus(administrationData.subscriptionStatus || administrationData.subscription?.status);
    res.json({
      ok: true,
      onlineUntil: new Date(now + signedInOnlineWindowMs).toISOString(),
      role,
      owner: access.owner,
      dashboard: access.dashboard,
      permissions: access.permissions,
      subscriptionStatus,
      premiumAccess: hasPremiumSubscription(subscriptionStatus)
    });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Activity could not be updated." });
  }
});

app.post("/api/activity/event", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  try {
    const { firebase, token } = await authenticatedNyxUser(req);
    const action = String(req.body?.action || "").trim().toLowerCase();
    if (!["login", "session_start"].includes(action)) {
      res.status(400).json({ error: "That activity event is not supported." });
      return;
    }
    const key = `${token.uid}:${action}`;
    const now = Date.now();
    const lastRecorded = Number(userActivityEventTimes.get(key) || 0);
    if (now - lastRecorded >= userActivityEventWindowMs) {
      userActivityEventTimes.set(key, now);
      await recordNyxAuditSafe(firebase, {
        actorUid: token.uid,
        actorEmail: token.email,
        action,
        targetUid: token.uid,
        targetEmail: token.email,
        details: { provider: String(token.firebase?.sign_in_provider || "password") }
      });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Activity could not be recorded." });
  }
});

app.get("/api/owner-dashboard", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const { firebase, actor } = await ownerDashboardActor(req, "users:view");
    const [{ users: allUsers, truncated }, auditSnapshot] = await Promise.all([
      ownerDashboardSnapshot(firebase),
      nyxActorHasPermission(actor, "audit:view")
        ? firebase.firestore.collection("nyxAuditLog").orderBy("createdAtMs", "desc").limit(30).get()
        : Promise.resolve(null)
    ]);
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const premiumStatuses = new Set(["premium", "trialing"]);
    const metrics = {
      totalUsers: allUsers.length,
      activeToday: allUsers.filter(user => (Date.parse(user.lastActiveAt || "") || 0) >= today.getTime()).length,
      onlineUsers: allUsers.filter(user => user.online).length,
      newSignups: allUsers.filter(user => (Date.parse(user.createdAt || "") || 0) >= sevenDaysAgo).length,
      premiumSubscribers: allUsers.filter(user => premiumStatuses.has(user.subscriptionStatus)).length,
      monthlyRevenueCents: allUsers.reduce((total, user) => total + (premiumStatuses.has(user.subscriptionStatus) ? user.monthlyRevenueCents : 0), 0)
    };
    const search = String(req.query.search || "").trim().toLowerCase().slice(0, 120);
    const role = String(req.query.role || "all").trim().toLowerCase();
    const subscription = String(req.query.subscription || "all").trim().toLowerCase();
    const status = String(req.query.status || "all").trim().toLowerCase();
    const segment = String(req.query.segment || "all").trim().toLowerCase();
    let filtered = allUsers.filter(user => {
      if (search && ![user.displayName, user.username, user.email, user.uid].some(value => String(value || "").toLowerCase().includes(search))) return false;
      if (role !== "all" && user.role !== role) return false;
      if (subscription !== "all" && user.subscriptionStatus !== subscription) return false;
      if (status === "enabled" && user.disabled) return false;
      if (status === "disabled" && !user.disabled) return false;
      if (status === "online" && !user.online) return false;
      if (status === "offline" && user.online) return false;
      if (segment === "active_today" && (Date.parse(user.lastActiveAt || "") || 0) < today.getTime()) return false;
      if (segment === "online" && !user.online) return false;
      if (segment === "new_7d" && (Date.parse(user.createdAt || "") || 0) < sevenDaysAgo) return false;
      if ((segment === "premium" || segment === "revenue") && !premiumStatuses.has(user.subscriptionStatus)) return false;
      return true;
    });
    filtered = nyxOwnerSortUsers(filtered, String(req.query.sort || ""), String(req.query.direction || "").toLowerCase());
    const pageSize = Math.max(10, Math.min(ownerDashboardPageSizeLimit, Number.parseInt(String(req.query.pageSize || "25"), 10) || 25));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.max(1, Math.min(pages, Number.parseInt(String(req.query.page || "1"), 10) || 1));
    const offset = (page - 1) * pageSize;
    const recentActivity = (auditSnapshot?.docs || []).map(document => {
      const data = document.data() || {};
      return {
        id: document.id,
        actorUid: String(data.actorUid || ""),
        actorEmail: String(data.actorEmail || ""),
        action: String(data.action || ""),
        targetUid: String(data.targetUid || ""),
        targetEmail: String(data.targetEmail || ""),
        details: data.details && typeof data.details === "object" ? data.details : {},
        createdAt: safeDateIso(data.createdAt, new Date(Number(data.createdAtMs || 0) || now).toISOString())
      };
    });
    res.json({
      access: nyxOwnerAccessPayload(actor),
      metrics,
      users: filtered.slice(offset, offset + pageSize),
      pagination: { page, pageSize, pages, total: filtered.length, scanned: allUsers.length, truncated },
      recentActivity,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Owner dashboard is unavailable." });
  }
});

app.get("/api/owner-dashboard/users/:uid", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const uid = String(req.params.uid || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(uid)) {
    res.status(400).json({ error: "That user ID is invalid." });
    return;
  }
  try {
    const { firebase, actor, ownerUid } = await ownerDashboardActor(req, "users:view");
    const [user, administration, profile, activity, audit] = await Promise.all([
      firebase.auth.getUser(uid),
      firebase.firestore.collection("nyxUserAdministration").doc(uid).get(),
      firebase.firestore.collection("nyxUserProfiles").doc(uid).get(),
      firebase.firestore.collection("nyxUserActivity").doc(uid).get(),
      nyxActorHasPermission(actor, "audit:view")
        ? firebase.firestore.collection("nyxAuditLog").where("targetUid", "==", uid).orderBy("createdAtMs", "desc").limit(20).get().catch(() => null)
        : Promise.resolve(null)
    ]);
    const record = nyxOwnerUserRecord(user, administration.data(), profile.data(), activity.data(), ownerUid, true);
    const capabilities = nyxOwnerUserCapabilities(actor, record.role, uid, ownerUid);
    record.recentActivity = audit ? audit.docs.map(document => {
      const data = document.data() || {};
      return { id: document.id, action: String(data.action || ""), actorEmail: String(data.actorEmail || ""), createdAt: safeDateIso(data.createdAt), details: data.details || {} };
    }) : [];
    res.json({ user: record, access: nyxOwnerAccessPayload(actor), capabilities });
  } catch (error) {
    const status = error.code === "auth/user-not-found" ? 404 : (error.status || 503);
    res.status(status).json({ error: status === 404 ? "User not found." : (error.message || "User details are unavailable.") });
  }
});

app.get("/api/owner-dashboard/audit", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const { firebase, actor } = await ownerDashboardActor(req, "audit:view");
    const limit = Math.max(10, Math.min(200, Number.parseInt(String(req.query.limit || "100"), 10) || 100));
    const snapshot = await firebase.firestore.collection("nyxAuditLog").orderBy("createdAtMs", "desc").limit(limit).get();
    res.json({
      access: nyxOwnerAccessPayload(actor),
      activity: snapshot.docs.map(document => {
        const data = document.data() || {};
        return {
          id: document.id,
          actorUid: String(data.actorUid || ""),
          actorEmail: String(data.actorEmail || ""),
          action: String(data.action || ""),
          targetUid: String(data.targetUid || ""),
          targetEmail: String(data.targetEmail || ""),
          details: data.details && typeof data.details === "object" ? data.details : {},
          createdAt: safeDateIso(data.createdAt)
        };
      })
    });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Audit activity is unavailable." });
  }
});

app.patch("/api/owner-dashboard/users/:uid", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  const uid = String(req.params.uid || "").trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(uid)) {
    res.status(400).json({ error: "That user ID is invalid." });
    return;
  }
  try {
    const { firebase, token, actor, ownerUid } = await ownerDashboardActor(req, "dashboard:view");
    const action = String(req.body?.action || "").trim().toLowerCase();
    const [target, targetAdministration] = await Promise.all([
      firebase.auth.getUser(uid),
      uid === ownerUid
        ? Promise.resolve(null)
        : firebase.firestore.collection("nyxUserAdministration").doc(uid).get()
    ]);
    const targetRole = nyxRoleForUser(uid, targetAdministration?.data(), ownerUid);
    const capabilities = nyxOwnerUserCapabilities(actor, targetRole, uid, ownerUid);
    const capabilityByAction = {
      set_role: "canSetRole",
      set_subscription: "canSetSubscription",
      set_profile: "canEditProfile",
      disable: "canDisableAccount",
      enable: "canDisableAccount",
      verify_email: "canVerifyEmail",
      create_password_reset_link: "canResetPassword",
      send_password_reset: "canResetPassword",
      delete: "canDeleteAccount"
    };
    if (capabilityByAction[action]) {
      assertNyxOwnerCapability(capabilities, capabilityByAction[action], `Your ${nyxRoleLabels[actor.role] || "Member"} role cannot perform that action on this account.`);
    }
    const ownerProtectedAction = ["set_role", "disable", "delete"].includes(action);
    if (uid === ownerUid && ownerProtectedAction) {
      res.status(409).json({ error: "The configured owner account cannot be demoted, disabled, or deleted." });
      return;
    }
    let auditAction = action;
    let auditDetails = {};
    if (action === "set_role") {
      const requestedRole = String(req.body?.role || "").trim().toLowerCase();
      if (!capabilities.assignableRoles.includes(requestedRole)) {
        res.status(403).json({ error: "Your role cannot assign that account role." });
        return;
      }
      const role = normalizeNyxRole(requestedRole);
      await firebase.firestore.collection("nyxUserAdministration").doc(uid).set({ role, updatedAt: new Date().toISOString() }, { merge: true });
      auditDetails = { role };
    } else if (action === "set_subscription") {
      const subscriptionStatus = normalizeSubscriptionStatus(req.body?.subscriptionStatus);
      const monthlyRevenueCents = Math.max(0, Math.min(100_000_000, Number.parseInt(String(req.body?.monthlyRevenueCents || "0"), 10) || 0));
      await firebase.firestore.collection("nyxUserAdministration").doc(uid).set({
        subscriptionStatus,
        monthlyRevenueCents,
        subscriptionUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      auditAction = "subscription_change";
      auditDetails = { subscriptionStatus, monthlyRevenueCents };
    } else if (action === "set_profile") {
      const profileRef = firebase.firestore.collection("nyxUserProfiles").doc(uid);
      const profileSnapshot = await profileRef.get();
      const profileToken = {
        uid,
        email: target.email,
        name: target.displayName,
        picture: target.photoURL
      };
      const previousProfile = normalizeNyxUserProfile(profileSnapshot.data()?.profile, profileToken);
      const requestedProfile = req.body?.profile && typeof req.body.profile === "object" ? req.body.profile : {};
      const editableFields = [
        "displayName", "handle", "bio", "customStatus", "status",
        "accentPrimary", "accentSecondary", "bannerColor",
        "displayNameFont", "displayNameEffect",
        "displayNameColorPrimary", "displayNameColorSecondary",
        "profileEffect", "avatarDecoration"
      ];
      const profileChanges = {};
      editableFields.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(requestedProfile, field)) profileChanges[field] = requestedProfile[field];
      });
      if (Object.prototype.hasOwnProperty.call(requestedProfile, "avatarUrl")) profileChanges.avatarUrl = requestedProfile.avatarUrl;
      if (Object.prototype.hasOwnProperty.call(requestedProfile, "bannerUrl")) profileChanges.bannerUrl = requestedProfile.bannerUrl;
      if (req.body?.removeAvatar === true) profileChanges.avatarUrl = "";
      if (req.body?.removeBanner === true) profileChanges.bannerUrl = "";
      const nextProfile = normalizeNyxUserProfile({ ...previousProfile, ...profileChanges }, profileToken);
      const createdAt = String(profileSnapshot.data()?.createdAt || target.metadata?.creationTime || new Date().toISOString());
      const savedProfile = await saveNyxProfileWithUsername(firebase, profileToken, nextProfile, createdAt, previousProfile);
      await firebase.auth.updateUser(uid, {
        displayName: savedProfile.displayName,
        photoURL: /^https?:\/\//i.test(savedProfile.avatarUrl) ? savedProfile.avatarUrl : null
      });
      auditAction = "profile_updated_by_owner";
      auditDetails = {
        username: nyxProfileUsername(savedProfile.handle, ""),
        displayName: savedProfile.displayName,
        avatarRemoved: req.body?.removeAvatar === true,
        bannerRemoved: req.body?.removeBanner === true
      };
    } else if (action === "disable" || action === "enable") {
      const disabled = action === "disable";
      await firebase.auth.updateUser(uid, { disabled });
      if (disabled) await firebase.auth.revokeRefreshTokens(uid);
      auditAction = disabled ? "account_disabled" : "account_enabled";
      auditDetails = { disabled };
    } else if (action === "verify_email") {
      if (!nyxDeliverableEmail(target.email)) {
        res.status(409).json({ error: "Username-only Nyx accounts do not have a deliverable email to verify." });
        return;
      }
      await firebase.auth.updateUser(uid, { emailVerified: true });
      auditAction = "email_verified";
    } else if (action === "create_password_reset_link") {
      const resetLink = await firebase.auth.generatePasswordResetLink(String(target.email || ""));
      auditAction = "password_reset_link_created";
      auditDetails = { delivery: nyxDeliverableEmail(target.email) ? "manual_or_email" : "manual" };
      await recordNyxAuditSafe(firebase, {
        actorUid: token.uid,
        actorEmail: token.email,
        action: auditAction,
        targetUid: uid,
        targetEmail: target.email,
        details: auditDetails
      });
      res.json({ resetLink });
      return;
    } else if (action === "send_password_reset") {
      if (!nyxDeliverableEmail(target.email)) {
        res.status(409).json({ error: "This username-only account has no recovery email. Firebase cannot deliver a reset message to it." });
        return;
      }
      const apiKey = linkGeneratorFirebaseConfig().webApiKey;
      if (!apiKey) {
        res.status(503).json({ error: "Firebase email actions are not configured." });
        return;
      }
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email: target.email })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message || "Firebase could not send the reset email.").replace(/_/g, " ").toLowerCase());
      auditAction = "password_reset_sent";
    } else if (action === "delete") {
      const profileRef = firebase.firestore.collection("nyxUserProfiles").doc(uid);
      const profileSnapshot = await profileRef.get();
      const username = nyxProfileUsername(profileSnapshot.data()?.profile?.handle, nyxProfileUsername(String(target.email || "").split("@")[0], ""));
      const usernameRef = username ? firebase.firestore.collection("nyxUsernames").doc(username) : null;
      const usernameSnapshot = usernameRef ? await usernameRef.get() : null;
      await firebase.auth.deleteUser(uid);
      const batch = firebase.firestore.batch();
      ["nyxUserProfiles", "nyxUserAdministration", "nyxUserActivity"].forEach(collectionName => {
        batch.delete(firebase.firestore.collection(collectionName).doc(uid));
      });
      if (usernameRef && usernameSnapshot?.exists && String(usernameSnapshot.data()?.ownerUid || "") === uid) batch.delete(usernameRef);
      await batch.commit();
      invalidateOwnerDashboardSnapshot();
      await recordNyxAuditSafe(firebase, {
        actorUid: token.uid,
        actorEmail: token.email,
        action: "account_deleted",
        targetUid: uid,
        targetEmail: target.email,
        details: { displayName: target.displayName || "" }
      });
      res.json({ deleted: true, uid });
      return;
    } else {
      res.status(400).json({ error: "That owner action is not supported." });
      return;
    }
    invalidateOwnerDashboardSnapshot();
    await recordNyxAuditSafe(firebase, {
      actorUid: token.uid,
      actorEmail: token.email,
      action: auditAction,
      targetUid: uid,
      targetEmail: target.email,
      details: auditDetails
    });
    const [updated, administration, profile, activity] = await Promise.all([
      firebase.auth.getUser(uid),
      firebase.firestore.collection("nyxUserAdministration").doc(uid).get(),
      firebase.firestore.collection("nyxUserProfiles").doc(uid).get(),
      firebase.firestore.collection("nyxUserActivity").doc(uid).get()
    ]);
    const record = nyxOwnerUserRecord(updated, administration.data(), profile.data(), activity.data(), ownerUid, true);
    res.json({
      user: record,
      access: nyxOwnerAccessPayload(actor),
      capabilities: nyxOwnerUserCapabilities(actor, record.role, uid, ownerUid)
    });
  } catch (error) {
    const status = error.code === "auth/user-not-found" ? 404 : (error.status || 503);
    res.status(status).json({ error: status === 404 ? "User not found." : (error.message || "The owner action could not be completed.") });
  }
});

app.get("/api/founder-profile", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  let profile = founderProfileDefaults;
  let persistent = false;
  try {
    const firebase = await linkGeneratorFirebase();
    if (firebase) {
      const snapshot = await firebase.firestore.collection("nyxSiteSettings").doc("founderProfile").get();
      profile = normalizeFounderProfile(snapshot.data()?.profile);
      const founderUid = founderProfileConfig().administratorUid;
      if (founderUid) {
        const founderUser = await firebase.firestore.collection("nyxUserProfiles").doc(founderUid).get();
        if (founderUser.exists) {
          const userProfile = normalizeNyxUserProfile(founderUser.data()?.profile);
          profile = normalizeFounderProfile({
            ...profile,
            displayName: userProfile.displayName,
            handle: userProfile.handle,
            bio: userProfile.bio,
            avatarUrl: userProfile.avatarUrl,
            bannerUrl: userProfile.bannerUrl,
            accent: userProfile.accentPrimary,
            accentPrimary: userProfile.accentPrimary,
            accentSecondary: userProfile.accentSecondary,
            bannerColor: userProfile.bannerColor,
            displayNameFont: userProfile.displayNameFont,
            displayNameEffect: userProfile.displayNameEffect,
            displayNameColorPrimary: userProfile.displayNameColorPrimary,
            displayNameColorSecondary: userProfile.displayNameColorSecondary,
            profileEffect: userProfile.profileEffect,
            customEffectPattern: userProfile.customEffectPattern,
            customEffectColorPrimary: userProfile.customEffectColorPrimary,
            customEffectColorSecondary: userProfile.customEffectColorSecondary,
            customEffectSpeed: userProfile.customEffectSpeed,
            customEffectIntensity: userProfile.customEffectIntensity,
            avatarDecoration: userProfile.avatarDecoration,
            status: userProfile.status
          });
        }
      }
      persistent = true;
    }
  } catch (error) {
    console.error("Nyx Founder Profile could not be read:", error?.message || error);
  }
  res.json({ profile, persistent, editingEnabled: Boolean(firebaseAdminModeConfigured() && founderProfileConfig().administratorUid) });
});

app.get("/api/founder-profile/auth-config", (_req, res) => {
  const firebase = linkGeneratorFirebaseConfig();
  res.set("Cache-Control", "no-store").json({
    enabled: firebaseAccountModeConfigured(),
    ownerConfigured: Boolean(founderProfileConfig().administratorUid),
    apiKey: firebaseAccountModeConfigured() ? firebase.webApiKey : "",
    projectId: firebaseAccountModeConfigured() ? firebase.projectId : ""
  });
});

app.get("/api/founder-profile/owner", async (req, res) => {
  const access = await verifiedFounderOwner(req);
  res.set("Cache-Control", "no-store").json(access);
});

app.get("/api/founder-profile/developer-status", async (req, res) => {
  const access = await verifiedFounderOwner(req);
  if (!access.enabled) return res.status(503).json({ error: "Founder ownership has not been configured." });
  if (!access.permissions.includes("developer-console")) return res.status(403).json({ error: "Developer Console access is required." });
  res.set("Cache-Control", "no-store").json({
    owner: access.owner,
    role: access.roleLabel,
    permissions: access.permissions,
    checkedAt: new Date().toISOString()
  });
});

app.put("/api/founder-profile", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  const config = founderProfileConfig();
  if (!config.administratorUid || !firebaseAdminModeConfigured()) {
    res.status(503).json({ error: "Founder Profile ownership has not been configured by the Nyx administrator yet." });
    return;
  }
  const access = await verifiedFounderOwner(req);
  if (!access.owner) {
    res.status(403).json({ error: "Only the signed-in founder account can publish this profile." });
    return;
  }
  const profile = normalizeFounderProfile(req.body?.profile);
  try {
    const firebase = await linkGeneratorFirebase();
    if (!firebase) throw new Error("Firebase is unavailable.");
    await firebase.firestore.collection("nyxSiteSettings").doc("founderProfile").set({
      profile,
      updatedAt: new Date().toISOString()
    });
    res.json({ profile, persistent: true });
  } catch (error) {
    console.error("Nyx Founder Profile could not be saved:", error?.message || error);
    res.status(503).json({ error: "Founder Profile could not be saved right now. Try again shortly." });
  }
});

app.get("/api/link-generator/status", (_req, res) => {
  const config = linkGeneratorConfig();
  res.set("Cache-Control", "no-store").json({
    available: Boolean(config.apiKey && config.origin && (config.accessCode || firebaseAccountModeConfigured())),
    administratorAccess: Boolean(config.accessCode),
    accountAccess: firebaseAccountModeConfigured(),
    origin: config.origin,
    freeDailyLimit: freeLinkDailyLimit,
    premiumBatchLimit: config.premiumBatchLimit,
    premiumImmediateCooldownAt,
    premiumAccumulatedLimit,
    premiumCooldownMinutes: premiumCooldownMs / 60_000
  });
});

app.get("/api/link-generator/auth-config", (_req, res) => {
  const config = linkGeneratorFirebaseConfig();
  res.set("Cache-Control", "no-store").json({
    enabled: firebaseAccountModeConfigured(),
    apiKey: firebaseAccountModeConfigured() ? config.webApiKey : ""
  });
});

app.post("/api/link-generator/validate-access", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }

  const config = linkGeneratorConfig();
  if (!config.accessCode) {
    res.status(503).json({ error: "Premium access has not been configured by the Nyx administrator yet." });
    return;
  }

  const submittedAccessCode = String(req.body?.accessCode || "");
  if (!submittedAccessCode) {
    res.status(400).json({ error: "Enter your Premium access code to continue." });
    return;
  }

  const now = Date.now();
  const rate = linkGeneratorRateState(linkGeneratorClientId(req), now);
  if (!secretMatches(submittedAccessCode, config.accessCode)) {
    rate.attempts += 1;
    if (rate.attempts > linkGeneratorMaxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((rate.windowStarted + linkGeneratorWindowMs - now) / 1000));
      res.set("Retry-After", String(retryAfter)).status(429).json({ error: "Too many incorrect access-code attempts. Try again later." });
      return;
    }
    res.status(401).json({ error: "The Premium access code is incorrect." });
    return;
  }

  rate.attempts = 0;
  res.json({ valid: true });
});

app.post("/api/link-generator/readiness", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }
  const config = linkGeneratorConfig();
  const target = generatedBunnyUrl(req.body?.url);
  if (!config.apiKey || !config.origin) {
    res.status(503).json({ error: "Link Generator has not been configured by the Nyx administrator yet." });
    return;
  }
  if (!target) {
    res.status(400).json({ error: "Only generated Nyx CDN links can be checked." });
    return;
  }
  try {
    const zonesPayload = await bunnyRequest("/pullzone?page=1&perPage=1000", config.apiKey);
    const zones = Array.isArray(zonesPayload) ? zonesPayload : Array.isArray(zonesPayload?.Items) ? zonesPayload.Items : [];
    const zone = zones.find(item => normalizedOrigin(item?.OriginUrl) === config.origin && Array.isArray(item?.Hostnames) && item.Hostnames.some(hostname => String(hostname?.Value || "").toLowerCase() === target.hostname.toLowerCase()));
    if (!zone) {
      res.status(404).json({ error: "That hostname is not a generated Nyx CDN link." });
      return;
    }
    if (zone.Suspended === true) {
      res.json({ ready: false, state: "suspended", message: "Bunny suspended this CDN link. Check the Bunny account balance and service limits." });
      return;
    }
    if (zone.Enabled === false) {
      res.json({ ready: false, state: "disabled", message: "Bunny left this CDN link disabled. Check the Bunny account balance and pull-zone limit." });
      return;
    }
    let response;
    try {
      response = await fetch(target.href, {
        headers: { Accept: "text/html", Range: "bytes=0-32767", "Cache-Control": "no-cache" },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000)
      });
    } catch {
      res.json({ ready: false, state: "provisioning", message: "Bunny is still connecting this link to Nyx." });
      return;
    }
    const sample = (await response.text()).slice(0, 40_000);
    const bunnyPlaceholder = /This server is a part of a CDN service provided by|Server Node:\s*[A-Z0-9-]+/i.test(sample);
    if (!response.ok || bunnyPlaceholder) {
      res.json({ ready: false, state: "provisioning", message: "Bunny is still provisioning this link. It will open after the CDN begins serving Nyx." });
      return;
    }
    res.json({ ready: true, state: "ready", message: "The CDN link is serving Nyx." });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.status ? error.message : `Bunny readiness check failed: ${String(error?.message || "Unknown error")}` });
  }
});

app.post("/api/link-generator", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!sameOriginRequest(req)) {
    res.status(403).json({ error: "Cross-origin requests are not allowed." });
    return;
  }

  const config = linkGeneratorConfig();
  if (!config.apiKey || !config.origin || (!config.accessCode && !firebaseAccountModeConfigured())) {
    res.status(503).json({ error: "Link Generator has not been configured by the Nyx administrator yet." });
    return;
  }

  const clientId = linkGeneratorClientId(req);
  const now = Date.now();
  const rate = linkGeneratorRateState(clientId, now);
  const submittedAccessCode = String(req.body?.accessCode || "");
  const administrator = Boolean(submittedAccessCode && config.accessCode && secretMatches(submittedAccessCode, config.accessCode));
  if (submittedAccessCode && !administrator) {
    rate.attempts += 1;
    if (rate.attempts > linkGeneratorMaxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((rate.windowStarted + linkGeneratorWindowMs - now) / 1000));
      res.set("Retry-After", String(retryAfter)).status(429).json({ error: "Too many incorrect access-code attempts. Try again later." });
      return;
    }
    res.status(401).json({ error: "The Premium access code is incorrect." });
    return;
  }

  let publicUser = null;
  try {
    if (!administrator) publicUser = await authenticatedLinkGeneratorUser(req);
  } catch (error) {
    res.status(error.status || 401).json({ error: error.message });
    return;
  }

  const premiumAccount = Boolean(publicUser?.premiumAccess);
  const premiumAccess = administrator || premiumAccount;
  const rawAmount = req.body?.amount === undefined ? 1 : Number(req.body.amount);
  const amount = premiumAccess ? rawAmount : 1;
  if (premiumAccess && (!Number.isInteger(rawAmount) || rawAmount < 1 || rawAmount > config.premiumBatchLimit)) {
    res.status(400).json({ error: `Premium batches can contain between 1 and ${config.premiumBatchLimit} links.` });
    return;
  }

  let reservation = null;
  let premiumReservation = null;
  let premiumFirebase = null;
  try {
    const zonesPayload = await bunnyRequest("/pullzone?page=1&perPage=1000", config.apiKey);
    const zones = Array.isArray(zonesPayload) ? zonesPayload : Array.isArray(zonesPayload?.Items) ? zonesPayload.Items : [];
    const generatedZones = zones.filter(zone => normalizedOrigin(zone?.OriginUrl) === config.origin);
    if (!premiumAccess && generatedZones.length >= config.maxZones) {
      res.status(409).json({ error: "The public Link Generator has reached its zone limit. Ask the Nyx administrator to remove an old generated link." });
      return;
    }

    if (publicUser && !premiumAccount) reservation = await reserveFreeLink(publicUser.firebase, publicUser.uid, clientId);
    if (premiumAccess) {
      premiumFirebase = publicUser?.firebase || await linkGeneratorFirebase();
      const premiumIdentity = premiumAccount ? `account:${publicUser.uid}` : clientId;
      premiumReservation = await reservePremiumGeneration(premiumFirebase, premiumIdentity, amount, now);
    }

    const links = [];
    let generationError = null;
    for (let index = 0; index < amount; index += 1) {
      try {
        const name = generatedPullZoneName(req.body?.label);
        const zone = await bunnyRequest("/pullzone", config.apiKey, {
          method: "POST",
          body: JSON.stringify({ Name: name, OriginUrl: config.origin })
        });
        const systemHostname = Array.isArray(zone?.Hostnames)
          ? zone.Hostnames.find(item => item?.IsSystemHostname)?.Value || zone.Hostnames[0]?.Value
          : "";
        if (!systemHostname) throw new Error("Bunny created the zone but did not return its hostname.");
        links.push({ id: zone.Id, name: zone.Name || name, url: `https://${systemHostname}` });
      } catch (error) {
        generationError = error;
        break;
      }
    }
    if (!links.length && generationError) throw generationError;
    if (premiumAccess && premiumReservation && links.length < amount) {
      premiumReservation = await adjustPremiumGeneration(premiumFirebase, premiumReservation, links.length);
    }
    const first = links[0];
    res.status(generationError ? 207 : 201).json({
      id: first.id,
      name: first.name,
      url: first.url,
      links,
      requested: amount,
      created: links.length,
      partial: Boolean(generationError),
      warning: generationError ? `Bunny stopped the batch after ${links.length} of ${amount} links: ${generationError.message}` : "",
      origin: config.origin,
      access: administrator ? "administrator" : (premiumAccount ? "premium" : "account"),
      subscriptionStatus: publicUser?.subscriptionStatus || (administrator ? "premium" : "free"),
      remaining: premiumAccess ? null : reservation?.remaining,
      premiumCooldown: premiumAccess ? {
        triggered: Boolean(premiumReservation?.cooldownTriggered),
        cooldownUntil: premiumReservation?.cooldownUntil || 0,
        accumulated: premiumReservation?.accumulated || 0,
        accumulatedLimit: premiumAccumulatedLimit,
        immediateAt: premiumImmediateCooldownAt,
        minutes: premiumCooldownMs / 60_000
      } : null
    });
  } catch (error) {
    if (publicUser && reservation) await releaseFreeLink(publicUser.firebase, reservation);
    if (premiumAccess && premiumReservation) await adjustPremiumGeneration(premiumFirebase, premiumReservation, 0);
    if (!error.status || error.status >= 500) console.error("Nyx Link Generator failed:", error?.message || error);
    if (error.retryAfter) res.set("Retry-After", String(error.retryAfter));
    res.status(error.status || 502).json({ error: error.status ? error.message : `Bunny could not create the link: ${String(error?.message || "Unknown error")}` });
  }
});
app.use(express.static(__dirname));
app.use("/uv/", express.static(uvPath));
app.use("/scramjet/", express.static(scramjetPath));
app.use("/controller/", express.static(scramjetControllerPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));

app.use("/~/sj/", (_req, res) => {
  res.status(502).type("html").send(`<!doctype html>
<meta charset="utf-8">
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101318;color:#f5f7fb;font:15px/1.45 Raleway,Arial,sans-serif}
  main{max-width:560px;padding:28px;text-align:center}
  h1{font-size:20px;margin:0 0 10px}
  p{margin:0;color:#c8ced8}
</style>
<main>
  <h1>Scramjet route missed</h1>
  <p>The Scramjet service worker did not claim this frame yet. Reload nyx and try again.</p>
</main>`);
});

app.use((req, res, next) => {
  const path = String(req.path || "");
  const shouldNotServeNyx =
    path.startsWith("/assets/") ||
    path.startsWith("/games/") ||
    path.startsWith("/images/") ||
    path.startsWith("/js/") ||
    path.startsWith("/css/") ||
    /\.(?:avif|bmp|css|gif|html?|ico|jpe?g|js|json|mjs|mp3|mp4|ogg|opus|png|svg|wasm|wav|webm|webp|woff2?|xml)$/i.test(path);
  if (!shouldNotServeNyx) {
    next();
    return;
  }
  res.status(404).type("text/plain").send("Not found");
});

app.use((_req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

export { app, externalWispUrl, normalizePublicWispUrl };

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === join(__dirname, "server.js");
if (isDirectRun) {
  const server = createServer((req, res) => app(req, res));

  server.on("upgrade", (req, socket, head) => {
    if (!externalWispUrl && req.url?.endsWith("/wisp/")) {
      wisp.routeRequest(req, socket, head);
    } else {
      socket.end();
    }
  });

  const port = Number.parseInt(process.env.PORT || "8080", 10);

  server.listen(port, "0.0.0.0", () => {
    const address = server.address();
    console.log("nyx running with Ultraviolet and Scramjet:");
    console.log(`  http://localhost:${address.port}`);
    console.log(`  http://${hostname()}:${address.port}`);
    console.log(`  wisp transport: ${externalWispUrl || "same-host /wisp/"}`);
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received; closing nyx server.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
