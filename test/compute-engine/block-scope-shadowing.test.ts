import { engine as ce } from '../utils';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

/**
 * Two engine-semantics behaviors for statement-position constructs:
 *
 * 1. A bare *symbol* `Break`/`Continue` (as opposed to the function form
 *    `Break()`/`Continue()`) in statement position canonicalizes to an error.
 *
 * 2. A block-local `Declare` of a constant-named symbol (`i`, `e`, `Pi`, …)
 *    shadows the constant for the rest of the block, so subsequent uses are
 *    ordinary variables (no imaginary-unit / e / Pi folding). The shadow ends
 *    at block exit.
 */

/** True if the expression tree contains an `Error` node. */
function hasError(expr: any): boolean {
  if (!expr) return false;
  if (expr.operator === 'Error') return true;
  return (expr.ops ?? []).some((op: any) => hasError(op));
}

describe('bare Break/Continue in statement position → Error', () => {
  test('bare `Break` as a Block statement is an error', () => {
    const block = ce.box(['Block', 'Break', ['Assign', 'x', 1]]);
    expect(block.ops![0].operator).toBe('Error');
  });

  test('bare `Continue` in an If branch inside a Loop is an error', () => {
    const loop = ce.box([
      'Loop',
      ['If', ['Equal', 'x', 1], 'Continue', ['Assign', 'x', 1]],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(hasError(loop)).toBe(true);
  });

  test('function form `Break()` in a Block stays valid', () => {
    const block = ce.box(['Block', ['Break'], ['Assign', 'x', 1]]);
    expect(block.ops![0].operator).toBe('Break');
    expect(hasError(block)).toBe(false);
  });

  test('function form `Continue()` in an If branch inside a Loop stays valid', () => {
    const loop = ce.box([
      'Loop',
      ['If', ['Equal', 'x', 1], ['Continue'], ['Assign', 'x', 1]],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(hasError(loop)).toBe(false);
  });

  test('bare `Return` is left untouched (not an error)', () => {
    const block = ce.box(['Block', 'Return', ['Assign', 'x', 1]]);
    expect(block.ops![0].operator).not.toBe('Error');
  });
});

describe('block-local Declare shadows a constant-named symbol', () => {
  test('local `i` shadows the imaginary unit (no Complex fold), evaluates to 4', () => {
    const block = ce.box([
      'Block',
      ['Declare', 'i', { str: 'integer' }],
      ['Assign', 'i', 3],
      ['Add', 'i', 1],
    ]);
    // The trailing `Add(i, 1)` must NOT fold to `Complex(1, 1)`.
    expect(block.ops![2].operator).not.toBe('Complex');
    expect(block.evaluate().toString()).toBe('4');
  });

  test('local `e` shadows Euler’s number, evaluates to 6', () => {
    const block = ce.box([
      'Block',
      ['Declare', 'e', { str: 'integer' }],
      ['Assign', 'e', 2],
      ['Multiply', 'e', 3],
    ]);
    expect(block.evaluate().toString()).toBe('6');
  });

  test('after the Block, `i` is the imaginary unit again', () => {
    ce.box([
      'Block',
      ['Declare', 'i', { str: 'integer' }],
      ['Assign', 'i', 3],
      ['Add', 'i', 1],
    ]);
    // A fresh `Add(i, 1)` outside any block folds to the imaginary unit.
    expect(ce.box(['Add', 'i', 1]).operator).toBe('Complex');
  });

  test('Python compile of a Block declaring a local `i` emits bare `i`', () => {
    const python = new PythonTarget();
    const block = ce.box([
      'Block',
      ['Declare', 'i', { str: 'integer' }],
      ['Assign', 'i', 3],
      ['Add', 'i', 1],
    ]);
    const code = python.compile(block).code;
    expect(code).not.toContain('complex');
    expect(code).toContain('i + 1');
  });

  test('`Assign(i, 3)` without a Declare still throws (constant)', () => {
    expect(() => ce.box(['Block', ['Assign', 'i', 3]]).evaluate()).toThrow(
      /constant/
    );
  });
});

describe('a function CLAUSE named after a builtin shadows it, never writes through', () => {
  // `defineFunctionClause` (`multi-clause.ts`) clears `existing` when the name
  // resolves to a system-scope builtin, then its single-clause branch delegates
  // to `ce.assign` — which resolves a name up the WHOLE scope chain and mutates
  // what it finds in place. On the face of it that delegation could overwrite
  // the builtin's own binding instead of creating a current-scope shadow, which
  // is what the protocol DISPATCHER path had to be given
  // `declareShadowingFunction` to avoid.
  //
  // MEASURED: it cannot, and not because of any one guard. By the time
  // `defineFunctionClause` runs, the current scope ALREADY holds its own
  // binding for the name and `existing` is never the system-scope definition —
  // so the builtin is structurally out of `assign`'s reach and the `isBuiltin`
  // branch is not even the operative protection on this route. Several layers
  // put that binding there (the unconditional `DefineFunction` hoist in
  // `control-structures.ts`, the recursion-knot shell in `core.ts`, and
  // `assign`'s own `shadowBuiltin` test in `engine-declarations.ts`), and
  // disabling any ONE of them individually still leaves the builtin intact.
  //
  // So this is an END-TO-END BEHAVIOR PIN, not a guard pin: it does not fail if
  // a single layer is removed, and it is not evidence that any particular layer
  // is load-bearing. What it catches is a refactor that removes the protection
  // wholesale — the shape the entry was filed about — and it records the
  // measurement, so the next reader does not re-derive it from scratch.
  //
  // Imported lazily: the rest of this file drives the shared engine from
  // `../utils`, while these probes each need a FRESH one (a shadow install is
  // engine state) plus the Epsil surface for the `do { … }` block form.
  const { ComputeEngine: Engine } =
    require('../../src/compute-engine') as typeof import('../../src/compute-engine');
  const {
    executeEpsil,
  } = require('../../src/epsil/execute-epsil') as typeof import('../../src/epsil/execute-epsil');

  /** Define a one-clause `name` inside a block and call it there; then use the
   * name again OUTSIDE the block. Returns both values plus whether the system
   * scope's definition record survived untouched.
   *
   * The two call sites are given separately because they are asking different
   * questions. `innerCall` must reach the user's clause, so it passes a SCALAR:
   * the clause's parameter is unannotated, and handing `Length` a list would
   * broadcast elementwise (`[42,42,42]`) — true, documented, and beside the
   * point here. `outerCall` is whatever exercises the builtin naturally, which
   * for a value-bound builtin like `Pi` is the bare name. */
  function shadowProbe(name: string, innerCall: string, outerCall: string) {
    const engine = new Engine();
    const systemScope = engine.contextStack[0]?.lexicalScope;
    const before = systemScope?.bindings.get(name);
    const result = executeEpsil(
      engine,
      `let inner = do { function ${name}(x) { 42 }; ${innerCall} }\nlet outer = ${outerCall}`
    );
    return {
      diagnostics: result.diagnostics ?? [],
      inner: engine.box('inner').evaluate().toString(),
      outer: engine.box('outer').evaluate().toString(),
      systemDefUntouched: systemScope?.bindings.get(name) === before,
    };
  }

  test.each([
    ['Sin', 'Sin(0)', 'Sin(0)', '0'],
    ['Abs', 'Abs(-3)', 'Abs(-3)', '3'],
    ['Length', 'Length(0)', 'Length([1,2,3])', '3'],
  ])(
    'operator builtin %s: the block sees the clause, the outer call sees the builtin',
    (name, innerCall, outerCall, builtinResult) => {
      const probe = shadowProbe(name, innerCall, outerCall);
      expect(probe.diagnostics).toEqual([]);
      // Inside the block the user's clause answers…
      expect(probe.inner).toBe('42');
      // …and outside it the builtin is intact, with its definition record the
      // very same object — the write-through would have replaced it in place.
      expect(probe.outer).toBe(builtinResult);
      expect(probe.systemDefUntouched).toBe(true);
    }
  );

  // A builtin bound as a VALUE definition rather than an operator one takes a
  // different branch of `assign`, so it is probed separately: the guard quoted
  // above sits inside the `isOperatorDef` arm and does not cover these.
  test.each([
    ['Pi', 'pi'],
    ['ExponentialE', 'e'],
  ])('value builtin %s is shadowed, not overwritten', (name, builtinResult) => {
    const probe = shadowProbe(name, `${name}(1)`, name);
    expect(probe.diagnostics).toEqual([]);
    expect(probe.inner).toBe('42');
    expect(probe.outer).toBe(builtinResult);
    expect(probe.systemDefUntouched).toBe(true);
  });
});
