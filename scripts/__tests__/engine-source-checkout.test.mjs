import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const helper = resolve("scripts/engine-source-checkout.sh");
const env = {
  ...process.env,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "protocol.file.allow",
  GIT_CONFIG_VALUE_0: "always",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { env, encoding: "utf8" }).trim();

function fixture(root, { reachable }) {
  const network = join(root, "network");
  mkdirSync(network);
  git(network, "init", "-q");
  writeFileSync(join(network, "marker.txt"), "network stack");
  git(network, "add", ".");
  git(network, "commit", "-qm", "network");
  const engine = join(root, "Engine");
  mkdirSync(engine);
  git(engine, "init", "-q");
  writeFileSync(join(engine, "Cargo.toml"), "[workspace]\n");
  git(engine, "add", ".");
  git(engine, "submodule", "add", "-q", network, "third_party/iroh");
  git(engine, "commit", "-qm", "engine");
  // The recorded URL stops resolving after the pin was created.
  if (!reachable) rmSync(network, { recursive: true, force: true });
  return { engine, commit: git(engine, "rev-parse", "HEAD") };
}

// Failure model: a single-commit checkout leaves submodule directories empty, so the Engine
// build fails far from the cause. Preparation must populate them or stop with a clear message.
test("a pinned Engine commit is checked out with its network-stack submodule populated", () => {
  const root = mkdtempSync(join(tmpdir(), "engine-checkout-"));
  try {
    const { engine, commit } = fixture(root, { reachable: true });
    const worktree = join(root, "work");
    execFileSync("bash", [helper, engine, worktree, commit], { env });
    assert.equal(readFileSync(join(worktree, "third_party/iroh/marker.txt"), "utf8"), "network stack");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreachable submodule stops preparation with a message that names it", () => {
  const root = mkdtempSync(join(tmpdir(), "engine-checkout-"));
  try {
    const { engine, commit } = fixture(root, { reachable: false });
    const worktree = join(root, "work");
    const result = spawnSync("bash", [helper, engine, worktree, commit], { env, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /third_party\/iroh/);
    assert.ok(!existsSync(join(worktree, "third_party/iroh/marker.txt")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an Engine commit without submodules is unaffected", () => {
  const root = mkdtempSync(join(tmpdir(), "engine-checkout-"));
  try {
    const engine = join(root, "Engine");
    mkdirSync(engine);
    git(engine, "init", "-q");
    writeFileSync(join(engine, "Cargo.toml"), "[workspace]\n");
    git(engine, "add", ".");
    git(engine, "commit", "-qm", "plain");
    const worktree = join(root, "work");
    execFileSync("bash", [helper, engine, worktree, git(engine, "rev-parse", "HEAD")], { env });
    assert.ok(existsSync(join(worktree, "Cargo.toml")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("both preparation paths create Engine worktrees through the shared helper", () => {
  for (const file of ["scripts/update-unified-engine-core.sh", "scripts/install-dev-device.sh"]) {
    const text = readFileSync(resolve(file), "utf8");
    assert.ok(text.includes("engine-source-checkout.sh"), `${file} must use the helper`);
    assert.ok(!/worktree add --detach/.test(text), `${file} must not add a bare worktree`);
  }
});
