// One compile of a deeply nested expression, as the first compile of this
// file, for `scripts/compiler-growth.mjs`. That script finds the compile
// depth limit of a `Sin`/`Cos` chain with a binary search: each step is one
// Jest run in which this file runs after a fixed set of other compile test
// files, so that its one compile is the first compile in a warm Jest worker,
// the case with the smallest stack budget (see the comment in
// `test/compute-engine/compile-deep-nesting.test.ts`).
//
// The file does nothing unless `CE_COMPILE_DEPTH_PROBE` gives the depth and
// `CE_COMPILE_DEPTH_PROBE_OUT` names the file that receives the result, one
// line: `<depth> ok`, or `<depth> fail` when the compile did not succeed.
// The test itself always passes: the result is the line in that file.

import { writeFileSync } from 'node:fs';
import { ComputeEngine } from '../../../src/compute-engine';
import { compile } from '../../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../../src/compute-engine/global-types';

const DEPTH = Number(process.env.CE_COMPILE_DEPTH_PROBE ?? '');
const OUT = process.env.CE_COMPILE_DEPTH_PROBE_OUT ?? '';
const ACTIVE = Number.isInteger(DEPTH) && DEPTH > 0 && OUT !== '';
const describeProbe = ACTIVE ? describe : describe.skip;

/** `Sin(Cos(Sin(… x)))`, `depth` levels, as in compile-deep-nesting. */
function chain(ce: ComputeEngine, depth: number): Expression {
  let e: Expression = ce.symbol('x');
  for (let i = 0; i < depth; i++) e = ce.function(i % 2 ? 'Cos' : 'Sin', [e]);
  return e;
}

describeProbe('compile depth probe', () => {
  test('one compile of a chain at the requested depth', () => {
    const e = chain(new ComputeEngine(), DEPTH);
    let ok = false;
    try {
      ok = compile(e).success === true;
    } catch {
      ok = false;
    }
    writeFileSync(OUT, `${DEPTH} ${ok ? 'ok' : 'fail'}\n`);
  });
});
