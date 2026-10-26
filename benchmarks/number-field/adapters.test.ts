import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { corpus } from './corpus.js';
import { verify } from './verify.js';

test(
  'external PARI adapter returns factors in the supplied field basis',
  {
    skip: !existsSync(
      'build/factoring-backends/node_modules/@sagemath/pari/dist/gp-sta.js'
    ),
  },
  () => {
    const cases = corpus('extended').filter(
      (c) => c.family === 'nonintegral-generator' || c.id.startsWith('source-')
    );
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'benchmarks/number-field/worker.ts', 'pari'],
      {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
        input:
          cases
            .map(({ id, modulus, coefficients }) =>
              JSON.stringify({ id, modulus, coefficients })
            )
            .join('\n') + '\n',
      }
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    const rows = child.stdout
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s));
    assert.equal(rows.shift().ready, true);
    assert.equal(rows.length, cases.length);
    for (const [i, row] of rows.entries()) {
      assert.equal(row.id, cases[i].id, JSON.stringify(row));
      assert.equal(row.result.status, 'complete');
      verify(cases[i], row.result);
    }
  }
);
