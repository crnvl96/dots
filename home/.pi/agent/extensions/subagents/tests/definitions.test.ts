import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { definitionPrompt, discoverAgents } from '../definitions.ts';

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pi-agent-definitions-'));
  const homeDir = join(root, 'home');
  const cwd = join(root, 'project');
  mkdirSync(homeDir);
  mkdirSync(cwd);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agent = (base, convention, file, name, body = 'Review the code.', extra = '') =>
    write(
      join(base, convention, 'agents', file),
      `---\nname: ${name}\ndescription: Review code carefully\n${extra}---\n${body}\n`,
    );
  const discover = (options = {}) => discoverAgents({ cwd, homeDir, ...options });
  return { root, homeDir, cwd, write, agent, discover };
}

test('missing roots are silent and discovery is fresh after additions, edits, and deletions', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.discover(), { agents: [], diagnostics: [] });
  const path = f.agent(f.homeDir, '.agents', 'review.md', 'review');
  assert.equal(f.discover().agents[0].body, 'Review the code.');
  f.agent(f.homeDir, '.agents', 'review.md', 'review', 'Edited instructions.');
  assert.equal(f.discover().agents[0].body, 'Edited instructions.');
  f.agent(f.homeDir, '.agents', 'new.md', 'new-agent');
  assert.deepEqual(
    f.discover().agents.map((agent) => agent.name),
    ['new-agent', 'review'],
  );
  rmSync(path);
  assert.deepEqual(
    f.discover().agents.map((agent) => agent.name),
    ['new-agent'],
  );
});

test('recursively discovers .agents roots, ignores non-Markdown, sorts by agent name', (t) => {
  const f = fixture(t);
  f.agent(f.homeDir, '.agents', 'nested/z.md', 'zeta');
  f.agent(f.homeDir, '.agents', 'deeper/nested/a.MD', 'alpha', 'Body.', 'model: inherit\n');
  f.agent(f.cwd, '.agents', 'nested/b.md', 'beta');
  f.agent(f.cwd, '.agents', 'not-markdown.txt', 'ignored');
  const catalog = f.discover();
  assert.deepEqual(
    catalog.agents.map((agent) => [agent.name, agent.source]),
    [
      ['alpha', 'user'],
      ['beta', 'project'],
      ['zeta', 'user'],
    ],
  );
  assert.deepEqual(catalog.diagnostics, []);
});

test('nearest project beats ancestors, which beat user definitions', (t) => {
  const f = fixture(t);
  mkdirSync(join(f.cwd, '.git'));
  const child = join(f.cwd, 'packages', 'app');
  mkdirSync(child, { recursive: true });
  f.agent(f.homeDir, '.agents', 'review.md', 'review', 'user definition');
  assert.equal(f.discover({ cwd: child }).agents[0].body, 'user definition');
  f.agent(f.cwd, '.agents', 'review.md', 'review', 'ancestor definition');
  assert.equal(f.discover({ cwd: child }).agents[0].body, 'ancestor definition');
  f.agent(child, '.agents', 'review.md', 'review', 'nearest definition');
  assert.equal(f.discover({ cwd: child }).agents[0].body, 'nearest definition');
  f.agent(f.root, '.agents', 'outside.md', 'outside');
  assert.deepEqual(
    f.discover({ cwd: child }).agents.map((agent) => agent.name),
    ['review'],
  );
  assert.deepEqual(f.discover({ cwd: child }).diagnostics, []);
});

test('.claude roots are ignored at user, ancestor project, and nearest project locations', (t) => {
  const f = fixture(t);
  const child = join(f.cwd, 'child');
  mkdirSync(child);
  mkdirSync(join(f.cwd, '.git'));
  for (const base of [f.homeDir, f.cwd, child]) {
    f.agent(base, '.claude', 'only.md', 'claude-only');
    f.agent(base, '.claude', 'review.md', 'review', '', 'tools: Read\n');
    f.write(join(base, '.claude', 'agents', 'invalid.md'), 'invalid');
    symlinkSync(join(f.root, 'missing'), join(base, '.claude', 'agents', 'broken.md'));
  }
  assert.deepEqual(f.discover({ cwd: child }), { agents: [], diagnostics: [] });
  f.agent(f.homeDir, '.agents', 'review.md', 'review', 'Only .agents instructions.');
  const result = f.discover({ cwd: child });
  assert.deepEqual(
    result.agents.map((agent) => [agent.name, agent.body, agent.source]),
    [['review', 'Only .agents instructions.', 'user']],
  );
  assert.deepEqual(result.diagnostics, []);
});

test('worktree .git files define the boundary and non-git projects scan only cwd', (t) => {
  const f = fixture(t);
  const child = join(f.cwd, 'child');
  mkdirSync(child);
  f.agent(f.cwd, '.agents', 'ancestor.md', 'ancestor');
  f.agent(child, '.agents', 'local.md', 'local');
  assert.deepEqual(
    f.discover({ cwd: child }).agents.map((agent) => agent.name),
    ['local'],
  );
  f.write(join(f.cwd, '.git'), 'gitdir: /some/worktree');
  assert.deepEqual(
    f.discover({ cwd: child }).agents.map((agent) => agent.name),
    ['ancestor', 'local'],
  );
});

test('untrusted project directories are not scanned, including their invalid definitions', (t) => {
  const f = fixture(t);
  f.agent(f.homeDir, '.agents', 'user.md', 'user');
  f.agent(f.cwd, '.agents', 'project.md', 'project');
  f.write(join(f.cwd, '.agents', 'agents', 'invalid.md'), 'invalid');
  assert.deepEqual(
    f.discover({ projectTrusted: false }).agents.map((agent) => agent.name),
    ['user'],
  );
  assert.deepEqual(f.discover({ projectTrusted: false }).diagnostics, []);
});

test('symlink directories and files are followed, loops terminate, aliases deduplicate', (t) => {
  const f = fixture(t);
  const external = join(f.root, 'external');
  const target = f.write(
    join(external, 'nested', 'review.md'),
    '---\nname: review\ndescription: Review\n---\nRead ./guide.md.',
  );
  const agents = join(f.homeDir, '.agents', 'agents');
  mkdirSync(agents, { recursive: true });
  symlinkSync(external, join(agents, 'directory'));
  symlinkSync(external, join(external, 'nested', 'loop'));
  symlinkSync(target, join(agents, 'alias.md'));
  symlinkSync(external, join(agents, 'second-directory'));
  const catalog = f.discover();
  assert.equal(catalog.agents.length, 1);
  assert.equal(catalog.agents[0].filePath, realpathSync(target));
  assert.deepEqual(catalog.diagnostics, []);
  assert.deepEqual(f.discover(), catalog);
});

test('shared user/project realpaths retain project precedence', (t) => {
  const f = fixture(t);
  const user = f.agent(f.homeDir, '.agents', 'shared.md', 'review', 'shared definition');
  const project = join(f.cwd, '.agents', 'agents');
  mkdirSync(project, { recursive: true });
  symlinkSync(user, join(project, 'shared.md'));
  const catalog = f.discover();
  assert.equal(catalog.agents[0].source, 'project');
  assert.equal(catalog.agents[0].body, 'shared definition');
  assert.deepEqual(catalog.diagnostics, []);
});

test('whole-directory aliases across user and project roots retain project source', (t) => {
  const f = fixture(t);
  f.agent(f.homeDir, '.agents', 'nested/shared.md', 'shared');
  mkdirSync(join(f.cwd, '.agents'), { recursive: true });
  const target = join(f.homeDir, '.agents', 'agents');
  symlinkSync(target, join(f.cwd, '.agents', 'agents'));
  const result = f.discover();
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].source, 'project');
  assert.deepEqual(result.diagnostics, []);
});

test('duplicates at equal priority diagnose and choose deterministic lexical path order', (t) => {
  const f = fixture(t);
  f.agent(f.cwd, '.agents', 'z.md', 'review', 'last');
  const first = f.agent(f.cwd, '.agents', 'a.md', 'review', 'first');
  const result = f.discover();
  assert.equal(result.agents[0].body, 'first');
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0], /duplicate agent name "review" at the same priority/);
  assert.ok(result.diagnostics[0].includes(realpathSync(first)));
  assert.deepEqual(f.discover(), result);
});

for (const [label, content, diagnostic] of [
  ['missing opening delimiter', 'name: review\ndescription: Review\n---\nBody', /first-line/],
  ['leading blank line', '\n---\nname: review\ndescription: Review\n---\nBody', /first-line/],
  [
    'opening delimiter prefix',
    '---yaml\nname: review\ndescription: Review\n---\nBody',
    /first-line/,
  ],
  ['missing closing delimiter', '---\nname: review\ndescription: Review\nBody', /closing/],
  [
    'closing delimiter prefix',
    '---\nname: review\ndescription: Review\n---oops\nBody\n---',
    /delimiter/,
  ],
  ['invalid YAML', '---\nname: [broken\ndescription: Review\n---\nBody', /YAML|flow|sequence/i],
  [
    'duplicate YAML keys',
    '---\nname: review\nname: other\ndescription: Review\n---\nBody',
    /unique|duplicate/i,
  ],
  ['list frontmatter', '---\n- name: review\n---\nBody', /mapping/],
  ['scalar frontmatter', '---\nhello\n---\nBody', /mapping/],
  ['missing name', '---\ndescription: Review\n---\nBody', /name/],
  ['blank name', '---\nname: ""\ndescription: Review\n---\nBody', /name/],
  ['invalid name', '---\nname: Review_Code\ndescription: Review\n---\nBody', /kebab-case/],
  ['long name', `---\nname: ${'a'.repeat(65)}\ndescription: Review\n---\nBody`, /64/],
  ['numeric name', '---\nname: 123\ndescription: Review\n---\nBody', /name/],
  ['blank description', '---\nname: review\ndescription: "  "\n---\nBody', /description/],
  ['non-string description', '---\nname: review\ndescription: [Review]\n---\nBody', /description/],
  ['empty body', '---\nname: review\ndescription: Review\n---\n \n', /body/],
  [
    'unknown permission field',
    '---\nname: review\ndescription: Review\npermissionMode: bypassPermissions\n---\nBody',
    /Unsupported.*permissionMode/,
  ],
  [
    'tools field',
    '---\nname: review\ndescription: Review\ntools: Read\n---\nBody',
    /Unsupported.*tools/,
  ],
  [
    'unknown extra field',
    '---\nname: review\ndescription: Review\ncolor: blue\n---\nBody',
    /Unsupported.*color/,
  ],
  [
    'model override',
    '---\nname: review\ndescription: Review\nmodel: opus\n---\nBody',
    /only model: inherit/,
  ],
  [
    'null model',
    '---\nname: review\ndescription: Review\nmodel: null\n---\nBody',
    /only model: inherit/,
  ],
  ['oversized file', 'x'.repeat(128 * 1024 + 1), /128 KiB/],
]) {
  test(`invalid definitions fail closed: ${label}`, (t) => {
    const f = fixture(t);
    f.write(join(f.homeDir, '.agents', 'agents', 'invalid.md'), content);
    const result = f.discover();
    assert.deepEqual(result.agents, []);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0], diagnostic);
  });
}

test('invalid named higher-priority definitions block silent fallback to lower-priority agents', (t) => {
  const f = fixture(t);
  f.agent(f.homeDir, '.agents', 'review.md', 'review', 'Lower priority valid agent.');
  const invalidPath = join(f.cwd, '.agents', 'agents', 'review.md');
  for (const content of [
    '---\nname: review\ndescription: Review\ntools: Read\n---\nBody',
    '---\nname: review\ndescription: Review\nmodel: opus\n---\nBody',
    '---\nname: review\ndescription: ""\n---\nBody',
    '---\nname: review\ndescription: Review\n---\n',
  ]) {
    f.write(invalidPath, content);
    const result = f.discover();
    assert.deepEqual(result.agents, []);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0], /agent "review" will not fall back/);
  }
  rmSync(invalidPath);
  assert.equal(f.discover().agents[0].body, 'Lower priority valid agent.');
});

test('invalid lower-priority definitions do not remove a valid higher-priority selection', (t) => {
  const f = fixture(t);
  f.agent(f.cwd, '.agents', 'review.md', 'review', 'Valid higher priority.');
  f.agent(f.homeDir, '.agents', 'review.md', 'review', '', 'tools: Read\n');
  const result = f.discover();
  assert.equal(result.agents[0].body, 'Valid higher priority.');
  assert.equal(result.diagnostics.length, 1);
});

test('unidentifiable definitions diagnose the limitation rather than guessing a name from the filename', (t) => {
  const f = fixture(t);
  f.agent(f.homeDir, '.agents', 'different-file.md', 'review', 'Valid user definition.');
  f.write(join(f.cwd, '.agents', 'agents', 'review.md'), '---\nname: [bad yaml\n---\nBody');
  const result = f.discover();
  assert.equal(result.agents[0].name, 'review');
  assert.match(
    result.diagnostics[0],
    /could not determine a valid agent name.*lower-priority definition may still be available/,
  );
});

test('YAML multiline description, quoted strings, CRLF, and 64-character names are supported', (t) => {
  const f = fixture(t);
  const name = 'a'.repeat(64);
  f.write(
    join(f.homeDir, '.agents', 'agents', 'valid.md'),
    `---\r\nname: "${name}"\r\ndescription: >-\r\n  Review carefully\r\n  and report.\r\nmodel: inherit\r\n---\r\nRead ./guide.md.\r\n`,
  );
  const result = f.discover();
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.agents[0].name, name);
  assert.equal(result.agents[0].description, 'Review carefully and report.');
});

test('I/O failures diagnose dangling symlinks and non-directory roots without throwing', (t) => {
  const f = fixture(t);
  const root = join(f.homeDir, '.agents', 'agents');
  mkdirSync(root, { recursive: true });
  symlinkSync(join(f.root, 'missing'), join(root, 'broken.md'));
  f.write(join(f.cwd, '.agents', 'agents'), 'not a directory');
  const result = f.discover();
  assert.deepEqual(result.agents, []);
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.diagnostics.some((message) => /ENOENT/.test(message)));
  assert.ok(result.diagnostics.some((message) => /not a directory/.test(message)));
});

test('definitionPrompt preserves body and specifies absolute source and relative-reference base', (t) => {
  const f = fixture(t);
  const path = f.agent(
    f.homeDir,
    '.agents',
    'nested/review.md',
    'review',
    'Read ./guide.md.\nThen inspect ../src.',
  );
  const definition = f.discover().agents[0];
  const prompt = definitionPrompt(definition);
  assert.ok(prompt.includes(realpathSync(path)));
  assert.ok(prompt.includes(dirname(realpathSync(path))));
  assert.ok(prompt.endsWith(definition.body));
  assert.match(prompt, /Resolve relative file references/);
});
