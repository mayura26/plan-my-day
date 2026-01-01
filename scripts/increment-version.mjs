import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const VERSION_FILE = join(process.cwd(), "VERSION");
const VERSION_JSON = join(process.cwd(), "public", "version.json");

function getCurrentVersion() {
  try {
    const versionContent = readFileSync(VERSION_FILE, "utf-8").trim();
    return versionContent || "1";
  } catch {
    try {
      const versionData = JSON.parse(readFileSync(VERSION_JSON, "utf-8"));
      return versionData.version || "1";
    } catch {
      return "1";
    }
  }
}

function incrementVersion(version) {
  const parts = version.split(".");
  if (parts.length === 1) {
    // Simple integer version
    return String(parseInt(parts[0], 10) + 1);
  } else {
    // Semantic versioning - increment patch
    const major = parseInt(parts[0], 10) || 0;
    const minor = parseInt(parts[1], 10) || 0;
    const patch = parseInt(parts[2], 10) || 0;
    return `${major}.${minor}.${patch + 1}`;
  }
}

const currentVersion = getCurrentVersion();
const newVersion = incrementVersion(currentVersion);

// Write to both files
writeFileSync(VERSION_FILE, newVersion + "\n", "utf-8");
writeFileSync(VERSION_JSON, JSON.stringify({ version: newVersion }, null, 2) + "\n", "utf-8");

console.log(`Version incremented: ${currentVersion} → ${newVersion}`);

