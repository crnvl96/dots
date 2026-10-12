import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PI_PACKAGE = "@earendil-works/pi-coding-agent";

function readPackage(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function findPackage(entry, name) {
  let directory = dirname(realpathSync(entry));
  while (true) {
    const path = join(directory, "package.json");
    try {
      const manifest = readPackage(path);
      if (manifest.name === name) return manifest;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot find package metadata for ${name}`);
    directory = parent;
  }
}

export function dependencySpecs(installRoot, nodeVersion = process.versions.node) {
  const nodeMajor = /^(?:v)?(\d+)\./.exec(nodeVersion)?.[1];
  if (!nodeMajor) throw new Error(`Invalid Node version: ${nodeVersion}`);

  // Resolve the manifest directly: mise's executable may be a shell shim,
  // and Pi's exports do not expose package.json or a CommonJS entry point.
  const piManifestPath = realpathSync(
    join(installRoot, "node_modules", PI_PACKAGE, "package.json"),
  );
  const pi = readPackage(piManifestPath);
  if (pi.name !== PI_PACKAGE || typeof pi.version !== "string") {
    throw new Error("Invalid mise-installed Pi package");
  }

  // Resolve from Pi's real package location to support isolated npm layouts.
  const typebox = findPackage(createRequire(piManifestPath).resolve("typebox"), "typebox");
  if (typeof typebox.version !== "string") throw new Error("Invalid TypeBox package version");

  return [
    `${PI_PACKAGE}@${pi.version}`,
    `@earendil-works/pi-ai@${pi.version}`,
    `@earendil-works/pi-tui@${pi.version}`,
    `typebox@${typebox.version}`,
    `@types/node@${nodeMajor}`,
  ];
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dry-run")) {
    throw new Error("Usage: node scripts/pi-deps.mjs [--dry-run]");
  }
  const root = fileURLToPath(new URL("../", import.meta.url));
  const installRoot = execFileSync("mise", ["where", `npm:${PI_PACKAGE}`], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const specs = dependencySpecs(installRoot);
  const npmArgs = ["install", "--save-dev", "--save-exact", "--include=dev", ...specs];

  console.log(`Syncing development dependencies with Pi and Node ${process.versions.node}`);
  console.log(`npm ${npmArgs.join(" ")}`);
  if (!args.includes("--dry-run")) {
    execFileSync("npm", npmArgs, { cwd: root, stdio: "inherit" });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Pi dependency sync failed: ${error.message}`);
    process.exitCode = 1;
  }
}
