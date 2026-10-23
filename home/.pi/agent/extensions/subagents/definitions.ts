import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';

export interface AgentDefinition {
  name: string;
  description: string;
  filePath: string;
  body: string;
  source: 'user' | 'project';
}

export interface AgentCatalog {
  agents: AgentDefinition[];
  diagnostics: string[];
}

const MAX_DEFINITION_BYTES = 128 * 1024;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

class InvalidNamedDefinition extends Error {
  agentName: string;
  constructor(agentName: string, message: string) {
    super(message);
    this.agentName = agentName;
  }
}

/** Reads at most the limit plus one byte, including when a file grows during discovery. */
function readDefinition(filePath: string): string {
  const fd = openSync(filePath, 'r');
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Definition is not a regular file');
    if (stat.size > MAX_DEFINITION_BYTES) throw new Error('Definition exceeds 128 KiB size limit');
    const buffer = Buffer.alloc(MAX_DEFINITION_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > MAX_DEFINITION_BYTES) throw new Error('Definition exceeds 128 KiB size limit');
    return buffer.subarray(0, size).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function parseDefinition(filePath: string, source: AgentDefinition['source']): AgentDefinition {
  const content = readDefinition(filePath).replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  if (lines[0] !== '---') throw new Error('Definition must start with a first-line --- frontmatter delimiter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('Missing closing --- frontmatter delimiter');
  // Pi's parser accepts delimiter prefixes; enforce exact lines before calling it.
  if (lines.slice(1, end).some(line => line.startsWith('---'))) {
    throw new Error('Invalid frontmatter delimiter');
  }
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(lines.slice(0, end + 1).join('\n') + '\n');
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error('Frontmatter must be a YAML mapping');
  }
  const { name, description } = frontmatter;
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('name must be a nonempty kebab-case string starting with a letter (at most 64 characters)');
  }
  const unsupported = Object.keys(frontmatter).filter(key => !['name', 'description', 'model'].includes(key)).sort(compare);
  if (unsupported.length) throw new InvalidNamedDefinition(name, `Unsupported frontmatter fields: ${unsupported.join(', ')}; only name, description, and model: inherit are supported`);
  if (Object.hasOwn(frontmatter, 'model') && frontmatter.model !== 'inherit') {
    throw new InvalidNamedDefinition(name, 'Unsupported frontmatter model; only model: inherit is supported');
  }
  if (typeof description !== 'string' || !description.trim()) throw new InvalidNamedDefinition(name, 'description must be a nonempty string');
  const body = lines.slice(end + 1).join('\n').trim();
  if (!body) throw new InvalidNamedDefinition(name, 'Definition body must not be empty');
  return { name, description: description.trim(), filePath, body, source };
}

/** Nearest repository boundary, including worktrees whose .git is a file. */
function projectDirectories(cwd: string, diagnostics: string[]): string[] {
  const directories: string[] = [];
  for (let directory = cwd; ; directory = dirname(directory)) {
    directories.push(directory);
    try {
      const git = lstatSync(join(directory, '.git'));
      if (git.isDirectory() || git.isFile() || git.isSymbolicLink()) return directories;
    } catch (error) {
      if (!missing(error)) diagnostics.push(`${join(directory, '.git')}: ${errorText(error)}`);
    }
    if (dirname(directory) === directory) return [cwd];
  }
}

/** Fresh synchronous discovery only: this never executes a definition or caches its contents. */
export function discoverAgents({ cwd, homeDir = homedir(), projectTrusted = true }: {
  cwd: string;
  homeDir?: string;
  projectTrusted?: boolean;
}): AgentCatalog {
  const diagnostics: string[] = [];
  const selected = new Map<string, AgentDefinition>();
  // A recognizable but invalid higher-priority definition must not silently
  // turn into a different, lower-priority agent of the same name.
  const blockedNames = new Set<string>();
  const seenFiles = new Set<string>();
  // Highest priority first is important: the same real file may occur at both
  // project and user paths through symlinks.
  const locations: { directory: string; source: AgentDefinition['source'] }[] = [
    ...(projectTrusted ? projectDirectories(resolve(cwd), diagnostics).map(directory => ({ directory, source: 'project' as const })) : []),
    { directory: resolve(homeDir), source: 'user' },
  ];
  for (const { directory, source } of locations) {
    const root = join(directory, '.agents', 'agents');
    const seenDirectories = new Set<string>();
    const namesAtPriority = new Map<string, string>();
    const visit = (path: string, isRoot = false) => {
      try {
        // Only absent roots are silent; dangling symlinks and disappearing
        // entries inside an existing root are actionable I/O diagnostics.
        if (isRoot) {
          try { lstatSync(path); } catch (error) { if (missing(error)) return; throw error; }
        }
        const canonical = realpathSync(path);
        const stat = statSync(canonical);
        if (stat.isDirectory()) {
          if (seenDirectories.has(canonical)) return;
          seenDirectories.add(canonical);
          for (const entry of readdirSync(path).sort(compare)) visit(join(path, entry));
        } else if (extname(path).toLowerCase() === '.md') {
          if (!stat.isFile()) throw new Error('Definition is not a regular file');
          if (seenFiles.has(canonical)) return;
          seenFiles.add(canonical);
          const definition = parseDefinition(canonical, source);
          const duplicate = namesAtPriority.get(definition.name);
          if (duplicate) {
            diagnostics.push(`${path}: duplicate agent name "${definition.name}" at the same priority; first definition: ${duplicate}`);
            return;
          }
          namesAtPriority.set(definition.name, canonical);
          if (!selected.has(definition.name) && !blockedNames.has(definition.name)) selected.set(definition.name, definition);
        } else if (isRoot) {
          throw new Error('Agent discovery root is not a directory');
        }
      } catch (error) {
        if (error instanceof InvalidNamedDefinition) {
          blockedNames.add(error.agentName);
          if (!namesAtPriority.has(error.agentName)) namesAtPriority.set(error.agentName, path);
          diagnostics.push(`${path}: ${errorText(error)}; agent "${error.agentName}" will not fall back to a lower-priority definition`);
        } else {
          const limitation = extname(path).toLowerCase() === '.md'
            ? '; could not determine a valid agent name, so a lower-priority definition may still be available'
            : '';
          diagnostics.push(`${path}: ${errorText(error)}${limitation}`);
        }
      }
    };
    visit(root, true);
  }
  return { agents: [...selected.values()].sort((a, b) => compare(a.name, b.name)), diagnostics };
}

export function definitionPrompt(definition: AgentDefinition): string {
  const filePath = resolve(definition.filePath);
  return `Named agent: ${definition.name}\nSource file: ${filePath}\nBase directory: ${dirname(filePath)}\nResolve relative file references in these instructions against that base directory.\n\n${definition.body}`;
}
