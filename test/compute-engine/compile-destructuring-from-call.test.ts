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
 * fail-closed refusal so the interpreter evaluates the statement — the
 * literal-tuple lowering (see `declare-destructure.test.ts`) is untouched.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { operand, operator } from '../../src/math-json/utils';

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

const STEP = 'step(i) = (i + 1, i * 2)\n';

describe('destructuring from a non-literal value: what still fails closed', () => {
  test('a NESTED pattern over a call value fails closed', () => {
    const expr = withDefs(
      'stepn(i) = ((i, i+1), i*2)\n' +
        'function use(k) {\n  let ((a, b), c) = stepn(k)\n  100*a + 10*b + c\n}',
      ['use', 1]
    );
    // `constantFold: false`: the call has no free variables, so compile-time
    // constant folding would otherwise evaluate the whole expression and emit
    // `122` as a literal, bypassing the fail-closed path under test.
    const r = compile(expr, { constantFold: false });
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/Could not compile/);
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
    expect(r?.error).toMatch(/Could not compile/);
  });

  test('a pattern/arity mismatch against a typed value fails closed', () => {
    const expr = withDefs(
      STEP + 'function use(k) {\n  let (a, b, c) = step(k)\n  a + b + c\n}',
      ['use', 3]
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/Could not compile/);
  });
});

//
// The interval mode has no destructuring: it must keep the refusal — NOT
// miscompile. GLSL compiles a declaration of a point (CE-1478) and keeps the
// refusal of the assign form. Probed through a tuple-TYPED symbol (rather
// than a call) so the refusal that fires is this gate's.
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

  // GLSL reads a point at each index (CE-1478): the value of `t` is a
  // constant, so the shader is that of the interpreter's value, 34.
  test('glsl compiles the declare form of a point', () => {
    const ce = tupleSymbolEngine();
    const r = compile(declareBlock(ce), { to: 'glsl' });
    expect(r?.success).toBe(true);
    expect(r?.code).toBe('34.0');
    expect(declareBlock(ce).evaluate().re).toBe(34);
  });

  test('interval-js fails closed on the declare form', () => {
    const r = compile(declareBlock(tupleSymbolEngine()), {
      to: 'interval-js',
    });
    expect(r?.success).toBe(false);
    // The interval mode has no destructuring declaration.
    expect(r?.diagnostic?.code).toBe('outside-profile');
    expect(r?.diagnostic?.operator).toBe('Declare');
  });

  for (const to of ['glsl', 'interval-js'] as const) {
    test(`${to} fails closed on the assign form`, () => {
      const r = compile(assignBlock(tupleSymbolEngine()), { to });
      expect(r?.success).toBe(false);
      // The interval mode has no destructuring assignment.
      if (to === 'interval-js') {
        expect(r?.diagnostic?.code).toBe('outside-profile');
        expect(r?.diagnostic?.operator).toBe('Assign');
      } else expect(r?.error).toMatch(/Could not compile/);
    });
  }
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
    expect(operator(ast!)).toBe('Program');
    expect(operator(operand(ast!, 1))).toBe('Block');
    return ce.box(strip(operand(ast!, 1)));
  };

  test('a DECLARED-TYPE target fails closed (it wrote both, atomically refused)', () => {
    // `x, y: integer` and a float leaf: the interpreter rejects the assignment
    // whole, so neither target moves. Compiled, the writes went through and
    // the block ran to 704.5.
    const expr = boxedBlock(
      'do { let x: integer = 1; let y: integer = 2; (x, y) := (7, 4.5); 100*x + y }'
    );
    // The leaf `y` is checked against its declared type when the block is
    // canonicalized: the assignment is the static error
    // `assignment-type-mismatch`, and the compilation declines.
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/Could not compile/);
    expect(r?.error).toMatch(/Could not compile/);
    // The static error is the value of the block.
    const result = expr.evaluate();
    expect(result.operator).toBe('Error');
    expect(result.toString()).toMatch(/assignment-type-mismatch/);
  });

  test('a declared-type target fails closed when the static type of a value does not prove the type', () => {
    // `y` has the declared type `integer`, and `x / 2` has the static type
    // `rational`: the interpreter checks the value at run time (here `1`,
    // which fits), and the compiled write cannot.
    const expr = boxedBlock(
      'do { let x: integer = 2; let y: integer = 2; (x, y) := (7, x / 2); 100*x + y }'
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/Could not compile/);
    expect(expr.evaluate().isSame(701)).toBe(true);
  });

  test('a CONST target fails closed (it was silently overwritten)', () => {
    const expr = boxedBlock(
      'do { const x = 1; let y = 2; (x, y) := (7, 4); 100*x + y }'
    );
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/Could not compile/);
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
    // `7` has the static type `integer`, which proves the type of `gx`;
    // `4.5` does not prove the type of `gy`.
    expect(r?.error).toMatch(/Could not compile/);
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
    // `constantFold: false`: `g(1)` has no free variables, so compile-time
    // constant folding would otherwise emit a literal and never reach the
    // destructuring-assignment refusal under test.
    const r = compile(expr, { constantFold: false });
    expect(r?.success).toBe(false);
    expect(r?.error).toMatch(/Could not compile/);
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
    expect(r?.error).toMatch(/Could not compile/);
    // The refused assignment's error value short-circuits the body (it
    // used to be discarded every iteration, and the call answered 1), and
    // the application answers with that error: a user function bubbles the
    // error value its body produces (it used to decline and stay inert).
    const refused = expr.evaluate().toString();
    expect(refused).toContain('incompatible-type');
    expect(refused).toContain('"v"');
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
    expect(r?.error).toMatch(/Could not compile/);
    expect(r?.error).toMatch(/Could not compile/);
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
    expect(r?.error).toMatch(/Could not compile/);
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
    expect(r?.error).toMatch(/Could not compile/);
    expect(r?.error).toMatch(/Could not compile/);
    expect(r?.error).toMatch(/Could not compile/);
    // The interpreter refuses the assignment atomically: neither parameter
    // moves. Compiled, it ran to 704.5. The refusal's error value
    // short-circuits the body (it used to be discarded, and the call
    // answered 102) and is the application's answer: a user function bubbles
    // the error value its body produces (it used to decline and stay inert).
    const refused = expr.evaluate().toString();
    expect(refused).toContain('incompatible-type');
    expect(refused).toContain('"y"');
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
    expect(r?.error).toMatch(/Could not compile/);
    // Every iteration's assignment is refused whole, so neither `x` nor `j`
    // moves. The refusal's error value stops the loop on iteration 1,
    // short-circuits the body (it used to be discarded, and the call
    // answered 101) and is the application's answer: a user function bubbles
    // the error value its body produces (it used to decline and stay inert).
    const refused = expr.evaluate().toString();
    expect(refused).toContain('incompatible-type');
    expect(refused).toContain('"x"');
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
});
