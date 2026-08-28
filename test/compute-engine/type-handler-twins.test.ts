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
import { provablyNonFiniteNumber } from '../../src/compute-engine/boxed-expression/numerics';
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
    // An APPLICATION whose non-finiteness lives only in a held value: `w`
    // holds `+∞` behind a `number` declaration, `hnan` holds NaN, and
    // `Abs`'s result type stays wide in both cases. These are the rows that
    // witness the descriptor's application-level finiteness read.
    ['Abs(w)', ce.box(['Abs', 'w'])],
    ['Abs(hnan)', ce.box(['Abs', 'hnan'])],
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
  test('operandSgn — equal everywhere, applications included', () => {
    // The descriptor reads an application's sign from its operator `sgn`
    // handler — the same dispatch the expression channel uses — since the
    // O7 audit certified that family pure (open item O7 of
    // `docs/plans/2026-08-22-type-handlers-on-types.md`). Compound proofs
    // (`Sqrt(Abs(r))`, `Neg(Floor(Abs(r)))`) and held-value proofs
    // (`Abs(hnan)`, whose handler reads the held NaN and answers
    // `unsigned`) therefore reach both channels identically.
    abUnary(legacy.operandSgn, twin.operandSgn, {});
  });

  test('operandLiteralValue — equal everywhere', () => {
    abUnary(legacy.operandLiteralValue, twin.operandLiteralValue, {});
  });

  test('provablyNonFiniteNumber / operandNonFiniteNumber — equal everywhere', () => {
    // The non-finiteness predicate is the gate several converted handlers
    // rest on, and one of them rests on it ALONE: `EllipticF`'s legacy
    // handler is exactly `ops.some(provablyNonFiniteNumber) ? 'number' :
    // 'finite_number'`, so the whole translation of that operator is this
    // one pin. The expressions shape asks the value channel first
    // (`isNaN`/`isInfinity`) and falls back on `isFinite === false` plus a
    // `number` type test; the twin must reproduce both halves, including the
    // rows where only one of them fires — `~oo` and a symbol HOLDING NaN or
    // ±∞ behind a `number` declaration.
    abUnary(provablyNonFiniteNumber, twin.operandNonFiniteNumber, {});
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

  test('ternary — equal on every ordered pair plus a third operand', () => {
    // Converted operators reach this helper at arity 3 and above (`Clamp`,
    // `Hypergeometric1F1`), which the pairs above do not cover. A full
    // ordered-triple sweep of the battery would be redundant: the handler
    // folds `some(non-finite)` and `every(real)` over its operands, so the
    // answer depends on which operand CLASSES are present and not on their
    // order or count. Every ordered pair is therefore extended by a third
    // operand drawn from the four classes the two folds distinguish — a
    // finite real, a NaN, a provably real ±∞, and a finite complex — which
    // is enough to reach every combination of fold outcomes at this arity.
    const thirds: [string, () => Expression][] = [
      ['c=2', () => ce.number(2)],
      ['c=NaN', () => ce.NaN],
      ['c=Inf', () => ce.PositiveInfinity],
      ['c=i', () => ce.I],
    ];
    const seen: Divergences = {};
    for (const [rowC, third] of thirds)
      for (const [rowA, x] of battery)
        for (const [rowB, y] of battery) {
          const z = third();
          const l = spell(legacy.numericTypeHandler([x, y, z]));
          const t = spell(
            twin.numericTypeHandler([
              describeOperand(x),
              describeOperand(y),
              describeOperand(z),
            ])
          );
          if (l !== t) seen[`${rowA}|${rowB}|${rowC}`] = [l, t];
        }
    expect(seen).toEqual({});
  });
});

describe('gammaPoleType', () => {
  test('the non-positive-integer pole gate reads the application sign channel', () => {
    // The gate WIDENS the claim to `number` on a proven non-positive sign.
    // The descriptor's sign channel reaches applications (the operator
    // `sgn` handlers are dispatched on the type path since the O7 audit),
    // so a compound operand whose non-positivity is a handler's proof —
    // `Neg(Floor(Abs(r)))` — fires the gate in both shapes and the
    // Γ-family handlers are convertible.
    abUnary(legacy.gammaPoleType, twin.gammaPoleType, {});
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
    // `isNumber(x) && x.isNaN` plus a symbol-held-NaN check. Both shapes
    // agree on every row, `~oo` included.
    //
    // `~oo` was the one divergence this battery used to record: NaN and
    // complex infinity produce IDENTICAL descriptors (type `number`, not
    // finite, sign `unsigned`), so the descriptor test alone cannot
    // separate them and the twin widened to `number` where the expressions
    // shape claimed `real<0..>`. The TYPE channel does separate them —
    // `~oo` is a subtype of `infinity` and NaN is not — so both shapes now
    // take an infinite arm ahead of the NaN exclusion and answer
    // `non_finite_number`, which is what `|~oo| = +∞` deserves.
    //
    // The `hnan=NaN` row (a symbol declared `number` and assigned NaN) is
    // deliberately an AGREEMENT: both shapes answer `number`. The expression
    // shape once guarded only literals and claimed `real<0..>` there — a
    // type that excludes the NaN `Abs` evaluates to — and that hole was
    // closed on the expressions side when this battery surfaced it, so the
    // row now pins that both value channels (literal and held number) are
    // read by both shapes.
    //
    // The `Abs(hnan)` row — an APPLICATION operand that evaluates to NaN —
    // is likewise an AGREEMENT with a history: when the O7 audit let the
    // descriptor's sign channel reach applications, the twin began proving
    // that NaN (`Abs`'s `sgn` handler answers `unsigned` from the held
    // value, the finiteness read answers `false`) while the expressions
    // shape still guarded only literals and symbol-held NaN, claiming
    // `real<0..>` for a NaN value. That hole was closed on the expressions
    // side (the application arm of `absFunctionType`), so the row now pins
    // that BOTH shapes read the application value channel.
    abUnary(legacy.absFunctionType, twin.absFunctionType, {});
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
  // `number`. The descriptor's sign channel reaches applications (O7), so
  // a compound argument whose non-positivity is an operator `sgn`
  // handler's proof — `Neg(Floor(Abs(r)))` — fires the gate in both
  // shapes: the log heads are convertible.
  for (const head of ['Ln', 'Log', 'Lb', 'Lg', 'Log2', 'Log10'])
    test(`${head} — the proven-non-positive gate, equal everywhere`, () =>
      abHead(head, {}));

  for (const head of ['Tan', 'Sec', 'Csc', 'Cot', 'Coth', 'Csch'])
    test(`${head} — equal everywhere`, () => abHead(head, {}));

  // `Sinh`/`Cosh`/`Tanh`/`Sech` take the non-finite arm on a REAL ±∞. Both
  // shapes now read realness from the TYPE. The expressions shape used to
  // test the value predicate (then spelled `isReal`), which a NaN literal
  // answered `true` — so it claimed `non_finite_number` (resp. `finite_real`)
  // for a value that is NaN. That was corrected on the expressions
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
  //      projection — when a symbol holds a value its declared type does
  //      not narrow to (`a := 5`). The descriptor has only the ranged
  //      type, so the magnitude stays undecided and the claim widens.
  //      (LITERALS with no exact machine value — `1/3`, `√2`, a bigint
  //      past 2⁵³ — used to diverge the same way; since their types carry
  //      an enclosing range, `typeBounds` decides the magnitude and the
  //      channels agree, so those rows are gone from the tables below.)
  //  (b) `Exp(r)` is the mirror case: the descriptor's SIGN comes from the
  //      result type (`(finite_real<0..>) & !0` proves positive, hence
  //      non-zero), while the expressions shape asks `isEqual(0)`, which
  //      does not consult a function expression's result type and answers
  //      `undefined`. Here the twin proves MORE and its claim is narrower —
  //      sound, but a divergence all the same.
  //  (c) the DECLARED-range rows (`bigd`, `smd`, `twod`) are the second
  //      mirror case. A range that came from a declaration
  //      (`ce.declare('bigd', 'real<2..>')`) puts a bound in the type and
  //      records NOTHING in the assumptions system, and the expressions
  //      shape's `provablyIn` asks `Expression.isGreaterEqual`, which reads
  //      the assumptions — so it answers `undefined` and widens, while the
  //      twin reads the bound off the type and decides. The
  //      `ce.assume`-ranged rows (`p`, `q`, `t`) do NOT diverge, because
  //      `ce.assume` refines the type and records the assumption, feeding
  //      both channels at once.
  //
  // The nine heads converted to the twin WITH these divergences, by ruling
  // (2026-08-25): the (b)/(c) rows' tighter claims are correct and adopted,
  // and the (a) rows' wider claims are the accepted rational-literal
  // residue (ruling O4 of the plan doc). These tables are therefore the
  // permanent record of what the conversion changed — the live engine
  // answers the SECOND column of each row — and the heads run no shadow
  // parity, since the shapes differ by design. The adopted behavior is
  // pinned directly in `type-handler-parity.test.ts`.
  const ARCSIN_D: Divergences = {
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
    'a=5': ['finite_real', 'finite_complex'],
    'Exp(r)': ['number', 'finite_complex'],
    'bigd:real<2..>': ['number', 'finite_real'],
    'twod:real<2..2>': ['number', 'finite_real'],
  };
  for (const head of ['Arcsec', 'Arccsc'])
    test(`${head} — the exact-value fast path and the type-proved sign`, () =>
      abHead(head, ARCSEC_D));

  // The unknown-magnitude join of a head whose pole value is `±∞` is spelled
  // `complex | non_finite_number`: `complex` denotes the FINITE complex
  // numbers, so it cannot absorb the pole on its own.
  const POLE_JOIN = 'complex | non_finite_number';

  test('Artanh — the exact-value fast path and the declared ranges', () =>
    abHead('Artanh', {
      'a=5': ['finite_complex', POLE_JOIN],
      'bigd:real<2..>': [POLE_JOIN, 'finite_complex'],
      'smd:real<-0.5..0.5>': [POLE_JOIN, 'finite_real'],
      'twod:real<2..2>': [POLE_JOIN, 'finite_complex'],
    }));

  test('Arcoth — the exact-value fast path and the declared ranges', () =>
    abHead('Arcoth', {
      'a=5': ['finite_real', POLE_JOIN],
      'bigd:real<2..>': [POLE_JOIN, 'finite_real'],
      'smd:real<-0.5..0.5>': [POLE_JOIN, 'finite_complex'],
      'twod:real<2..2>': [POLE_JOIN, 'finite_real'],
    }));

  test('Arsech — the exact-value fast path, the type-proved sign and the declared ranges', () =>
    abHead('Arsech', {
      'Exp(r)': [POLE_JOIN, 'finite_complex'],
      'bigd:real<2..>': [POLE_JOIN, 'finite_complex'],
      'twod:real<2..2>': [POLE_JOIN, 'finite_complex'],
    }));

  // `Arcsch`'s real interval is the whole line, so a bound proves nothing
  // the generic-point convention did not already grant: the declared-range
  // rows agree here, which is what makes them a property of the DOMAIN
  // rather than of the operand.
  test('Arcsch — equal everywhere', () => abHead('Arcsch', {}));

  test('Arcosh — the exact-value fast path and the declared ranges', () =>
    abHead('Arcosh', {
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

  test('Log with an explicit base — equal on every argument/base pair', () => {
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
    // No divergence survives the sweep: the proven-non-positive ARGUMENT
    // gate that once separated the shapes on `Neg(Floor(Abs(r)))|b=2` now
    // fires in both — the descriptor's sign channel reaches applications
    // (O7), so a compound argument's handler-proven sign is visible to the
    // twin exactly as to the expressions shape.
    expect(seen).toEqual({});
  });
});
