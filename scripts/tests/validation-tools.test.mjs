import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ce-validation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(root, file, text) {
  const path = resolve(root, file);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, text);
}
function run(script, args = [], cwd = root) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
  });
}
function install(rootPath, name) {
  mkdirSync(join(rootPath, 'scripts'), { recursive: true });
  const target = join(rootPath, 'scripts', name);
  copyFileSync(join(root, 'scripts', name), target);
  return target;
}

test('documentation checks real file links and commands, ignoring link examples in code', (t) => {
  const dir = fixture(t);
  write(dir, 'target.md', '# Target');
  write(
    dir,
    'guide.md',
    '[target](target.md)\n\n`npm run typecheck`\n\n```md\n[example](missing.md)\n```\n'
  );
  const result = run(join(root, 'scripts/check-doc-references.mjs'), [
    join(dir, 'guide.md'),
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test('documentation checks fail on missing inline/reference links and obsolete npm scripts', (t) => {
  const dir = fixture(t);
  write(
    dir,
    'guide.md',
    '[missing](gone.md)\n\n[other][ref]\n\n[ref]: absent.md\n\n`npm run no-such-project-command`\n'
  );
  const result = run(join(root, 'scripts/check-doc-references.mjs'), [
    join(dir, 'guide.md'),
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing file: gone.md/);
  assert.match(result.stderr, /Missing file: absent.md/);
  assert.match(result.stderr, /Unknown npm script: no-such-project-command/);
});

test('documentation uses the first duplicate reference definition', (t) => {
  const dir = fixture(t);
  write(dir, 'present.md', '# Present');
  const file = join(dir, 'guide.md');
  const check = () =>
    run(join(root, 'scripts/check-doc-references.mjs'), [file]);
  write(
    dir,
    'guide.md',
    '[guide][ref]\n\n[ref]: missing.md\n[ref]: present.md\n'
  );
  assert.equal(check().status, 1);
  write(
    dir,
    'guide.md',
    '[guide][ref]\n\n[ref]: present.md\n[ref]: missing.md\n'
  );
  const result = check();
  assert.equal(result.status, 0, result.stderr);
});

test('documentation checks complete script names while allowing prose punctuation', (t) => {
  const dir = fixture(t);
  const file = join(dir, 'guide.md');
  const check = () =>
    run(join(root, 'scripts/check-doc-references.mjs'), [file]);
  write(dir, 'guide.md', '`npm run typecheck.old`');
  const invalid = check();
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown npm script: typecheck\.old/);
  write(
    dir,
    'guide.md',
    'Run npm run typecheck.\n\n`npm run "format:check"`\n'
  );
  const valid = check();
  assert.equal(valid.status, 0, valid.stderr);
});

test('skill setup is idempotent and links to the canonical source', (t) => {
  const dir = fixture(t);
  write(dir, '.agents/skills/example/SKILL.md', '# Example');
  const script = install(dir, 'setup-agent-skills.mjs');
  for (let i = 0; i < 2; i++) {
    const result = run(script);
    assert.equal(result.status, 0, result.stderr);
  }
  const target = join(dir, '.agents/skills/example');
  const link = join(dir, '.claude/skills/example');
  assert.equal(realpathSync(link), realpathSync(target));
  write(target, 'SKILL.md', '# Updated');
  assert.equal(readFileSync(join(link, 'SKILL.md'), 'utf8'), '# Updated');
});

test('skill setup preserves existing local skills and creates no partial links on conflict', (t) => {
  const dir = fixture(t);
  write(dir, '.agents/skills/a/SKILL.md', '# A');
  write(dir, '.agents/skills/z/SKILL.md', '# Z');
  write(dir, '.claude/skills/z/SKILL.md', '# Local');
  const result = run(install(dir, 'setup-agent-skills.mjs'));
  assert.equal(result.status, 1);
  assert.equal(
    readFileSync(join(dir, '.claude/skills/z/SKILL.md'), 'utf8'),
    '# Local'
  );
  assert.equal(existsSync(join(dir, '.claude/skills/a')), false);
});

test('core runner selects exact files, forwards Jest options, and propagates failure', (t) => {
  const dir = fixture(t);
  write(
    dir,
    'config/core-tests.txt',
    '# comment\n\ntest/a.test.ts # inline comment\ntest/b.test.ts\n'
  );
  write(dir, 'test/a.test.ts', '');
  write(dir, 'test/b.test.ts', '');
  write(
    dir,
    'node_modules/jest/bin/jest.js',
    'require("fs").writeFileSync("args.json", JSON.stringify(process.argv.slice(2))); process.exit(7);'
  );
  const result = run(install(dir, 'test-core.mjs'), ['--watchman=false']);
  assert.equal(result.status, 7);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8')), [
    '--maxWorkers=4',
    '--runTestsByPath',
    'test/a.test.ts',
    'test/b.test.ts',
    '--watchman=false',
  ]);
});

test('core runner refuses an empty list or missing test instead of running an unintended suite', (t) => {
  const dir = fixture(t);
  const script = install(dir, 'test-core.mjs');
  write(dir, 'config/core-tests.txt', '# empty\n');
  assert.equal(run(script).status, 1);
  write(dir, 'config/core-tests.txt', 'test/missing.test.ts\n');
  const result = run(script);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing core test/);
});
