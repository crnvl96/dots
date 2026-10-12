import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { dependencySpecs } from "./pi-deps.mjs";

function fixture(t, piVersion = "1.2.0", typeboxVersion = "1.4.2") {
  const root = mkdtempSync(join(tmpdir(), "pi-deps-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const pi = join(root, "node_modules/.store/pi/node_modules/@earendil-works/pi-coding-agent");
  const typebox = join(root, "node_modules/.store/typebox/node_modules/typebox");
  const piLink = join(root, "node_modules/@earendil-works/pi-coding-agent");
  const typeboxLink = join(dirname(pi), "../typebox");
  for (const path of [pi, typebox, dirname(piLink), dirname(typeboxLink)]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(
    join(pi, "package.json"),
    JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: piVersion,
      dependencies: { typebox: "^1.3.27" },
    }),
  );
  writeFileSync(
    join(typebox, "package.json"),
    JSON.stringify({ name: "typebox", version: typeboxVersion, exports: "./index.mjs" }),
  );
  writeFileSync(join(typebox, "index.mjs"), "");
  symlinkSync(pi, piLink, "dir");
  symlinkSync(typebox, typeboxLink, "dir");
  return root;
}

test("pins Pi packages and resolves actual TypeBox through an isolated installation", (t) => {
  assert.deepEqual(dependencySpecs(fixture(t), "24.21.0"), [
    "@earendil-works/pi-coding-agent@1.2.0",
    "@earendil-works/pi-ai@1.2.0",
    "@earendil-works/pi-tui@1.2.0",
    "typebox@1.4.2",
    "@types/node@24",
  ]);
});

test("follows a different Pi release and the active Node major", (t) => {
  assert.deepEqual(dependencySpecs(fixture(t, "1.3.0", "1.5.0"), "v26.1.0"), [
    "@earendil-works/pi-coding-agent@1.3.0",
    "@earendil-works/pi-ai@1.3.0",
    "@earendil-works/pi-tui@1.3.0",
    "typebox@1.5.0",
    "@types/node@26",
  ]);
});

test("rejects invalid Node versions", (t) => {
  assert.throws(() => dependencySpecs(fixture(t), "invalid"), /Invalid Node version/);
});

test("fails rather than guessing when Pi is not installed", (t) => {
  const root = fixture(t);
  rmSync(join(root, "node_modules/@earendil-works/pi-coding-agent"));
  assert.throws(() => dependencySpecs(root, "24.21.0"), { code: "ENOENT" });
});
