import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('host adapters refuse aliases and dangling output links into the snapshot', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'stable-batch-output-'));
  try {
    const root = join(temporary, 'snapshot');
    mkdirSync(root);
    symlinkSync(root, join(temporary, 'alias'));
    const forbidden = join(root, 'must-not-write.json');
    const dangling = join(temporary, 'dangling.json');
    symlinkSync(forbidden, dangling);
    for (const adapter of ['tycho', 'document']) {
      for (const output of [join(realpathSync(root), 'must-not-write.json'), dangling]) {
        const args = adapter === 'tycho'
          ? [join(temporary, 'alias'), temporary, 'audit', output]
          : [join(temporary, 'alias'), join(temporary, 'absent-state.json'), output];
        const child = spawnSync(process.execPath, [fileURLToPath(new URL(`./stable-batch-${adapter}.mjs`, import.meta.url)), ...args], { encoding: 'utf8' });
        assert.equal(child.status, 1);
        assert.match(child.stderr, /Output must be outside the Tycho checkout/);
        assert.equal(existsSync(forbidden), false);
      }
    }
    const output = join(temporary, 'audit.json');
    symlinkSync(forbidden, output + '.full.json');
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./stable-batch-tycho.mjs', import.meta.url)),
      root, temporary, 'audit', output], { encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Output must be outside the Tycho checkout/);
    assert.equal(existsSync(forbidden), false);
  } finally { rmSync(temporary, { recursive: true }); }
});
