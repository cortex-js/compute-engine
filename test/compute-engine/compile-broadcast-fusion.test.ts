/**
 * Nested run-time broadcasts fused into one closure on the JavaScript target.
 *
 * Scalar arithmetic over a list whose width the compiler cannot see (a
 * declared `list<number>` input) lowers to the run-time helper `_SYS.bcast`,
 * one call per head: `(L − 1) mod 15 + 7` built three intermediate arrays and
 * ran four element loops. The implicit-surface rows of the Tycho
 * code-generation audit document `art/khpocp8io0` nested twelve such calls
 * over a 225-element list, at 21 µs a sample against 2.7 µs for one loop.
 * The emitter (`BaseCompiler.emitFusedBroadcast`) now absorbs an operand
 * that is itself a plain broadcast into the enclosing closure: the inner
 * element parameters join the outer ones, the inner operand sources join the
 * call, and the inner result is bound to the outer parameter inside the
 * closure body. One call, one loop, no intermediate array.
 *
 * What is NOT absorbed, and why: a temporary the common-subexpression pass
 * bound (a value read twice is still computed once), a user-function
 * dispatch (`_SYS.bcastFn`), and any operand source, which is evaluated once
 * as a call argument in both forms.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('L', 'list<number>');
ce.declare('M', 'list<number>');
for (const s of ['x', 'y', 'z', 'a']) ce.declare(s, 'real');

const LIST = [3, 7, 11, 20, 31];
const INPUT = { L: LIST, M: [1, 2, 3, 4, 5], x: 3.2, y: 4.1, z: 2, a: 0.5 };

function interpreted(json: unknown): number[] {
  const expr = ce.box(json);
  const value = expr
    .subs({
      L: ce.box(['List', ...LIST]),
      M: ce.box(['List', ...INPUT.M]),
      x: ce.number(INPUT.x),
      y: ce.number(INPUT.y),
      z: ce.number(INPUT.z),
      a: ce.number(INPUT.a),
    })
    .N();
  return [...(value as any).each()].map((e: any) => e.re as number);
}

function sites(code: string): number {
  return (code.match(/_SYS\.bcast\(/g) ?? []).length;
}

function expectParity(json: unknown): string {
  const r = compile(ce.box(json), { fallback: false });
  expect(r.success).toBe(true);
  const got = r.run!(INPUT) as number[];
  const want = interpreted(json);
  expect(got.length).toBe(want.length);
  got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 12));
  return r.code!;
}

describe('Nested broadcasts fuse into one closure', () => {
  test('a chain of arithmetic heads over one list is one call', () => {
    const code = expectParity([
      'Add',
      ['Multiply', 2, ['Add', ['Mod', ['Subtract', 'L', 1], 15], 7]],
      'x',
    ]);
    expect(sites(code)).toBe(1);
    // The absorbed operands are `const` bindings inside the closure body.
    expect(code).toMatch(/=> \{ const _tv\d+ = /);
  });

  test('two lists zipped through the chain', () => {
    const code = expectParity([
      'Add',
      ['Multiply', ['Add', 'L', 1], ['Subtract', 'M', 'a']],
      ['Divide', 'M', 2],
    ]);
    expect(sites(code)).toBe(1);
  });

  test('a repeated list source is passed once', () => {
    const code = expectParity([
      'Add',
      ['Multiply', ['Add', 'L', 1], ['Add', 'L', 2]],
      1,
    ]);
    expect(sites(code)).toBe(1);
    expect(code.split('_.L').length - 1).toBe(1);
  });

  test('the audit implicit-surface row is one loop', () => {
    const row = ce.parse(
      String.raw`(y-(L-1)\bmod 15+7)^2+(x-\lfloor\frac{1}{15}(L-1)\rfloor+7)^2+2(z-2.25)^2-0.25`
    );
    const r = compile(row, { fallback: false });
    expect(r.success).toBe(true);
    expect(sites(r.code!)).toBe(1);
    const got = r.run!(INPUT) as number[];
    const want = interpreted(row.json);
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 10));
  });

  test('a value read twice is bound once and computed once', () => {
    // `(L + 1)` is read by both factors: the common-subexpression pass binds
    // it, and the fused closure reads the temporary — the broadcast that
    // computes it is emitted once, not absorbed into each reader.
    const shared = ['Sin', ['Add', ['Multiply', 'L', 2], 1]];
    const code = expectParity(['Multiply', shared, ['Cos', shared]]);
    expect(code).toMatch(/_cse\d+ = _SYS\.bcast\(/);
    expect(code.split('_.L').length - 1).toBe(1);
    // The temporary is the outer call's one list source, read once.
    expect(code).toMatch(/\}, _cse\d+\)/);
  });

  test('an operand with an effect keeps the nested form', () => {
    // Fusion moves the element reads after every call argument has run;
    // with a draw among the arguments the order is kept as written, and the
    // draw stays one call argument, made once.
    const r = compile(ce.box(['Add', ['Multiply', 'L', ['Random']], 1]), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    const code = r.code!;
    expect(sites(code)).toBe(2);
    expect(code.split('_SYS.drawNextRandomNumber()').length - 1).toBe(1);
    const out = r.run!(INPUT) as number[];
    // One draw for every element: the ratios are all the same.
    const k = (out[0] - 1) / LIST[0];
    out.forEach((v, i) => expect((v - 1) / LIST[i]).toBeCloseTo(k, 12));
  });

  test('a caller-supplied operand keeps the nested order', () => {
    // `Cos` is the caller's own code; it may hand `L` on to code this
    // compiler never sees. The absorbable `Sin(L)` stays a nested call, so
    // its elements are read before the caller's code runs.
    const r = compile(ce.box(['Add', ['Sin', 'L'], ['Cos', 'x']]), {
      fallback: false,
      functions: { Cos: '_.myCos' },
    });
    expect(r.success).toBe(true);
    expect(sites(r.code!)).toBe(2);
    expect(r.code).toContain('_.myCos(');
  });

  test('an error position is NaN in both forms', () => {
    // The nested form answered `[NaN, NaN]` for `Sin([]) + M`, an array of
    // M's length, and the fused form answers one NaN: the runtime helper
    // reads the empty list and the two-element list as a length mismatch.
    // The interpreter answers `[1, 2]` (a `Nothing` operand leaves a sum)
    // for the empty list and an `incompatible-dimensions` error for
    // `Sin([1, 2, 3]) + [1, 2]`, so neither form was faithful before; see
    // the open ruling on a broadcast over a lone empty operand in
    // `ROADMAP.md`.
    const r = compile(ce.box(['Add', ['Sin', 'L'], 'M']), { fallback: false });
    expect(r.success).toBe(true);
    expect(sites(r.code!)).toBe(1);
    expect(r.run!({ L: [], M: [1, 2] })).toBeNaN();
    expect(r.run!({ L: [1, 2, 3], M: [1, 2] })).toBeNaN();
  });

  test('a user-function dispatch is not absorbed', () => {
    ce.declare('sq', 'function');
    ce.assign('sq', ce.parse('t \\mapsto t^2 + 1'));
    const r = compile(ce.box(['Add', ['sq', 'L'], 1]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.bcastFn(');
    const out = r.run!(INPUT) as number[];
    out.forEach((v, i) => expect(v).toBeCloseTo(LIST[i] ** 2 + 2, 12));
  });

  test('a scalar input beside the list is still a scalar', () => {
    const r = compile(ce.box(['Add', ['Multiply', 2, 'L'], 'x']), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run!({ L: 4, x: 1 })).toBe(9);
  });
});
