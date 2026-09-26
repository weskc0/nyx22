import { createServer } from "node:http";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const port = Number.parseInt(process.env.PORT || "8080", 10);
const configuredAllowedOrigins = String(process.env.NYX_ALLOWED_ORIGINS || "")
  .split(",")
  .map(value => value.trim().replace(/\/$/, ""))
  .filter(Boolean);
const canonicalAllowedOrigins = [
  process.env.NYX_PUBLIC_ORIGIN,
  "https://nyxlearning.org",
  "https://www.nyxlearning.org",
  "https://nyxlearning.netlify.app"
]
  .map(value => String(value || "").trim().replace(/\/$/, ""))
  .filter(Boolean);
const allowedOrigins = [...new Set([...configuredAllowedOrigins, ...canonicalAllowedOrigins])];
const presenceSessions = new Map();
const presenceTtlMs = 45_000;

wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
wisp.options.allow_direct_ip = true;
wisp.options.allow_udp_streams = false;
wisp.options.port_whitelist = [80, 443];
wisp.options.dns_method = "lookup";
wisp.options.dns_result_order = "ipv4first";
// wisp-js 0.4.1 stores streams in an object, but its per-host limiter tries
// to iterate that object directly and crashes the process on the first stream.
// Keep the working total limit below and leave the broken per-host path off.
wisp.options.stream_limit_per_host = -1;
wisp.options.stream_limit_total = 64;
wisp.options.wisp_motd = "Nyx Railway Wisp";

function originAllowed(origin) {
  if (!allowedOrigins.length || allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(String(origin || "").replace(/\/$/, ""));
}

function rejectUpgrade(socket, status = "403 Forbidden") {
  try {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

function prunePresence(now = Date.now()) {
  for (const [sessionId, lastSeen] of presenceSessions) {
    if (now - lastSeen > presenceTtlMs) presenceSessions.delete(sessionId);
  }
  return presenceSessions.size;
}

function applyPresenceCors(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (origin && originAllowed(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("cache-control", "no-store");
}

function sendPresence(res, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ online: prunePresence(), ttl: presenceTtlMs }));
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/presence") {
    applyPresenceCors(req, res);
    const origin = String(req.headers.origin || "").replace(/\/$/, "");
    if (origin && !originAllowed(origin)) {
      sendPresence(res, 403);
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET") {
      sendPresence(res);
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => {
        body += chunk;
        if (body.length > 1024) req.destroy();
      });
      req.on("end", () => {
        try {
          const sessionId = String(JSON.parse(body || "{}").sessionId || "");
          if (!/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId)) {
            sendPresence(res, 400);
            return;
          }
          presenceSessions.set(sessionId, Date.now());
          sendPresence(res);
        } catch {
          sendPresence(res, 400);
        }
      });
      return;
    }
    sendPresence(res, 405);
    return;
  }
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({
      ok: true,
      service: "nyx-wisp",
      online: prunePresence(),
      originsRestricted: allowedOrigins.length > 0,
      dnsResultOrder: wisp.options.dns_result_order
    }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end("Nyx Wisp is running. WebSocket endpoint: /wisp/\n");
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/wisp/") {
    rejectUpgrade(socket, "404 Not Found");
    return;
  }
  if (!originAllowed(req.headers.origin)) {
    rejectUpgrade(socket);
    return;
  }
  wisp.routeRequest(req, socket, head);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Nyx Wisp listening on 0.0.0.0:${port}`);
  console.log(`Outbound DNS result order: ${wisp.options.dns_result_order}`);
  console.log(allowedOrigins.length ? `Allowed origins: ${allowedOrigins.join(", ")}` : "Warning: NYX_ALLOWED_ORIGINS is empty; all browser origins are currently allowed.");
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; closing Wisp server.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
