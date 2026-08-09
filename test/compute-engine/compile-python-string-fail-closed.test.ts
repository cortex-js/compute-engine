/**
 * String / aggregate COMPARISONS fail closed (D6) on the **Python** compile
 * target — the mirror of `compile-string-fail-closed.test.ts` (JavaScript).
 *
 * The shapes that were silently WRONG before the gates, both verified by
 * executing the emitted code against `./venv/bin/python3`:
 *
 *  - `Less(["a", 10], ["b", 9])` emitted `np.less(["a",10], ["b",9])`, where
 *    NumPy coerces `10` to `"10"` and string-compares — `[True, True]`, while
 *    the interpreter answers `["True", "False"]` (`10 < 9` is False);
 *  - `Equal(Tuple(1, 2), List(1, 2))` emitted `_ce_eqcoll((1,2), [1,2])` → `True`
 *    where the interpreter answers `False` (a point binds atomically).
 *
 * Other mixed-string shapes (`np.less("a", [1,2])`, `np.less(["a","b"], 5)`) are
 * LOUD on NumPy 2.4 but historically returned a scalar `False` with a
 * `FutureWarning`, so they are gated at COMPILE time on static type evidence
 * rather than trusted to raise on the user's NumPy.
 *
 * What must KEEP compiling (each pinned below with EXECUTED parity against the
 * interpreter):
 *
 *  - ALL-string orderings — scalar, chained, list-vs-list, list-vs-scalar;
 *  - `IndexOf` in every shape (a string needle, a string haystack, a TUPLE
 *    needle in a point list, a missing value). This is a DELIBERATE DIVERGENCE
 *    from the JavaScript target, which gates its needle: the `_ce_indexof`
 *    adapter is structural, not a numeric tolerance test, so it is faithful.
 *    The adapter's `_ce_same` leaf also compares BOOL-ness first, so Python's
 *    `True == 1` does not find a boolean needle in a numeric haystack;
 *  - tuple-vs-tuple `Equal` (via `_ce_eqcoll`, whole-value equality);
 *  - all-string COLLECTION equality (via `_ce_eqcoll`). The four shapes in
 *    `compile-python-parity.test.ts` (`eq_coll_strings_*`,
 *    `eq_coll_numeric_strings*`) already pin it. Since tier 2 (2026-08-08) this
 *    is NO LONGER a divergence from the JavaScript target: `_SYS.eq`'s scalar
 *    leaf gained the same string branch;
 *  - SCALAR string equality (tier 2, 2026-08-08) — a structural `==`/`!=`,
 *    which is the interpreter's own string semantics. Mirrors the JavaScript
 *    target's `===`. A MIXED string/number pair and the CHAINED form stay
 *    closed on both targets;
 *  - `unknown`-typed comparisons, byte-identical (an `unknown` operand is never
 *    string evidence, or plot comparisons would stop compiling).
 *
 * ACCEPTED RESIDUAL (ruled 2026-08-08, deliberately not gated): all-string
 * orderings compare by UTF-16 code UNIT in the interpreter but code POINT in
 * Python, which disagree only when an astral-plane character is ordered
 * against U+E000–U+FFFF (see `assertPyNoMixedStringOrdering`'s doc in
 * python-target.ts).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let ce: ComputeEngine;
const python = new PythonTarget();

beforeEach(() => {
  ce = new ComputeEngine();
});

/** The emitted code for `expr` — `compileFunction` throws when a gate fires. */
function code(expr: BoxedExpression): string {
  return python.compileFunction(expr, 'f', []);
}

describe('Python: SCALAR string equality is admitted (tier 2, 2026-08-08)', () => {
  // The mirror of the JavaScript target's `===` admission. The scalar lowering
  // used to be `abs(("a") - ("a")) <= tol` — a `TypeError` on every Python — so
  // the shape was fully closed; Python's `==` on `str` is exact structural
  // comparison, which IS the interpreter's string semantics. Executed parity
  // for these shapes is in the `ADMITTED` battery at the bottom of this file.

  test('Equal / NotEqual over two string literals emit a structural ==', () => {
    expect(code(ce.box(['Equal', { str: 'a' }, { str: 'a' }]))).toContain(
      '("a") == ("a")'
    );
    expect(code(ce.box(['NotEqual', { str: 'a' }, { str: 'b' }]))).toContain(
      '("a") != ("b")'
    );
    // Never the numeric tolerance form.
    expect(code(ce.box(['Equal', { str: 'a' }, { str: 'a' }]))).not.toContain(
      'abs('
    );
  });

  test('Equal over a string-TYPED symbol compiles', () => {
    ce.declare('s', 'string');
    expect(
      python.compileFunction(ce.box(['Equal', 's', { str: 'a' }]), 'f', ['s'])
    ).toContain('(s) == ("a")');
  });

  test('a MIXED string/number equality still declines', () => {
    // The tier-0 ruling, unchanged: probed, the interpreter answers `False`
    // and Python's `==` would agree, but admitting the mixed shape is a
    // separate decision.
    for (const args of [
      [{ str: 'a' }, 1],
      [1, { str: 'a' }],
    ]) {
      expect(() => code(ce.box(['Equal', ...args] as any))).toThrow(
        /Equal.*string-valued operands/s
      );
    }
  });

  test('the CHAINED (n-ary) string equality still declines', () => {
    expect(() =>
      code(ce.box(['Equal', { str: 'a' }, { str: 'a' }, { str: 'a' }]))
    ).toThrow(/Equal.*string-valued operands/s);
  });
});

describe('Python: a UNION arm that is a collection disqualifies the scalar ==', () => {
  // REGRESSION (2026-08-08), the mirror of the JavaScript one:
  // `isPyCollectionOperand` is a SUBTYPE test (`list` / `indexed_collection`),
  // so a general UNION with a collection arm slipped through and
  // `Equal(uq, "a")` over `string | list<string>` emitted the scalar
  // `((uq) == ("a"))` — a bare `False` where the interpreter broadcasts
  // element-wise. The gate now also consults `couldBeCollectionParticipant`.

  test('a DECLARED `string | list<string>` participant declines, both heads', () => {
    ce.declare('uq', 'string | list<string>');
    for (const head of ['Equal', 'NotEqual'] as const) {
      expect(() =>
        python.compileFunction(ce.box([head, 'uq', { str: 'a' }] as any), 'f', [
          'uq',
        ])
      ).toThrow(/string-valued operands/s);
    }
    // The interpreter, which the fallback reaches, broadcasts.
    ce.assign('uq', ce.box(['List', { str: 'a' }, { str: 'b' }]));
    expect(ce.box(['Equal', 'uq', { str: 'a' }]).evaluate().toString()).toBe(
      '["True","False"]'
    );
  });

  test('an INFERRED Epsil union with a collection arm declines too', () => {
    executeEpsil(ce, 'gu(flag) = "a" if flag else [1,2,3]');
    ce.declare('fl', 'boolean');
    expect(ce.box(['gu', 'fl']).type.toString()).toMatch(/\|/);
    expect(() =>
      python.compileFunction(
        ce.box(['Equal', ['gu', 'fl'], { str: 'a' }]),
        'f',
        ['fl']
      )
    ).toThrow(/string-valued operands/s);
  });

  test('the union gate does NOT narrow the settled bare-`unknown` admission', () => {
    // Ruling (a), 2026-08-08 — only POSITIVE union evidence disqualifies.
    ce.declare('anyq', 'unknown');
    expect(
      python.compileFunction(ce.box(['Equal', 'anyq', { str: 'a' }]), 'f', [
        'anyq',
      ])
    ).toContain('(anyq) == ("a")');
    ce.declare('sbq', 'string | boolean');
    expect(
      python.compileFunction(ce.box(['Equal', 'sbq', { str: 'a' }]), 'f', [
        'sbq',
      ])
    ).toContain('(sbq) == ("a")');
  });
});

describe('Python: NotEqual over `string | missing` keeps the Kleene guard', () => {
  // REGRESSION (2026-08-08). The §3.F object-domain guard covered `Equal`
  // only; with the tier-2 admission accepting `NotEqual(s, "x")` the emission
  // became a bare `(s) != ("x")`, i.e. `True` for an absent `s`, where the
  // interpreter answers `Missing`. Guarded on both heads now.

  test('the interpreter is Kleene for both heads', () => {
    expect(ce.box(['Equal', 'Missing', { str: 'x' }]).evaluate().symbol).toBe(
      'Missing'
    );
    expect(
      ce.box(['NotEqual', 'Missing', { str: 'x' }]).evaluate().symbol
    ).toBe('Missing');
  });

  test('the emitted NotEqual is the None-guarded conditional, not a bare !=', () => {
    ce.declare('s', 'string | missing');
    const out = python.compileFunction(
      ce.box(['NotEqual', 's', { str: 'x' }]),
      'f',
      ['s']
    );
    expect(out).toContain('None if');
    expect(out).toContain('(s is None)');
    expect(out).toContain('(s) != ("x")');
    expect(out).not.toContain('abs(');
  });
});

describe('Python: EQUALITY fails closed on string evidence', () => {
  test('Equal over a tuple with a string component declines', () => {
    // The carve-out requires every component to be provably NUMERIC, so a
    // string component does not take it at all and the AGGREGATE gate closes
    // this one. (It used to reach the string gate; either way it fails closed.)
    expect(() =>
      code(
        ce.box([
          'Equal',
          ['Tuple', 1, { str: 'a' }],
          ['Tuple', 1, { str: 'a' }],
        ])
      )
    ).toThrow(/Equal.*a tuple participant.*Fail closed \(D6\)/s);
  });

  test('Equal over a MIXED string/number collection declines', () => {
    // `list<string | number>` is not FLAT all-string, so the admission side
    // rejects it and the head fails closed.
    expect(() =>
      code(
        ce.box(['Equal', ['List', { str: 'a' }, 1], ['List', { str: 'a' }, 1]])
      )
    ).toThrow(/Equal.*string-valued operands/s);
  });

  test('Equal over a NESTED all-string collection declines', () => {
    expect(() =>
      code(
        ce.box([
          'Equal',
          ['List', ['List', { str: 'a' }]],
          ['List', ['List', { str: 'a' }]],
        ])
      )
    ).toThrow(/Equal.*string-valued operands/s);
  });
});

describe('Python: EQUALITY fails closed on an unfaithful aggregate', () => {
  test('Equal(Tuple, List) declines — it answered True against False', () => {
    const expr = ce.box(['Equal', ['Tuple', 1, 2], ['List', 1, 2]]);
    expect(() => code(expr)).toThrow(
      /Equal.*a tuple participant.*Fail closed \(D6\)/s
    );
    expect(expr.evaluate().toString()).toBe('"False"');
  });

  test('Equal over dictionary-typed symbols declines', () => {
    ce.declare('d1', 'dictionary<integer>');
    ce.declare('d2', 'dictionary<integer>');
    expect(() =>
      python.compileFunction(ce.box(['Equal', 'd1', 'd2']), 'f', ['d1', 'd2'])
    ).toThrow(/Equal.*a dictionary participant/s);
  });

  test('Equal over record-typed symbols declines', () => {
    ce.declare('r1', 'record<a: integer>');
    ce.declare('r2', 'record<a: integer>');
    expect(() =>
      python.compileFunction(ce.box(['Equal', 'r1', 'r2']), 'f', ['r1', 'r2'])
    ).toThrow(/Equal.*a record participant/s);
  });

  test('a BINARY tuple-vs-tuple Equal keeps the _ce_eqcoll lowering', () => {
    expect(code(ce.box(['Equal', ['Tuple', 1, 2], ['Tuple', 1, 2]]))).toContain(
      '_ce_eqcoll((1, 2), (1, 2), 1e-10)'
    );
  });

  test('a tuple with a BOOLEAN component declines — Python coerces bool to int', () => {
    // `_ce_eqcoll`'s scalar leaf compares with Python `==`, under which
    // `True == 1`: this compiled and executed to `True` where the interpreter
    // answers `False`. The carve-out now requires provably NUMERIC components.
    const expr = ce.box(['Equal', ['Tuple', 'True'], ['Tuple', 1]]);
    expect(() => code(expr)).toThrow(
      /Equal.*a tuple participant.*Fail closed \(D6\)/s
    );
    expect(expr.evaluate().toString()).toBe('"False"');
  });

  test('boolean-component tuple SYMBOLS decline too', () => {
    ce.declare('bt1', 'tuple<boolean>');
    ce.declare('bt2', 'tuple<number>');
    expect(() =>
      python.compileFunction(ce.box(['Equal', 'bt1', 'bt2']), 'f', [
        'bt1',
        'bt2',
      ])
    ).toThrow(/Equal.*a tuple participant/s);
  });

  test('a point-LIST Equal keeps compiling (the ruled consumer)', () => {
    // The nested-tuple ordering gate must NOT touch equality: `_ce_eqcoll`
    // compares each point as one value, which is the interpreter's answer.
    ce.declare('pl1', 'list<tuple<number, number>>');
    ce.declare('pl2', 'list<tuple<number, number>>');
    expect(
      python.compileFunction(ce.box(['Equal', 'pl1', 'pl2']), 'f', [
        'pl1',
        'pl2',
      ])
    ).toContain('_ce_eqcoll(pl1, pl2, 1e-10)');
  });
});

describe('Python: ORDERINGS decline only the MIXED string case', () => {
  test('Less over a string-and-number LIST pair declines (was [True, True])', () => {
    const expr = ce.box([
      'Less',
      ['List', { str: 'a' }, 10],
      ['List', { str: 'b' }, 9],
    ]);
    expect(() => code(expr)).toThrow(
      /Less.*mixes a string operand.*Fail closed \(D6\)/s
    );
    // The interpreter's answer, which the fallback produces: `10 < 9` is False.
    expect(expr.evaluate().toString()).toBe('["True","False"]');
  });

  test.each(['Less', 'LessEqual', 'Greater', 'GreaterEqual'])(
    '%s(string, number) declines on the INFIX route',
    (head) => {
      expect(() => code(ce.box([head, { str: 'a' }, 1]))).toThrow(
        /mixes a string operand/s
      );
    }
  );

  test('Less(list<string>, number) declines on the np.less route', () => {
    expect(() =>
      code(ce.box(['Less', ['List', { str: 'a' }, { str: 'b' }], 5]))
    ).toThrow(/Less.*mixes a string operand/s);
  });

  test('Less(string, list<number>) declines', () => {
    expect(() => code(ce.box(['Less', { str: 'a' }, ['List', 1, 2]]))).toThrow(
      /Less.*mixes a string operand/s
    );
  });

  test('an ordering CHAIN with one non-string operand declines', () => {
    expect(() => code(ce.box(['Less', { str: 'a' }, { str: 'b' }, 3]))).toThrow(
      /Less.*mixes a string operand/s
    );
  });

  test('a string alongside an UNKNOWN-typed operand is possibly-mixed', () => {
    ce.declare('u', 'unknown');
    expect(() =>
      python.compileFunction(ce.box(['Less', { str: 'a' }, 'u']), 'f', ['u'])
    ).toThrow(/Less.*mixes a string operand/s);
  });

  test('an ordering over an aggregate participant declines (both routes)', () => {
    // Tuple LITERALS reach `np.less` (which maps over them element-wise)…
    expect(() =>
      code(ce.box(['Less', ['Tuple', 1, 2], ['Tuple', 3, 4]]))
    ).toThrow(/Less.*a tuple participant/s);
    // …and tuple-TYPED symbols reach the infix `<` (Python compares tuples
    // lexicographically, where the interpreter stays symbolic).
    ce.declare('p', 'tuple<number, number>');
    ce.declare('q', 'tuple<number, number>');
    expect(() =>
      python.compileFunction(ce.box(['Less', 'p', 'q']), 'f', ['p', 'q'])
    ).toThrow(/Less.*a tuple participant/s);
    ce.declare('d1', 'dictionary<integer>');
    ce.declare('d2', 'dictionary<integer>');
    expect(() =>
      python.compileFunction(ce.box(['Less', 'd1', 'd2']), 'f', ['d1', 'd2'])
    ).toThrow(/Less.*a dictionary participant/s);
  });

  test('an ordering over a POINT LIST declines (np.less looked inside each point)', () => {
    // `np.less([(1,2)], [(3,4)])` answers `[[True, True]]`, whereas the
    // interpreter broadcasts to an inert point comparison.
    const expr = ce.box([
      'Less',
      ['List', ['Tuple', 1, 2]],
      ['List', ['Tuple', 3, 4]],
    ]);
    expect(() => code(expr)).toThrow(
      /Less.*ELEMENTS are tuples.*Fail closed \(D6\)/s
    );
    expect(expr.evaluate().toString()).toBe('[(1, 2) < (3, 4)]');
    // …and the same shape carried by point-list TYPED symbols.
    ce.declare('pl1', 'list<tuple<number, number>>');
    ce.declare('pl2', 'list<tuple<number, number>>');
    expect(() =>
      python.compileFunction(ce.box(['Less', 'pl1', 'pl2']), 'f', ['pl1', 'pl2'])
    ).toThrow(/Less.*ELEMENTS are tuples/s);
  });

  test('Less over list<string> SYMBOLS takes np.less, not the infix `<`', () => {
    // The infix route's admission is `!x.isCollection`, which is false for an
    // unassigned collection-TYPED symbol: this emitted `sl1 < sl2`, ONE
    // lexicographic Python bool, where the interpreter answers a LIST of
    // booleans. Executed parity for the emission is pinned in the venv suite.
    ce.declare('sl1', 'list<string>');
    ce.declare('sl2', 'list<string>');
    expect(
      python.compileFunction(ce.box(['Less', 'sl1', 'sl2']), 'f', [
        'sl1',
        'sl2',
      ])
    ).toContain('_ce_ord(np.less, sl1, sl2)');
  });

  test('ALL-string orderings keep compiling', () => {
    expect(code(ce.box(['Less', { str: 'a' }, { str: 'b' }]))).toContain(
      'return "a" < "b"'
    );
    expect(
      code(ce.box(['Less', { str: 'a' }, { str: 'b' }, { str: 'c' }]))
    ).toContain('("a" < _tv1) and (_tv1 < "c")');
    expect(
      code(
        ce.box([
          'Less',
          ['List', { str: 'a' }, { str: 'c' }],
          ['List', { str: 'b' }, { str: 'b' }],
        ])
      )
    ).toContain('_ce_ord(np.less, ["a", "c"], ["b", "b"])');
    expect(
      code(ce.box(['Less', ['List', { str: 'a' }, { str: 'c' }], { str: 'b' }]))
    ).toContain('_ce_ord(np.less, ["a", "c"], "b")');
  });
});

describe('Python: unknown-typed comparisons compile unchanged', () => {
  test('Equal(u, 1) keeps the scalar tolerance form', () => {
    ce.declare('u', 'unknown');
    expect(python.compileFunction(ce.box(['Equal', 'u', 1]), 'f', ['u']))
      .toMatchInlineSnapshot(`
      "def f(u):
          return (abs((u) - (1)) <= 1e-10)
      "
    `);
  });

  test('Less(u, 1) keeps the infix form', () => {
    ce.declare('u', 'unknown');
    expect(python.compileFunction(ce.box(['Less', 'u', 1]), 'f', ['u']))
      .toMatchInlineSnapshot(`
      "def f(u):
          return u < 1
      "
    `);
  });
});

describe('Python: IndexOf is NOT gated (deliberate divergence)', () => {
  test('a string needle compiles', () => {
    expect(
      code(
        ce.box(['IndexOf', ['List', { str: 'a' }, { str: 'b' }], { str: 'b' }])
      )
    ).toContain(`_ce_indexof(["a", "b"], "b")`);
  });

  test('a TUPLE needle in a point list compiles', () => {
    expect(
      code(
        ce.box([
          'IndexOf',
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
          ['Tuple', 3, 4],
        ])
      )
    ).toContain(`_ce_indexof([(1, 2), (3, 4)], (3, 4))`);
  });
});

// -----------------------------------------------------------------------------
// `compileLambda` has no place to define a module-level `_ce_*` helper, so any
// lowering that references one must fail closed rather than emit a reference to
// an undefined name (`NameError` at call time, behind a returned lambda). Only
// `_ce_bcast` was guarded; `_ce_indexof` and `_ce_eqcoll` were not.
// -----------------------------------------------------------------------------
describe('Python: compileLambda fails closed on runtime-helper lowerings', () => {
  test('an IndexOf body declines (it emitted an undefined _ce_indexof)', () => {
    expect(() =>
      python.compileLambda(ce.box(['IndexOf', ['List', 1, 2], 'v']), ['v'])
    ).toThrow(/_ce_indexof.*compileFunction/s);
  });

  test('a two-collection Equal body declines (undefined _ce_eqcoll)', () => {
    expect(() =>
      python.compileLambda(
        ce.box(['Equal', ['List', 1, 2], ['List', 1, 2]]),
        []
      )
    ).toThrow(/_ce_eqcoll.*compileFunction/s);
  });

  test('an ordering over a collection declines (undefined _ce_ord)', () => {
    ce.declare('xs', 'list<real>');
    expect(() =>
      python.compileLambda(ce.box(['Less', 'xs', 3]), ['xs'])
    ).toThrow(/_ce_ord.*compileFunction/s);
  });
});

// -----------------------------------------------------------------------------
// EXECUTED parity for every shape the gates keep admitting. The suite is
// skipped when the repo venv (with numpy) is unavailable, exactly as
// `compile-python-parity.test.ts` does.
// -----------------------------------------------------------------------------

const VENV_PYTHON =
  [
    path.join(__dirname, '..', '..', 'venv', 'bin', 'python3'),
    path.join(process.cwd(), 'venv', 'bin', 'python3'),
  ].find((p) => fs.existsSync(p)) ??
  path.join(process.cwd(), 'venv', 'bin', 'python3');

function venvHasNumpy(): boolean {
  try {
    if (!fs.existsSync(VENV_PYTHON)) return false;
    execFileSync(VENV_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

type Json = boolean | number | string | Json[];

/** The interpreter's answer, in the same JSON shape the emitted code prints. */
function interpreted(expr: BoxedExpression): Json {
  const v = expr.evaluate();
  const scalar = (x: BoxedExpression): Json => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    return x.re;
  };
  if (v.symbol === 'True' || v.symbol === 'False') return scalar(v);
  if (v.isCollection) return [...v.each()].map(scalar);
  return scalar(v);
}

const ADMITTED: Array<{ name: string; expr: any }> = [
  // ALL-string orderings: scalar (including the non-ASCII pair a locale-aware
  // collation would order differently), chained, list-vs-list, list-vs-scalar.
  { name: 'lt_ab', expr: ['Less', { str: 'a' }, { str: 'b' }] },
  { name: 'lt_ba', expr: ['Less', { str: 'b' }, { str: 'a' }] },
  { name: 'lt_Za', expr: ['Less', { str: 'Z' }, { str: 'a' }] },
  { name: 'lt_10_9', expr: ['Less', { str: '10' }, { str: '9' }] },
  { name: 'lt_a_umlaut_b', expr: ['Less', { str: 'ä' }, { str: 'b' }] },
  { name: 'le_aa', expr: ['LessEqual', { str: 'a' }, { str: 'a' }] },
  { name: 'gt_ba', expr: ['Greater', { str: 'b' }, { str: 'a' }] },
  { name: 'ge_ab', expr: ['GreaterEqual', { str: 'a' }, { str: 'b' }] },
  {
    name: 'lt_chain_abc',
    expr: ['Less', { str: 'a' }, { str: 'b' }, { str: 'c' }],
  },
  {
    name: 'lt_chain_acb',
    expr: ['Less', { str: 'a' }, { str: 'c' }, { str: 'b' }],
  },
  {
    name: 'lt_list_list',
    expr: [
      'Less',
      ['List', { str: 'a' }, { str: 'c' }],
      ['List', { str: 'b' }, { str: 'b' }],
    ],
  },
  {
    name: 'lt_list_scalar',
    expr: ['Less', ['List', { str: 'a' }, { str: 'c' }], { str: 'b' }],
  },
  {
    name: 'ge_list_list',
    expr: [
      'GreaterEqual',
      ['List', { str: 'a' }, { str: 'c' }],
      ['List', { str: 'b' }, { str: 'b' }],
    ],
  },
  // IndexOf, every shape.
  {
    name: 'indexof_string_needle',
    expr: ['IndexOf', ['List', { str: 'a' }, { str: 'b' }], { str: 'b' }],
  },
  {
    name: 'indexof_string_missing',
    expr: ['IndexOf', ['List', { str: 'a' }, { str: 'b' }], { str: 'z' }],
  },
  {
    name: 'indexof_tuple_needle',
    expr: [
      'IndexOf',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['Tuple', 3, 4],
    ],
  },
  {
    name: 'indexof_tuple_missing',
    expr: [
      'IndexOf',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['Tuple', 9, 9],
    ],
  },
  { name: 'indexof_number', expr: ['IndexOf', ['List', 5, 7, 9], 9] },
  // BOOLEAN-ness is part of the element test: Python's `True == 1` would
  // otherwise find a boolean needle in a numeric haystack (and vice versa),
  // where the interpreter's `.isSame()` answers 0. Guarded by `_ce_same`
  // inside the `_ce_indexof` adapter (ruled 2026-08-08: adapter, not gate).
  {
    name: 'indexof_bool_needle_numbers',
    expr: ['IndexOf', ['List', 1, 2], 'True'],
  },
  {
    name: 'indexof_number_needle_bools',
    expr: ['IndexOf', ['List', 'True'], 1],
  },
  {
    name: 'indexof_bool_needle_bools',
    expr: ['IndexOf', ['List', 'True', 'False'], 'False'],
  },
  // …while numbers still match across int/float, like the interpreter.
  {
    name: 'indexof_float_needle',
    expr: ['IndexOf', ['List', { num: '1.5' }, 3], { num: '1.5' }],
  },
  // NaN is the other departure from Python equality: `nan == nan` is False, so
  // a NaN needle was never found, where the interpreter's structural
  // `.isSame()` answers 1. (`NaN` is emitted as `np.nan`, a plain float.)
  {
    name: 'indexof_nan_found',
    expr: ['IndexOf', ['List', 'NaN', 3], 'NaN'],
  },
  {
    name: 'indexof_nan_missing',
    expr: ['IndexOf', ['List', 1, 2], 'NaN'],
  },
  // EXACTNESS: the interpreter's number `.isSame()` has NO tolerance, so a
  // needle merely within `engine.tolerance` of an element is NOT found.
  // `_ce_same`'s leaf used to compare within the engine tolerance and answered
  // 1 on both of these. (The earlier belief that the interpreter tolerated
  // float noise came from probing `IndexOf([0.3], Add(0.1, 0.2))`, where
  // `Add(0.1, 0.2)` EVALUATES to exactly `0.3` by exact decimal folding, so the
  // comparison leaf never saw a near-miss float.)
  //
  // ACCEPTED RESIDUAL (documented, not executed — canonicalization folds the
  // sum away before the compiler sees it): a needle COMPUTED at runtime to a
  // near-miss f64 (Python's `0.1 + 0.2` → `0.30000000000000004`) is not found
  // in a `[0.3]` haystack, where the interpreter folds the sum exactly and does
  // find it. Inherent exactness loss of compiling to f64; no element test can
  // close it.
  {
    name: 'indexof_tolerance_needle_not_found',
    expr: ['IndexOf', ['List', 0], { num: '5e-11' }],
  },
  {
    name: 'indexof_float_noise_element_not_found',
    expr: ['IndexOf', ['List', { num: '0.30000000000000004' }], 0.3],
  },
  // Tuple-vs-tuple equality (the aggregate carve-out).
  {
    name: 'eq_tuple_tuple_true',
    expr: ['Equal', ['Tuple', 1, 2], ['Tuple', 1, 2]],
  },
  {
    name: 'eq_tuple_tuple_false',
    expr: ['Equal', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  },
  {
    name: 'neq_tuple_tuple',
    expr: ['NotEqual', ['Tuple', 1, 2], ['Tuple', 1, 2]],
  },
  {
    name: 'eq_tuple_arity_mismatch',
    expr: ['Equal', ['Tuple', 1, 2], ['Tuple', 1, 2, 3]],
  },
  // All-string COLLECTION equality (the string carve-out).
  {
    name: 'eq_strcoll_true',
    expr: [
      'Equal',
      ['List', { str: 'a' }, { str: 'b' }],
      ['List', { str: 'a' }, { str: 'b' }],
    ],
  },
  {
    name: 'eq_strcoll_false',
    expr: ['Equal', ['List', { str: 'a' }], ['List', { str: 'c' }]],
  },
  {
    name: 'eq_strcoll_numeric_looking',
    expr: ['Equal', ['List', { str: '1' }], ['List', { str: '1.0' }]],
  },
  {
    name: 'eq_strcoll_len_mismatch',
    expr: [
      'Equal',
      ['List', { str: 'a' }],
      ['List', { str: 'a' }, { str: 'b' }],
    ],
  },
  {
    name: 'neq_strcoll',
    expr: ['NotEqual', ['List', { str: 'a' }], ['List', { str: 'a' }]],
  },
  {
    name: 'eq_strcoll_chain',
    expr: [
      'Equal',
      ['List', { str: 'a' }],
      ['List', { str: 'a' }],
      ['List', { str: 'a' }],
    ],
  },
  // SCALAR string equality (tier 2): the structural `==`/`!=` admission. The
  // numeric-string rows are the trap the tolerance form could never express —
  // `"1"` and `"1.0"` are DIFFERENT strings, as the interpreter says.
  { name: 'eq_str_equal', expr: ['Equal', { str: 'a' }, { str: 'a' }] },
  { name: 'eq_str_unequal', expr: ['Equal', { str: 'a' }, { str: 'b' }] },
  { name: 'neq_str_unequal', expr: ['NotEqual', { str: 'a' }, { str: 'b' }] },
  { name: 'neq_str_equal', expr: ['NotEqual', { str: 'a' }, { str: 'a' }] },
  { name: 'eq_str_empty', expr: ['Equal', { str: '' }, { str: '' }] },
  {
    name: 'eq_str_numeric_looking',
    expr: ['Equal', { str: '1' }, { str: '1.0' }],
  },
  { name: 'eq_str_numeric_same', expr: ['Equal', { str: '1' }, { str: '1' }] },
];

const describeMaybe = venvHasNumpy() ? describe : describe.skip;

describeMaybe('PYTHON STRING/AGGREGATE COMPARISON PARITY (venv)', () => {
  it('every admitted shape executes to the interpreter’s answer', () => {
    const engine = new ComputeEngine();
    let src = 'import numpy as np\nimport json\n\n';
    src +=
      'def _ser(z):\n' +
      '    if isinstance(z, np.ndarray): return [_ser(x) for x in z.tolist()]\n' +
      '    if isinstance(z, (bool, np.bool_)): return bool(z)\n' +
      '    if isinstance(z, (list, tuple)): return [_ser(x) for x in z]\n' +
      '    return float(z)\n\n';
    const expected: Json[] = [];

    for (const c of ADMITTED) {
      const expr = engine.box(c.expr);
      src += `${python.compileFunction(expr, `fn_${c.name}`, [])}\n`;
      expected.push(interpreted(expr));
    }

    src += '\nresults = []\n';
    for (const c of ADMITTED) src += `results.append(_ser(fn_${c.name}()))\n`;
    src += 'print(json.dumps(results))\n';

    const file = path.join(
      os.tmpdir(),
      `ce-py-string-parity-${process.pid}.py`
    );
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    const actual = JSON.parse(out) as Json[];

    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      // Name the case in the failure message.
      expect({ [ADMITTED[i].name]: actual[i] }).toEqual({
        [ADMITTED[i].name]: expected[i],
      });
    }
  });

  it('Less over list<string> PARAMETERS is element-wise, like the interpreter', () => {
    // The shape Finding 1 fixed: with the infix `<` this returned ONE
    // lexicographic bool. Executed against the interpreter's answer for the
    // same values substituted as literals.
    const engine = new ComputeEngine();
    engine.declare('sl1', 'list<string>');
    engine.declare('sl2', 'list<string>');
    const fn = python.compileFunction(engine.box(['Less', 'sl1', 'sl2']), 'f', [
      'sl1',
      'sl2',
    ]);
    const src =
      'import numpy as np\nimport json\n\n' +
      `${fn}\n` +
      'print(json.dumps([bool(x) for x in f(["a", "c"], ["b", "b"])]))\n';
    const file = path.join(os.tmpdir(), `ce-py-strlist-lt-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual([true, false]);
    expect(
      engine
        .box([
          'Less',
          ['List', { str: 'a' }, { str: 'c' }],
          ['List', { str: 'b' }, { str: 'b' }],
        ])
        .evaluate()
        .toString()
    ).toBe('["True","False"]');
  });

  it('Less over list<number> PARAMETERS is element-wise, like the interpreter', () => {
    // The numeric mirror of the row above, with the lists supplied as plain
    // Python lists at CALL time (not folded into the emission).
    const engine = new ComputeEngine();
    engine.declare('nl1', 'list<number>');
    engine.declare('nl2', 'list<number>');
    const fn = python.compileFunction(engine.box(['Less', 'nl1', 'nl2']), 'f', [
      'nl1',
      'nl2',
    ]);
    const src =
      'import numpy as np\nimport json\n\n' +
      `${fn}\n` +
      'print(json.dumps([bool(x) for x in f([1, 9, 3], [3, 4, 3])]))\n';
    const file = path.join(os.tmpdir(), `ce-py-numlist-lt-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual([true, false, false]);
    expect(
      engine
        .box(['Less', ['List', 1, 9, 3], ['List', 3, 4, 3]])
        .evaluate()
        .toString()
    ).toBe('["True","False","False"]');
  });

  it('an ordering over collections of DIFFERENT lengths raises, including 1-vs-n', () => {
    // The interpreter answers `Error("incompatible-dimensions", …)` for both
    // shapes. NumPy raises on 3-vs-2 but SILENTLY BROADCASTS 1-vs-n
    // (`np.less([1], [1, 2])` → `[False, True]`), a wrong answer behind a
    // `success: true` — hence the `_ce_ord` shape guard.
    const engine = new ComputeEngine();
    engine.declare('nl1', 'list<number>');
    engine.declare('nl2', 'list<number>');
    const fn = python.compileFunction(engine.box(['Less', 'nl1', 'nl2']), 'f', [
      'nl1',
      'nl2',
    ]);
    const src =
      'import numpy as np\nimport json\n\n' +
      `${fn}\n` +
      'out = []\n' +
      'for a, b in [([1, 2, 3], [1, 2]), ([1], [1, 2])]:\n' +
      '    try:\n' +
      '        out.append(f(a, b).tolist())\n' +
      '    except ValueError:\n' +
      '        out.append("raised")\n' +
      'print(json.dumps(out))\n';
    const file = path.join(os.tmpdir(), `ce-py-ord-shape-${process.pid}.py`);
    fs.writeFileSync(file, src);
    let out = '';
    try {
      out = execFileSync(VENV_PYTHON, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(JSON.parse(out)).toEqual(['raised', 'raised']);
    // The interpreter's verdict on the same two shapes.
    for (const pair of [
      [
        ['List', 1, 2, 3],
        ['List', 1, 2],
      ],
      [['List', 1], ['List', 1, 2]],
    ] as const)
      expect(
        engine.box(['Less', ...pair] as any).evaluate().operator
      ).toBe('Error');
  });
});
