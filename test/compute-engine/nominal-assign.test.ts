import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';

//
// Route parity for the DECLARED-TYPE compatibility check.
//
// A value is installed into a symbol through three routes:
//
//   1. declare-with-value — `["Declare", name, type, value]` / the host
//      `ce.declare(name, { type, value })`. The check lives in the
//      `_BoxedValueDefinition` constructor (`matchesDeclaredTypeAxes`).
//   2. the `Assign` OPERATOR — `["Assign", name, value]`, which calls
//      `ce.assign()`.
//   3. the host `ce.assign(name, value)`.
//
// Routes 2 and 3 both funnel through `assignFn` (`engine-declarations.ts`).
// That path used to apply the compatibility check ONLY when the declared type
// was a function signature, so a declared type on a non-function symbol was a
// contract at declaration time and nothing afterwards: a value merely
// STRUCTURALLY similar to a NOMINAL declared type installed silently, even
// though the declare-with-value spelling of the same thing rejects it.
//
// All three routes now apply the same per-axis check.
//

const ALIAS = ['Dictionary', ['KeyValuePair', 'alias', 'True']] as any;

/** A fresh engine with a NOMINAL `point` and a STRUCTURAL alias `pt`, both
 * spelling the same underlying tuple shape. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('point', 'tuple<integer, integer>'); // nominal
  ce.declareType('pt', 'tuple<integer, integer>', { alias: true });
  return ce;
}

/** The outcome of a route, as a string, so the three routes can be compared
 * side by side. Either `'ok'`, the operator route's error-value string, or
 * `'throw: <first line of the message>'`. */
function outcome(f: () => string | void): string {
  try {
    return f() || 'ok';
  } catch (e) {
    return `throw: ${(e as Error).message.split('\n')[0]}`;
  }
}

describe('NOMINAL declared type rejects a structurally-similar value', () => {
  test('route 1 — declare with value (operator)', () => {
    const ce = engine();
    expect(
      outcome(() =>
        ce.box(['Declare', 'w', { str: 'point' }, ['Tuple', 1, 2]]).evaluate()
          .json as any
      )
    ).toMatchInlineSnapshot(`"throw: Symbol "w""`);
    // No value was installed.
    expect(ce.box('w').evaluate().toString()).toBe('w');
  });

  test('route 1 — declare with value (host)', () => {
    const ce = engine();
    expect(() =>
      ce.declare('w', {
        type: ce.type('point'),
        value: ce.box(['Tuple', 1, 2]),
      })
    ).toThrow(/is not compatible with the type "point"/);
    // ...and the same with the type spelled as a string (which has to be
    // parsed against the engine's type resolver to see `point` at all)
    expect(() =>
      ce.declare('w2', { type: 'point', value: ce.box(['Tuple', 1, 2]) })
    ).toThrow(/is not compatible with the type "point"/);
  });

  test('route 2 — the `Assign` operator', () => {
    const ce = engine();
    ce.declare('p', 'point');
    expect(
      outcome(() => ce.box(['Assign', 'p', ['Tuple', 1, 2]]).evaluate().json as any)
    ).toMatchInlineSnapshot(`"throw: Symbol "p""`);
    // The value was NOT installed: `p` is still valueless.
    expect(ce.box('p').evaluate().toString()).toBe('p');
  });

  test('route 3 — the host `ce.assign`', () => {
    const ce = engine();
    ce.declare('q', 'point');
    expect(() => ce.assign('q', ce.box(['Tuple', 1, 2]))).toThrow(
      /is not compatible with the type "point"/
    );
    expect(ce.box('q').evaluate().toString()).toBe('q');
  });

  test('the error message names both types', () => {
    const ce = engine();
    ce.declare('q', 'point');
    let message = '';
    try {
      ce.assign('q', ce.box(['Tuple', 1, 2]));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatchInlineSnapshot(`
      "Symbol "q"
      |   The value "(1, 2)" of type "tuple<finite_integer, finite_integer>" is not compatible with the type "point""
    `);
  });
});

describe('STRUCTURAL alias declared type accepts a matching value', () => {
  test('route 1 — declare with value', () => {
    const ce = engine();
    expect(
      ce
        .box(['Declare', 'a', { str: 'pt' }, ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('(1, 2)');
  });

  test('route 2 — the `Assign` operator', () => {
    const ce = engine();
    ce.declare('a', 'pt');
    expect(ce.box(['Assign', 'a', ['Tuple', 1, 2]]).evaluate().toString()).toBe(
      '(1, 2)'
    );
    expect(ce.box('a').evaluate().toString()).toBe('(1, 2)');
  });

  test('route 3 — the host `ce.assign`', () => {
    const ce = engine();
    ce.declare('b', 'pt');
    ce.assign('b', ce.box(['Tuple', 1, 2]));
    expect(ce.box('b').evaluate().toString()).toBe('(1, 2)');
  });

  test('re-assignment after a legal assignment', () => {
    const ce = engine();
    ce.declare('b', 'pt');
    ce.assign('b', ce.box(['Tuple', 1, 2]));
    ce.assign('b', ce.box(['Tuple', 5, 6]));
    expect(ce.box('b').evaluate().toString()).toBe('(5, 6)');
    // ...and a re-assignment still has to fit
    expect(() => ce.assign('b', ce.box(['Tuple', 1, 2, 3]))).toThrow(
      /is not compatible with the type "pt"/
    );
    expect(ce.box('b').evaluate().toString()).toBe('(5, 6)');
  });

  test('the Cortex `type alias` statement still works', () => {
    // The STRUCTURAL form is `type alias`; a bare `type` declares a nominal
    // type, which no structural value inhabits (see the nominal pins above).
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias pt = tuple<number, number>\nlet p: pt = (1, 2)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('a Cortex `type alias` is assignable after declaration', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias pt = tuple<number, number>\nlet p: pt = (1, 2)\np = (3, 4)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(3, 4)');
  });

  test('an alias declared through the `DeclareType` operator', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      'pair',
      { str: 'tuple<integer, integer>' },
      ALIAS,
    ]).evaluate();
    ce.declare('z', 'pair');
    ce.assign('z', ce.box(['Tuple', 7, 8]));
    expect(ce.box('z').evaluate().toString()).toBe('(7, 8)');
  });
});

describe('the INFERRED track is untouched', () => {
  test('an auto-declared symbol still narrows and widens', () => {
    const ce = new ComputeEngine();
    ce.assign('u', 1);
    expect(ce.box('u').type.toString()).toBe('integer');
    // A `real` value WIDENS the inferred `integer` guess rather than failing
    ce.assign('u', 1.5);
    expect(ce.box('u').type.toString()).toBe('real');
    expect(ce.box('u').evaluate().toString()).toBe('1.5');
  });

  test('an incompatible value REPLACES an inferred guess (D11)', () => {
    const ce = new ComputeEngine();
    ce.assign('v', 1);
    ce.assign('v', ce.string('hello'));
    expect(ce.box('v').type.toString()).toBe('string');
  });

  test('an explicitly-inferred declaration keeps the lenient behavior', () => {
    const ce = engine();
    ce.declare('w', { type: 'integer', inferred: true });
    ce.assign('w', 2.5);
    expect(ce.box('w').evaluate().toString()).toBe('2.5');
  });

  test('an `unknown`-typed declaration accepts anything', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'unknown');
    ce.assign('k', ce.box(['Tuple', 1, 2]));
    expect(ce.box('k').evaluate().toString()).toBe('(1, 2)');
  });
});

describe('a MINTED type constructor cannot be assigned over (D5)', () => {
  // A type declaration claims BOTH namespaces. Every assign branch for an
  // operator definition replaces the inner definition wholesale — dropping the
  // minted marker — so an in-place assignment would leave the type still
  // resolving with nothing able to build a value of it.

  test('route 3 — the host `ce.assign` refuses a value', () => {
    const ce = engine();
    expect(() => ce.assign('point', 5)).toThrow(
      /Cannot assign a value to the constructor of type "point"/
    );
    // The constructor is intact.
    expect(ce.box(['point', 1, 2]).evaluate().toString()).toBe('point(1, 2)');
    expect(ce.box(['point', 1, 2]).type.toString()).toBe('point');
  });

  test('an ALIAS constructor is refused too', () => {
    const ce = engine();
    expect(() => ce.assign('pt', 5)).toThrow(
      /Cannot assign a value to the constructor of type "pt"/
    );
    expect(ce.box(['pt', 1, 2]).evaluate().toString()).toBe('(1, 2)');
  });

  test('the FUNCTION-LITERAL reassignment branch is refused too', () => {
    const ce = engine();
    expect(() =>
      ce.assign('point', ce.box(['Function', ['Add', '_1', '_2'], '_1', '_2']))
    ).toThrow(/Cannot assign a value to the constructor of type "point"/);
    expect(ce.box(['point', 1, 2]).evaluate().toString()).toBe('point(1, 2)');
  });

  test('an operator-definition assignment is refused too', () => {
    const ce = engine();
    expect(() =>
      ce.assign('point', ([x]) => x as any)
    ).toThrow(/Cannot assign a value to the constructor of type "point"/);
  });

  test('route 2 — the `Assign` operator surfaces it as an Error value', () => {
    const ce = engine();
    expect(
      outcome(() => ce.box(['Assign', 'point', 5]).evaluate().json as any)
    ).toMatchInlineSnapshot(
      `"throw: Cannot assign a value to the constructor of type "point""`
    );
  });

  test('the Cortex `point = 5` route becomes an Error value', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type point = tuple<x: number, y: number>\npoint = 5'
    );
    expect(r.value.toString()).toBe(
      'Error("Cannot assign a value to the constructor of type \\"point\\"")'
    );
    // The type half is untouched.
    expect(
      executeCortex(ce, 'let p: point = point(1, 2)\np').value.toString()
    ).toBe('point(1, 2)');
  });

  test('an ORDINARY operator of the same shape is still assignable', () => {
    // The guard keys off the minted marker, not the shape of the definition.
    const ce = new ComputeEngine();
    ce.declare('foo', { signature: '(number, number) -> number' });
    ce.assign('foo', 5);
    expect(ce.box('foo').evaluate().toString()).toBe('5');
  });
});

describe('the effects axis keeps its own provenance', () => {
  test('a `{scope}` closure fits a BARE-specifier declared arrow', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) -> number');
    ce.assign('y', 10);
    // The literal's arrow carries the `{scope}` its body walk inferred; the
    // declaration left the effects axis on the inferred track, so it fits.
    ce.assign('f', ce.box(['Function', ['Add', '_1', 'y'], '_1']));
    expect(ce.box(['f', 1]).evaluate().toString()).toBe('11');
  });

  test('a declared non-function type still rejects a mismatched scalar', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    expect(() => ce.assign('n', ce.string('hello'))).toThrow(
      /is not compatible with the type "integer"/
    );
    ce.assign('n', 3);
    expect(ce.box('n').evaluate().toString()).toBe('3');
  });
});
