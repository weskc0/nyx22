const port = Number(process.env.CDP_PORT || 9231);
const base = `http://localhost:${port}`;
const nyx = process.env.NYX_URL || "http://localhost:8080/";
const browserMode = process.env.BROWSER_MODE || "auto";
const transport = process.env.TRANSPORT || "epoxy";
const allApps = [
  ["Lion AI", "#lion-ai"],
  ["YouTube", "https://www.youtube.com/"],
  ["Games", "assets/games/index.html"],
  ["GeForce Now", "https://play.geforcenow.com/"],
  ["Roblox", "https://www.roblox.com/"],
  ["Discord", "https://discord.com/app"],
  ["Spotify", "https://open.spotify.com/"],
  ["Music", "https://traxmojo.com/"],
  ["Google", "https://www.google.com/"],
  ["Google Drive", "https://drive.google.com/"],
  ["Study", "https://docs.google.com/document/d/180tBipQWefvmr0Mt61vnWqR0z4ill1hKVlOjNHeaGuI/edit?tab=t.0"],
  ["ClassLink", "https://www.classlink.com/"],
  ["Duck AI", "https://duck.ai/"],
  ["Wikipedia", "https://www.wikipedia.org/"],
  ["Cineby", "https://cineby.sc/"],
  ["TikTok", "https://www.tiktok.com/"],
  ["Instagram", "https://www.instagram.com/"],
  ["Snapchat", "https://www.snapchat.com/"],
  ["Amazon", "https://www.amazon.com/"],
  ["Reddit", "https://www.reddit.com/"],
  ["Twitter", "https://x.com/"],
  ["TCGPlayer", "https://www.tcgplayer.com/"],
  ["CPS Test", "https://cpstest.org/"],
  ["Chess.com", "https://www.chess.com/"],
  ["Animex", "https://animex.one/"],
  ["AI", "https://chatgpt.com/"]
];
const requested = new Set(String(process.env.AUDIT_APPS || "").split(",").map(name => name.trim()).filter(Boolean));
const apps = requested.size ? allApps.filter(([name]) => requested.has(name)) : allApps;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function newPage() {
  const response = await fetch(`${base}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  if (!response.ok) throw new Error(`CDP new target failed: ${response.status}`);
  return response.json();
}

async function closePage(id) {
  await fetch(`${base}/json/close/${id}`).catch(() => {});
}

function cdp(wsUrl) {
  let nextId = 1;
  const callbacks = new Map();
  const listeners = new Map();
  const ws = new WebSocket(wsUrl);
  ws.addEventListener("message", event => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const { resolve, reject } = callbacks.get(data.id);
      callbacks.delete(data.id);
      data.error ? reject(new Error(data.error.message || JSON.stringify(data.error))) : resolve(data.result);
      return;
    }
    const set = listeners.get(data.method);
    if (set) for (const fn of set) fn(data.params || {});
  });
  return {
    ready: new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => callbacks.set(id, { resolve, reject }));
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
    },
    close() {
      ws.close();
    }
  };
}

function textFromArgs(args = []) {
  return args.map(arg => arg.value ?? arg.description ?? "").join(" ");
}

async function auditApp(name, url) {
  const target = await newPage();
  const page = cdp(target.webSocketDebuggerUrl);
  await page.ready;
  const errors = [];
  const addError = (kind, text) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean && !errors.some(item => item.kind === kind && item.text === clean)) {
      errors.push({ kind, text: clean.slice(0, 500) });
    }
  };
  page.on("Runtime.consoleAPICalled", params => {
    if (["error", "warning", "assert"].includes(params.type)) addError(`console.${params.type}`, textFromArgs(params.args));
  });
  page.on("Runtime.exceptionThrown", params => {
    const details = params.exceptionDetails || {};
    addError("exception", [
      details.text,
      details.exception?.description,
      details.url ? `${details.url}:${details.lineNumber}:${details.columnNumber}` : ""
    ].filter(Boolean).join(" "));
  });
  page.on("Log.entryAdded", params => {
    if (["error", "warning"].includes(params.entry?.level)) addError(`log.${params.entry.level}`, params.entry.text);
  });
  page.on("Network.loadingFailed", params => {
    if (params.errorText && !/net::ERR_ABORTED/.test(params.errorText)) addError("network", `${params.errorText} ${params.blockedReason || ""} ${params.type || ""}`);
  });
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Network.enable");
  await page.send("Page.enable");
  await page.send("Page.navigate", { url: nyx });
  await delay(1000);
  await page.send("Runtime.evaluate", {
    expression: `
      localStorage.setItem('nyx.browserMode',${JSON.stringify(browserMode)});
      localStorage.setItem('nyx.transport',${JSON.stringify(transport)});
      localStorage.setItem('nyx.browserShellMode','true');
      true;
    `
  });
  await page.send("Page.reload", { ignoreCache: true });
  await delay(1500);
  await page.send("Runtime.evaluate", {
    expression: `
      (() => {
        const url = ${JSON.stringify(url)};
        if (url === '#lion-ai') {
          const btn = document.createElement('button');
          btn.dataset.open = 'lionai';
          document.body.appendChild(btn);
          btn.click();
          return 'clicked-lionai';
        }
        const btn = document.createElement('button');
        btn.dataset.appUrl = url;
        btn.textContent = 'audit';
        document.body.appendChild(btn);
        btn.click();
        return 'clicked-app';
      })();
    `
  });
  await delay(name === "GeForce Now" ? 7000 : 3500);
  page.close();
  await closePage(target.id);
  return { name, url, errors };
}

const results = [];
for (const [name, url] of apps) {
  console.log(`AUDIT ${name}`);
  results.push(await auditApp(name, url));
}

const failing = results.filter(result => result.errors.length);
console.log(JSON.stringify({ checked: results.length, failing }, null, 2));
