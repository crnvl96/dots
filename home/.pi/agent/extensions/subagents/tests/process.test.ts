// Launches a real pi process and drives it over RPC. The model is a local scripted provider, so this makes no network call.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const extensionDir = fileURLToPath(new URL('..', import.meta.url));
const nl = '\n';
const providerSource = [
  "import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';",
  'function textOf(message) {',
  '  if (!message) return "";',
  '  return typeof message.content === "string" ? message.content : message.content.map((part) => part.text ?? part.name ?? "").join("\\n");',
  '}',
  'function called(context, name) {',
  '  return context.messages.some((message) => message.role === "assistant" && message.content?.some?.((part) => part.type === "toolCall" && part.name === name));',
  '}',
  'function finish(stream, model, content) {',
  '  const stopReason = content.some((part) => part.type === "toolCall") ? "toolUse" : "stop";',
  '  const message = {',
  '    role: "assistant", content, api: model.api, provider: model.provider, model: model.id,',
  '    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },',
  '    stopReason, timestamp: Date.now(),',
  '  };',
  '  stream.push({ type: "done", reason: stopReason, message });',
  '  stream.end();',
  '}',
  'export default function (pi) {',
  '  pi.registerProvider("fake", {',
  '    baseUrl: "http://127.0.0.1:9",',
  '    apiKey: "scripted",',
  '    api: "openai-completions",',
  '    models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],',
  '    streamSimple(model, context) {',
  '      const stream = createAssistantMessageEventStream();',
  '      const transcript = context.messages.map(textOf).join("\\n");',
  '      const content = transcript.includes("Orchestrate check-files") && !called(context, "subagents_launch")',
  '        ? [{ type: "toolCall", id: "launch-1", name: "subagents_launch", arguments: { tasks: [{ name: "check-files", prompt: "CHILD_TASK write marker.txt containing hello-from-child, then ask the parent whether to keep that filename." }] } }]',
  '        : transcript.includes("CHILD_TASK") && !called(context, "write")',
  '          ? [{ type: "toolCall", id: "write-1", name: "write", arguments: { path: "marker.txt", content: "hello-from-child" } }]',
  '          : transcript.includes("CHILD_TASK") && !called(context, "subagents_ask")',
  '            ? [{ type: "toolCall", id: "ask-1", name: "subagents_ask", arguments: { kind: "decision", message: "Should I keep the filename marker.txt?" } }]',
  '            : transcript.includes("needs a decision")',
  '              ? [{ type: "text", text: "I need a user decision about marker.txt." }]',
  '              : [{ type: "text", text: "done" }];',
  '      queueMicrotask(() => finish(stream, model, content));',
  '      return stream;',
  '    },',
  '  });',
  '}',
  '',
].join(nl);

test('a dedicated pi process inherits tools, writes a file, and asks the parent', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-subagents-process-'));
  const provider = join(directory, 'fake-provider.ts');
  await writeFile(provider, providerSource);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(
    'pi',
    [
      '--mode',
      'rpc',
      '--no-session',
      '--no-extensions',
      '--no-skills',
      '--no-context-files',
      '--thinking',
      'off',
      '--provider',
      'fake',
      '--model',
      'scripted',
      '-e',
      extensionDir,
      '-e',
      provider,
    ],
    {
      cwd: directory,
      env: { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const lines = [];
  let buffer = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`pi process timed out\nstderr=${stderr}\nlines=${lines.slice(-6).join('\n')}`),
      );
    }, 30_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`pi exited ${code}\nstderr=${stderr}\nlines=${lines.slice(-8).join('\n')}`));
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const parts = buffer.split(/\n/);
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        if (!part.trim()) continue;
        lines.push(part);
        const asked = lines.some((line) => line.includes('Should I keep the filename marker.txt'));
        const answered = lines.some((line) =>
          line.includes('I need a user decision about marker.txt'),
        );
        if (asked && answered) {
          clearTimeout(timer);
          resolve(part);
        }
      }
    });
  });
  child.stdin.write(
    JSON.stringify({
      id: '1',
      type: 'prompt',
      message: 'Orchestrate check-files. Launch one subagent and wait for its decision request.',
    }) + '\n',
  );
  try {
    await ready;
  } finally {
    child.kill('SIGTERM');
  }
  const marker = await readFile(join(directory, 'marker.txt'), 'utf8');
  assert.equal(marker, 'hello-from-child');
  assert.ok(lines.some((line) => line.includes('subagents_ask')));
});
