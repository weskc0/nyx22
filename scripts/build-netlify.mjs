import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const output = join(root, "dist");
const require = createRequire(import.meta.url);
const maxStaticFileBytes = 10_000_000;
const rootFiles = new Set([
  "index.html",
  "ai.html",
  "nyx-singlefile.html",
  "app.webmanifest",
  "script.js",
  "startup.js",
  "startup-studyhub.html",
  "styles.css",
  "uv.config.js",
  "uv.sw.js",
  "scramjet.sw.js"
]);
const staticPrefixes = ["apps/", "assets/", "css/", "js/"];
const blockedExtensions = /\.(?:7z|avi|mkv|mov|mp4|rar|webm|zip)$/i;
const skippedLargeFiles = [];
const remotelyHostedUgsGames = new Set([
  "minecraft/Dragonxclient.html",
  "minecraft/EaglercraftL_1.9_v0_7_0_Offline_Signed.html",
  "minecraft/EaglercraftX 1.8.8(u29).html",
  "minecraft/EaglercraftZ_1.11.2.html",
  "minecraft/eaglercraft.1.5.2.html"
]);

function normalizeWispUrl(value) {
  const raw = String(value || "").trim();
  const url = new URL(raw || "wss://nyx-temporary-production.up.railway.app/wisp/");
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (!new Set(["ws:", "wss:"]).has(url.protocol)) throw new Error("WISP_URL must use ws:// or wss://");
  if (!url.pathname || url.pathname === "/") url.pathname = "/wisp/";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.href;
}

function repositoryFiles() {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "buffer"
  });
  if (result.status !== 0) throw new Error(`Unable to list repository files: ${result.stderr?.toString() || "git failed"}`);
  return result.stdout.toString("utf8").split("\0").filter(Boolean).map(path => path.replaceAll("\\", "/"));
}

function isStaticSource(path) {
  return rootFiles.has(path) || staticPrefixes.some(prefix => path.startsWith(prefix));
}

async function copyRepositoryStaticFiles() {
  for (const relative of repositoryFiles()) {
    if (!isStaticSource(relative) || blockedExtensions.test(relative)) continue;
    const source = join(root, ...relative.split("/"));
    let info;
    try {
      info = await stat(source);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (info.size > maxStaticFileBytes) {
      skippedLargeFiles.push(relative);
      continue;
    }
    const destination = join(output, ...relative.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}

async function copyProxyRuntimes() {
  const { uvPath } = require("@titaniumnetwork-dev/ultraviolet");
  const { baremuxPath } = require("@mercuryworkshop/bare-mux/node");
  const { scramjetPath } = require("@mercuryworkshop/scramjet/path");
  const controller = dirname(require.resolve("@mercuryworkshop/scramjet-controller"));
  const epoxy = join(dirname(require.resolve("@mercuryworkshop/epoxy-transport")), "..", "dist");
  const libcurl = dirname(require.resolve("@mercuryworkshop/libcurl-transport"));
  for (const [source, destination] of [
    [uvPath, "uv"],
    [baremuxPath, "baremux"],
    [scramjetPath, "scramjet"],
    [controller, "controller"],
    [epoxy, "epoxy"],
    [libcurl, "libcurl"]
  ]) {
    await cp(source, join(output, destination), { recursive: true, force: true });
  }
}

async function copyEruda() {
  const source = require.resolve("eruda");
  const destination = join(output, "assets", "vendor", "eruda.min.js");
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: true });
}

async function waitForLocalServer(child) {
  return new Promise((resolveReady, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Timed out starting the build server.\n${log}`)), 20_000);
    child.stdout.on("data", chunk => {
      log += chunk.toString();
      const match = log.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolveReady(Number(match[1]));
      }
    });
    child.stderr.on("data", chunk => { log += chunk.toString(); });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Build server exited with code ${code}.\n${log}`));
    });
  });
}

async function writePatchedRuntimes(wispUrl) {
  const child = spawn(process.execPath, [join(root, "server.js")], {
    cwd: root,
    env: { ...process.env, PORT: "0", WISP_URL: wispUrl },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const port = await waitForLocalServer(child);
    const routes = new Map([
      ["/runtime-config.js", "runtime-config.js"],
      ["/uv/uv.handler.js", "uv/uv.handler.js"],
      ["/uv/uv.bundle.js", "uv/uv.bundle.js"],
      ["/baremux/index.mjs", "baremux/index.mjs"],
      ["/scramjet/scramjet.js", "scramjet/scramjet.js"],
      ["/nyx-scramjet-runtime-guard.js", "nyx-scramjet-runtime-guard.js"]
    ]);
    for (const [route, destination] of routes) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`${route} returned ${response.status}`);
      const target = join(output, ...destination.split("/"));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await response.arrayBuffer()));
    }
  } finally {
    child.kill("SIGTERM");
  }
}

async function configureUv(wispUrl) {
  const path = join(output, "uv.config.js");
  const source = await readFile(path, "utf8");
  const configured = source.replace(
    /bare:\s*[\s\S]*?,\s*encodeUrl:/,
    `bare: ${JSON.stringify(wispUrl)},\n  encodeUrl:`
  );
  if (configured === source) throw new Error("Could not set the Netlify Wisp URL in uv.config.js");
  await writeFile(path, configured);
}

async function removeUnavailableUgsEntries() {
  const catalogPath = join(output, "assets", "ugs", "games.json");
  let games;
  try {
    games = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
    return;
  }
  const available = [];
  for (const game of games) {
    const gamePath = String(game?.path || "").replaceAll("\\", "/");
    if (!gamePath || gamePath.includes("..")) continue;
    if (remotelyHostedUgsGames.has(gamePath)) {
      available.push(game);
      continue;
    }
    try {
      const info = await stat(join(output, "assets", "ugs", ...gamePath.split("/")));
      if (info.isFile()) available.push(game);
    } catch {}
  }
  await writeFile(catalogPath, JSON.stringify(available));
  console.log(`UGS catalog: ${available.length}/${games.length} deployable games`);
}

async function writeNetlifyFiles() {
  await writeFile(join(output, "404.html"), "<!doctype html><meta charset=\"utf-8\"><title>Not found</title><p>Not found</p>\n");
}

async function main() {
  const wispUrl = normalizeWispUrl(process.env.WISP_URL);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await copyRepositoryStaticFiles();
  await copyEruda();
  await copyProxyRuntimes();
  await writePatchedRuntimes(wispUrl);
  await configureUv(wispUrl);
  await removeUnavailableUgsEntries();
  await writeNetlifyFiles();
  console.log(`Netlify build ready in ${output}`);
  console.log(`Wisp endpoint: ${wispUrl}`);
  if (skippedLargeFiles.length) {
    console.warn(`Skipped ${skippedLargeFiles.length} static files over Netlify's 10 MB recommendation:`);
    for (const path of skippedLargeFiles) console.warn(`  - ${path}`);
  }
}

await main();
