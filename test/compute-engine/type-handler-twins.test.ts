/**
 * Direct A/B pins between the shared type-handler helpers of
 * `library/type-handlers.ts` (the expressions shape, driven with real boxed
 * operands) and their descriptor-taking twins in
 * `library/type-handlers-types.ts` (the `'types'` shape, driven with
 * `describe(op)` descriptors).
 *
 * Each block runs one helper over the whole operand battery and compares the
 * two answers row by row. The result is asserted against an explicit table of
 * the rows that are EXPECTED to differ, so the pins are two-sided: a new
 * divergence fails, and a documented divergence that silently disappears
 * fails too. Every entry in a divergence table names the channel that is
 * absent (or extra) on the descriptor side; the tables are the audit that
 * decides which numeric-family handlers can convert.
 *
 * The battery deliberately mixes the operand kinds whose channels differ:
 * number literals (including ones no machine number represents exactly),
 * non-finite and complex literals, non-literal constants, valueless symbols
 * with no range, with an assumption-derived range and with a
 * declaration-only range (the two range channels part company: `ce.assume`
 * feeds both the type and the assumptions system, `ce.declare` only the
 * type), symbols carrying a held value — a finite one, `+∞` and NaN —
 * function applications whose result type carries a range and applications
 * whose sign only an operator `sgn` handler knows, and collections.
 */

import type { Expression, OperandDescriptor } from '../../src/compute-engine/global-types';
import type { Type } from '../../src/common/type/types';
import { ComputeEngine } from '../../src/compute-engine';
import { BoxedType } from '../../src/common/type/boxed-type';
import { typeToString } from '../../src/common/type/serialize';
import { describe as describeOperand } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import * as legacy from '../../src/compute-engine/library/type-handlers';
import * as twin from '../../src/compute-engine/library/type-handlers-types';

let ce: ComputeEngine;
let battery: [string, Expression][];

beforeAll(() => {
  ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('r', 'real');
  ce.declare('p', 'real');
  ce.assume(ce.parse('p > 0'));
  ce.declare('q', 'real');
  ce.assume(ce.parse('q \\geq 2'));
  ce.declare('t', 'real');
  ce.assume(ce.parse('t > \\frac13'));
  // Ranged by DECLARATION, not by `ce.assume`: the range is in the type and
  // nothing is recorded in the assumptions system, which is the channel
  // split the bounded-inverse-trig rows below measure.
  ce.declare('bigd', 'real<2..>');
  ce.declare('smd', 'real<-0.5..0.5>');
  ce.declare('twod', 'real<2..2>');
  ce.declare('w', 'number');
  ce.assign('w', ce.number(Infinity));
  // A symbol HOLDING NaN behind a wider declaration: the descriptor carries
  // `finite: false` + `sgn: 'unsigned'` from the held value, but the operand
  // is not a number literal.
  ce.declare('hnan', 'number');
  ce.assign('hnan', ce.NaN);
  ce.declare('a', 'integer');
  ce.assign('a', 5);
  ce.declare('L', 'list<real>');
  ce.declare('nf', 'non_finite_number');

  battery = [
    ['0', ce.number(0)],
    ['1', ce.number(1)],
    ['2', ce.number(2)],
    ['-3', ce.number(-3)],
    ['2.5', ce.number(2.5)],
    ['-0.5', ce.number(-0.5)],
    ['0.5', ce.number(0.5)],
    ['NaN', ce.NaN],
    ['+Inf', ce.PositiveInfinity],
    ['-Inf', ce.NegativeInfinity],
    ['~oo', ce.ComplexInfinity],
    ['1/2', ce.parse('\\frac12')],
    ['1/3', ce.parse('\\frac13')],
    ['sqrt2', ce.parse('\\sqrt2')],
    ['bigint', ce.number(BigInt('9007199254740993'))],
    ['i', ce.I],
    ['1+2i', ce.parse('1+2i')],
    ['Pi', ce.Pi],
    ['E', ce.E],
    ['n:integer', ce.symbol('n')],
    ['r:real', ce.symbol('r')],
    ['p>0', ce.symbol('p')],
    ['q>=2', ce.symbol('q')],
    ['t>1/3', ce.symbol('t')],
    ['bigd:real<2..>', ce.symbol('bigd')],
    ['smd:real<-0.5..0.5>', ce.symbol('smd')],
    ['twod:real<2..2>', ce.symbol('twod')],
    ['w=+inf', ce.symbol('w')],
    ['hnan=NaN', ce.symbol('hnan')],
    ['a=5', ce.symbol('a')],
    ['u:undeclared', ce.symbol('u')],
    ['L:list<real>', ce.symbol('L')],
    ['nf', ce.symbol('nf')],
    ['Abs(r)', ce.box(['Abs', 'r'])],
    ['Negate(Abs(r))', ce.box(['Negate', ['Abs', 'r']])],
    ['Sign(r)', ce.box(['Sign', 'r'])],
    ['Sqrt(Abs(r))', ce.box(['Sqrt', ['Abs', 'r']])],
    ['Exp(r)', ce.box(['Exp', 'r'])],
    ['Mul(2,Abs(r))', ce.box(['Multiply', 2, ['Abs', 'r']])],
    ['Mul(-1,Abs(r))', ce.box(['Multiply', -1, ['Abs', 'r']])],
    ['Square(r)', ce.box(['Square', 'r'])],
    ['Floor(Neg(Abs(r)))', ce.box(['Floor', ['Negate', ['Abs', 'r']]])],
    ['Neg(Floor(Abs(r)))', ce.box(['Negate', ['Floor', ['Abs', 'r']]])],
    ['f(u)', ce.box(['f', 'u'])],
    ['Add(r,1)', ce.box(['Add', 'r', 1])],
    ['List(1,2)', ce.box(['List', 1, 2])],
    ['List(1.5,2.5)', ce.box(['List', 1.5, 2.5])],
    ['Tuple(1,2)', ce.box(['Tuple', 1, 2])],
  ];
});

/** A comparable spelling for anything either shape may answer: a `BoxedType`,
 * a structural `Type`, a type string, or one of the three-valued scalars the
 * operand-level helpers return. */
function spell(v: unknown): string {
  if (v instanceof BoxedType) return typeToString(v.type);
  if (v !== null && typeof v === 'object') return typeToString(v as Type);
  return String(v);
}

/** A table of rows expected to differ: row label → [expressions shape,
 * `'types'` shape]. */
type Divergences = Record<string, [string, string]>;

/** Run one unary helper over the battery and assert the divergence table. */
function abUnary(
  legacyFn: (x: Expression) => unknown,
  twinFn: (d: OperandDescriptor) => unknown,
  expected: Divergences
): void {
  const seen: Divergences = {};
  for (const [row, x] of battery) {
    const l = spell(legacyFn(x));
    const t = spell(twinFn(describeOperand(x)));
    if (l !== t) seen[row] = [l, t];
  }
  expect(seen).toEqual(expected);
}

/** Run one helper over every ordered pair drawn from the battery. */
function abBinary(
  legacyFn: (x: Expression, y: Expression) => unknown,
  twinFn: (a: OperandDescriptor, b: OperandDescriptor) => unknown,
  expected: Divergences
): void {
  const seen: Divergences = {};
  for (const [rowA, x] of battery)
    for (const [rowB, y] of battery) {
      const l = spell(legacyFn(x, y));
      const t = spell(twinFn(describeOperand(x), describeOperand(y)));
      if (l !== t) seen[`${rowA}|${rowB}`] = [l, t];
    }
  expect(seen).toEqual(expected);
}

describe('operand-level helpers', () => {
  test('operandSgn — equal except where the sign is only a `sgn` handler’s', () => {
    // The descriptor never invokes an operator `sgn` handler, so an
    // application whose result type carries no range answers `undefined`
    // where the expression channel answers a sign. `Abs(r)` and
    // `Negate(Abs(r))` agree because their result types DO carry the range.
    abUnary(legacy.operandSgn, twin.operandSgn, {
      'Sqrt(Abs(r))': ['non-negative', 'undefined'],
      'Neg(Floor(Abs(r)))': ['non-positive', 'undefined'],
    });
  });

  test('operandLiteralValue — equal everywhere', () => {
    abUnary(legacy.operandLiteralValue, twin.operandLiteralValue, {});
  });

  test('operandIsEven / operandIsOdd — the held-value channel is absent', () => {
    // `a := 5` keeps its declared type `integer` (an assigned symbol is
    // checked, never narrowed), so the value that decides its parity is not
    // in the descriptor's type and the twin declines.
    //
    // The `bigint` row (9007199254740993, odd) is a value-channel loss of
    // the same kind: the legacy helper prefers `BoxedNumber.isEven`, which
    // reads the exact integer and answers correctly, while the twin has only
    // the descriptor's machine-number literal value — and no machine number
    // holds 9007199254740993 exactly — so it declines.
    abUnary(legacy.operandIsEven, twin.operandIsEven, {
      bigint: ['false', 'undefined'],
      'a=5': ['false', 'undefined'],
    });
    abUnary(legacy.operandIsOdd, twin.operandIsOdd, {
      bigint: ['true', 'undefined'],
      'a=5': ['true', 'undefined'],
    });
  });
});

describe('numericTypeHandler', () => {
  test('unary — equal everywhere', () => {
    abUnary(
      (x) => legacy.numericTypeHandler([x]),
      (d) => twin.numericTypeHandler([d]),
      {}
    );
  });

  test('binary — equal on every ordered pair', () => {
    abBinary(
      (x, y) => legacy.numericTypeHandler([x, y]),
      (a, b) => twin.numericTypeHandler([a, b]),
      {}
    );
  });
});

describe('gammaPoleType', () => {
  test('the non-positive-integer pole gate needs a sign the descriptor lacks', () => {
    // The gate WIDENS the claim to `number` on a proven non-positive sign,
    // so an integer-typed application whose non-positivity only an operator
    // `sgn` handler knows misses it and the twin claims `finite_real`. That
    // is NARROWER than the expressions shape, which is why the Γ-family
    // handlers cannot convert until the sign channel reaches applications.
    abUnary(legacy.gammaPoleType, twin.gammaPoleType, {
      'Neg(Floor(Abs(r)))': ['number', 'finite_real'],
    });
  });
});

describe('roundingFunctionType', () => {
  test('equal everywhere, including the complex and non-finite literals', () => {
    // A complex literal's non-realness travels on the SIGN here: `1 + 2i`
    // types `finite_complex`, which is not disjoint from `real`, so only
    // `sgn === 'unsigned'` (an imaginary part, NaN having been excluded by
    // the non-finite arm) proves it.
    abUnary(legacy.roundingFunctionType, twin.roundingFunctionType, {});
  });
});

describe('absFunctionType', () => {
  test('the NaN exclusion is the descriptor test, so it covers ~oo and a held NaN', () => {
    // The twin excludes NaN with the descriptor test `finite === false &&
    // sgn === 'unsigned'`, where the expressions shape asks the literal-only
    // `isNumber(x) && x.isNaN` plus a symbol-held-NaN check. One divergence
    // remains, and it widens in the sound direction:
    //
    //  `~oo`      — NaN and complex infinity produce IDENTICAL descriptors
    //               (type `number`, not finite, sign `unsigned`), so the
    //               exclusion cannot separate them and `Abs(~oo)` widens to
    //               `number`. Here the widening only drops a bound that
    //               happens to hold (|~oo| = +∞).
    //
    // The `hnan=NaN` row (a symbol declared `number` and assigned NaN) is
    // deliberately an AGREEMENT: both shapes answer `number`. The expression
    // shape once guarded only literals and claimed `real<0..>` there — a
    // type that excludes the NaN `Abs` evaluates to — and that hole was
    // closed on the expressions side when this battery surfaced it, so the
    // row now pins that both value channels (literal and held number) are
    // read by both shapes.
    abUnary(legacy.absFunctionType, twin.absFunctionType, {
      '~oo': ['real<0..>', 'number'],
    });
  });
});

describe('extremumType', () => {
  test('unary — equal everywhere', () => {
    abUnary(
      (x) => legacy.extremumType([x]),
      (d) => twin.extremumType([d]),
      {}
    );
  });

  test('binary — equal on every ordered pair', () => {
    abBinary(
      (x, y) => legacy.extremumType([x, y]),
      (a, b) => twin.extremumType([a, b]),
      {}
    );
  });
});

describe('measurementType', () => {
  test('equal everywhere', () => {
    abUnary(
      (x) => legacy.measurementType([x]),
      (d) => twin.measurementType([d]),
      {}
    );
  });
});

describe('bigOpResultType', () => {
  test('the reducer form — equal everywhere', () => {
    abUnary(
      (x) => legacy.bigOpResultType([x]),
      (d) => twin.bigOpResultType([d]),
      {}
    );
  });

  test('the (body, limits) form — equal everywhere', () => {
    const limit = () => ce.symbol('n');
    abUnary(
      (x) => legacy.bigOpResultType([x, limit()]),
      (d) => twin.bigOpResultType([d, describeOperand(limit())]),
      {}
    );
  });
});

describe('adjoinType and quotientRingType', () => {
  test('adjoin, base only — equal everywhere', () => {
    abUnary(
      (x) => legacy.adjoinType([x]),
      (d) => twin.adjoinType([d]),
      {}
    );
  });

  test('adjoin, base plus one adjunct — equal on every ordered pair', () => {
    abBinary(
      (x, y) => legacy.adjoinType([x, y]),
      (a, b) => twin.adjoinType([a, b]),
      {}
    );
  });

  test('quotient ring — equal everywhere', () => {
    abUnary(
      (x) => legacy.quotientRingType([x]),
      (d) => twin.quotientRingType([d]),
      {}
    );
  });
});

describe('elementaryFunctionType', () => {
  function abHead(head: string, expected: Divergences): void {
    abUnary(
      (x) => legacy.elementaryFunctionType(head, [x]),
      (d) => twin.elementaryFunctionType(head, [d]),
      expected
    );
  }

  // The log heads: the proven-non-positive gate widens the claim to
  // `number`, so an argument whose non-positivity only an operator `sgn`
  // handler knows falls through to the unknown-sign join and the twin
  // claims `complex`. NARROWER — the log heads convert once the sign
  // channel reaches applications.
  const LOG_DIVERGENCE: Divergences = {
    'Neg(Floor(Abs(r)))': ['number', 'complex'],
  };
  for (const head of ['Ln', 'Log', 'Lb', 'Lg', 'Log2', 'Log10'])
    test(`${head} — the proven-non-positive gate`, () =>
      abHead(head, LOG_DIVERGENCE));

  for (const head of ['Tan', 'Sec', 'Csc', 'Cot', 'Coth', 'Csch'])
    test(`${head} — equal everywhere`, () => abHead(head, {}));

  // `Sinh`/`Cosh`/`Tanh`/`Sech` take the non-finite arm on a REAL ±∞. Both
  // shapes now read realness from the TYPE. The expressions shape used to
  // test `isReal === true`, which a NaN literal answers `true` — so it
  // claimed `non_finite_number` (resp. `finite_real`) for a value that is
  // NaN, a member of `number` alone. That was corrected on the expressions
  // side rather than recorded as a divergence, because the twin's answer was
  // the sound one; the corrected NaN behavior is pinned in
  // `type-handler-parity.test.ts`.
  for (const head of ['Sinh', 'Cosh', 'Tanh', 'Sech'])
    test(`${head} — equal everywhere, NaN included`, () => abHead(head, {}));

  for (const head of ['Arctan', 'Arccot'])
    test(`${head} — equal everywhere`, () => abHead(head, {}));

  test('Sin — the default arm, equal everywhere', () => abHead('Sin', {}));

  // The bounded inverse heads. Three channel differences, all listed per
  // row — one where the descriptor knows less, two where it knows more:
  //
  //  (a) the expressions shape falls back on `x.re` — the machine-float
  //      projection — when a literal carries no exact machine value (`1/3`,
  //      `√2`, a bigint past 2⁵³) or when a symbol holds a value its
  //      declared type does not narrow to (`a := 5`). The descriptor has
  //      only the ranged type, so the magnitude stays undecided and the
  //      claim widens.
  //  (b) `Exp(r)` is the mirror case: the descriptor's SIGN comes from the
  //      result type (`(finite_real<0..>) & !0` proves positive, hence
  //      non-zero), while the expressions shape asks `isEqual(0)`, which
  //      does not consult a function expression's result type and answers
  //      `undefined`. Here the twin proves MORE and its claim is narrower —
  //      sound, but a divergence all the same.
  //  (c) the DECLARED-range rows (`bigd`, `smd`, `twod`) are the second
  //      mirror case, and the one that matters most for conversion. A range
  //      that came from a declaration (`ce.declare('bigd', 'real<2..>')`)
  //      puts a bound in the type and records NOTHING in the assumptions
  //      system, and the expressions shape's `provablyIn` asks
  //      `Expression.isGreaterEqual`, which reads the assumptions — so it
  //      answers `undefined` and widens, while the twin reads the bound off
  //      the type and decides. The `ce.assume`-ranged rows (`p`, `q`, `t`)
  //      do NOT diverge, because `ce.assume` refines the type and records
  //      the assumption, feeding both channels at once. The twin's claims
  //      here are sound and tighter, but tighter-than-baseline is still a
  //      shadow divergence: the bounded inverse heads cannot convert until
  //      the conversion decides what to do with these rows.
  const ARCSIN_D: Divergences = {
    '1/3': ['finite_real', 'finite_complex'],
    'smd:real<-0.5..0.5>': ['finite_complex', 'finite_real'],
    // A ranged RESULT type is the third witness of loss class (c): `Sign(r)`
    // types `finite_integer<-1..1>`, so `typeBounds` proves the operand lies
    // in Arcsin/Arccos's closed real domain [−1, 1] and the twin claims
    // `finite_real` (correct: arcsin of {−1, 0, 1} is {−π/2, 0, π/2}), while
    // the expression shape's `provablyIn` asks the assumptions system, which
    // never reads a result-type range, and falls to the vacuous no-pole
    // `finite_complex`. Only these two heads gain the row — every other
    // bounded head's real domain is open at ±1 or excludes it, so the
    // closed range [−1, 1] proves nothing there.
    'Sign(r)': ['finite_complex', 'finite_real'],
  };
  for (const head of ['Arcsin', 'Arccos'])
    test(`${head} — the exact-value fast path`, () => abHead(head, ARCSIN_D));

  const ARCSEC_D: Divergences = {
    sqrt2: ['finite_real', 'finite_complex'],
    bigint: ['finite_real', 'finite_complex'],
    'a=5': ['finite_real', 'finite_complex'],
    'Exp(r)': ['number', 'finite_complex'],
    'bigd:real<2..>': ['number', 'finite_real'],
    'twod:real<2..2>': ['number', 'finite_real'],
  };
  for (const head of ['Arcsec', 'Arccsc'])
    test(`${head} — the exact-value fast path and the type-proved sign`, () =>
      abHead(head, ARCSEC_D));

  test('Artanh — the exact-value fast path and the declared ranges', () =>
    abHead('Artanh', {
      '1/3': ['finite_real', 'complex'],
      sqrt2: ['finite_complex', 'complex'],
      bigint: ['finite_complex', 'complex'],
      'a=5': ['finite_complex', 'complex'],
      'bigd:real<2..>': ['complex', 'finite_complex'],
      'smd:real<-0.5..0.5>': ['complex', 'finite_real'],
      'twod:real<2..2>': ['complex', 'finite_complex'],
    }));

  test('Arcoth — the exact-value fast path and the declared ranges', () =>
    abHead('Arcoth', {
      '1/3': ['finite_complex', 'complex'],
      sqrt2: ['finite_real', 'complex'],
      bigint: ['finite_real', 'complex'],
      'a=5': ['finite_real', 'complex'],
      'bigd:real<2..>': ['complex', 'finite_real'],
      'smd:real<-0.5..0.5>': ['complex', 'finite_complex'],
      'twod:real<2..2>': ['complex', 'finite_real'],
    }));

  test('Arsech — the exact-value fast path, the type-proved sign and the declared ranges', () =>
    abHead('Arsech', {
      '1/3': ['finite_real', 'finite_complex'],
      'Exp(r)': ['complex', 'finite_complex'],
      'bigd:real<2..>': ['complex', 'finite_complex'],
      'twod:real<2..2>': ['complex', 'finite_complex'],
    }));

  // `Arcsch`'s real interval is the whole line, so a bound proves nothing
  // the generic-point convention did not already grant: the declared-range
  // rows agree here, which is what makes them a property of the DOMAIN
  // rather than of the operand.
  test('Arcsch — equal everywhere', () => abHead('Arcsch', {}));

  test('Arcosh — the exact-value fast path and the declared ranges', () =>
    abHead('Arcosh', {
      sqrt2: ['finite_real', 'finite_complex'],
      bigint: ['finite_real', 'finite_complex'],
      'a=5': ['finite_real', 'finite_complex'],
      'bigd:real<2..>': ['finite_complex', 'finite_real'],
      'twod:real<2..2>': ['finite_complex', 'finite_real'],
    }));

  test('an unlisted head falls through both dispatchers alike', () => {
    // The default arm is `numericTypeHandler` in both shapes; a head neither
    // dispatcher names must not start diverging.
    abHead('Erf', {});
    abHead('NotAnOperator', {});
  });

  // The log heads with an explicit base. A usable base must be positive,
  // finite, and DIFFERENT FROM 1 (`log_1` has no value: `1^y = 1` for every
  // y). The twin proves the first two facts from the type and the third
  // with `provablyDiffers`, which needs the type's bounds or its sign to
  // exclude 1.
  //
  // `Exp(r)` used to be the interesting base here: its type
  // `(finite_real<0..>) & !0` is type-derived-finite, where
  // `Expression.isFinite` on a function application is a structural
  // per-head propagation that never consults the result type and answers
  // `undefined` — so the twin accepted a base the expressions shape
  // rejected, and narrowed. That was NOT a benign stronger-channel
  // narrowing: `Exp(0) = 1`, so the accepted base could be exactly the one
  // value that has no logarithm, and the resulting `finite_real` claim was
  // unsound (`Log(4, Exp(0)).N()` is `+oo`). With the non-1 test made a
  // proof rather than a literal `!== 1` check, `Exp(r)` fails it — nothing
  // in `(finite_real<0..>) & !0` excludes 1 — and the whole `b=Exp(r)`
  // column now agrees with the expressions shape.
  const BASES: [string, () => Expression][] = [
    ['b=2', () => ce.number(2)],
    ['b=1', () => ce.number(1)],
    ['b=0', () => ce.number(0)],
    ['b=-2', () => ce.number(-2)],
    ['b=Inf', () => ce.PositiveInfinity],
    ['b=p>0', () => ce.symbol('p')],
    ['b=r', () => ce.symbol('r')],
    ['b=Exp(r)', () => ce.box(['Exp', 'r'])],
  ];

  test('Log with an explicit base — only the operator-`sgn` argument row differs', () => {
    const seen: Divergences = {};
    for (const [rowB, base] of BASES)
      for (const [row, x] of battery) {
        const l = spell(legacy.elementaryFunctionType('Log', [x, base()]));
        const t = spell(
          twin.elementaryFunctionType('Log', [
            describeOperand(x),
            describeOperand(base()),
          ])
        );
        if (l !== t) seen[`${row}|${rowB}`] = [l, t];
      }
    // One row survives in the whole sweep, and it is not about the base at
    // all: it is the same proven-non-positive ARGUMENT gate the unary log
    // heads diverge on (`Neg(Floor(Abs(r)))`, whose non-positivity only an
    // operator `sgn` handler knows). It shows up on `b=2` alone because
    // `b=2` is the only base in the list both shapes accept — with any
    // unusable base the twin reaches the base gate and answers `number`,
    // which is what the expressions shape already answered at the sign
    // gate, so the two agree by coincidence of route.
    expect(seen).toEqual({
      'Neg(Floor(Abs(r)))|b=2': ['number', 'complex'],
    });
  });
});
