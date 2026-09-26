import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const legacyName = /good[ -]?lion/i;
const trackedFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);
const failures = [];

for (const file of trackedFiles) {
  if (legacyName.test(file)) {
    failures.push(`${file} (filename)`);
    continue;
  }
  try {
    const data = await readFile(file);
    if (data.includes(0)) continue;
    if (legacyName.test(data.toString("utf8"))) failures.push(`${file} (contents)`);
  } catch {}
}

if (failures.length) {
  console.error("Legacy branding remains:");
  failures.forEach(file => console.error(`  - ${file}`));
  process.exit(1);
}

console.log(`Nyx branding check passed (${trackedFiles.length} tracked files checked).`);
