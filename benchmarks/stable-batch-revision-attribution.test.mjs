import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('recursive allocation inclusive counts each byte once per function identity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'revision-attribution-'));
  try {
    const frame = { functionName: 'recursive', url: 'synthetic', lineNumber: 0, columnNumber: 0 };
    const input = join(dir, 'profile.json'); const output = join(dir, 'output.json');
    writeFileSync(input, JSON.stringify({ head: { callFrame: frame, selfSize: 10, children: [{ callFrame: frame, selfSize: 20, children: [] }] } }));
    execFileSync(process.execPath, [new URL('./stable-batch-revision-attribution.mjs', import.meta.url).pathname, input, output]);
    const result = JSON.parse(readFileSync(output));
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].self, 30);
    assert.equal(result.rows[0].inclusive, 30);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
