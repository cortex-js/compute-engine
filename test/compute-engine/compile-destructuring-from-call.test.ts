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
// The POSITIONAL value form of a destructuring declare — `Declare(pattern,
// "unknown", value)`, the shape a hand-written MathJSON program uses. The
// fixtures above all put the value in a trailing attributes dictionary
// because the compiler read EITHER shape while the interpreter's `Declare`
// read only the dictionary one, so a positional value compiled to the right
// answer and interpreted to a silently-unbound pattern. Parity is now
// pinnable.
//
describe('the positional value form agrees with the interpreter', () => {
  test('a positional-value declare-from-call compiles and matches', () => {
    const expr = withDefs(STEP, [
      'Block',
      ['Declare', ['Tuple', 'v', 'j'], { str: 'unknown' }, ['step', 3]],
      ['Add', 'v', 'j'],
    ]);
    // step(3) = (4, 6) → 4 + 6, through the one-temporary lowering.
    const code = agrees(expr, 10);
    expect(code).toMatch(/_tv\d+ = _fn_step\(3\)/);
  });
});

//
// The interpreter's destructuring `Assign` is ATOMIC: every leaf is validated
// against its target's existing binding — a `const` target, a value that does
// not fit a declared type — in a read-only pre-pass, and one rejection leaves
// the WHOLE pattern unwritten. The compiled lowering is a sequence of plain
// per-leaf writes with no such validation, so it must not accept a pattern the
// interpreter refuses.
//
describe('a destructuring assign the interpreter would refuse fails closed', () => {
  const boxedBlock = (src: string) => {
    const ce = new ComputeEngine();
    const [ast] = parseEpsil(src);
    return ce.box(strip(ast));
  };

  test('a DECLARED-TYPE target fails closed (it wrote both, atomically refused)', () => {
    // `x, y: integer` and a float leaf: the interpreter rejects the assignment
    // whole, so neither target moves and the block is `100*1 + 2`. Compiled, the
    // writes went through and the block ran to 704.5.
    const expr = boxedBlock(
      'do { let x: integer = 1; let y: integer = 2; (x, y) := (7, 4.5); 100*x + y }'
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/declared type|declared type of/);
    expect(r?.error).toMatch(/Fail closed \(D6\)/);
    expect(expr.evaluate().isSame(102)).toBe(true);
  });

  test('a declared-type target fails closed even when the value FITS', () => {
    // The gate is on the DECLARATION, not on the values: the lowering has no
    // way to enforce the type, so it declines regardless. The interpreter
    // accepts this one, and the fallback answers it.
    const expr = boxedBlock(
      'do { let x: integer = 1; let y: integer = 2; (x, y) := (7, 4); 100*x + y }'
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(expr.evaluate().isSame(704)).toBe(true);
  });

  test('a CONST target fails closed (it was silently overwritten)', () => {
    const expr = boxedBlock(
      'do { const x = 1; let y = 2; (x, y) := (7, 4); 100*x + y }'
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/constant/);
    // The interpreter refuses outright.
    expect(() => expr.evaluate()).toThrow(/constant/);
  });

  test('a target declared in an ENCLOSING scope is caught too', () => {
    // Not a block local: an `ce.declare`d symbol with a stated type. Its
    // definition is installed, so the desugar reads it off the engine.
    const ce = new ComputeEngine();
    ce.declare('gx', 'integer');
    ce.declare('gy', 'integer');
    const expr = ce.box([
      'Block',
      ['Assign', ['Tuple', 'gx', 'gy'], ['Tuple', 7, 4.5]],
      ['Add', ['Multiply', 100, 'gx'], 'gy'],
    ]);
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/declared type of 'gx'/);
  });

  test('the from-CALL path is gated too, before any temporary is minted', () => {
    const expr = withDefs(
      STEP +
        'function g(k) {\n' +
        '  let v: integer = 0\n' +
        '  let j = k\n' +
        '  (v, j) := step(j)\n' +
        '  100*v + j\n' +
        '}',
      ['g', 1]
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/destructuring assignment/);
  });

  test('a nested LOOP BODY sees the enclosing block declarations', () => {
    // `compileLoopBody` is handed the body's statements alone, so the outer
    // block's `let v: integer` is invisible to it unless the harvested frame is
    // pushed. It was not: the loop compiled and ran to 254 where the
    // interpreter — refusing every iteration's assignment atomically — answers
    // 1.
    const expr = withDefs(
      'stepf(i) = (i + 0.5, i * 2)\n' +
        'function g(k) {\n' +
        '  let v: integer = 0\n' +
        '  let j = k\n' +
        '  let n = 0\n' +
        '  while n < 2 {\n' +
        '    (v, j) := stepf(j)\n' +
        '    n = n + 1\n' +
        '  }\n' +
        '  100*v + j\n' +
        '}',
      ['g', 1]
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/destructuring assignment/);
    expect(expr.evaluate().isSame(1)).toBe(true);
  });

  test('an UNTYPED / inferred target still compiles, byte-identically', () => {
    // The state-threading idiom must be untouched: nothing is enforced on an
    // untyped local, so the sequence of writes IS the interpreter's outcome.
    const code = agrees(
      boxedBlock('do { let x = 1; let y = 2; (x, y) := (7, 4.5); 100*x + y }'),
      704.5
    );
    expect(code.match(/_tv\d+ =/g)?.length ?? 0).toBe(2);
  });
});

//
// A destructuring `Declare` that STATES a type. Both lowerings rewrite every
// leaf as `Declare(name, "unknown", value)`, dropping the type — so the
// declaration bound every name where the interpreter validates each leaf
// against the type and rejects the whole pattern atomically.
//
describe('a destructuring declare that states a type fails closed', () => {
  test('the literal-tuple form declines (it bound both names)', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', ['Tuple', 'x', 'y'], { str: 'integer' }, ['Tuple', 3, 4.5]],
      ['Add', ['Multiply', 10, 'x'], 'y'],
    ]);
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/states a type/);
    expect(r?.error).toMatch(/Fail closed \(D6\)/);
    // The interpreter binds NEITHER name, so the sum stays symbolic.
    expect(expr.evaluate().isSame(34.5)).toBe(false);
  });

  test('it declines even when every leaf value FITS the type', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', ['Tuple', 'x', 'y'], { str: 'integer' }, ['Tuple', 3, 4]],
      ['Add', ['Multiply', 10, 'x'], 'y'],
    ]);
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(expr.evaluate().isSame(34)).toBe(true);
  });

  test('the from-CALL form declines', () => {
    const expr = withDefs(STEP, [
      'Block',
      ['Declare', ['Tuple', 'v', 'j'], { str: 'integer' }, ['step', 3]],
      ['Add', 'v', 'j'],
    ]);
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/states a type/);
  });

  test('the `"unknown"` filler is NOT a stated type — it keeps compiling', () => {
    // The only spelling the Epsil surface emits in that slot (a `:` annotation
    // on a destructuring `let` is a parse diagnostic), so the idiomatic path is
    // unaffected.
    const expr = withDefs('', [
      'Block',
      ['Declare', ['Tuple', 'x', 'y'], { str: 'unknown' }, ['Tuple', 3, 4.5]],
      ['Add', ['Multiply', 10, 'x'], 'y'],
    ]);
    agrees(expr, 34.5);
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

//
// A typed function PARAMETER as a destructuring-assign target. The declared
// type lives on the lambda literal's parameter operands (`Typed(x,
// "integer")`), in a scope that is not installed while the body compiles — so
// neither the definition lookup nor the block-local `Declare` harvest can see
// it, and the assignment ran to completion compiled where the interpreter
// refuses it whole. The emitted body now enters its annotated parameters as an
// enforced-target frame (`withEnforcedParams`).
//
describe('an annotated PARAMETER as a destructuring-assign target', () => {
  test('a typed parameter target fails closed (it wrote both leaves)', () => {
    const expr = withDefs(
      'function f(x: integer, y: integer) {\n' +
        '  (x, y) := (7, 4.5)\n' +
        '  100*x + y\n' +
        '}',
      ['f', 1, 2]
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/destructuring assignment/);
    expect(r?.error).toMatch(/declared type|declared as a constant/);
    expect(r?.error).toMatch(/Fail closed \(D6\)/);
    // The interpreter refuses the assignment atomically: neither parameter
    // moves, so the body is 100*1 + 2. Compiled, it ran to 704.5.
    expect(expr.evaluate().isSame(102)).toBe(true);
  });

  test('an annotated parameter NOT targeted by the pattern still compiles', () => {
    // The annotation matters only for a pattern TARGET: `n` and `k` are read,
    // never written, so the per-leaf writes to the untyped locals `a`/`b` are
    // exactly the interpreter's outcome.
    const expr = withDefs(
      'function f(n: integer, k) {\n' +
        '  let a = 0\n' +
        '  let b = 0\n' +
        '  (a, b) := (k, n)\n' +
        '  a + b\n' +
        '}',
      ['f', 3, 4]
    );
    agrees(expr, 7);
  });

  test('a destructuring assign in a WHILE body inside a typed-param function declines', () => {
    // `compileLoopBody` sees the body's statements alone, so the parameter
    // frame — pushed for the whole body compile — is the only route to the
    // annotation from inside the loop.
    const expr = withDefs(
      'stepf(i) = (i + 0.5, i * 2)\n' +
        'function f(x: integer, k) {\n' +
        '  let j = k\n' +
        '  let n = 0\n' +
        '  while n < 2 {\n' +
        '    (x, j) := stepf(j)\n' +
        '    n = n + 1\n' +
        '  }\n' +
        '  100*x + j\n' +
        '}',
      ['f', 1, 1]
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/destructuring assignment/);
    // Every iteration's assignment is refused whole, so neither `x` nor `j`
    // moves: 100*1 + 1.
    expect(expr.evaluate().isSame(101)).toBe(true);
  });

  test('an UNANNOTATED parameter target still compiles (state threading)', () => {
    // The pin this must not disturb: nothing is enforced on an unannotated
    // parameter, so the per-leaf writes stand.
    const expr = withDefs(
      STEP +
        'function g(k) {\n' +
        '  let v = 0\n' +
        '  let j = k\n' +
        '  (v, j) := step(j)\n' +
        '  100*v + j\n' +
        '}',
      ['g', 1]
    );
    // step(1) = (2, 2)
    agrees(expr, 202);
  });

  test('a typed local at the CALL SITE does not make the callee decline', () => {
    // An emitted definition is a module-level function, so the requesting
    // block's frames must not apply to its body: `x` here is the caller's
    // typed local, and `g`'s own `x` is an unannotated parameter.
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      STEP + 'function g(x) {\n  let j = x\n  (x, j) := step(j)\n  100*x + j\n}'
    );
    const [ast] = parseEpsil('do { let x: integer = 1; x + g(1) }');
    const expr = ce.box(strip(ast));
    // g(1): j = 1, step(1) = (2, 2) → 100*2 + 2 = 202, plus the caller's 1
    agrees(expr, 203);
  });

  test('the DIRECT lambda-compile route enforces annotations too', () => {
    // `compile()` of a `Function` literal (the `calling: 'lambda'` convention)
    // compiles the body without going through `emitFunctionLiteralDefinition`;
    // it must wrap the body in the same enforced-parameter frame — without it,
    // this literal compiled and wrote both leaves (ran to 704.5) where the
    // interpreter atomically declines.
    const ce = new ComputeEngine();
    ce.pushScope();
    const lit = ce.box([
      'Function',
      [
        'Block',
        ['Assign', ['Tuple', 'x', 'y'], ['Tuple', 7, 4.5]],
        ['Add', ['Multiply', 100, 'x'], 'y'],
      ],
      ['Typed', 'x', { str: 'integer' }],
      ['Typed', 'y', { str: 'integer' }],
    ]);
    const r = compile(lit);
    expect(r.success).toBe(false);
  });

  test('the DIRECT lambda-compile route keeps unannotated params compiling', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const lit = ce.box([
      'Function',
      [
        'Block',
        ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 7, 8]],
        ['Add', 'a', 'b'],
      ],
      'a',
      'b',
    ]);
    const r = compile(lit);
    expect(r.success).toBe(true);
    if (r.success)
      expect((r.run as unknown as (a: number, b: number) => number)(1, 2)).toBe(
        15
      );
  });
});
