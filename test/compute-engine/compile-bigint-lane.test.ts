import { ComputeEngine, compile } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import {
  analyzeBigintLane,
  bigintCseExclusion,
  bigintLane,
  requireBigintLane,
  type BigintLaneAnalysis,
  type BigintLaneRecord,
} from '../../src/compute-engine/compilation/compile-bigint-lane';
import { isCseAdmissible } from '../../src/compute-engine/compilation/cse';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * CE-715, step 2 of `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`:
 * the lane analysis of `mode: 'bigint'` (`compile-bigint-lane.ts`).
 *
 * Every numeric node of an expression compiled in the mode must be on the
 * bigint lane, or the compilation declines with `code: 'bigint-lane'` and a
 * reason specific to the rule that failed. The analysis records, for each
 * node, what the emitters of step 3 read: the kind of value, the refined
 * type, the kind of lowering and the parent-lowered shape. The analysis
 * does not track where a value that is not finite (a pole) can occur: such
 * an expression compiles, and its compiled result is then a `number` (§3.4).
 */

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('k0', 'integer<0..>');
ce.declare('L', 'list<integer>');
ce.declare('LL', 'list<list<integer>>');
ce.declare('r', 'real');
ce.declare('w', 'integer | infinity');
// A function declared with a `number` parameter.
ce.declare('h', '(number) -> number');
ce.box(['Assign', 'h', ['Function', ['Add', ['Power', 'x', 2], 1], 'x']]).evaluate();
// A function with no declaration: its literal has an untyped parameter.
ce.parse('f(x) := x!').evaluate();
// A function declared `-> integer`: an integer promise for its body.
ce.declare('g', '(integer) -> integer');
ce.box(['Assign', 'g', ['Function', ['Factorial', 'x'], 'x']]).evaluate();
ce.declare('half', '(integer) -> integer');
ce.box([
  'Assign',
  'half',
  ['Function', ['Divide', ['Multiply', 'x', ['Add', 'x', 1]], 2], 'x'],
]).evaluate();
// A quotient declared `-> integer`: the divisor can be zero.
ce.declare('quo', '(integer, integer) -> integer');
ce.box(['Assign', 'quo', ['Function', ['Divide', 'x', 'y'], 'x', 'y']]).evaluate();
// A recursive function declared `-> integer`.
ce.declare('fact', '(integer) -> integer');
ce.box([
  'Assign',
  'fact',
  [
    'Function',
    [
      'If',
      ['LessEqual', 'x', 1],
      1,
      ['Multiply', 'x', ['fact', ['Subtract', 'x', 1]]],
    ],
    'x',
  ],
]).evaluate();

type Json = Parameters<typeof ce.box>[0];

function accept(json: Json): {
  expr: Expression;
  analysis: BigintLaneAnalysis;
  root: BigintLaneRecord;
} {
  const expr = ce.box(json);
  const r = analyzeBigintLane(expr);
  if (!r.accepted)
    throw new Error(`declined: ${expr.toString()}: ${r.decline.message}`);
  return { expr, analysis: r.analysis, root: r.analysis.records.get(expr)! };
}

function decline(json: Json): string {
  const expr = ce.box(json);
  const r = analyzeBigintLane(expr);
  if (r.accepted) throw new Error(`accepted: ${expr.toString()}`);
  expect(r.decline.diagnostic.code).toBe('bigint-lane');
  expect(r.decline.diagnostic.kind).toBe('capability');
  return r.decline.message;
}

const t = (s: string) => typeToString(parseType(s));
const typeOf = (rec: BigintLaneRecord) => typeToString(rec.type);

describe('bigintLane(type)', () => {
  it.each([
    ['integer', true],
    ['integer<0..>', true],
    ['integer | nan', true],
    ['infinity | integer', true],
    ['integer | nan | signed_infinity', true],
    ['rational', false],
    ['real', false],
    ['nan | real', false],
    ['complex', false],
    ['number', false],
    ['boolean', false],
    ['list<integer>', false],
  ])('%s is on the lane: %s', (type, expected) => {
    expect(bigintLane(parseType(type))).toBe(expected);
  });
});

describe('the rows of the lane table (§3.1)', () => {
  it('Binom(2n, n) − Binom(2n, n+1) is on the lane', () => {
    const { root } = accept([
      'Subtract',
      ['Binomial', ['Multiply', 2, 'n'], 'n'],
      ['Binomial', ['Multiply', 2, 'n'], ['Add', 'n', 1]],
    ]);
    expect(root.value).toBe('bigint');
    expect(root.lowering).toBe('bigint');
  });

  it.each([
    ['Mod(n, 7)', ['Mod', 'n', 7]],
    ['GCD(n, m)', ['GCD', 'n', 'm']],
    ['−n', ['Negate', 'n']],
  ] as const)('%s is on the lane', (_, json) => {
    const { root } = accept(json as Json);
    expect(root.value).toBe('bigint');
    expect(typeOf(root)).toBe('integer');
  });

  it('Mod(n, m) is refined to integer | nan', () => {
    const { root } = accept(['Mod', 'n', 'm']);
    expect(typeOf(root)).toBe(t('integer | nan'));
  });

  it('Abs(n!) is refined to integer<0..> | infinity', () => {
    const { root } = accept(['Abs', ['Factorial', 'n']]);
    expect(typeOf(root)).toBe(t('integer<0..> | infinity'));
  });

  it.each([
    ['Sum(i², i = 1..n)', ['Sum', ['Square', 'i'], ['Limits', 'i', 1, 'n']]],
    ['Product(i, i = 1..n)', ['Product', 'i', ['Limits', 'i', 1, 'n']]],
  ] as const)('%s is on the lane, a loop', (_, json) => {
    const { root } = accept(json as Json);
    expect(root.value).toBe('bigint');
    expect(root.lowering).toBe('bigint');
  });

  it('Floor(n/3) is a floor division of a rational product', () => {
    const { expr, analysis } = accept(['Floor', ['Divide', 'n', 3]]);
    const quotient = analysis.records.get(expr.op1)!;
    expect(quotient.value).toBe('parent-lowered');
    expect(quotient.parentLowered).toEqual({
      shape: 'rational-product',
    });
    expect(analysis.records.get(expr.op1.op1)!.rational).toEqual({
      p: 1n,
      q: 3n,
    });
  });

  it('Floor(2^(−n)) is the rounding of a reciprocal', () => {
    const { expr, analysis } = accept([
      'Floor',
      ['Power', 2, ['Negate', 'n']],
    ]);
    expect(analysis.records.get(expr.op1)!.parentLowered).toEqual({
      shape: 'power',
    });
  });

  it('Floor(Sqrt(n)) is an integer square root, NaN for a negative n', () => {
    const { expr, analysis } = accept(['Floor', ['Sqrt', 'n']]);
    expect(analysis.records.get(expr.op1)!.parentLowered).toEqual({
      shape: 'sqrt',
    });
  });

  it('Floor(Sqrt(k0)) with k0 typed integer<0..> is on the lane', () => {
    expect(accept(['Floor', ['Sqrt', 'k0']]).root.value).toBe('bigint');
  });

  it('n! is on the lane, typed infinity | integer (~oo at n < 0)', () => {
    const { root } = accept(['Factorial', 'n']);
    expect(typeOf(root)).toBe(t('infinity | integer'));
  });

  it('n(n+1)/2 declines outside an integer-forcing parent', () => {
    expect(
      decline(['Divide', ['Multiply', 'n', ['Add', 'n', 1]], 2])
    ).toMatch(/`1\/2 \* n \* \(n \+ 1\)` \(type `rational`\).*integer-forcing parent/);
  });

  it('2^n declines outside an integer-forcing parent', () => {
    expect(decline(['Power', 2, 'n'])).toMatch(
      /exponent is not typed `integer<0\.\.>`/
    );
  });

  it('n^m declines, n^k0 is on the lane', () => {
    expect(decline(['Power', 'n', 'm'])).toMatch(
      /exponent is not typed `integer<0\.\.>`/
    );
    const { root } = accept(['Power', 'n', 'k0']);
    expect(root.value).toBe('bigint');
  });

  it('Factorial2(n) declines, Factorial2(k0) is on the lane', () => {
    expect(decline(['Factorial2', 'n'])).toMatch(/\(−5\)!! = 1\/3/);
    const { root } = accept(['Factorial2', 'k0']);
    expect(typeOf(root)).toBe('integer');
  });

  it('Mod(n/2, 7) declines: Mod is not an integer promise', () => {
    expect(decline(['Mod', ['Divide', 'n', 2], 7])).toMatch(
      /`1\/2 \* n` \(type `rational`\)/
    );
  });

  it('Binom(2n, n) / (n + 1) declines (a Divide typed real)', () => {
    expect(
      decline([
        'Divide',
        ['Binomial', ['Multiply', 2, 'n'], 'n'],
        ['Add', 'n', 1],
      ])
    ).toMatch(/its type is not an integer type/);
  });

  it('Sqrt(n) outside a rounding head declines', () => {
    expect(decline(['Sqrt', 'n'])).toMatch(/\(type `complex`\)/);
  });

  it('DigitSum(n) declines: the head is not on the list', () => {
    expect(decline(['DigitSum', 'n'])).toMatch(
      /`DigitSum` is not on the list of heads of the bigint mode \(CE-715\.3\)/
    );
  });
});

describe('the refined types (§3.1.3)', () => {
  it('Abs(t) is integer<0..>, plus infinity when t has a non-finite member', () => {
    expect(typeOf(accept(['Abs', 'n']).root)).toBe(t('integer<0..>'));
    expect(typeOf(accept(['Abs', ['Factorial', 'n']]).root)).toBe(
      t('integer<0..> | infinity')
    );
  });

  it('Mod and Remainder are integer | nan, integer for a non-zero literal divisor', () => {
    expect(typeOf(accept(['Mod', 'n', 'm']).root)).toBe(t('integer | nan'));
    expect(typeOf(accept(['Remainder', 'n', 'm']).root)).toBe(
      t('integer | nan')
    );
    expect(typeOf(accept(['Mod', 'n', 7]).root)).toBe('integer');
    expect(typeOf(accept(['Remainder', 'n', -7]).root)).toBe('integer');
  });

  it('Power(t, u) with u typed integer<0..> is integer, plus nan when both can be 0', () => {
    expect(typeOf(accept(['Power', 'n', 'k0']).root)).toBe(t('integer | nan'));
    expect(typeOf(accept(['Power', 2, 'k0']).root)).toBe('integer');
    // A refined type never admits a value that the engine's type excludes:
    // the engine's `integer<0..>` of `n^2` is kept.
    expect(typeOf(accept(['Power', 'n', 2]).root)).toBe(t('integer<0..>'));
  });

  it('a refinement keeps an engine type that is already on the lane', () => {
    expect(typeOf(accept(['Mod', 'n', 7]).root)).toBe('integer');
    expect(typeOf(accept(['Abs', 'n']).root)).toBe(t('integer<0..>'));
  });

  it('Factorial2(t) with t typed integer<0..> is integer', () => {
    expect(typeOf(accept(['Factorial2', 'k0']).root)).toBe('integer');
  });
});

describe('the allow-list and its lowerings (§3.1.1)', () => {
  it.each([
    ['Add', ['Add', 'n', 'm']],
    ['Multiply', ['Multiply', 'n', 'm']],
    ['Min', ['Min', 'n', 'm']],
    ['Max', ['Max', 'n', 3]],
    ['Sign', ['Sign', 'n']],
    ['LCM', ['LCM', 'n', 'm']],
    ['Fibonacci', ['Fibonacci', 'n']],
    ['If', ['If', ['Less', 'n', 0], 1, 'm']],
    ['Which', ['Which', ['Less', 'n', 0], 1, 'True', 'm']],
    ['Typed', ['Typed', 'n', "'integer'"]],
    ['Range', ['Range', 1, 'n']],
    ['Fold', ['Fold', ['Function', ['Add', 'a', 'b'], 'a', 'b'], 0, 'L']],
  ] as const)('%s has the bigint lowering (a)', (_, json) => {
    expect(accept(json as Json).root.lowering).toBe('bigint');
  });

  it.each([
    ['Length', ['Length', 'L']],
    ['Count', ['Count', 'L']],
    ['Boole', ['Boole', ['Greater', 'n', 1]]],
  ] as const)('%s has the number lowering wrapped in BigInt (b)', (_, json) => {
    const { root } = accept(json as Json);
    expect(root.value).toBe('bigint');
    expect(root.lowering).toBe('number-wrapped');
  });

  it.each([
    ['At', ['At', 'L', 'n'], 'bigint'],
    ['First', ['First', 'L'], 'bigint'],
    ['Last', ['Last', 'L'], 'bigint'],
    ['Take', ['Take', 'L', 'n'], 'bigint-list'],
    ['Drop', ['Drop', 'L', 'n'], 'bigint-list'],
    ['ReplaceAt', ['ReplaceAt', 'L', 'n', 'm'], 'bigint-list'],
  ] as const)(
    '%s has the index conversion lowering (c)',
    (_, json, value) => {
      const { root } = accept(json as Json);
      expect(root.value).toBe(value);
      expect(root.lowering).toBe('index-conversion');
    }
  );

  it('At(L, k) is typed integer: the NaN of an index out of range is implicit', () => {
    expect(typeOf(accept(['At', 'L', 'n']).root)).toBe(t('integer'));
  });

  it('Length(L) + n is on the lane, and Length(L) > 3 compiles', () => {
    expect(typeOf(accept(['Add', ['Length', 'L'], 'n']).root)).toBe('integer');
    expect(accept(['Greater', ['Length', 'L'], 3]).root.value).toBe(
      'boolean'
    );
  });

  it('IsPrime(n) is a boolean consumer of a lane operand', () => {
    const { root } = accept(['IsPrime', 'n']);
    expect(root.value).toBe('boolean');
  });

  it.each([
    // At n = 10^15 the interpreter gives "1e+30"; the JavaScript
    // `String(10n ** 30n)` gives every digit.
    ['String(n^2)', ['String', ['Power', 'n', 2]], '1e+30'],
    // At n = 10^15 the interpreter gives "1000003e+15".
    ['String(n·1000003)', ['String', ['Multiply', 'n', 1000003]], '1000003e+15'],
  ] as const)(
    '%s declines: the interpreter number format is not reproduced',
    (_, json, value) => {
      const at = ce
        .box(json as Json)
        .subs({ n: ce.number(10 ** 15) })
        .evaluate();
      expect(at.string).toBe(value);
      expect(decline(json as Json)).toMatch(
        /interpreter's number format.*CE-715\.3/
      );
    }
  );

  it.each([
    ['IsEven(n)', ['IsEven', 'n'], /`IsEven` is not on the list/],
    ['String(n, m)', ['String', 'n', 'm'], /one operand only/],
    ['Floor(n, 2)', ['Floor', 'n', 2], /with a step operand/],
    [
      'a chained comparison',
      ['Less', 0, 'n', 'm'],
      /a chained comparison is not on the list/,
    ],
  ] as const)('%s declines', (_, json, reason) => {
    expect(decline(json as Json)).toMatch(reason);
  });
});

describe('the inputs (§3.1)', () => {
  it('an integer binding is an input', () => {
    const { root } = accept('n');
    expect(root.lowering).toBe('input');
    expect(root.value).toBe('bigint');
  });

  it('a loop index is a local, not an input', () => {
    const { expr, analysis } = accept([
      'Sum',
      ['Multiply', 'i', 'n'],
      ['Limits', 'i', 1, 10],
    ]);
    const [i, n] = expr.op1.ops;
    const index = analysis.records.get(i.symbol === 'i' ? i : n)!;
    const input = analysis.records.get(i.symbol === 'i' ? n : i)!;
    expect(index.lowering).toBe('bigint');
    expect(index.input).toBeUndefined();
    expect(input.lowering).toBe('input');
    expect(input.input).toBe('integer');
  });

  it('a list<integer> binding, nested or not, is an input', () => {
    expect(accept('L').root.input).toBe('integer-list');
    expect(accept('LL').root.input).toBe('integer-list');
  });

  it('a binding that admits a non-finite value declines (CE-715.4)', () => {
    expect(decline(['Add', 'w', 1])).toMatch(/CE-715\.4/);
  });

  it('a real binding declines', () => {
    expect(decline(['Add', 'r', 1])).toMatch(
      /the mode accepts only bindings of a subtype of `integer`/
    );
  });

  it('a real constant declines', () => {
    expect(decline(['Add', ['Multiply', 'Pi', ['Power', 10, 20]], 'n'])).toMatch(
      /a real \(non-rational\) constant has no exact bigint value/
    );
    expect(decline(['Multiply', 'Pi', 'n'])).toMatch(
      /a real \(non-rational\) constant/
    );
  });

  it('an integer constant subtree is folded', () => {
    const { expr, analysis } = accept(['Add', ['Power', 2, 70], 'n']);
    const power = expr.ops.find((op) => op.operator === 'Power')!;
    expect(analysis.records.get(power)!.lowering).toBe('folded');
  });

  it('a vars entry that is not the vars-object read declines', () => {
    const expr = ce.box(['Add', 'n', 1]);
    expect(() =>
      requireBigintLane(expr, { isCallerSourceVar: (name) => name === 'n' })
    ).toThrow(/the `vars` option gives it a value or source code/);
  });
});

describe('user functions (§3.1.2)', () => {
  it('f(n) with f: (number) -> number declines', () => {
    expect(decline(['h', 'n'])).toMatch(
      /the parameter 1 of `h` is typed `number`/
    );
  });

  it('f(n) + 1 with f := x ↦ x! compiles, the call is typed infinity | integer', () => {
    const { expr, analysis, root } = accept(['Add', ['f', 'n'], 1]);
    const call = analysis.records.get(expr.ops[0])!;
    expect(typeOf(call)).toBe(t('infinity | integer'));
    expect(call.userCall!.name).toBe('f');
    expect(call.userCall!.resultPromise).toBe(false);
    expect(typeOf(root)).toBe(t('infinity | integer'));
  });

  it('f(n) > 5 compiles: a pole of the call gives a number result', () => {
    expect(accept(['Greater', ['f', 'n'], 5]).root.value).toBe('boolean');
  });

  it('g(n) with g: (integer) -> integer := x ↦ x! compiles: the body is under the promise', () => {
    const { root } = accept(['g', 'n']);
    expect(root.userCall!.resultPromise).toBe(true);
    expect(typeOf(root)).toBe('integer');
  });

  it('a function declared -> integer is an integer promise for its body', () => {
    const { root } = accept(['half', 'n']);
    expect(root.userCall!.resultPromise).toBe(true);
    expect(typeOf(root)).toBe('integer');
  });

  it('a quotient declared -> integer compiles, also when the divisor can be zero', () => {
    const { root } = accept(['quo', 'n', 'm']);
    expect(root.userCall!.resultPromise).toBe(true);
  });

  it('a call with constant arguments is analyzed as a call', () => {
    const { root } = accept(['f', 3]);
    expect(root.userCall!.name).toBe('f');
  });

  it('a recursive function declared -> integer is on the lane', () => {
    const { root } = accept(['fact', 'n']);
    expect(root.value).toBe('bigint');
  });

  it('an integer parameter of a library head is an integer promise', () => {
    // `Fibonacci` is `(integer) -> integer`: `n/2` is a checked exact
    // division there.
    const { expr, analysis } = accept(['Fibonacci', ['Divide', 'n', 2]]);
    expect(analysis.records.get(expr.op1)!.parentLowered).toEqual({
      shape: 'rational-product',
    });
  });
  it('a quotient at an integer parameter whose divisor can be zero compiles', () => {
    const { expr, analysis } = accept(['Fibonacci', ['Divide', 'n', 'm']]);
    expect(analysis.records.get(expr.op1)!.parentLowered).toEqual({
      shape: 'quotient',
    });
  });
});

describe('the declines of §3.1 to §3.3', () => {
  it.each([
    ['DigitSum(n)', ['DigitSum', 'n'], /CE-715\.3/],
    ['Mod(n/2, 7)', ['Mod', ['Divide', 'n', 2], 7], /`1\/2 \* n`/],
    ['n^m', ['Power', 'n', 'm'], /exponent is not typed/],
    ['Factorial2(n)', ['Factorial2', 'n'], /1\/3/],
    ['f(n), f: (number) -> number', ['h', 'n'], /typed `number`/],
    [
      'a real constant',
      ['Add', ['Multiply', 'Pi', ['Power', 10, 20]], 'n'],
      /real \(non-rational\) constant/,
    ],
    [
      'Sum(i, i = 1..n/2)',
      ['Sum', 'i', ['Limits', 'i', 1, ['Divide', 'n', 2]]],
      /CE-715\.2/,
    ],
  ] as const)('%s declines', (_, json, reason) => {
    expect(decline(json as Json)).toMatch(reason);
  });
});

describe('the number results of §3.4: a pole compiles', () => {
  // The analysis does not test where a pole can occur. Each expression
  // below compiles; at an input where a sub-expression has no finite value,
  // its helper throws, and the compiled result is a `number`.
  it.each([
    ['n! > 5', ['Greater', ['Factorial', 'n'], 5], 'boolean'],
    ['f(n) > 5', ['Greater', ['f', 'n'], 5], 'boolean'],
    [
      'If((n!) > 5, m!, 7)',
      ['If', ['Greater', ['Factorial', 'n'], 5], ['Factorial', 'm'], 7],
      'bigint',
    ],
    ['n! − m!', ['Subtract', ['Factorial', 'n'], ['Factorial', 'm']], 'bigint'],
    ['0·n!', ['Multiply', 0, ['Factorial', 'n']], 'bigint'],
    ['−|n!|', ['Negate', ['Abs', ['Factorial', 'n']]], 'bigint'],
    ['−(n!) + 3', ['Add', ['Negate', ['Factorial', 'n']], 3], 'bigint'],
    ["Typed(n!, 'integer')", ['Typed', ['Factorial', 'n'], "'integer'"], 'bigint'],
    ["Typed(n/m, 'integer')", ['Typed', ['Divide', 'n', 'm'], "'integer'"], 'bigint'],
    ['Floor(n!/2)', ['Floor', ['Divide', ['Factorial', 'n'], 2]], 'bigint'],
    ['Mod(n!, 7)', ['Mod', ['Factorial', 'n'], 7], 'bigint'],
    [
      'Sum(k!, k = −1..n)',
      ['Sum', ['Factorial', 'k'], ['Limits', 'k', -1, 'n']],
      'bigint',
    ],
    [
      'At(Map(Range(−1, n), k ↦ k!), 1)',
      [
        'At',
        ['Map', ['Function', ['Factorial', 'k'], 'k'], ['Range', -1, 'n']],
        1,
      ],
      'bigint',
    ],
    [
      'Map(Range(−1, n), k ↦ k!)',
      ['Map', ['Function', ['Factorial', 'k'], 'k'], ['Range', -1, 'n']],
      'bigint-list',
    ],
    ['List(n!, Abs(n!))', ['List', ['Factorial', 'n'], ['Abs', ['Factorial', 'n']]], 'bigint-list'],
    [
      'Fold((a, b) ↦ a + b!, 0, L)',
      ['Fold', ['Function', ['Add', 'a', ['Factorial', 'b']], 'a', 'b'], 0, 'L'],
      'bigint',
    ],
    ['If(n < 0, 0, n!)', ['If', ['Less', 'n', 0], 0, ['Factorial', 'n']], 'bigint'],
    ["Typed(Mod(n, m), 'integer')", ['Typed', ['Mod', 'n', 'm'], "'integer'"], 'bigint'],
  ] as const)('%s compiles', (_, json, value) => {
    expect(accept(json as Json).root.value).toBe(value);
  });

  it.each([
    ['Sum(k!, k = 0..n)', ['Sum', ['Factorial', 'k'], ['Limits', 'k', 0, 'n']]],
    [
      'Sum(Floor(n/k), k = 1..n)',
      ['Sum', ['Floor', ['Divide', 'n', 'k']], ['Limits', 'k', 1, 'n']],
    ],
    ['Sum(Mod(n, k), k = 1..n)', ['Sum', ['Mod', 'n', 'k'], ['Limits', 'k', 1, 'n']]],
    [
      'Sum((−1)^k·Binomial(n, k)·(n − k)!, k = 0..n)',
      [
        'Sum',
        [
          'Multiply',
          ['Power', -1, 'k'],
          ['Binomial', 'n', 'k'],
          ['Factorial', ['Subtract', 'n', 'k']],
        ],
        ['Limits', 'k', 0, 'n'],
      ],
    ],
  ] as const)('the counting sum %s compiles', (_, json) => {
    const { root } = accept(json as Json);
    expect(root.value).toBe('bigint');
    expect(root.lowering).toBe('bigint');
  });

  it('a pole-capable node has the refined type with its non-finite member', () => {
    expect(typeOf(accept(['Factorial', 'n']).root)).toBe(t('infinity | integer'));
    expect(
      typeOf(accept(['Add', ['Negate', ['Factorial', 'n']], 3]).root)
    ).toBe(t('infinity | integer'));
    expect(typeOf(accept(['Typed', ['Mod', 'n', 'm'], "'integer'"]).root)).toBe(
      'integer'
    );
  });
});

describe('the integer-forcing parents and their shapes (§3.2)', () => {
  it.each([
    ['Floor', 'Floor'],
    ['Ceil', 'Ceil'],
    ['Round', 'Round'],
    ['Truncate', 'Truncate'],
  ] as const)('%s(n/3) lowers the quotient', (head) => {
    const { expr, analysis, root } = accept([head, ['Divide', 'n', 3]]);
    expect(root.value).toBe('bigint');
    expect(analysis.records.get(expr.op1)!.parentLowered).toEqual({
      shape: 'rational-product',
    });
  });

  it.each(['Ceil', 'Round', 'Truncate'] as const)(
    '%s(Sqrt(n)) lowers an integer square root',
    (head) => {
      const { expr, analysis } = accept([head, ['Sqrt', 'n']]);
      expect(analysis.records.get(expr.op1)!.parentLowered).toEqual({
        shape: 'sqrt',
      });
    }
  );

  it('Floor(n/m) is a quotient whose divisor can be zero', () => {
    const { expr, analysis } = accept(['Floor', ['Divide', 'n', 'm']]);
    expect(analysis.records.get(expr.op1)!.parentLowered!.shape).toBe(
      'quotient'
    );
  });

  it("Typed(n(n+1)/2, 'integer') is a checked exact division", () => {
    const { expr, analysis } = accept([
      'Typed',
      ['Divide', ['Multiply', 'n', ['Add', 'n', 1]], 2],
      "'integer'",
    ]);
    expect(analysis.records.get(expr.op1)!.parentLowered).toEqual({
      shape: 'rational-product',
    });
  });

  it('Sqrt under an integer promise declines', () => {
    expect(decline(['Typed', ['Sqrt', 'n'], "'integer'"])).toMatch(
      /\(type `complex`\)/
    );
  });

  it('a sum of shapes under a promise declines', () => {
    expect(
      decline([
        'Typed',
        ['Add', ['Divide', 'n', 2], ['Divide', 'm', 3]],
        "'integer'",
      ])
    ).toMatch(/integer-forcing parent/);
  });
});

describe('the comparisons with a rational constant (§3.3)', () => {
  it('n > 1/2 compares exactly with p = 1, q = 2', () => {
    const { expr, root } = accept(['Greater', 'n', ['Rational', 1, 2]]);
    // Canonicalized as `Less(1/2, n)`.
    expect(expr.operator).toBe('Less');
    expect(root.value).toBe('boolean');
    expect(root.comparison).toEqual({ constantOperand: 0, p: 1n, q: 2n });
  });

  it('n ≥ (3·2^53 + 1)/2 keeps the exact constant', () => {
    const { root } = accept([
      'GreaterEqual',
      'n',
      ['Divide', ['Add', ['Multiply', 3, ['Power', 2, 53]], 1], 2],
    ]);
    expect(root.comparison).toEqual({
      constantOperand: 0,
      p: 3n * 2n ** 53n + 1n,
      q: 2n,
    });
  });

  it('Equal(n, (2^53 + 1)/2^53) folds to false', () => {
    const { root } = accept([
      'Equal',
      'n',
      ['Divide', ['Add', ['Power', 2, 53], 1], ['Power', 2, 53]],
    ]);
    expect(root.comparison).toEqual({
      constantOperand: 1,
      p: 2n ** 53n + 1n,
      q: 2n ** 53n,
      folded: false,
    });
  });

  it('NotEqual(n, 1/3) folds to true', () => {
    const { root } = accept(['NotEqual', 'n', ['Rational', 1, 3]]);
    expect(root.comparison!.folded).toBe(true);
  });

  it('a comparison with a real constant declines', () => {
    expect(decline(['Less', 'n', 'Pi'])).toMatch(/real \(non-rational\)/);
  });
});

describe('the CSE exclusion (§3.2)', () => {
  it('a parent-lowered quotient is not a candidate; its parent is', () => {
    const { expr, analysis } = accept([
      'Add',
      ['Floor', ['Divide', 'n', 2]],
      ['Ceil', ['Divide', 'n', 2]],
    ]);
    const excluded = bigintCseExclusion(analysis);
    const [floor, ceil] = expr.ops;
    expect(excluded(floor.op1)).toBe(true);
    expect(excluded(ceil.op1)).toBe(true);
    expect(excluded(floor)).toBe(false);
    expect(isCseAdmissible(floor.op1, { notACandidate: excluded })).toBe(
      false
    );
  });

  it('a node that can give a non-finite value stays a candidate, also in a list cell', () => {
    const list = accept(['List', ['Factorial', 'n'], ['Abs', ['Factorial', 'n']]]);
    const inList = bigintCseExclusion(list.analysis);
    expect(inList(list.expr.op1)).toBe(false);
    expect(inList(list.expr.op2.op1)).toBe(false);

    const { expr, analysis } = accept([
      'If',
      ['Less', 'n', 0],
      ['Factorial', 'n'],
      ['Add', ['Factorial', 'n'], 1],
    ]);
    expect(bigintCseExclusion(analysis)(expr.op2)).toBe(false);
  });

  it('a node the analysis did not see is judged by its type', () => {
    const { analysis } = accept(['Add', 'n', 1]);
    const excluded = bigintCseExclusion(analysis);
    expect(excluded(ce.box(['Divide', 'n', 'm']))).toBe(true);
    expect(excluded(ce.box(['Factorial', 'n']))).toBe(false);
    expect(excluded(ce.box(['Add', 'n', 'm']))).toBe(false);
  });
});

describe('the analysis in a compilation', () => {
  it.each([
    ['n!', ['Factorial', 'n']],
    ['Floor(n/2) + Ceil(n/2)', ['Add', ['Floor', ['Divide', 'n', 2]], ['Ceil', ['Divide', 'n', 2]]]],
    ['List(n!, Abs(n!))', ['List', ['Factorial', 'n'], ['Abs', ['Factorial', 'n']]]],
    ['n > 1/2', ['Greater', 'n', ['Rational', 1, 2]]],
    ['f(n) + 1', ['Add', ['f', 'n'], 1]],
    ['n! > 5', ['Greater', ['Factorial', 'n'], 5]],
    ['Sum(k!, k = 0..n)', ['Sum', ['Factorial', 'k'], ['Limits', 'k', 0, 'n']]],
  ] as const)('%s is accepted, and compiles', (_, json) => {
    const r = compile(ce.box(json as Json), { mode: 'bigint' });
    expect(r.success).toBe(true);
    expect(r.mode).toBe('bigint');
  });

  it('a rejected expression declines with the reason of its node', () => {
    const r = compile(ce.box(['Greater', ['DigitSum', 'n'], 5]), {
      mode: 'bigint',
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic!.code).toBe('bigint-lane');
    expect(r.diagnostic!.value).toBe('DigitSum(n)');
    expect(r.diagnostic!.message).toMatch(/`DigitSum` is not on the list/);
    // The interpreter fallback still runs.
    expect(r.run).toBeDefined();
  });

  it('a function literal at the root is analyzed with its parameters as inputs', () => {
    const accepted = compile(
      ce.box(['Function', ['Factorial', 'k'], ['Typed', 'k', "'integer'"]]),
      { mode: 'bigint' }
    );
    expect(accepted.success).toBe(true);
    const rejected = compile(
      ce.box(['Function', ['Sqrt', 'k'], ['Typed', 'k', "'integer'"]]),
      { mode: 'bigint' }
    );
    expect(rejected.diagnostic!.message).toMatch(/is not on the integer lane/);
  });

  it('the other modes are not affected', () => {
    const r = compile(ce.box(['Floor', ['Divide', 'n', 2]]), { mode: 'strict' });
    expect(r.success).toBe(true);
    expect(r.run!({ n: 7 })).toBe(3);
  });
});

describe('the fixes of the review of step 2', () => {
  // A separate engine: the global symbols with values below must not
  // change the other tests.
  const ce2 = new ComputeEngine();
  ce2.declare('n', 'integer');
  ce2.declare('m', 'integer');
  ce2.declare('L', 'list<integer>');
  ce2.declare('x', 'real');
  ce2.box(['Assign', 'k', 5]).evaluate();
  ce2.box(['Assign', 'c0', 3]).evaluate();
  ce2.box(['Assign', 'c', ['Floor', ['Sin', 'x']]]).evaluate();
  ce2.box([
    'Assign',
    'fi',
    ['Function', ['Factorial', 'y'], ['Typed', 'y', "'integer'"]],
  ]).evaluate();
  ce2.box(['Assign', 'ADD', ['Function', ['Add', 'a', 'b'], 'a', 'b']]).evaluate();
  // Two mutually recursive functions: the second branch of `fm` can give
  // `NaN` (`Mod(1, 0)`), and `gm` gets it through `fm`. They are declared
  // `-> integer`: a recursive call then has the type `integer`.
  ce2.declare('fm', '(integer) -> integer');
  ce2.declare('gm', '(integer) -> integer');
  ce2.box([
    'Assign',
    'fm',
    [
      'Function',
      ['If', ['Greater', 'y', 0], ['gm', ['Subtract', 'y', 1]], ['Mod', 1, 'y']],
      'y',
    ],
  ]).evaluate();
  ce2.box(['Assign', 'gm', ['Function', ['Add', ['fm', 'y'], 1], 'y']]).evaluate();

  const accept2 = (json: Json) => {
    const expr = ce2.box(json);
    const r = analyzeBigintLane(expr);
    if (!r.accepted)
      throw new Error(`declined: ${expr.toString()}: ${r.decline.message}`);
    return { expr, analysis: r.analysis, root: r.analysis.records.get(expr)! };
  };
  const decline2 = (json: Json): string => {
    const expr = ce2.box(json);
    const r = analyzeBigintLane(expr);
    if (r.accepted) throw new Error(`accepted: ${expr.toString()}`);
    expect(r.decline.diagnostic.code).toBe('bigint-lane');
    return r.decline.message;
  };

  it('a negation of the +oo of Abs compiles', () => {
    // At n = −1, `evaluate()` gives `−oo` for each of these; the compiled
    // result is the `number` `Infinity`, which has no defined relation to
    // the interpreter's value (§3.4).
    accept(['Negate', ['Abs', ['Factorial', 'n']]]);
    accept(['Subtract', 1, ['Abs', ['Factorial', 'n']]]);
    accept(['Negate', ['If', ['Less', 'n', 0], ['Abs', ['Factorial', 'n']], 0]]);
    accept(['Negate', ['Factorial', 'n']]);
    accept(['Abs', ['Factorial', 'n']]);
    accept(['Add', ['Abs', ['Factorial', 'n']], 3]);
  });

  it('Fold and Reduce decline over a collection of lists', () => {
    // `evaluate()` gives `[3, 4]`.
    expect(
      decline([
        'Reduce',
        ['List', 1, ['List', 2, 3]],
        ['Function', ['Add', 'a', 'b'], 'a', 'b'],
        0,
      ])
    ).toMatch(/must be integers, not lists/);
    expect(
      decline([
        'Fold',
        ['Function', ['Add', 'a', 'b'], 'a', 'b'],
        0,
        'LL',
      ])
    ).toMatch(/must be integers, not lists/);
  });

  it('a name bound by a function is not folded from the global symbol of that name', () => {
    // `k` has the value 5, and is the parameter of the callback.
    const { analysis, expr } = accept2([
      'Map',
      ['Function', ['Multiply', 2, 'k'], 'k'],
      'L',
    ]);
    const callback = analysis.records.get(expr)!.callback!;
    let body = callback.ops[0];
    while (body.operator === 'Block') body = body.ops![0];
    expect(analysis.records.get(body)!.lowering).not.toBe('folded');
    // A parameter of the function at the root is an input.
    const root = accept2([
      'Function',
      ['Factorial', 'k'],
      ['Typed', 'k', "'integer'"],
    ]);
    let rootBody = root.expr.ops![0];
    while (rootBody.operator === 'Block') rootBody = rootBody.ops![0];
    expect(root.analysis.records.get(rootBody)!.lowering).toBe('bigint');
    expect(root.analysis.records.get(rootBody.ops![0])!.lowering).toBe('input');
  });

  it('the same node object in two cells is accepted', () => {
    // The same node object in two cells.
    const f = ce.box(['Factorial', 'n']);
    const expr = ce.function('List', [f, ce.function('Abs', [f])]);
    expect(expr.ops![0]).toBe(expr.ops![1].ops![0]);
    const r = analyzeBigintLane(expr);
    expect(r.accepted).toBe(true);
  });

  it.each([
    ['the Map first', true],
    ['the call first', false],
  ])(
    'a user function as a Map callback and in a call (%s) is accepted',
    (_, mapFirst) => {
      const mapNode: Json = ['Map', 'fi', 'L'];
      const callNode: Json = ['Add', ['fi', 'n'], 1];
      const { expr, analysis } = accept2([
        'List',
        ...(mapFirst ? [mapNode, callNode] : [callNode, mapNode]),
      ] as Json);
      const [mapExpr, callExpr] = mapFirst
        ? [expr.ops![0], expr.ops![1]]
        : [expr.ops![1], expr.ops![0]];
      const callback = analysis.records.get(mapExpr)!.callback!;
      const call = analysis.records.get(callExpr.ops![0])!;
      expect(callback.operator).toBe('Function');
      expect(call.userCall!.name).toBe('fi');
    }
  );

  it('a static type error in bigint mode reports static-type-error', () => {
    const silence = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const expr = ce2.box(['ADD', "'ab'", 'n']);
      expect(expr.type.toString()).toBe('error');
      const r = compile(expr, { mode: 'bigint' });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('static-type-error');
      expect(r.unsupported).toContain('ErrorCode');
    } finally {
      silence.mockRestore();
    }
  });

  it('a symbol whose value is not an exact integer is not folded', () => {
    // `c := Floor(Sin(x))` is typed `integer`; `evaluate()` gives
    // `Floor(Sin(x))`, with the free real `x`.
    expect(decline2('c')).toMatch(/not an exact integer constant/);
    expect(decline2(['Add', 'c', 1])).toMatch(/not an exact integer constant/);
    // `k := 5` is folded.
    expect(accept2(['Add', 'k', 1]).root.lowering).toBe('folded');
  });

  it('a declared parameter type of a fold callback is kept', () => {
    expect(
      decline([
        'Reduce',
        'L',
        [
          'Function',
          ['Add', 'a', 'b'],
          ['Typed', 'a', "'real'"],
          ['Typed', 'b', "'real'"],
        ],
        0,
      ])
    ).toMatch(/is typed `real`, which is not on the integer lane/);
    accept([
      'Reduce',
      'L',
      [
        'Function',
        ['Add', 'a', 'b'],
        ['Typed', 'a', "'integer'"],
        ['Typed', 'b', "'integer'"],
      ],
      0,
    ]);
  });

  it('mutually recursive functions compile', () => {
    // `gm(0)` is `fm(0) + 1`, and `fm(0)` is `Mod(1, 0)`, `NaN`: the
    // compiled result at `n = 0` is a `number`.
    const { root } = accept2(['List', ['fm', 'n'], ['Sign', ['gm', 'n']]]);
    expect(root.value).toBe('bigint-list');
  });

  it('a square root of a refined operand compiles', () => {
    accept(['Floor', ['Sqrt', ['Abs', 'n']]]);
    accept(['Multiply', 2, ['Floor', ['Sqrt', ['Abs', 'n']]]]);
  });

  it('Reduce with no initial value needs a non-empty collection', () => {
    const add = ['Function', ['Add', 'a', 'b'], 'a', 'b'] as Json;
    // `Reduce([], (a, b) ↦ a + b)` is `Nothing`.
    expect(decline(['Reduce', 'L', add])).toMatch(/not known to be non-empty/);
    accept(['Reduce', ['List', 'n', 2], add]);
    accept(['Reduce', ['Range', 1, 5], add]);
  });

  it('Max with no operand declines', () => {
    // `evaluate()` gives `NaN`.
    decline(['Max']);
  });

  it('a constant subtree does not fold a caller override or a caller-source input', () => {
    const fib = compile(ce2.box(['Add', ['Fibonacci', 5], 1]), {
      mode: 'bigint',
      functions: { Fibonacci: (v: number) => v },
    });
    expect(fib.diagnostic?.code).toBe('bigint-lane');
    expect(fib.diagnostic?.message).toMatch(/the caller replaced/);
    const viaVars = compile(ce2.box(['Add', 'c0', 1]), {
      mode: 'bigint',
      // Caller source, not a read of the vars object.
      vars: { c0: '7' },
    });
    expect(viaVars.diagnostic?.code).toBe('bigint-lane');
    expect(viaVars.diagnostic?.message).toMatch(/the `vars` option/);
  });

  it('a constant comparison operand above the fold cost limit is not evaluated', () => {
    const msg = decline([
      'Greater',
      'n',
      [
        'Divide',
        ['Sum', ['Factorial', 'i'], ['Limits', 'i', 1, 1000000]],
        2,
      ],
    ]);
    expect(msg).toMatch(/not an integer type|integer value/);
  });

  it('Abs of a NaN-only operand is integer<0..> | nan', () => {
    const { root } = accept(['Abs', ['Mod', 'n', ['Add', 'n', 1]]]);
    expect(typeOf(root)).toBe(t('integer<0..> | nan'));
  });
});

describe('the fixes of the second review of step 2', () => {
  // A separate engine: the global symbols with values below must not
  // change the other tests.
  const ce3 = new ComputeEngine();
  ce3.declare('n', 'integer');
  ce3.declare('L', 'list<integer>');
  ce3.declare('y', 'real');
  ce3.box(['Assign', 'k', 5]).evaluate();
  ce3.box(['Assign', 'c2', ['Floor', ['Sin', 'y']]]).evaluate();
  ce3.box(['Assign', 'g', ['Function', ['Add', 'x', 1], 'x']]).evaluate();
  // A function defined outside the expressions below, which reads the
  // global `k`.
  ce3.box([
    'Assign',
    'fk',
    ['Function', ['Add', 'k', 'z'], ['Typed', 'z', "'integer'"]],
  ]).evaluate();

  const analyze3 = (json: Json) => {
    const expr = ce3.box(json);
    return { expr, r: analyzeBigintLane(expr) };
  };
  const records = (r: ReturnType<typeof analyzeBigintLane>) => {
    if (!r.accepted) throw new Error(`declined: ${r.decline.message}`);
    return r.analysis.records;
  };
  const unblock = (e: Expression): Expression => {
    while (e.operator === 'Block') e = e.ops![0];
    return e;
  };

  it('an engine constant does not block a fold: n + Floor(Pi), n + Floor(10·Pi)', () => {
    for (const [json, value] of [
      [['Floor', 'Pi'], 3],
      [['Floor', ['Multiply', 10, 'Pi']], 31],
    ] as const) {
      const constant = ce3.box(json as Json);
      expect(constant.evaluate().re).toBe(value);
      const { expr, r } = analyze3(['Add', 'n', json as Json]);
      const folded = expr.ops!.find((op) => op.operator === 'Floor')!;
      expect(records(r).get(folded)!.lowering).toBe('folded');
    }
  });

  it('a variable whose value is not an exact constant blocks the fold: n + c2', () => {
    // `c2 := Floor(Sin(y))` is typed `integer`, with no value to fold.
    const { r } = analyze3(['Add', 'n', 'c2']);
    expect(r.accepted).toBe(false);
    if (!r.accepted)
      expect(r.decline.message).toMatch(/not an exact integer constant/);
  });

  it.each([
    ['(g) ↦ g(2)', ['Function', ['g', 2], 'g']],
    ['(g) ↦ n + g(2)', ['Function', ['Add', 'n', ['g', 2]], 'g']],
    ['(g) ↦ Map(g, L)', ['Function', ['Map', 'g', 'L'], 'g']],
  ] as const)(
    '%s: a bound call head is not the global function of its name',
    (_, json) => {
      const { r } = analyze3(json as Json);
      expect(r.accepted).toBe(false);
      if (!r.accepted) expect(r.decline.diagnostic.code).toBe('bigint-lane');
    }
  );

  it('a named Map callback does not see the parameters of the root function', () => {
    // `k` is a parameter of the root literal, and a global with the value 5
    // in the body of `fk`: the body of `fk` reads the global.
    const { expr, r } = analyze3([
      'Function',
      ['Map', 'fk', 'L'],
      ['Typed', 'k', "'integer'"],
    ]);
    const recs = records(r);
    const map = unblock(expr.ops![0]);
    const callback = recs.get(map)!.callback!;
    const body = unblock(callback.ops![0]);
    const k = body.ops!.find((op) => op.symbol === 'k')!;
    expect(recs.get(k)!.lowering).toBe('folded');
    expect(recs.get(k)!.input).toBeUndefined();
  });

  it('the fold test walks a shared subtree once', () => {
    // Each level wraps the previous node twice: 40 distinct nodes, 2^40
    // paths from the root to a leaf.
    let e: Expression = ce3.number(1);
    for (let i = 0; i < 40; i++) e = ce3.function('List', [e, e]);
    expect(e.ops![0]).toBe(e.ops![1]);
    const start = Date.now();
    analyzeBigintLane(ce3.function('Add', [ce3.box('n'), ce3.function('Length', [e])]));
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('the fixes of the third review of step 2', () => {
  // A separate engine: the global symbols with values below must not
  // change the other tests.
  const ce4 = new ComputeEngine();
  ce4.declare('n', 'integer');
  ce4.declare('m', 'integer');
  ce4.declare('L', 'list<integer>');
  ce4.declare('h', '(number) -> number');
  ce4.box(['Assign', 'h', ['Function', ['Add', ['Power', 'x', 2], 1], 'x']]).evaluate();
  ce4.declare('sq', '(real) -> integer');
  ce4.box(['Assign', 'sq', ['Function', ['Multiply', 'x', 'x'], 'x']]).evaluate();
  ce4.declare('half', '(integer) -> integer');
  ce4.box([
    'Assign',
    'half',
    ['Function', ['Divide', ['Multiply', 'x', ['Add', 'x', 1]], 2], 'x'],
  ]).evaluate();
  ce4.declare('mean2', '(integer, integer) -> integer');
  ce4.box([
    'Assign',
    'mean2',
    ['Function', ['Divide', ['Add', 'a', 'b'], 2], 'a', 'b'],
  ]).evaluate();
  // A function with an inferred signature.
  ce4.box(['Assign', 'inc', ['Function', ['Add', 'x', 1], 'x']]).evaluate();
  ce4.declareType('grid', 'list<list<integer>>', { alias: true });
  ce4.declare('G', 'grid');
  ce4.declare('e0', 'integer<0..>');

  const analyze4 = (json: Json | Expression) => {
    const expr = 'engine' in (json as object) ? (json as Expression) : ce4.box(json as Json);
    return { expr, r: analyzeBigintLane(expr) };
  };
  const records = (r: ReturnType<typeof analyzeBigintLane>) => {
    if (!r.accepted) throw new Error(`declined: ${r.decline.message}`);
    return r.analysis.records;
  };
  const declined = (r: ReturnType<typeof analyzeBigintLane>): string => {
    if (r.accepted) throw new Error('accepted');
    expect(r.decline.diagnostic.code).toBe('bigint-lane');
    return r.decline.message;
  };

  it('a dependent inner bound of Sum is the outer index, not the global of its name', () => {
    // Sum(p·j, p = 1..n, j = 1..p) is 25 at n = 3.
    const sum: Json = [
      'Sum',
      ['Multiply', 'p', 'j'],
      ['Limits', 'p', 1, 'n'],
      ['Limits', 'j', 1, 'p'],
    ];
    expect(ce4.box(sum).subs({ n: 3 }).evaluate().re).toBe(25);
    // With a global `p := 100`, the inner bound `p` is still the index.
    const ce5 = new ComputeEngine();
    ce5.declare('n', 'integer');
    ce5.box(['Assign', 'p', 100]).evaluate();
    for (const engine of [ce4, ce5]) {
      const expr = engine.box(sum);
      const recs = records(analyzeBigintLane(expr));
      const inner = expr.ops!.find(
        (op) => op.operator === 'Limits' && op.op1.symbol === 'j'
      )!;
      const bound = recs.get(inner.op3)!;
      expect(bound.lowering).toBe('bigint');
      expect(bound.input).toBeUndefined();
    }
    // The same for Product, with no global of the index name.
    const product = ce4.box([
      'Product',
      'j',
      ['Limits', 'q', 1, 'n'],
      ['Limits', 'j', 1, 'q'],
    ]);
    const inner = product.ops!.find(
      (op) => op.operator === 'Limits' && op.op1.symbol === 'j'
    )!;
    const bound = records(analyzeBigintLane(product)).get(inner.op3)!;
    expect(bound.lowering).toBe('bigint');
    expect(bound.input).toBeUndefined();
  });

  it.each([
    ['Map(h, L) with h: (number) -> number', 'h', /typed `number`/],
    ['Map(sq, L) with sq: (real) -> integer', 'sq', /typed `real`/],
  ] as const)(
    '%s declines, as the call does',
    (_, name, reason) => {
      expect(declined(analyze4([name, 'n']).r)).toBeTruthy();
      expect(declined(analyze4(['Map', name, 'L']).r)).toMatch(reason);
    }
  );

  it('a named callback declared -> integer is an integer promise for its body', () => {
    // half(3) is 6: the interpreter checks the declared result.
    expect(ce4.box(['half', 3]).evaluate().re).toBe(6);
    expect(analyze4(['half', 'n']).r.accepted).toBe(true);
    const map = analyze4(['Map', 'half', 'L']);
    const mapCallback = records(map.r).get(map.expr)!.callback!;
    expect(records(map.r).get(mapCallback)!.promiseType).toBe('integer');
    // Reduce(L, mean2, 0) with mean2 := (a, b) ↦ (a + b)/2.
    const fold = analyze4(['Reduce', 'L', 'mean2', 0]);
    const foldRecord = records(fold.r).get(fold.expr)!;
    expect(foldRecord.value).toBe('bigint');
    expect(records(fold.r).get(foldRecord.callback!)!.promiseType).toBe(
      'integer'
    );
  });

  it('a rational constant operand of a comparison is not a CSE candidate', () => {
    // Fibonacci(30)/7 = 832040/7 is not an integer.
    const c = ce4.box(['Divide', ['Fibonacci', 30], 7]);
    const expr = ce4.function('And', [
      ce4.function('Less', [ce4.box('n'), c]),
      ce4.function('Less', [c, ce4.box('m')]),
    ]);
    const { r } = analyze4(expr);
    const recs = records(r);
    if (!r.accepted) return;
    const excluded = bigintCseExclusion(r.analysis);
    let seen = 0;
    for (const cmp of expr.ops!) {
      const at = recs.get(cmp)!.comparison!.constantOperand;
      const operand = cmp.ops![at];
      expect(recs.get(operand)!.value).toBe('rational-constant');
      expect(excluded(operand)).toBe(true);
      seen += 1;
    }
    expect(seen).toBe(2);
  });

  it('a callback literal is not a CSE candidate', () => {
    const map = analyze4(['Map', 'half', 'L']);
    if (!map.r.accepted) throw new Error('declined');
    const callback = records(map.r).get(map.expr)!.callback!;
    expect(bigintCseExclusion(map.r.analysis)(callback)).toBe(true);
  });

  it('a node shared by two integer-forcing parents records its shape only', () => {
    const d = ce4.box(['Divide', 'n', 2]);
    const both = ce4.function('Add', [
      ce4.function('Floor', [d]),
      ce4.function('Ceil', [d]),
    ]);
    expect(both.op1.op1).toBe(both.op2.op1);
    const shared = both.op1.op1;
    expect(records(analyze4(both).r).get(shared)!.parentLowered).toEqual({
      shape: 'rational-product',
    });
    const withPromise = ce4.function('Add', [
      ce4.function('Floor', [d]),
      ce4.function('Typed', [d, ce4.string('integer')]),
    ]);
    const node = withPromise.op1.op1;
    expect(records(analyze4(withPromise).r).get(node)!.parentLowered).toEqual({
      shape: 'rational-product',
    });
  });

  it('an input typed by a transparent alias of list<list<integer>> is a lane list', () => {
    const { expr, r } = analyze4(['Length', 'G']);
    expect(records(r).get(expr.op1)!.input).toBe('integer-list');
  });

  it('a parameter specialized to integer | infinity is a bigint local: inc(n!)', () => {
    // inc(3!) is 7.
    expect(ce4.box(['inc', ['Factorial', 3]]).evaluate().re).toBe(7);
    const { expr, r } = analyze4(['inc', ['Factorial', 'n']]);
    expect(records(r).get(expr)!.value).toBe('bigint');
    // A binding read as an input with such a type still declines.
    ce4.declare('w', 'integer | infinity');
    expect(declined(analyze4(['Add', 'w', 1]).r)).toMatch(/CE-715\.4/);
  });

  it.each([
    ['n + 1e20', 1e20],
    ['n + 2^53', 2 ** 53],
  ] as const)(
    '%s: an integer literal held as an inexact big decimal declines',
    (_, value) => {
      // The interpreter computes with such a literal at its working
      // precision, so `Power(2^53, n)` is rounded for a large `n` while
      // bigint code would be exact. The literal declines everywhere.
      expect(declined(analyze4(['Add', 'n', value]).r)).toMatch(
        /inexact decimal/
      );
      // An exponent typed `integer<0..>` would put the power on the lane.
      expect(declined(analyze4(['Power', value, 'e0']).r)).toMatch(
        /inexact decimal/
      );
    }
  );

  it('the same integer written as exact digits is on the lane', () => {
    // `{num: '…'}` boxes an exact integer; `n + 10^20` at `n = 1` is
    // 100000000000000000001.
    const digits = { num: '100000000000000000000' };
    expect(ce4.box(['Add', 1, digits]).evaluate().toString()).toBe(
      '100000000000000000001'
    );
    const { expr, r } = analyze4(['Add', 'n', digits]);
    const literal = expr.ops!.find((op) => op.symbol !== 'n')!;
    expect(records(r).get(literal)!.lowering).toBe('folded');
  });
});

describe('the fixes of the review round 2 of the reduced step 2', () => {
  const ce5 = new ComputeEngine();
  ce5.declare('n', 'integer');
  // A recursive transparent alias: unfolding it gives `list<R>` again.
  ce5.declareType('R', 'list<R>', { alias: true });
  ce5.declare('rr', 'R');

  const analyze5 = (json: Json) => analyzeBigintLane(ce5.box(json));

  it('an input typed by a recursive alias declines, with no stack overflow', () => {
    const r = analyze5(['Length', 'rr']);
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.decline.diagnostic.code).toBe('bigint-lane');
  });

  it('a quotient under a single-statement Block keeps the parent-lowered record', () => {
    // `Floor(Block(n/2))`: the direct parent of the quotient is the Block,
    // and the emitter passes the lowering of `Floor` down through it.
    const expr = ce5.box(['Floor', ['Block', ['Divide', 'n', 2]]]);
    const r = analyzeBigintLane(expr);
    if (!r.accepted) throw new Error(`declined: ${r.decline.message}`);
    expect(r.analysis.records.get(expr.op1)!.parentLowered).toEqual({
      shape: 'rational-product',
    });
  });

  it('a Block shared by a rounding parent and a promise is accepted', () => {
    const block = ce5.box(['Block', ['Divide', 'n', 2]]);
    const expr = ce5.function('Add', [
      ce5.function('Floor', [block]),
      ce5.box(['Typed', ['Block', ['Divide', 'n', 2]], "'integer'"]),
    ]);
    const r = analyzeBigintLane(expr);
    expect(r.accepted).toBe(true);
  });
});
