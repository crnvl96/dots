import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const DOCS = fileURLToPath(new URL('../docs/', import.meta.url));
const markdown = new MarkdownIt({ html: false });
const escape = markdown.utils.escapeHtml;
/** @param {string} path */
const href = (path) => `/${path.split('/').map(encodeURIComponent).join('/')}`;

// Give headings stable anchors, including distinct IDs for repeated headings.
markdown.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  const text = tokens[index + 1].content;
  const slug =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';
  env ??= {};
  const ids = env.ids instanceof Set ? env.ids : (env.ids = new Set());
  let id = slug;
  for (let count = 1; ids.has(id); count++) id = `${slug}-${count}`;
  ids.add(id);
  tokens[index].attrSet('id', id);
  return renderer.renderToken(tokens, index, options);
};

/**
 * @param {string} root
 * @returns {string[]}
 */
function documents(root, directory = '') {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return documents(root, path);
      // Do not follow file or directory symlinks.
      return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
    })
    .sort();
}

/**
 * @param {string} title
 * @param {string} body
 */
function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>
body { font-family: sans-serif; line-height: 1.5; margin: 2rem; }
nav { border-bottom: 1px solid #aaa; padding-bottom: 1rem; }
pre { background: #eee; padding: 1rem; overflow: auto; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid #aaa; padding: .5rem; text-align: left; vertical-align: top; }
</style></head><body>${body}</body></html>`;
}

/** @param {string[]} files */
function indexPage(files) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const file of files) {
    const folder = dirname(file);
    const entries = groups.get(folder) ?? [];
    entries.push(file);
    groups.set(folder, entries);
  }
  const sections = [...groups]
    .map(
      ([folder, entries]) =>
        `<section><h2>${escape(folder === '.' ? 'Documents' : folder)}</h2><ul>${entries
          .map(
            (file) =>
              `<li><a href="${href(file)}">${escape(file.slice(folder === '.' ? 0 : folder.length + 1))}</a></li>`,
          )
          .join('')}</ul></section>`,
    )
    .join('');
  return layout('Docs', `<h1>Docs</h1>${sections || '<p>No Markdown documents yet.</p>'}`);
}

/**
 * @param {string} root
 * @param {string} path
 */
function inside(root, path) {
  const remainder = relative(root, path);
  return remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} body
 */
function send(response, status, body, type = 'text/html; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  });
  response.end(body);
}

export function createDocsServer(directory = DOCS) {
  const root = realpathSync(directory);
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return send(response, 405, 'Use GET or HEAD', 'text/plain; charset=utf-8');
    }
    let pathname;
    try {
      if (!request.url) throw new Error('Missing URL');
      pathname = decodeURIComponent(request.url.split('?')[0]);
      if (!pathname.startsWith('/') || pathname.includes('\0')) throw new Error('Invalid path');
    } catch {
      return send(response, 400, 'Invalid URL', 'text/plain; charset=utf-8');
    }
    if (!inside(root, resolve(root, `.${pathname}`))) {
      return send(response, 403, 'Path outside docs', 'text/plain; charset=utf-8');
    }
    try {
      const files = documents(root);
      if (pathname === '/') return send(response, 200, indexPage(files));
      const file = pathname.slice(1);
      const index = files.indexOf(file);
      if (index === -1) return send(response, 404, 'Document not found', 'text/plain; charset=utf-8');
      const path = realpathSync(join(root, file));
      if (!inside(root, path)) return send(response, 403, 'Path outside docs', 'text/plain; charset=utf-8');
      const navigation = [
        '<a href="/">Index</a>',
        index > 0 ? `<a rel="prev" href="${href(files[index - 1])}">Previous</a>` : '',
        index < files.length - 1 ? `<a rel="next" href="${href(files[index + 1])}">Next</a>` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const body = markdown.render(readFileSync(path, 'utf8'));
      return send(
        response,
        200,
        layout(file, `<nav>${navigation}</nav><p><small>${escape(file)}</small></p><main>${body}</main>`),
      );
    } catch (error) {
      const status = error instanceof Error && 'code' in error && error.code === 'ENOENT' ? 404 : 500;
      if (status === 500) console.error(error);
      return send(
        response,
        status,
        status === 404 ? 'Document not found' : 'Unable to read docs',
        'text/plain; charset=utf-8',
      );
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: node scripts/server.mjs [port]\nServes docs/ on localhost (default port: 8787).');
    return;
  }
  const port = args[0] ?? '8787';
  if (args.length > 1 || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('Usage: node scripts/server.mjs [port]; port must be 1–65535');
  }
  const server = createDocsServer();
  server.on('error', (error) => {
    console.error(`Docs server failed: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(Number(port), '127.0.0.1', () => {
    console.log(`Docs: http://127.0.0.1:${port}/ (Ctrl+C to stop)`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Docs server failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
