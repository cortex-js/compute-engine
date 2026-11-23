/**
 * Compiling `N`, `MatchesType` (`x is T`) and `Match` (CE-1652, step 1;
 * `compilation/ir/README.md`, "Match, x is T and N").
 *
 * - `N(x, p)` of a number, a string or a boolean is `x`, for `p` absent or
 *   a literal of at least 15 digits.
 * - `MatchesType(x, T)` is a boolean constant, decided from the static type
 *   of `x`; a type that the static type neither proves nor excludes
 *   declines. No run-time test of a type is emitted.
 * - `Match`: a case of a constant is a clause of a `Which` on the subject,
 *   `_` is the default, a `Tuple` pattern of names is selected by the shape
 *   of the subject at compile time, and a constant subject keeps one case.
 * - `Element(x, S)` of a number set (`Integers`, `RealNumbers`, ...) is
 *   decided as `MatchesType` of the type of the set, and `NotElement(x, S)`
 *   is its negation (CE-1738).
 *
 * Every case is compared with the interpreter's value, on `javascript` and
 * `interval-js` (an enclosure that holds it); `glsl` cannot run here, so it
 * is checked to compile or to decline as stated.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Target = 'javascript' | 'glsl' | 'interval-js';
type Outcome =
  { ok: true; run: (inputs: object) => any } | { ok: false; message: string };

function engine(defs: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  ce.declare('s', 'string');
  executeEpsil(ce, defs);
  return ce;
}

function compileTo(ce: ComputeEngine, expr: any, to: Target): Outcome {
  try {
    const r: any = compile(ce.box(expr), { to, fallback: false } as any);
    return { ok: true, run: (inputs) => r.run(inputs) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** The interpreter's value of `expr` with each input replaced by its value:
 *  a number, a string or a boolean. */
function interpreted(
  ce: ComputeEngine,
  expr: any,
  inputs: Record<string, any>
) {
  const subs = Object.fromEntries(
    Object.entries(inputs).map(([k, v]) => [
      k,
      typeof v === 'string' ? ce.string(v) : ce.box(v),
    ])
  );
  const v = ce.box(expr).subs(subs).evaluate();
  if (isSymbol(v, 'True')) return true;
  if (isSymbol(v, 'False')) return false;
  if (isString(v)) return v.string;
  return v.re;
}

/** `expr` compiles on JavaScript and gives the interpreter's value at each
 *  point; on `interval-js` it gives an enclosure of it, or declines with
 *  `interval`; on GLSL it compiles, or declines with `glsl`. */
function expectAgrees(
  ce: ComputeEngine,
  expr: any,
  points: Record<string, any>[],
  declines: { glsl?: RegExp; interval?: RegExp } = {}
) {
  const js = compileTo(ce, expr, 'javascript');
  if (!js.ok) throw new Error(js.message);
  const iv = compileTo(ce, expr, 'interval-js');
  if (declines.interval) {
    expect(iv.ok).toBe(false);
    expect((iv as { message: string }).message).toMatch(declines.interval);
  } else if (!iv.ok) throw new Error(iv.message);
  for (const p of points) {
    const expected = interpreted(ce, expr, p);
    const got = js.run(p);
    if (typeof expected === 'number') expect(got).toBeCloseTo(expected, 12);
    else expect(got).toBe(expected);
    if (iv.ok) {
      const r = iv.run(p);
      expect(r.kind).toBe('interval');
      expect(r.value.lo).toBeLessThanOrEqual(expected as number);
      expect(r.value.hi).toBeGreaterThanOrEqual(expected as number);
    }
  }
  const glsl = compileTo(ce, expr, 'glsl');
  if (declines.glsl) {
    expect(glsl.ok).toBe(false);
    expect((glsl as { message: string }).message).toMatch(declines.glsl);
  } else if (!glsl.ok) throw new Error(glsl.message);
}

/** `expr` declines on every target, with `reason` on each one that
 *  `reasons` does not name otherwise. */
function expectDeclines(
  ce: ComputeEngine,
  expr: any,
  reason: RegExp,
  reasons: Partial<Record<Target, RegExp>> = {}
) {
  for (const to of ['javascript', 'glsl', 'interval-js'] as Target[]) {
    const r = compileTo(ce, expr, to);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(reasons[to] ?? reason);
  }
}

const TEXT = /text compiles on javascript only/;

describe('N(x, p)', () => {
  const ce = engine(`
    function nr(x: real) { N(x, 15) * 2 }
    function ns(s: string) { N(s) }
    function nb(x: real) { if N(x > 1) { 1 } else { 0 } }
    function n5(x: real) { N(x, 5) }
    function nl(x: real) { N([x, 2]) }
  `);

  test('of a real is its value', () =>
    expectAgrees(ce, ['nr', 'x'], [{ x: 1.5 }, { x: -0.1 }], {
      interval: /N of a number in the interval mode/,
    }));

  test('of a string is the string', () =>
    expectAgrees(ce, ['ns', 's'], [{ s: 'ab' }], {
      glsl: TEXT,
      interval: TEXT,
    }));

  test('of a boolean is the boolean', () =>
    expectAgrees(ce, ['nb', 'x'], [{ x: 1.5 }, { x: 0.5 }]));

  test('of a complex number is the complex number', () =>
    expect(
      compileTo(
        ce,
        ['Im', ['N', ['Multiply', 'x', 'ImaginaryUnit']]],
        'javascript'
      )
    ).toMatchObject({ ok: true }));

  test('of a precision of fewer than 15 digits declines', () =>
    expectDeclines(
      ce,
      ['n5', 'x'],
      /N of a precision that is not a literal integer of at least 15 digits/
    ));

  test('of a list declines', () =>
    expectDeclines(ce, ['nl', 'x'], /N of a value of type vector<real\^2>/));
});

describe('MatchesType(x, T): a constant from the static type of x', () => {
  const ce = engine(`
    function isReal(x: real) { if x is real { 1 } else { 2 } }
    function isText(x: real) { if x is string { 1 } else { 2 } }
    function textIsText(s: string) { if s is string { "y" } else { "n" } }
    function isInteger(x: real) { if x is integer { 1 } else { 2 } }
    function byMatch(s: string, x: real) { match s { == "a" => x * 2; _ => 0 } }
    function matchIsInteger(s: string, x: real) {
      if byMatch(s, x) is integer { 1 } else { 0 }
    }
  `);

  test('True when the static type is a subtype of T', () => {
    expectAgrees(ce, ['isReal', 'x'], [{ x: 1.5 }]);
    expect(
      compileTo(ce, ['MatchesType', 'x', { str: 'real' }], 'javascript')
    ).toMatchObject({ ok: true });
  });

  test('False when the two types do not overlap', () =>
    expectAgrees(ce, ['isText', 'x'], [{ x: 1.5 }]));

  test('of a string', () =>
    expectAgrees(ce, ['textIsText', 's'], [{ s: 'q' }], {
      glsl: TEXT,
      interval: TEXT,
    }));

  test('declines when the static type neither proves nor excludes T', () =>
    expectDeclines(
      ce,
      ['isInteger', 'x'],
      /MatchesType of a value of type real, which neither proves nor excludes integer/
    ));

  test('declines a subject whose static type comes from a Match (CE-1731)', () => {
    // The engine types `byMatch(s, x)` as an integer, from the case `_ => 0`;
    // its value at `"a"`, 1.25 is 2.5.
    expect(
      interpreted(ce, ['matchIsInteger', 's', 'x'], { s: 'a', x: 1.25 })
    ).toBe(0);
    expectDeclines(
      ce,
      ['matchIsInteger', 's', 'x'],
      /MatchesType of a subject whose static type comes from a Match/
    );
  });
});

describe('MatchesType of a local', () => {
  const ce = engine(`
    function localIsText(p: tuple<real, real>) {
      let y = match p { (a, b) => a + b; _ => "none" }
      if y is string { 0 } else { 1 }
    }
    function m2(v: real) { match v { == 1 => "one"; _ => v } }
    function mapped(x: real) { if map(m2, [x]) is list<real> { 0 } else { 1 } }
    function declaredLet(s: string, x: real) -> boolean {
      let k = 2
      match s { == "a" => x * k; _ => x + 1 }
    }
  `);

  test('declines a subject that reads a local (CE-1731)', () => {
    // The engine types `y` as a string, from the case `_ => "none"`; the
    // case taken is the Tuple pattern.
    expect(
      interpreted(ce, ['localIsText', ['Tuple', 'x', 2]], { x: 1.5 })
    ).toBe(1);
    expectDeclines(
      ce,
      ['localIsText', ['Tuple', 'x', 2]],
      /MatchesType of a subject that reads a local, whose type can come from a Match/
    );
  });

  test('declines a subject that calls, by name, a function whose body is a Match', () =>
    expectDeclines(
      ce,
      ['mapped', 'x'],
      /MatchesType of a subject whose static type comes from a Match/
    ));

  test('keeps a declared result after a let: a body that contradicts it declines', () =>
    expectDeclines(
      ce,
      ['declaredLet', 's', 'x'],
      /a body of declaredLet that is not boolean/,
      { 'glsl': TEXT, 'interval-js': TEXT }
    ));
});

describe('Match', () => {
  const ce = engine(`
    function shape(s: string, x: real) {
      match s { == "rect" => x * 2; == "circ" => x + 1; _ => 0 }
    }
    function count(n: integer, x: real) { match n { == 3 => x; 4 => 1; _ => 2 * x } }
    direct(s: string, x: real) = match s { == "a" => x; _ => -x }
    function sum(p: tuple<real, real>) { match p { (a, b) => a + b; _ => 0 } }
    function lengths(p: tuple<real, real>) {
      match p { (a, b, c) => a; (u, _) => u * 3; _ => 0 }
    }
    function scalar(x: real) { match x { (a, b) => a; _ => x + 1 } }
    function nested(p: tuple<real, real>) {
      match p { (a, b) => match a { == 1 => b * 10; _ => b }; _ => 0 }
    }
    function constantText(x: real) {
      match "rect" { == "circ" => [1, 2]; == "rect" => x; _ => "a" }
    }
    function constantNumber(x: real) {
      match 2 { == 1 => [1, 2]; == 2 => x * 3; _ => [3] }
    }
    function guarded(x: real) { match x { y if y > 1 => 1; _ => 0 } }
    function binding(x: real) { match x { y => y + 1 } }
    function shapes(n: integer) { match n { == 1 => [1, 2]; _ => 3 } }
    function noDefault(n: integer) { match n { == 1 => 2; == 2 => 3 } }
    function onList(L: list<real>) { match L { (a, b) => a; _ => 0 } }
    function declared(s: string, x: real) -> boolean {
      match s { == "a" => x; _ => x + 1 }
    }
    function large(n: integer) {
      match 1152921504606846976 { 1152921504606846976 => n; _ => 0 }
    }
  `);

  test('cases of string constants are the clauses of a Which', () =>
    expectAgrees(
      ce,
      ['shape', 's', 'x'],
      [
        { s: 'rect', x: 1.5 },
        { s: 'circ', x: 1.5 },
        { s: 'other', x: 1.5 },
      ],
      { glsl: TEXT, interval: TEXT }
    ));

  test('cases of number constants are the clauses of a Which', () =>
    expectAgrees(
      ce,
      ['count', 'n', 'x'],
      [
        { n: 3, x: 1.5 },
        { n: 4, x: 1.5 },
        { n: 5, x: 1.5 },
      ]
    ));

  test('a Match as the body of a function', () =>
    expectAgrees(
      ce,
      ['direct', 's', 'x'],
      [
        { s: 'a', x: 1.5 },
        { s: 'b', x: 1.5 },
      ],
      { glsl: TEXT, interval: TEXT }
    ));

  test('a Tuple pattern binds its names to the elements', () =>
    expectAgrees(ce, ['sum', ['Tuple', 'x', 2]], [{ x: 1.5 }, { x: -4 }]));

  test('a Tuple pattern of another length, or on a scalar, is not taken', () => {
    expectAgrees(ce, ['lengths', ['Tuple', 'x', 2]], [{ x: 1.5 }]);
    expectAgrees(ce, ['scalar', 'x'], [{ x: 1.5 }]);
  });

  test('a Match in a case reads the names of the case', () =>
    expectAgrees(
      ce,
      ['nested', ['Tuple', 'n', 'x']],
      [
        { n: 1, x: 1.5 },
        { n: 2, x: 1.5 },
      ]
    ));

  test('a constant subject keeps one case: the shapes of the others do not count', () => {
    expectAgrees(ce, ['constantText', 'x'], [{ x: 1.5 }], {
      glsl: TEXT,
      interval: TEXT,
    });
    expectAgrees(ce, ['constantNumber', 'x'], [{ x: 1.5 }]);
  });

  test('a case with a guard declines', () =>
    expectDeclines(ce, ['guarded', 'x'], /a case of a Match with a guard/));

  test('a pattern of another kind declines', () =>
    expectDeclines(
      ce,
      ['binding', 'x'],
      /a pattern of a Match that is not a string, a real number, _ or a Tuple of distinct names/
    ));

  test('cases whose results differ in shape decline', () =>
    expectDeclines(ce, ['shapes', 'n'], /arms of two types/));

  test('a Match with no case that takes every value declines', () =>
    expectDeclines(
      ce,
      ['noDefault', 'n'],
      /a Match with no case that takes every value/
    ));

  test('a body that contradicts a declared result declines', () =>
    expectDeclines(
      ce,
      ['declared', 's', 'x'],
      /a body of declared that is not boolean/,
      { 'glsl': TEXT, 'interval-js': TEXT }
    ));

  test('a host signature that the body contradicts declines', () => {
    ce.declare('hostDeclared', {
      signature: '(string, real) -> boolean',
      evaluate: [
        'Function',
        ['Match', 's', ['MatchCase', { str: 'a' }, 'x'], ['MatchCase', '_', 0]],
        's',
        'x',
      ],
    } as any);
    expectDeclines(
      ce,
      ['hostDeclared', 's', 'x'],
      /a body of hostDeclared that is not boolean/,
      { 'glsl': TEXT, 'interval-js': TEXT }
    );
  });

  test('a large integer subject in the bigint mode', () => {
    const r: any = compile(ce.box(['large', 'n']), {
      to: 'javascript',
      mode: 'bigint',
      fallback: false,
    } as any);
    expect(r.run({ n: 7n })).toBe(7n);
    expect(interpreted(ce, ['large', 'n'], { n: 7 })).toBe(7);
  });

  test('a Tuple pattern on a list declines', () => {
    ce.declare('L', 'list<real>');
    expectDeclines(ce, ['onList', 'L'], /a Tuple pattern of a Match on a list/);
  });
});

describe('MatchesType of a name whose value holds a Match', () => {
  test('declines (CE-1731)', () => {
    const ce = engine('');
    ce.declare('v', 'unknown');
    ce.assign(
      'v',
      ce.box([
        'Hold',
        [
          'Match',
          's',
          ['MatchCase', { str: 'a' }, ['Multiply', 2, 'x']],
          ['MatchCase', '_', 0],
        ],
      ])
    );
    expectDeclines(
      ce,
      ['MatchesType', 'v', { str: 'integer' }],
      /MatchesType of a subject whose static type comes from a Match/
    );
  });
});

describe('Element(x, S) of a number set: a constant from the static type of x (CE-1738)', () => {
  const ce = engine(`
    function byMatch(s: string, x: real) { match s { == "a" => x * 2; _ => 0 } }
  `);
  ce.declare('L', 'list<integer>');
  const test01 = (x: any, set: string) => ['If', ['Element', x, set], 1, 0];

  test('True when the static type is a subtype of the type of S', () => {
    for (const set of ['Integers', 'RationalNumbers', 'RealNumbers', 'Numbers'])
      expectAgrees(ce, test01('n', set), [{ n: 3 }, { n: -2 }]);
    expectAgrees(ce, test01(['Add', 'n', 1], 'Integers'), [{ n: 3 }]);
    expectAgrees(ce, test01('x', 'ComplexNumbers'), [{ x: 0.5 }]);
  });

  test('False when the two types do not overlap', () => {
    expectAgrees(ce, test01('x', 'ImaginaryNumbers'), [{ x: 0.5 }]);
    expectAgrees(ce, test01('s', 'Integers'), [{ s: 'a' }]);
  });

  test('of an element of a list of integers', () => {
    const r: any = compile(
      ce.box(['Map', ['Function', ['Element', 'k', 'Integers'], 'k'], 'L']),
      { fallback: false }
    );
    expect(r.run({ L: [1, -4] })).toEqual([true, true]);
  });

  test('declines when the static type neither proves nor excludes the set', () => {
    expectDeclines(
      ce,
      ['Element', 'x', 'Integers'],
      /Element of a value that the interpreter may hold exactly/,
      { 'interval-js': /Element on interval-js/ }
    );
    // `NonNegativeIntegers` is not a set of `domainToType()`: the type of
    // `n` does not prove it.
    expectDeclines(
      ce,
      ['Element', 'n', 'NonNegativeIntegers'],
      /Element of a value that the interpreter may hold exactly/,
      { 'interval-js': /Element on interval-js/ }
    );
  });

  test('declines a subject whose static type comes from a Match (CE-1731)', () => {
    // The engine types `byMatch(s, x)` as an integer, from the case `_ => 0`;
    // its value at `"a"`, 1.25 is 2.5.
    expect(
      interpreted(ce, test01(['byMatch', 's', 'x'], 'Integers'), {
        s: 'a',
        x: 1.25,
      })
    ).toBe(0);
    expectDeclines(
      ce,
      ['Element', ['byMatch', 's', 'x'], 'Integers'],
      /Element of a value that the interpreter may hold exactly/,
      { 'interval-js': /Element on interval-js/ }
    );
    // `NotElement` has no list lowering: a decline shows that the type of
    // the subject did not decide it.
    expectDeclines(
      ce,
      ['NotElement', ['byMatch', 's', 'x'], 'Integers'],
      /the operator NotElement is not supported/
    );
  });

  test('NotElement is the negation', () => {
    expectAgrees(ce, ['If', ['NotElement', 'n', 'Integers'], 1, 0], [{ n: 3 }]);
    expectAgrees(
      ce,
      ['If', ['NotElement', 'x', 'ImaginaryNumbers'], 1, 0],
      [{ x: 0.5 }]
    );
    expectDeclines(
      ce,
      ['NotElement', 'x', 'Integers'],
      /the operator NotElement is not supported/
    );
  });
});
