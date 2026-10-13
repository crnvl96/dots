import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { expandHome } from "./normalization.js";

function findNearestSkillDirs(cwd: string): string[] {
  const directories: string[] = [];
  let current = cwd;
  while (true) {
    directories.push(path.join(current, CONFIG_DIR_NAME, "skills"));
    directories.push(path.join(current, ".agents", "skills"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

function parseSkillName(content: string): string | undefined {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] ?? content.slice(0, 2048);
  return frontmatter.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim();
}

function resolveSkillPath(skill: string, cwd: string): string {
  const expanded = expandHome(skill);
  if (path.isAbsolute(expanded) || expanded.startsWith(".")) {
    const candidate = path.resolve(cwd, expanded);
    if (fs.existsSync(candidate)) return candidate;
    throw new Error(`Skill path not found: ${skill}`);
  }
  const npmRoot = path.join(getAgentDir(), "npm", "node_modules");
  const roots = [path.join(getAgentDir(), "skills"), path.join(os.homedir(), ".agents", "skills"), ...findNearestSkillDirs(cwd), npmRoot];
  for (const root of roots) {
    const directDirectory = path.join(root, skill);
    if (fs.existsSync(path.join(directDirectory, "SKILL.md"))) return directDirectory;
    const directMarkdown = path.join(root, `${skill}.md`);
    if (fs.existsSync(directMarkdown)) return directMarkdown;
  }
  const stack = fs.existsSync(npmRoot) ? [npmRoot] : [];
  while (stack.length) {
    const directory = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    const skillFile = path.join(directory, "SKILL.md");
    if (fs.existsSync(skillFile)) {
      try {
        if (parseSkillName(fs.readFileSync(skillFile, "utf8")) === skill) return directory;
      } catch {}
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" && directory !== npmRoot) continue;
      stack.push(path.join(directory, entry.name));
    }
  }
  throw new Error(`Skill not found: ${skill}`);
}

export function resolveSkillPaths(skills: string[] | undefined, cwd: string, loadedSkillPaths?: Record<string, string>): string[] | undefined {
  return skills?.map((skill) => loadedSkillPaths?.[skill] ?? resolveSkillPath(skill, cwd));
}

function looksLikePath(value: string): boolean {
  return value === "~" || value.startsWith("~/") || value.startsWith(".") || path.isAbsolute(value);
}

function resolveExtensionPath(extension: string, cwd: string): string {
  // Pi 1.x built-in extensions are explicit resource identifiers, not npm packages.
  if (extension.startsWith("builtin:")) return extension;
  if (looksLikePath(extension)) {
    const expanded = expandHome(extension);
    const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
    if (!fs.existsSync(resolved)) throw new Error(`Extension path not found: ${extension}`);
    return resolved;
  }
  const candidates = [
    path.join(cwd, CONFIG_DIR_NAME, "npm", "node_modules", extension),
    path.join(getAgentDir(), "npm", "node_modules", extension),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) throw new Error(`Installed extension package not found: ${extension}. Install it with pi install first.`);
  return resolved;
}

export function resolveExtensionPaths(extensions: string[] | undefined, cwd: string): string[] | undefined {
  return extensions?.map((extension) => resolveExtensionPath(extension, cwd));
}
