/**
 * Compiling a destructuring declare/assign whose right-hand side is
 * tuple-VALUED but not a literal `Tuple` — the state-threading idiom
 * `(n, j) := parseDigits(cs, j)`.
 *
 * Such a value lowers through ONE temporary holding the whole tuple plus a
 * positional read per leaf (`BaseCompiler.destructureViaTemp`):
 *
 *     let (v, j) = step(k)
 *       ⟶  let _tv1; _tv1 = step(k); let v = _tv1[1]; let j = _tv1[2]
 *
 * so the value is evaluated EXACTLY ONCE and only then read — the
 * interpreter's order. Every case below therefore checks `run()` against the
 * interpreter, never just `success: true` (a compiled destructuring that reads
 * the wrong thing yields a silent NaN behind `success: true`, which is the bug
 * this whole area exists to prevent).
 *
 * The path is gated: JavaScript only, a FLAT pattern, and a statically-known
 * tuple arity matching the pattern. Everything else keeps the existing
 * fail-closed (D6) refusal so the interpreter evaluates the statement — the
 * literal-tuple lowering (see `declare-destructure.test.ts`) is untouched.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';

const strip = (x: any) =>
  JSON.parse(
    JSON.stringify(x, (k, v) => (k === 'sourceOffsets' ? undefined : v))
  );

/** Run `defs` (function definitions), then box `expr` in the same engine. */
function withDefs(defs: string, expr: any): any {
  const ce = new ComputeEngine();
  executeEpsil(ce, defs);
  return ce.box(expr);
}

/** Run `defs`, then box the Epsil block `src` in the same engine. */
function withDefsBlock(defs: string, src: string): any {
  const ce = new ComputeEngine();
  executeEpsil(ce, defs);
  const [ast] = parseEpsil(src);
  return ce.box(strip(ast));
}

/** Compile `expr` and assert it agrees with the interpreter. */
function agrees(expr: any, expected: number): string {
  const r = compile(expr);
  expect(r?.success).toBe(true);
  expect(r!.run!({})).toBe(expected);
  expect(expr.evaluate().isSame(expected)).toBe(true);
  return r!.code as string;
}

const STEP = 'step(i) = (i + 1, i * 2)\n';

describe('destructuring declare from a tuple-VALUED call', () => {
  test('a declare-from-call compiles and matches the interpreter', () => {
    const expr = withDefs(
      STEP + 'function use(k) {\n  let (v, j) = step(k)\n  v + j\n}',
      ['use', 3]
    );
    // interpreter: (4, 6) → 4 + 6
    agrees(expr, 10);
  });

  test('the lowering binds the call ONCE, then reads positionally', () => {
    // The same statement at block level, where the emitted code (rather than a
    // preamble function body) is inspectable.
    const expr = withDefsBlock(STEP, 'do { let (v, j) = step(3); v + j }');
    const code = agrees(expr, 10);
    // Evaluated exactly once…
    expect(code.match(/_fn_step\(/g)?.length ?? 0).toBe(1);
    // …into a temporary, read back with 1-BASED positional access.
    expect(code).toMatch(/_tv\d+ = _fn_step\(3\)/);
    expect(code).toMatch(/let v = _SYS\.at\(_tv\d+, 1\)/);
    expect(code).toMatch(/let j = _SYS\.at\(_tv\d+, 2\)/);
  });

  test('a `_` position emits no read, and the call still runs once', () => {
    const expr = withDefsBlock(STEP, 'do { let (_, j) = step(3); j }');
    const code = agrees(expr, 6);
    expect(code.match(/_fn_step\(/g)?.length ?? 0).toBe(1);
    expect(code.match(/_SYS\.at\(/g)?.length ?? 0).toBe(1);
    expect(code).toMatch(/let j = _SYS\.at\(_tv\d+, 2\)/);
  });
});

describe('destructuring assign from a tuple-VALUED call', () => {
  test('the state-threading loop step compiles (while)', () => {
    const src =
      STEP +
      'function g(k) {\n' +
      '  let v = 0\n' +
      '  let j = k\n' +
      '  let n = 0\n' +
      '  while n < 3 {\n' +
      '    (v, j) := step(j)\n' +
      '    n = n + 1\n' +
      '  }\n' +
      '  100*v + j\n' +
      '}';
    // j: 1 → 2 → 4 → 8, v = j+1 at each step → v = 5, j = 8
    agrees(withDefs(src, ['g', 1]), 508);
  });

  test('the state-threading loop step compiles (for)', () => {
    const src =
      STEP +
      'function g(k) {\n' +
      '  let v = 0\n' +
      '  let j = k\n' +
      '  for n in 1..3 {\n' +
      '    (v, j) := step(j)\n' +
      '  }\n' +
      '  100*v + j\n' +
      '}';
    agrees(withDefs(src, ['g', 1]), 508);
  });

  test('a bare assign-from-call at block level binds once, then writes', () => {
    const expr = withDefsBlock(
      STEP,
      'do { let v = 0; let j = 1; (v, j) := step(j); 100*v + j }'
    );
    const code = agrees(expr, 202);
    expect(code.match(/_fn_step\(/g)?.length ?? 0).toBe(1);
    // Every read of the temporary happens after the single bind, so the write
    // to `j` cannot clobber the `j` the call reads.
    const bind = code.search(/_tv\d+ = _fn_step\(j\)/);
    expect(bind).toBeGreaterThan(-1);
    expect(code.search(/\bv = _SYS\.at\(_tv/)).toBeGreaterThan(bind);
    expect(code.search(/\bj = _SYS\.at\(_tv/)).toBeGreaterThan(bind);
  });

  test('a `_` position in the assign form still runs the call once', () => {
    const expr = withDefsBlock(
      STEP,
      'do { let j = 1; (_, j) := step(3); j }'
    );
    const code = agrees(expr, 6);
    expect(code.match(/_fn_step\(/g)?.length ?? 0).toBe(1);
    expect(code.match(/_SYS\.at\(/g)?.length ?? 0).toBe(1);
  });
});

describe('two destructurings in one block', () => {
  test('two from-call declares get distinct temporaries', () => {
    const expr = withDefsBlock(
      STEP,
      'do { let (a, b) = step(1); let (c, d) = step(2); ' +
        '1000*a + 100*b + 10*c + d }'
    );
    // step(1) = (2, 2), step(2) = (3, 4)
    const code = agrees(expr, 2234);
    expect(new Set(code.match(/_tv\d+/g)).size).toBe(2);
  });

  test('a literal-tuple assign and a from-call assign coexist', () => {
    const expr = withDefsBlock(
      STEP,
      'do { let x = 1; let y = 2; (x, y) := (y, x); (x, y) := step(x); ' +
        '10*x + y }'
    );
    // after the swap x=2, y=1; step(2) = (3, 4)
    agrees(expr, 34);
  });

  test('a temporary never captures a name the program already uses', () => {
    const expr = withDefsBlock(
      STEP,
      'do { let (v, j) = step(3); let _tv1 = 7; v + j + _tv1 }'
    );
    const code = agrees(expr, 17);
    expect(code).toContain('let _tv1 = 7');
    expect(code).toMatch(/_tv2 = _fn_step\(3\)/);
  });
});

describe('destructuring from a tuple-TYPED symbol', () => {
  test('an annotated tuple PARAMETER rides the same path', () => {
    // A symbol whose static type pins the arity is admitted exactly like a
    // call: the temporary is bound to the symbol's value and read positionally.
    const expr = withDefs(
      'function use(t: tuple<number, number>) {\n' +
        '  let (a, b) = t\n' +
        '  10*a + b\n' +
        '}',
      ['use', ['Tuple', 3, 4]]
    );
    agrees(expr, 34);
  });

  test('a block LOCAL bound to a tuple stays fail-closed (type `unknown`)', () => {
    // PINNED, not endorsed: a block local's declared type is `unknown` (the
    // initializer does not narrow it at box time), so the arity is not
    // statically known and the statement keeps the existing D6 refusal. The
    // interpreter evaluates it correctly.
    const expr = withDefsBlock('', 'do { let p = (3, 4); let (x, y) = p; 10*x + y }');
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/statically-known tuple arity/);
    expect(expr.evaluate().isSame(34)).toBe(true);
  });
});

describe('destructuring from a non-literal value: what still fails closed', () => {
  test('a NESTED pattern over a call value fails closed', () => {
    const expr = withDefs(
      'stepn(i) = ((i, i+1), i*2)\n' +
        'function use(k) {\n  let ((a, b), c) = stepn(k)\n  100*a + 10*b + c\n}',
      ['use', 1]
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/destructuring declaration/);
    // The interpreter handles it: ((1, 2), 2) → 100 + 20 + 2
    expect(expr.evaluate().isSame(122)).toBe(true);
  });

  test('a value with no statically-known tuple arity fails closed', () => {
    // A list-returning call types `vector<2>`, not a tuple: no tuple arity to
    // check the pattern against.
    const expr = withDefs(
      'lst(i) = [i, i + 1]\n' +
        'function use(k) {\n  let (a, b) = lst(k)\n  a + b\n}',
      ['use', 3]
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/statically-known tuple arity/);
  });

  test('a pattern/arity mismatch against a typed value fails closed', () => {
    const expr = withDefs(
      STEP + 'function use(k) {\n  let (a, b, c) = step(k)\n  a + b + c\n}',
      ['use', 3]
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/statically-known tuple arity/);
  });
});

//
// The path is JavaScript-only: the shader targets have no tuple-indexing
// lowering for an untyped local, and the Python target cannot compile a
// user-function call at all. Both must keep the existing D6 refusal — NOT
// miscompile. Probed through a tuple-TYPED symbol (rather than a call, which
// Python refuses for an unrelated reason) so the refusal that fires is this
// gate's.
//
describe('non-JavaScript targets keep the fail-closed refusal', () => {
  const tupleSymbolEngine = () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'tuple<number, number>');
    ce.assign('t', ce.box(['Tuple', 3, 4]));
    return ce;
  };

  // The value goes in a trailing attributes dictionary (`value` key) — the
  // shape the Epsil parser emits, and the one the interpreter's `Declare`
  // binds from for a Tuple pattern.
  const declareBlock = (ce: ComputeEngine) =>
    ce.box([
      'Block',
      [
        'Declare',
        ['Tuple', 'x', 'y'],
        ['Dictionary', ['KeyValuePair', { str: 'value' }, 't']],
      ],
      ['Add', ['Multiply', 10, 'x'], 'y'],
    ]);

  const assignBlock = (ce: ComputeEngine) =>
    ce.box([
      'Block',
      ['Declare', 'a', { str: 'unknown' }, 0],
      ['Declare', 'b', { str: 'unknown' }, 0],
      ['Assign', ['Tuple', 'a', 'b'], 't'],
      ['Add', ['Multiply', 10, 'a'], 'b'],
    ]);

  test('JavaScript compiles both forms, matching the interpreter (control)', () => {
    const declare = declareBlock(tupleSymbolEngine());
    agrees(declare, 34);
    const assign = assignBlock(tupleSymbolEngine());
    agrees(assign, 34);
  });

  for (const to of ['glsl', 'wgsl', 'python', 'interval-js'] as const) {
    test(`${to} fails closed on the declare form`, () => {
      const r = compile(declareBlock(tupleSymbolEngine()), { to });
      expect(r?.success).toBe(false);
      expect(r?.error).toMatch(/destructuring declaration/);
    });

    test(`${to} fails closed on the assign form`, () => {
      const r = compile(assignBlock(tupleSymbolEngine()), { to });
      expect(r?.success).toBe(false);
      expect(r?.error).toMatch(/destructuring assignment/);
    });
  }

  test('glsl fails closed on a destructuring assign inside a loop body', () => {
    const expr = withDefs(
      STEP +
        'function g(k) {\n' +
        '  let v = 0\n' +
        '  let j = k\n' +
        '  for n in 1..3 {\n' +
        '    (v, j) := step(j)\n' +
        '  }\n' +
        '  100*v + j\n' +
        '}',
      ['g', 1]
    );
    const r = compile(expr, { to: 'glsl' });
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/destructuring assignment/);
  });
});

//
// The LITERAL-tuple lowering is untouched: no temporary is minted for it in
// the declare form, and the assign form keeps its per-leaf temporaries.
//
describe('the literal-tuple lowering is unchanged', () => {
  const boxed = (src: string) => {
    const ce = new ComputeEngine();
    const [ast] = parseEpsil(src);
    return ce.box(strip(ast));
  };

  test('a literal-tuple declare still lowers per leaf, with no temporary', () => {
    const code = agrees(boxed('do { let (a, b) = (3, 4); 10*a + b }'), 34);
    expect(code).not.toMatch(/_tv\d+/);
    expect(code).toContain('let a = 3');
    expect(code).toContain('let b = 4');
  });

  test('a literal-tuple assign still lowers to per-leaf temporaries', () => {
    const code = agrees(
      boxed('do { let a = 1; let b = 2; (a, b) := (b, a); 10*a + b }'),
      21
    );
    expect(code.match(/_tv\d+ =/g)?.length ?? 0).toBe(2);
    expect(code).not.toMatch(/_SYS\.at\(/);
  });
});
