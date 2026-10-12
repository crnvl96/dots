import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDocsServer } from './server.mjs';

/**
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} files
 */
async function fixture(t, files = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'docs-server-test-'));
  const root = join(directory, 'docs');
  mkdirSync(root);
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), contents);
  }
  const server = createDocsServer(root);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  return {
    root,
    directory,
    /** @param {string} path */
    get(path, method = 'GET') {
      // Unlike fetch/URL, this preserves traversal paths for security tests.
      return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path, method }, (response) => {
          /** @type {Buffer[]} */
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        });
        req.on('error', reject);
        req.end();
      });
    },
  };
}

test('index lists Markdown recursively, grouped by folder and sorted', async (t) => {
  const { get } = await fixture(t, {
    'z.md': '# Z',
    'a.md': '# A',
    'guides/start.md': '# Start',
    'guides/nested/topic.md': '# Topic',
    'ignore.json': '{}',
  });
  const { status, body } = await get('/');
  assert.equal(status, 200);
  assert.match(body, /<h2>Documents<\/h2>/);
  assert.match(body, /<h2>guides<\/h2>/);
  assert.match(body, /href="\/guides\/nested\/topic.md"/);
  assert.ok(body.indexOf('href="/a.md"') < body.indexOf('href="/z.md"'));
  assert.doesNotMatch(body, /ignore.json/);
});

test('renders tables, code, headings and relative Markdown links', async (t) => {
  const { get } = await fixture(t, {
    'guide.md':
      '# Guide\n\n| Tool |\n| --- |\n| Oxfmt |\n\n```js\nconst x = 1;\n```\n\n[Next](nested/next.md#setup)\n\n## Setup\n\n## Setup\n\n## Setup-1',
  });
  const { status, body } = await get('/guide.md');
  assert.equal(status, 200);
  assert.match(body, /<table>/);
  assert.match(body, /<td>Oxfmt<\/td>/);
  assert.match(body, /<code class="language-js">/);
  assert.match(body, /href="nested\/next.md#setup"/);
  assert.match(body, /id="setup"/);
  assert.match(body, /id="setup-1"/);
  const ids = [...body.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});

test('documents have index, previous and next navigation', async (t) => {
  const { get } = await fixture(t, { 'a.md': '# A', 'b.md': '# B', 'nested/c.md': '# C' });
  const first = await get('/a.md');
  assert.match(first.body, /<a href="\/">Index<\/a>/);
  assert.doesNotMatch(first.body, /rel="prev"/);
  assert.match(first.body, /rel="next" href="\/b.md"/);
  const middle = await get('/b.md');
  assert.match(middle.body, /rel="prev" href="\/a.md"/);
  assert.match(middle.body, /rel="next" href="\/nested\/c.md"/);
  const last = await get('/nested/c.md');
  assert.match(last.body, /rel="prev" href="\/b.md"/);
  assert.doesNotMatch(last.body, /rel="next"/);
});

test('supports encoded filenames and escapes filenames in HTML', async (t) => {
  const { get } = await fixture(t, { 'a b-ü.md': '# Encoded', 'a<evil>.md': '# Safe' });
  const index = await get('/');
  assert.match(index.body, /href="\/a%20b-%C3%BC.md"/);
  assert.match(index.body, /a&lt;evil&gt;.md/);
  assert.equal((await get('/a%20b-%C3%BC.md?refresh=1')).status, 200);
  assert.match((await get('/a%3Cevil%3E.md')).body, /<title>a&lt;evil&gt;.md<\/title>/);
});

test('refresh discovers added documents and rereads edited content', async (t) => {
  const { root, get } = await fixture(t, { 'a.md': '# Before' });
  assert.match((await get('/a.md')).body, /Before/);
  writeFileSync(join(root, 'a.md'), '# After');
  writeFileSync(join(root, 'b.md'), '# New');
  assert.match((await get('/a.md')).body, /After/);
  assert.match((await get('/')).body, /href="\/b.md"/);
  rmSync(join(root, 'a.md'));
  assert.equal((await get('/a.md')).status, 404);
});

test('empty docs has a useful index', async (t) => {
  const { get } = await fixture(t);
  assert.match((await get('/')).body, /No Markdown documents yet/);
});

test('missing documents, non-Markdown files and directories are not served', async (t) => {
  const { get } = await fixture(t, { 'secret.json': '{}', 'nested/a.md': '# A' });
  for (const path of ['/missing.md', '/secret.json', '/nested/', '/README.md']) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test('blocks traversal, including percent-encoded paths and sibling prefixes', async (t) => {
  const { directory, get } = await fixture(t);
  writeFileSync(join(directory, 'outside.md'), '# Secret');
  mkdirSync(join(directory, 'docs-other'));
  writeFileSync(join(directory, 'docs-other/secret.md'), '# Secret');
  for (const path of ['/../outside.md', '/%2e%2e/outside.md', '/%2e%2e%2foutside.md', '/../docs-other/secret.md']) {
    const response = await get(path);
    assert.equal(response.status, 403, path);
    assert.doesNotMatch(response.body, /Secret/);
  }
});

test('does not list or serve file or directory symlinks', async (t) => {
  const { root, directory, get } = await fixture(t, { 'a.md': '# A' });
  writeFileSync(join(directory, 'outside.md'), '# Secret');
  symlinkSync(join(directory, 'outside.md'), join(root, 'escape.md'));
  symlinkSync(directory, join(root, 'escape-directory'), 'dir');
  symlinkSync(root, join(root, 'loop'), 'dir');
  assert.doesNotMatch((await get('/')).body, /escape|loop/);
  assert.equal((await get('/escape.md')).status, 404);
  assert.equal((await get('/escape-directory/outside.md')).status, 404);
});

test('rejects malformed URL escapes, invalid UTF-8 and null bytes', async (t) => {
  const { get } = await fixture(t);
  for (const path of ['/%', '/%ff.md', '/%00.md']) {
    assert.equal((await get(path)).status, 400, path);
  }
});

test('escapes raw HTML and refuses dangerous Markdown links', async (t) => {
  const { get } = await fixture(t, { 'unsafe.md': '<script>alert(1)</script>\n\n[Click](javascript:alert(1))' });
  const { body, headers } = await get('/unsafe.md');
  assert.doesNotMatch(body, /<script>|href="javascript:/);
  assert.match(body, /&lt;script&gt;/);
  assert.match(headers['content-security-policy'], /default-src 'none'/);
  assert.equal(headers['x-content-type-options'], 'nosniff');
});

test('HEAD preserves headers without a body and unsupported methods return 405', async (t) => {
  const { get } = await fixture(t, { 'a.md': '# A' });
  const normal = await get('/a.md');
  const head = await get('/a.md', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], normal.headers['content-length']);
  assert.equal(head.headers['cache-control'], 'no-store');
  const post = await get('/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('CLI help and invalid ports work from outside the repository', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'docs-cli-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('./server.mjs', import.meta.url));
  /** @param {...string} args */
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8' });
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /8787/);
  for (const args of [['0'], ['65536'], ['abc'], ['8787', 'extra']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
});

test('default document root is repository docs, not the current directory', async (t) => {
  const server = createDocsServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /href="\/verification-roadmap.md"/);
});
