importScripts("/uv/uv.bundle.js");
importScripts("/uv.config.js");
importScripts("/uv/uv.sw.js");

const uv = new UVServiceWorker();
const UV_ASSET_RETRY_DELAYS = [0, 180, 520];

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

function proxiedSourceUrl(requestUrl) {
  try {
    const url = new URL(requestUrl);
    const prefix = self.__uv$config?.prefix || "/service/";
    if (!url.pathname.startsWith(prefix)) return "";
    return self.__uv$config.decodeUrl(url.pathname.slice(prefix.length));
  } catch {
    return "";
  }
}

function shouldNeutralizeUvScript(event) {
  if (!["script", "worker", "sharedworker"].includes(event.request.destination)) return false;
  try {
    const source = new URL(proxiedSourceUrl(event.request.url));
    return source.hostname.endsWith("cookielaw.org") ||
      source.hostname.endsWith("onetrust.com");
  } catch {
    return false;
  }
}

function emptyNeutralizedScriptResponse(event) {
  const accept = event.request.headers.get("accept") || "";
  const path = new URL(event.request.url).pathname;
  const looksLikeScript = /\.(?:js|mjs|cjs|jq|hs|ohs)(?:$|[/?#])/i.test(path);
  if (["script", "worker", "sharedworker"].includes(event.request.destination) || /javascript|ecmascript/i.test(accept) || looksLikeScript) {
    return new Response("", {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
  return null;
}

function uvRequestIsStyle(event) {
  if (event.request.destination === "style") return true;
  const accept = event.request.headers.get("accept") || "";
  if (/text\/css/i.test(accept)) return true;
  try {
    return /\.css(?:$|[/?#])/i.test(new URL(proxiedSourceUrl(event.request.url)).pathname);
  } catch {
    return false;
  }
}

function uvRequestIsScript(event) {
  if (["script", "worker", "sharedworker"].includes(event.request.destination)) return true;
  const accept = event.request.headers.get("accept") || "";
  if (/javascript|ecmascript/i.test(accept)) return true;
  try {
    return /\.(?:js|mjs|cjs|jq|hs|ohs)(?:$|[/?#])/i.test(new URL(proxiedSourceUrl(event.request.url)).pathname);
  } catch {
    return false;
  }
}

function uvRequestIsRetryableAsset(event) {
  return uvRequestIsStyle(event) || uvRequestIsScript(event);
}

function uvResponseHasAssetMimeError(response) {
  const contentType = response?.headers?.get("content-type") || "";
  return /text\/html|application\/json|text\/json/i.test(contentType);
}

async function uvFetchWithAssetRetry(event) {
  if (!uvRequestIsRetryableAsset(event)) return uv.fetch(event);
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < UV_ASSET_RETRY_DELAYS.length; attempt += 1) {
    const delay = UV_ASSET_RETRY_DELAYS[attempt];
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      lastResponse = await uv.fetch(event);
      lastError = null;
      if (lastResponse.status < 400 && !uvResponseHasAssetMimeError(lastResponse)) {
        return lastResponse;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error("UV asset request failed");
}

function uvRequestExpectsAsset(event) {
  const accept = event.request.headers.get("accept") || "";
  const path = new URL(event.request.url).pathname;
  let sourcePath = "";
  try {
    sourcePath = new URL(proxiedSourceUrl(event.request.url)).pathname;
  } catch {}
  return ["script", "worker", "sharedworker", "style"].includes(event.request.destination)
    || /javascript|ecmascript|text\/css/i.test(accept)
    || /\.(?:js|mjs|cjs|css|jq|hs|ohs)(?:$|[/?#])/i.test(path)
    || /\.(?:js|mjs|cjs|css|jq|hs|ohs)(?:$|[/?#])/i.test(sourcePath);
}

function badAssetBody(text) {
  return /^\s*</.test(text) || /^\s*\)\]\}'/.test(text) || /^\s*\)\]/.test(text);
}

async function nyxUvFetch(event) {
  if (shouldNeutralizeUvScript(event)) {
    return emptyNeutralizedScriptResponse(event);
  }
  const response = await uvFetchWithAssetRetry(event);
  if (response.status >= 400) {
    try {
      console.warn("[nyx UV upstream error]", response.status, event.request.method, proxiedSourceUrl(event.request.url) || event.request.url);
    } catch {}
  }
  const contentType = response.headers.get("content-type") || "";
  const expectsAsset = uvRequestExpectsAsset(event);
  const badAssetMime = expectsAsset
    && (contentType.includes("text/html") || contentType.includes("application/json") || contentType.includes("text/json"));
  if (expectsAsset && badAssetMime) {
    return Response.error();
  }
  if (expectsAsset && response.status >= 400) {
    return response;
  }
  if (expectsAsset) {
    const text = await response.clone().text().catch(() => "");
    if (badAssetBody(text)) {
      return Response.error();
    }
  }
  if (!["document", "iframe", "frame"].includes(event.request.destination)) {
    return response;
  }
  return response;
}

self.addEventListener("fetch", event => {
  event.respondWith(nyxUvFetch(event).catch(() => Response.error()));
});
