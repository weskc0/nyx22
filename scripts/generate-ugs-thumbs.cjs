const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const gamesPath = path.join(root, 'assets', 'ugs', 'games.json');
const thumbsDir = path.join(root, 'assets', 'ugs', 'thumbs');
const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const games = JSON.parse(fs.readFileSync(gamesPath, 'utf8'));
const limit = Number(process.argv[2] || games.length);

fs.mkdirSync(thumbsDir, { recursive: true });

function thumbName(gamePath) {
  return gamePath.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() + '.png';
}

function fileUrl(filePath) {
  return 'file:///' + filePath.replace(/\\/g, '/').replace(/#/g, '%23');
}

function writeFallback() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="236" viewBox="0 0 420 236">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#18233a"/><stop offset="1" stop-color="#334155"/></linearGradient>
</defs>
<rect width="420" height="236" fill="url(#g)"/>
<path d="M34 178 C92 102 130 122 165 88 C211 43 284 61 336 26 L386 26 L386 210 L34 210 Z" fill="#67e8f9" opacity=".16"/>
<text x="210" y="107" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="900" fill="#f8fafc">Pirate Cove</text>
<text x="210" y="139" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="#cbd5e1">Game preview</text>
</svg>`;
  fs.writeFileSync(path.join(thumbsDir, 'fallback.svg'), svg);
}

function runEdge(args, timeoutMs = 10000) {
  return new Promise(resolve => {
    const child = spawn(edgePath, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, timeoutMs);
    child.on('exit', code => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function capture(game, index) {
  const htmlPath = path.join(root, 'assets', 'ugs', game.path);
  const outPath = path.join(thumbsDir, thumbName(game.path));
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return 'skip';
  if (!fs.existsSync(htmlPath)) return 'missing';
  const profile = path.join(os.tmpdir(), 'nyx-edge-profile-' + process.pid + '-' + index);
  const ok = await runEdge([
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--window-size=420,236',
    '--virtual-time-budget=2500',
    '--user-data-dir=' + profile,
    '--screenshot=' + outPath,
    fileUrl(htmlPath),
  ], 12000);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  } catch {}
  return ok && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000 ? 'ok' : 'fail';
}

(async () => {
  writeFallback();
  let made = 0;
  let checked = 0;
  for (let i = 0; i < games.length && checked < limit; i++) {
    checked++;
    const status = await capture(games[i], i);
    if (status === 'ok') made++;
    console.log(`${checked}/${Math.min(limit, games.length)} ${status} ${games[i].title}`);
  }
  console.log(`Done. Created ${made} new thumbnails in ${path.relative(root, thumbsDir)}.`);
})();
