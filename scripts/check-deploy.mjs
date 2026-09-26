import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "index.html",
  "server.js",
  "script.js",
  "startup.js",
  "styles.css",
  "uv.config.js",
  "uv.sw.js",
  "scramjet.sw.js",
  "js/loading-screen.js",
  "css/core.css",
  "css/chrome-and-settings.css",
  "css/fresh-theme.css",
  "css/interface-polish.css",
  "css/midnight-theme.css",
  "apps/link-checker/index.html",
  "apps/link-checker/styles.css",
  "apps/link-checker/app.js",
  "apps/utility-shell.css",
  "apps/link-generator/index.html",
  "apps/link-generator/styles.css",
  "apps/link-generator/app.js",
  "assets/games/index.html",
  "assets/ugs/play.html",
  "deploy/nginx/nyx.conf.template",
  "deploy/systemd/nyx.service.template",
  "deploy/nyx.env.example",
  "deploy/setup-ovh.sh"
];

const missing = [];
for (const file of requiredFiles) {
  try {
    await access(file);
  } catch {
    missing.push(file);
  }
}

if (missing.length) {
  console.error("Deployment is missing required files:");
  missing.forEach(file => console.error(`  - ${file}`));
  console.error("Add and commit these files before deploying.");
  process.exit(1);
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
for (const dependency of ["express", "firebase-admin", "@mercuryworkshop/wisp-js"]) {
  if (!packageJson.dependencies?.[dependency]) {
    console.error(`Deployment dependency is missing: ${dependency}`);
    process.exit(1);
  }
}

console.log(`Deployment check passed (${requiredFiles.length} required files found).`);
