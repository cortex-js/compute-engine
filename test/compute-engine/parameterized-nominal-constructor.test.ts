import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { assertGroundType } from '../../src/common/type/subtype';
import type { Type } from '../../src/common/type/types';

//
// Phase 2 of the parameterized-nominal design
// (`docs/plans/2026-08-06-parameterized-nominal-types-design.md` §5): the
// QUANTIFIED constructor.
//
//   type tree<T> = tuple<value: T, children: list<tree<T>>>
//     ⇒ tree : forall T. (T, list<tree<T>>) -> tree<T>
//
// Three things are pinned here:
//
//  1. The minted signature is `forall`-quantified and its RESULT is the
//     APPLIED reference (`tree<T>`), so the rank-1 call-site solver types
//     `tree(1, [])` as `tree<finite_integer>`. A `def.type` handler would
//     overwrite that (it runs AFTER the instantiation), so a parameterized
//     nominal mints none.
//  2. A generic ALIAS still mints nothing — the load-bearing precedent that
//     lets `function Duo(x) {…}` coexist with `type alias Duo<T> = …`.
//  3. D14a: the arm-overlap check and every runtime membership check require
//     GROUND inputs, a requirement guarded only by a `console.assert` that the
//     production build strips. An open `T` reaching them is silent wrongness,
//     so the constructor-function install grounds the body first.
//
// Variance-dependent behavior (widening `let t: tree<number> = tree(1, [])`)
// belongs to Phase 1 and is deliberately absent.
//

function signatureOf(ce: ComputeEngine, name: string): string {
  const def = ce.lookupDefinition(name) as any;
  return def?.operator?.signature?.toString() ?? 'NONE';
}

/** The flagship recursive tuple-bodied type. */
function treeEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
    typeParams: ['T'],
  });
  return ce;
}

/** Run `f`, counting FAILED `console.assert` calls. The ground-type invariant
 * is enforced by exactly those asserts, so a count of 0 is the pin. */
function countAssertFailures(f: () => void): number {
  let n = 0;
  const saved = console.assert;
  console.assert = ((condition: unknown, ...rest: unknown[]) => {
    if (!condition) {
      n += 1;
      saved(condition, ...rest);
    }
  }) as typeof console.assert;
  try {
    f();
  } finally {
    console.assert = saved;
  }
  return n;
}

describe('§5 — the minted constructor is `forall`-quantified', () => {
  test('a tuple body mints an n-ary quantified constructor returning tree<T>', () => {
    const ce = treeEngine();
    expect(signatureOf(ce, 'tree')).toBe(
      'forall T. (value: T, children: list<tree<T>>) -> tree<T>'
    );
  });

  test('a non-tuple body mints a unary quantified constructor', () => {
    const ce = new ComputeEngine();
    ce.declareType('box', 'T', { typeParams: ['T'] });
    expect(signatureOf(ce, 'box')).toBe('forall T. (T) -> box<T>');
  });

  test('a generic ALIAS still mints nothing (the coexistence precedent)', () => {
    const ce = new ComputeEngine();
    ce.assign('Duo', ce.box(['Function', 'x', 'x']) as any);
    ce.declareType('Duo', 'tuple<T, T>', { typeParams: ['T'], alias: true });
    // The user's own `x => x` survives INTACT: the exact signature, not merely
    // "does not mention Duo<" — which a dropped or clobbered binding would
    // also satisfy.
    expect(signatureOf(ce, 'Duo')).toBe('(unknown) -> unknown');
  });

  test('a parameterized NOMINAL does claim the value namespace', () => {
    const ce = new ComputeEngine();
    ce.assign('Duo', ce.box(['Function', 'x', 'x']) as any);
    expect(() =>
      ce.declareType('Duo', 'tuple<T, T>', { typeParams: ['T'] })
    ).toThrow(/already declared in the current scope/);
  });

  test('an unparameterized nominal is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<x: number, y: number>');
    expect(signatureOf(ce, 'point')).toBe(
      '(x: number, y: number) -> point'
    );
    expect(ce.box(['point', 1, 2]).type.toString()).toBe('point');
  });
});

describe('§5 — T is solved at the construction site', () => {
  test('tree(1, []) is a tree<finite_integer>', () => {
    const ce = treeEngine();
    const t = ce.box(['tree', 1, ['List']]);
    expect(t.isValid).toBe(true);
    expect(t.type.toString()).toBe('tree<finite_integer>');
  });

  test('the result is the APPLIED reference, never the bare nominal', () => {
    // A `def.type` handler runs AFTER the instantiated result and overwrites
    // it; a parameterized nominal therefore mints none. Without that, every
    // construction would type as the (arity-invalid) bare `tree`.
    const ce = treeEngine();
    const t = ce.box(['tree', 1, ['List']]).type;
    // An APPLICATION, positively: `not.toBe('tree')` would also pass for
    // `unknown`, `error`, or anything else the instantiation could degrade to.
    expect(t.toString()).toMatch(/^tree</);
    expect((t.type as { kind?: string }).kind).toBe('reference');
    expect((t.type as { args?: unknown[] }).args?.length).toBe(1);
  });

  test('the argument type drives the instantiation', () => {
    const ce = treeEngine();
    expect(ce.box(['tree', { str: 'ab' }, ['List']]).type.toString()).toBe(
      'tree<string>'
    );
  });

  test('route parity: ce.function agrees with ce.box', () => {
    const ce = treeEngine();
    const a = ce.function('tree', [ce.number(1), ce.box(['List'])]);
    const b = ce.box(['tree', 1, ['List']]);
    expect(a.type.toString()).toBe(b.type.toString());
    expect(a.isSame(b)).toBe(true);
  });

  test('evaluation is the inert tagged value, still applied', () => {
    const ce = treeEngine();
    const t = ce.box(['tree', 1, ['List']]).evaluate();
    expect(t.json).toEqual(['tree', 1, ['List']]);
    expect(t.type.toString()).toBe('tree<finite_integer>');
  });

  test('Epsil route: the §2 flagship declares and constructs with no diagnostic', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type tree<T> = tuple<value: T, children: list<tree<T>>>\n' +
        'let t = tree(1, [])\n' +
        't'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.type.toString()).toBe('tree<finite_integer>');
  });

  test('D9 injectivity survives quantification', () => {
    const ce = treeEngine();
    const a = ce.box(['tree', 1, ['List']]).evaluate();
    const b = ce.box(['tree', 1, ['List']]).evaluate();
    const c = ce.box(['tree', 2, ['List']]).evaluate();
    expect(a.isEqual(b)).toBe(true);
    expect(a.isEqual(c)).toBe(false);
  });
});

describe('§5 — declaration-time validation reaches the minted polytype', () => {
  test('a variable in an intersection position is rejected', () => {
    // A UNION arm is admissible (Rule U); an intersection member is not, and
    // the rejection steers to the spelling that replaces it — a bound.
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('u', 'tuple<a: T & integer>', { typeParams: ['T'] })
    ).toThrow(/unsupported-variable-position/);
  });

  test('a phantom parameter is rejected', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('phantom', 'tuple<a: integer>', { typeParams: ['T'] })
    ).toThrow(/generic-alias-unused-parameter/);
  });

  test('a bare or wrong-arity application is the generalized arity error', () => {
    const ce = treeEngine();
    expect(() => ce.type('tree')).toThrow(/generic-alias-arity/);
    expect(() => ce.type('tree<integer, string>')).toThrow(
      /generic-alias-arity/
    );
    expect(ce.type('tree<integer>').toString()).toBe('tree<integer>');
  });
});

describe('§7 — compilation still erases the tag', () => {
  test('a unary parameterized constructor compiles to its compiled operand', () => {
    const ce = new ComputeEngine();
    ce.declareType('meters', 'T', { typeParams: ['T'] });
    ce.declare('x', 'number');
    const body = ce.box(['Add', ['Sin', 'x'], ['Power', 'x', 2]]);
    expect(compile(ce.box(['meters', body]))?.code).toBe(
      compile(body)?.code
    );
  });

  test('a tuple-bodied parameterized constructor compiles as its Tuple', () => {
    const ce = new ComputeEngine();
    ce.declareType('pair', 'tuple<T, T>', { typeParams: ['T'] });
    expect(compile(ce.box(['pair', 1, 2]))?.code).toBe(
      compile(ce.box(['Tuple', 1, 2]))?.code
    );
  });
});

describe('§5 — D14a grounding: the overlap check never sees an open type', () => {
  /** A user arm at the raw arm's OWN arity, so `provablyDisjoint` is actually
   * reached at every position — including the bare-variable one, which is the
   * position that leaked before the body was grounded. */
  function install(ce: ComputeEngine): void {
    ce.assign(
      'tree',
      ce.box([
        'Function',
        ['Tuple', ['StringLength', 'a'], ['List']],
        ['Typed', 'a', { str: 'string' }],
        ['Typed', 'b', { str: 'string' }],
      ]) as any
    );
  }

  // The zero-pins below are only worth anything if the spy CAN count. This is
  // the positive control: the very tripwire the grounding exists to keep
  // silent, fired deliberately. The ASSERTION FAILURE banner it prints is the
  // point — `countAssertFailures` calls the real `console.assert` through.
  test('the assert spy counts a fired assert (positive control)', () => {
    expect(
      countAssertFailures(() =>
        assertGroundType('probe', { kind: 'variable', name: 'T' } as Type)
      )
    ).toBe(1);
  });

  test('installing a position-disjoint user arm violates no ground-type assert', () => {
    const ce = treeEngine();
    expect(countAssertFailures(() => install(ce))).toBe(0);
    expect(signatureOf(ce, 'tree')).toContain('forall T.');
  });

  // D14a grounds the RAW arm; before the fix the USER arm went to
  // `overlapsRawArm` verbatim, so a QUANTIFIED user arm walked its own `U`
  // into `provablyDisjoint`/`typeCategory`. A 2-ary fixture never reaches
  // that: `overlapsRawArm` short-circuits on arity before any position is
  // compared. This one is 1-ary against a 1-ary (record-bodied) raw arm.
  test('a 1-ary generic user arm reaches the overlap check without leaking `U`', () => {
    const ce = new ComputeEngine();
    ce.declareType('pack', 'record<v: T>', { typeParams: ['T'] });
    const n = countAssertFailures(() => {
      try {
        ce.assign(
          'pack',
          ce.box([
            'Function',
            ['Dictionary', ['KeyValuePair', { str: 'v' }, 'x']],
            { str: 'forall U. (x: U) -> pack<U>' },
          ]) as any
        );
      } catch {
        // The overlap verdict itself is pinned below; this counts asserts.
      }
    });
    expect(n).toBe(0);
  });

  test('…and an open `U` at the raw arm´s own arity is still overlap', () => {
    // Grounded, `U` reads `any` at the parameter — undecidable, which D14a
    // rejects loudly rather than letting the user arm shadow the raw one.
    const ce = new ComputeEngine();
    ce.declareType('pack', 'record<v: T>', { typeParams: ['T'] });
    expect(() =>
      ce.assign(
        'pack',
        ce.box([
          'Function',
          ['Dictionary', ['KeyValuePair', { str: 'v' }, 'x']],
          { str: 'forall U. (x: U) -> pack<U>' },
        ]) as any
      )
    ).toThrow(/overlaps the type's raw-injection constructor/);
  });

  test('constructing through either arm violates no ground-type assert', () => {
    const ce = treeEngine();
    install(ce);
    expect(
      countAssertFailures(() => {
        ce.box(['tree', { str: 'ab' }, { str: 'cd' }]).evaluate();
        ce.box(['tree', 3, ['List']]).evaluate();
      })
    ).toBe(0);
  });

  test('the raw arm still wins on its own domain', () => {
    const ce = treeEngine();
    install(ce);
    const raw = ce.box(['tree', 3, ['List']]).evaluate();
    expect(raw.json).toEqual(['tree', 3, ['List']]);
    expect(raw.type.toString()).toBe('tree<finite_integer>');
  });

  test('an unannotated same-arity user arm is still rejected as overlap', () => {
    const ce = treeEngine();
    expect(() =>
      ce.assign(
        'tree',
        ce.box(['Function', ['Tuple', 'v', 'cs'], 'v', 'cs']) as any
      )
    ).toThrow(/overlaps the type's raw-injection constructor/);
  });
});

describe('§5 — a record body is inhabited by a generic constructor function', () => {
  /** `type tree<T> = record<…>` mints nothing (D4b); the constructor function
   * supplies it, with a clause of its OWN — the variable is named `U` here
   * precisely because the type's `T` is not in scope inside the function and
   * the names are alpha-irrelevant. */
  function recordTreeEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'record<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    ce.assign(
      'tree',
      ce.box([
        'Function',
        [
          'Dictionary',
          ['KeyValuePair', { str: 'value' }, 'v'],
          ['KeyValuePair', { str: 'children' }, 'cs'],
        ],
        { str: 'forall U. (v: U, cs: list<tree<U>>) -> tree<U>' },
      ]) as any
    );
    return ce;
  }

  test('a record body auto-mints nothing', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'record<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    expect(signatureOf(ce, 'tree')).toBe('NONE');
  });

  test('the overload set keeps both clauses, each its own', () => {
    const ce = recordTreeEngine();
    expect(signatureOf(ce, 'tree')).toBe(
      '(forall U. (v: U, cs: list<tree<U>>) -> tree<U>) & ' +
        '(forall T. (record<value: T, children: list<tree<T>>>) -> tree<T>)'
    );
  });

  test('a clause named differently from the type´s constructs (alpha-irrelevance)', () => {
    const ce = recordTreeEngine();
    const t = ce.box(['tree', 1, ['List']]);
    expect(t.isValid).toBe(true);
    expect(t.type.toString()).toBe('tree<finite_integer>');
    expect(t.evaluate().json).toEqual([
      'tree',
      { dict: { value: 1, children: [] } },
    ]);
  });

  test('D12: the tagged payload round-trips through the raw arm at the same type', () => {
    const ce = recordTreeEngine();
    const t = ce.box(['tree', 1, ['List']]).evaluate();
    const rt = ce.box(t.json).evaluate();
    expect(rt.json).toEqual(t.json);
    expect(rt.type.toString()).toBe('tree<finite_integer>');
  });

  test('a wrong-arity result-type application does not produce a constructor', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'record<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    const literal = ce.box([
      'Function',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'value' }, 'v'],
        ['KeyValuePair', { str: 'children' }, 'cs'],
      ],
      { str: 'forall U. (v: U, cs: list<tree<U>>) -> tree<U, U>' },
    ] as any);
    expect(literal.isValid).toBe(false);
  });

  test('an UNANNOTATED constructor function falls back to the ground application', () => {
    // Nothing can instantiate the application on the author's behalf: the
    // type's clause is not in scope in the function (§5), so a literal with no
    // declared result gets `tree<any>` rather than an open `tree<T>`.
    const ce = new ComputeEngine();
    ce.declareType('tree', 'record<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    ce.assign(
      'tree',
      ce.box([
        'Function',
        [
          'Dictionary',
          ['KeyValuePair', { str: 'value' }, 'v'],
          ['KeyValuePair', { str: 'children' }, 'cs'],
        ],
        'v',
        'cs',
      ]) as any
    );
    const t = ce.box(['tree', 1, ['List']]);
    expect(t.isValid).toBe(true);
    expect(t.type.toString()).toBe('tree<any>');
  });
});

// ── Finding 2 (adversarial review, 2026-08-06): membership ≠ disjointness ───
//
// The ground skeleton of `cell<T>` is `cell<any>`, which is the right answer
// for DISJOINTNESS (§5: never derive disjointness from the type variable) and
// the wrong one for MEMBERSHIP: under §4.3's invariant rule `cell<integer> <:
// cell<any>` is FALSE, so an `inout` — or a still-deferred — nominal could not
// be a constructor argument of another parameterized nominal at all. The two
// contracts are now separate readings.
describe('§4.3/§5 — an invariant nominal is still a constructor argument', () => {
  function nestedEngine(variance: 'inout' | 'out'): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declareType('cell', 'tuple<v: T>', {
      typeParams: [{ name: 'T', variance }],
    });
    ce.declareType('w', 'tuple<x: cell<T>>', {
      typeParams: [{ name: 'T', variance }],
    });
    return ce;
  }

  test('`inout` nests, and solves the outer parameter from the inner one', () => {
    const ce = nestedEngine('inout');
    const t = ce.box(['w', ['cell', 1]]);
    expect(t.isValid).toBe(true);
    expect(t.type.toString()).toBe('w<finite_integer>');
  });

  test('…exactly as the identical `out` shape already did', () => {
    const ce = nestedEngine('out');
    expect(ce.box(['w', ['cell', 1]]).type.toString()).toBe(
      'w<finite_integer>'
    );
  });

  // The widening is confined to applications of the SAME declaration: a
  // non-application at the position is refuted exactly as before, so the gate
  // did not become "admit anything".
  test('a non-application at the position is still refuted', () => {
    const ce = nestedEngine('inout');
    expect(ce.box(['w', 5]).evaluate().operator).toBe('Error');
  });

  test('a recursive `inout` type constructs at every level', () => {
    const ce = new ComputeEngine();
    ce.declareType('rt', 'tuple<v: T, kids: list<rt<T>>>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    const t = ce.box(['rt', 1, ['List', ['rt', 2, ['List']]]]);
    expect(t.isValid).toBe(true);
    expect(t.type.toString()).toBe('rt<finite_integer>');
  });

  // The DEFERRED window reads as `inout` (ruling C), so it hits the same
  // gate — which is why finding 1's fix (deferral now propagates) needs this
  // one: a blocked type must stay inhabitable.
  test('a still-deferred nominal nests too', () => {
    const ce = new ComputeEngine();
    ce.declareType('b', 'tuple<v: T, ghosts: list<type later<T>>>', {
      typeParams: ['T'],
    });
    ce.declareType('c', 'tuple<x: b<T>>', { typeParams: ['T'] });
    const inner = ce.box(['b', 1, ['List']]).evaluate();
    expect(inner.type.toString()).toBe('b<finite_integer>');
    const outer = ce.box(['c', inner]);
    expect(outer.isValid).toBe(true);
    expect(outer.type.toString()).toBe('c<finite_integer>');
  });

  // The runtime VALUE-membership check is the other half of the split: with
  // `cell<any>` as the payload target it answered `'maybe'`, and a `'maybe'`
  // leaves the constructor inert — the user arm's body never ran.
  test('a user constructor function´s body runs under an invariant nesting', () => {
    const ce = new ComputeEngine();
    ce.declareType('cell', 'tuple<v: T>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    // A 2-ary raw arm against a 1-ary user arm: no D14a overlap.
    ce.declareType('nest', 'tuple<a: cell<T>, b: cell<T>>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    ce.assign(
      'nest',
      ce.box([
        'Function',
        ['Tuple', 'x', 'x'],
        { str: 'forall U. (x: cell<U>) -> nest<U>' },
      ]) as any
    );
    const t = ce.box(['nest', ['cell', 1]]).evaluate();
    expect(t.json).toEqual(['nest', ['cell', 1], ['cell', 1]]);
    expect(t.type.toString()).toBe('nest<finite_integer>');
  });
});

// §10 "Recursion" — nested construction, pinned after Phase 1 landed because
// the admission mechanism is now the variance-aware rule: `T` solves from
// operand 0, and the inner list is checked against the already-instantiated
// `list<tree<finite_integer>>`.
describe('§10 — recursion: nested construction', () => {
  test('a 2-deep tree constructs and stays applied at every level', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    const t = ce.box(['tree', 1, ['List', ['tree', 2, ['List']]]]);
    expect(t.isValid).toBe(true);
    expect(t.type.toString()).toBe('tree<finite_integer>');
  });

  test('a 3-deep tree constructs (the §10 recursion witness)', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
      typeParams: ['T'],
    });
    const t = ce.box([
      'tree',
      1,
      ['List', ['tree', 2, ['List', ['tree', 3, ['List']]]]],
    ]);
    expect(t.isValid).toBe(true);
    expect(t.type.toString()).toBe('tree<finite_integer>');
  });
});
