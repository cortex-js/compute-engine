import type {
  Expression,
  ExpressionInput,
  IComputeEngine,
} from '../global-types.js';
import type {
  ContourInput,
  ContourIntegralResult,
  ContourPole,
} from '../types-contour.js';
import {
  isFunction,
  isNumber,
  isSymbol,
  sym,
} from '../boxed-expression/type-guards.js';
import {
  getPolynomialCoefficients,
  polynomialDegree,
} from '../boxed-expression/polynomials.js';
import {
  checkDeadline,
  throwIfCallerCancellation,
} from '../../common/interruptible.js';
import { freshSymbol, laurentData } from './series.js';
import { differentiate } from './derivative.js';
import { polynomialExponentialSingularity } from './essential-residue.js';
import {
  parseContour,
  exactComplexParts,
  exactlyEqual,
  exactSign,
  exactValueOfFloat,
  integerExponent,
} from './contour.js';
import {
  isExactConstantExpression,
  refineExactConstants,
} from '../boxed-expression/compare.js';

const MAX_DEGREE = 64;

function finiteValue(e: Expression): boolean {
  if (!e.isPure || !e.isValid) return false;
  if (sym(e) === 'ExponentialE' || sym(e) === 'Pi') return true;
  if (e.isFinite === true) return true;
  if (!isFunction(e)) return false;
  if (
    ['Add', 'Multiply', 'Negate', 'Sin', 'Cos', 'Sinh', 'Cosh'].includes(
      e.operator
    )
  )
    return e.ops.every(finiteValue);
  if (e.operator === 'Power') {
    if (isSymbol(e.op1) && e.op1.symbol === 'ExponentialE')
      return finiteValue(e.op2);
    if ((integerExponent(e) ?? -1) >= 0) return finiteValue(e.op1);
  }
  if (e.operator === 'Divide') return finiteValue(e.op1) && nonzero(e.op2);
  return false;
}

function nonzero(e: Expression): boolean {
  if (sym(e) === 'ExponentialE' || sym(e) === 'Pi') return true;
  if (isFunction(e, 'Power') && sym(e.op1) === 'ExponentialE')
    return finiteValue(e.op2);
  if (isFunction(e, 'Multiply')) return e.ops.every(nonzero);
  if (isFunction(e, 'Divide')) return nonzero(e.op1) && nonzero(e.op2);
  const parts = exactComplexParts(e);
  if (!parts) return false;
  const x = exactSign(parts.x);
  const y = exactSign(parts.y);
  return x === 1 || x === -1 || y === 1 || y === -1;
}

function exactZero(e: Expression): boolean {
  if (e.isSame(0)) return true;
  const parts = exactComplexParts(e);
  return !!parts && exactZeroPart(parts.x) && exactZeroPart(parts.y);
}

/** Whether an exact real constant is 0. `evaluate()` and `simplify()` keep a
 * product of sums factored, so a part such as `1 − √((√2 − 1)(√2 + 1))` stays
 * undecided although it is 0. When the sign is undecided, expand the part and
 * try again. The expansion is exact, so a result of 0 is still a proof. */
function exactZeroPart(part: Expression): boolean {
  const sign = exactSign(part);
  if (sign !== undefined) return sign === 0;
  return exactSign(part.engine.function('ExpandAll', [part]).evaluate()) === 0;
}

function exactNumber(e: Expression): boolean {
  if (!isNumber(e) || e.isFinite !== true) return false;
  const n = e.numericValue;
  return typeof n === 'number' ? Number.isSafeInteger(n) : n.isExact;
}

function polynomialCoefficients(poly: Expression, variable: string) {
  const direct = getPolynomialCoefficients(poly, variable);
  if (direct) return direct;
  // Nested shifted powers need recursive expansion before coefficient
  // extraction. Keep the original factored form for root enumeration.
  const degree = polynomialDegree(poly, variable);
  if (degree < 0 || degree > MAX_DEGREE) return undefined;
  return getPolynomialCoefficients(
    poly.engine.function('ExpandAll', [poly]).evaluate(),
    variable
  );
}

/** Construct an exact Cartesian square root instead of numericizing a
 * complex radical. The squared candidate is checked before it is used. */
function exactSquareRoot(value: Expression): Expression | undefined {
  const ce = value.engine;
  // Build every intermediate value with `ce.function()`. The `.add()`,
  // `.sub()`, `.div()` and `.pow()` methods fold two exact literals to a
  // machine float when one of them is irrational (for example `√2 − 1`), and
  // a float component makes the root fail the exactness checks below.
  const residual = (root: Expression) =>
    ce.function('Subtract', [ce.function('Power', [root, 2]), value]);
  const direct = ce.function('Sqrt', [value]).simplify();
  if (exactComplexParts(direct) && exactZero(residual(direct))) return direct;
  const parts = exactComplexParts(value);
  if (!parts) return undefined;
  const signY = exactSign(parts.y);
  if (signY === 0) {
    // A real value. `Sqrt` of a negative real, such as `√(−2 + √3)`, has no
    // exact Cartesian parts, so write it as i·√(−x).
    const signX = exactSign(parts.x);
    if (signX === undefined) return undefined;
    const root =
      signX === -1
        ? ce.function(
            'Multiply',
            [
              ce
                .function('Sqrt', [ce.function('Negate', [parts.x])])
                .simplify(),
              ce.I,
            ],
            { form: 'structural' }
          )
        : ce.function('Sqrt', [parts.x]).simplify();
    return exactComplexParts(root) && exactZero(residual(root))
      ? root
      : undefined;
  }
  if (signY !== 1 && signY !== -1) return undefined;
  const norm = ce
    .function('Sqrt', [
      ce.function('Add', [
        ce.function('Power', [parts.x, 2]),
        ce.function('Power', [parts.y, 2]),
      ]),
    ])
    .simplify();
  const re = ce
    .function('Sqrt', [
      ce.function('Divide', [ce.function('Add', [norm, parts.x]), 2]),
    ])
    .simplify();
  const im = ce
    .function('Sqrt', [
      ce.function('Divide', [ce.function('Subtract', [norm, parts.x]), 2]),
    ])
    .simplify();
  // Keep the Cartesian components separate: eager complex arithmetic may
  // turn mixed rational/radical components into an approximate complex scalar.
  const root = ce.function(
    'Add',
    [re, ce.function('Multiply', [signY, im, ce.I], { form: 'structural' })],
    { form: 'structural' }
  );
  return exactComplexParts(root) && exactZero(residual(root))
    ? root
    : undefined;
}

/** Certify completeness by exact synthetic division, including multiplicity.
 * The general solver may return only real roots or numeric approximations;
 * neither constitutes a complete symbolic list of complex poles. */
function polynomialZeros(
  poly: Expression,
  variable: string
): Expression[] | undefined {
  const ce = poly.engine;
  const degree = polynomialDegree(poly, variable);
  if (degree < 0 || degree > MAX_DEGREE) return undefined;
  if (degree === 0) {
    const c = poly.evaluate();
    return exactComplexParts(c) && nonzero(c) ? [] : undefined;
  }
  if (isFunction(poly, 'Multiply')) {
    const parts = poly.ops.map((p) => polynomialZeros(p, variable));
    return parts.some((p) => p === undefined)
      ? undefined
      : (parts as Expression[][]).flat();
  }
  if (isFunction(poly, 'Power') && (integerExponent(poly) ?? 0) > 0)
    return polynomialZeros(poly.op1, variable);
  let coefficients = polynomialCoefficients(poly, variable)?.map((c) =>
    c.simplify().evaluate()
  );
  if (!coefficients || !coefficients.every((c) => exactComplexParts(c)))
    return undefined;
  while (
    coefficients.length > 1 &&
    coefficients[coefficients.length - 1].isSame(0)
  )
    coefficients.pop();
  if (coefficients.length === 1)
    return coefficients[0].isSame(0) ? undefined : [];
  if (coefficients[0].isSame(0)) {
    while (coefficients.length > 1 && coefficients[0].isSame(0))
      coefficients.shift();
    const remainder = ce.function(
      'Add',
      coefficients.map((c, i) =>
        ce.function('Multiply', [
          c,
          ce.function('Power', [ce.symbol(variable), i]),
        ])
      )
    );
    const rest = polynomialZeros(remainder, variable);
    return rest ? [ce.Zero, ...rest] : undefined;
  }
  if (coefficients.length <= 3) {
    const [c, b, a] = coefficients;
    if (!a) return [ce.function('Divide', [c.neg(), b]).simplify()];
    const discriminant = ce
      .function('Subtract', [
        ce.function('Power', [b, 2]),
        ce.function('Multiply', [4, a, c]),
      ])
      .simplify();
    // `Sqrt` of a non-real or negative exact discriminant does not always
    // give exact Cartesian parts, so the roots would not be usable. Construct
    // the square root of such a discriminant in Cartesian form instead.
    const discriminantParts = exactComplexParts(discriminant);
    const imaginarySign = discriminantParts && exactSign(discriminantParts.y);
    const realSign = discriminantParts && exactSign(discriminantParts.x);
    const radical =
      imaginarySign === 1 || imaginarySign === -1 || realSign === -1
        ? exactSquareRoot(discriminant)
        : ce.function('Sqrt', [discriminant]);
    if (!radical) return undefined;
    const denominator = ce.function('Multiply', [2, a]);
    return [1, -1].map((s) =>
      ce
        .function('Divide', [
          ce.function('Add', [b.neg(), ce.function('Multiply', [s, radical])]),
          denominator,
        ])
        .simplify()
    );
  }
  // An even polynomial is a lower-degree polynomial in z². This preserves
  // completeness, unlike keeping only the real roots from the general solver.
  if (coefficients.every((c, i) => i % 2 === 0 || c.isSame(0))) {
    const reduced = ce.function(
      'Add',
      coefficients
        .filter((_, i) => i % 2 === 0)
        .map((c, i) =>
          ce.function('Multiply', [
            c,
            ce.function('Power', [ce.symbol(variable), i]),
          ])
        )
    );
    const squares = polynomialZeros(reduced, variable);
    const lifted = squares?.flatMap((r) => {
      const root = exactSquareRoot(r);
      return root ? [root, root.neg()] : [];
    });
    if (squares && lifted?.length === 2 * squares.length) return lifted;
  }
  const roots = poly.solve(variable) as ReadonlyArray<Expression> | null;
  if (!roots) return undefined;
  const certified: Expression[] = [];
  for (const candidate of roots) {
    checkDeadline(ce._deadlineFrame);
    const root = candidate.simplify().evaluate();
    if (!exactComplexParts(root)) continue;
    let multiplicity = 0;
    while (coefficients.length > 1) {
      const quotient: Expression[] = [coefficients[coefficients.length - 1]];
      for (let j = coefficients.length - 2; j > 0; j--) {
        quotient.unshift(
          ce
            .function('Add', [
              coefficients[j],
              ce.function('Multiply', [root, quotient[0]]),
            ])
            .simplify()
            .evaluate()
        );
      }
      const remainder = ce
        .function('Add', [
          coefficients[0],
          ce.function('Multiply', [root, quotient[0]]),
        ])
        .simplify()
        .evaluate();
      if (!exactZero(remainder) || !quotient.every((c) => exactComplexParts(c)))
        break;
      coefficients = quotient;
      multiplicity++;
    }
    if (multiplicity > 0) certified.push(root);
  }
  if (coefficients.length === 1) return certified;
  if (certified.length > 0 && coefficients.length <= 3) {
    const remaining = ce.function(
      'Add',
      coefficients.map((c, i) =>
        ce.function('Multiply', [
          c,
          ce.function('Power', [ce.symbol(variable), i]),
        ])
      )
    );
    const tail = polynomialZeros(remaining, variable);
    if (tail) return [...certified, ...tail];
  }
  return undefined;
}

/** Recognized entire functions may occur in the numerator, but applying one
 * to a meromorphic argument can create essential singularities. */
function isEntire(e: Expression, variable: string): boolean {
  if (!e.has(variable)) return finiteValue(e);
  if (isSymbol(e) && e.symbol === variable) return true;
  if (!isFunction(e)) return false;
  if (
    [
      'Add',
      'Subtract',
      'Multiply',
      'Negate',
      'Sin',
      'Cos',
      'Sinh',
      'Cosh',
      'Exp',
    ].includes(e.operator)
  )
    return e.ops.every((x) => isEntire(x, variable));
  if (e.operator === 'Power') {
    if (isSymbol(e.op1) && e.op1.symbol === 'ExponentialE')
      return isEntire(e.op2, variable);
    return (integerExponent(e) ?? -1) >= 0 && isEntire(e.op1, variable);
  }
  if (e.operator === 'Divide')
    return (
      !e.op2.has(variable) &&
      exactNumber(e.op2.evaluate()) &&
      !e.op2.evaluate().isSame(0) &&
      isEntire(e.op1, variable)
    );
  return false;
}

/** Whether `point` equals one of `points`: `undefined` when exact arithmetic
 * cannot decide it for some element. The same pole can come from two factors
 * of a denominator in two different forms, and it must be counted once: each
 * candidate is analyzed against the whole integrand, so a duplicate adds the
 * full residue a second time. */
function isKnownPoint(
  points: readonly Expression[],
  point: Expression
): boolean | undefined {
  let undecided = false;
  for (const p of points) {
    const same = exactlyEqual(p, point);
    if (same === true) return true;
    if (same === undefined) undecided = true;
  }
  return undecided ? undefined : false;
}

function poleCandidates(
  body: Expression,
  variable: string,
  realBounds: readonly Expression[]
): { points: Expression[]; scope: 'global' | 'contour' } | undefined {
  const ce = body.engine;
  const candidates: Expression[] = [];
  const essential = polynomialExponentialSingularity(body, variable);
  if (essential) return { points: [essential.point], scope: 'global' };
  let budget = 512;
  let scope: 'global' | 'contour' = 'global';
  const addZeros = (p: Expression): boolean => {
    checkDeadline(ce._deadlineFrame);
    if (--budget < 0) return false;
    if (polynomialDegree(p, variable) > MAX_DEGREE) return false;
    if (isFunction(p, 'Multiply')) return p.ops.every(addZeros);
    const exponent = integerExponent(p) ?? 0;
    if (isFunction(p, 'Power') && exponent > 0)
      return exponent <= MAX_DEGREE && addZeros(p.op1);
    let roots: Expression[] | undefined;
    if (isFunction(p, 'Sin') || isFunction(p, 'Cos')) {
      scope = 'contour';
      roots = trigonometricZeros(p, variable, realBounds);
    } else roots = polynomialZeros(p, variable);
    if (!roots) return false;
    for (const root of roots) {
      const known = isKnownPoint(candidates, root);
      // A root that may or may not equal a known candidate cannot be counted
      // once or twice safely, so the pole set is not certified.
      if (known === undefined) return false;
      if (!known) candidates.push(root);
    }
    return candidates.length <= MAX_DEGREE;
  };
  const visit = (e: Expression): boolean => {
    checkDeadline(ce._deadlineFrame);
    if (--budget < 0) return false;
    if (isEntire(e, variable)) return true;
    if (!isFunction(e)) return false;
    if (['Add', 'Subtract', 'Multiply', 'Negate'].includes(e.operator))
      return e.ops.every(visit);
    if (e.operator === 'Divide') return visit(e.op1) && addZeros(e.op2);
    const exponent = integerExponent(e);
    if (exponent !== undefined)
      return exponent < 0 ? addZeros(e.op1) : visit(e.op1);
    return false;
  };
  return visit(body) ? { points: candidates, scope } : undefined;
}

/** All zeros of sin(a*z+b) and cos(a*z+b), for real exact a and b,
 * belong to one real lattice. Enclose its index over the contour's real
 * projection, then enumerate a conservative integer superset. */
function trigonometricZeros(
  trig: Expression,
  variable: string,
  realBounds: readonly Expression[]
): Expression[] | undefined {
  if (!isFunction(trig) || trig.engine.angularUnit !== 'rad') return undefined;
  const ce = trig.engine;
  const coefficients = polynomialCoefficients(trig.op1, variable);
  if (coefficients?.length !== 2) return undefined;
  const [b, a] = coefficients;
  const ap = exactComplexParts(a);
  const bp = exactComplexParts(b);
  if (
    !ap ||
    !bp ||
    exactSign(ap.y) !== 0 ||
    exactSign(bp.y) !== 0 ||
    (exactSign(ap.x) !== 1 && exactSign(ap.x) !== -1)
  )
    return undefined;
  const phase = trig.operator === 'Cos' ? ce.Pi.div(2) : ce.Zero;
  const indices = realBounds.map((x) =>
    ce.function('Divide', [
      ce.function('Subtract', [ce.function('Add', [a.mul(x), b]), phase]),
      ce.Pi,
    ])
  );
  // The resolver's error model assumes exact inputs. A canonical arithmetic
  // operation that turned an exact expression into a float must not become
  // evidence for excluding any lattice index.
  if (!indices.every((x) => exactNumber(x) || isExactConstantExpression(x)))
    return undefined;
  const range = refineExactConstants(indices, (bounds) => {
    const lo = Math.min(...bounds.map(([l]) => l.floor().toNumber()));
    const hi = Math.max(...bounds.map(([, h]) => h.ceil().toNumber()));
    if (
      !Number.isSafeInteger(lo) ||
      !Number.isSafeInteger(hi) ||
      hi - lo + 1 > MAX_DEGREE
    )
      return undefined;
    return { lo, hi };
  });
  if (!range) return undefined;
  const roots: Expression[] = [];
  for (let k = range.lo; k <= range.hi; k++) {
    checkDeadline(ce._deadlineFrame);
    roots.push(
      ce
        .function('Divide', [
          ce.function('Subtract', [
            ce.function('Add', [phase, ce.Pi.mul(k)]),
            b,
          ]),
          a,
        ])
        .simplify()
    );
  }
  return roots;
}

/** The step budget of one `ce.contourIntegrate()` call: the number of
 * deadline checks it may make. The exact pole and residue computations have
 * no other bound on their cost: a large circle around a sine lattice or a
 * polygon with many vertices does many exact sign tests. A step budget makes
 * the point where the call gives up the same on every machine, so the result
 * of `Integrate`, which calls it, does not depend on machine speed. The 105
 * textbook cases of `test/compute-engine/fixtures/contour-textbook.ts` use at
 * most 389 steps, and `1/sin z` on a circle of radius 60 uses about 10,000. */
const CONTOUR_INTEGRATE_STEP_BUDGET = 50_000;

/** A wall-clock limit, in ms, that only guards against a hang in code that
 * does not count steps. */
const CONTOUR_INTEGRATE_HANG_GUARD_MS = 30_000;

/** Symbolic residue-theorem driver. It never invokes numeric quadrature.
 * When its own step budget or time limit is spent, the result has the status
 * `unsupported`. When the deadline or budget of an enclosing call is spent,
 * the cancellation is thrown to that caller. */
export function contourIntegrate(
  ce: IComputeEngine,
  integrand: ExpressionInput,
  variable: string,
  contour: ContourInput
): ContourIntegralResult {
  const outer = ce._deadlineFrame;
  try {
    return ce._withBudget(
      {
        ms: CONTOUR_INTEGRATE_HANG_GUARD_MS,
        steps: CONTOUR_INTEGRATE_STEP_BUDGET,
        label: 'contour-integrate',
      },
      () => contourIntegrateUnbounded(ce, integrand, variable, contour)
    );
  } catch (e) {
    throwIfCallerCancellation(e, outer);
    if (!(e instanceof Error && e.name === 'CancellationError')) throw e;
    return {
      method: 'residue-theorem',
      status: 'unsupported',
      polesComplete: false,
      poles: [],
      reason:
        'The step budget or time limit of the residue computation was spent.',
    };
  }
}

function contourIntegrateUnbounded(
  ce: IComputeEngine,
  integrand: ExpressionInput,
  variable: string,
  contour: ContourInput
): ContourIntegralResult {
  const report: ContourIntegralResult = {
    method: 'residue-theorem',
    status: 'unsupported',
    polesComplete: false,
    poles: [],
  };
  if (
    contour !== null &&
    typeof contour === 'object' &&
    'kind' in contour &&
    contour.kind === 'real-line'
  )
    return realLineIntegral(
      ce,
      integrand,
      variable,
      contour.principalValue ?? false
    );
  if (!(contour !== null && typeof contour === 'object' && 'kind' in contour)) {
    const c = ce.expr(contour);
    if (isFunction(c, 'RealLineContour')) {
      if (
        c.nops > 1 ||
        (c.nops === 1 && sym(c.op1) !== 'True' && sym(c.op1) !== 'False')
      )
        return {
          ...report,
          status: 'invalid-contour',
          reason:
            'RealLineContour accepts an optional principal-value boolean.',
        };
      return realLineIntegral(
        ce,
        integrand,
        variable,
        c.nops === 1 && sym(c.op1) === 'True'
      );
    }
  }
  const original = ce.expr(integrand);
  // A float in the integrand is read as the exact rational value that it
  // holds, so that the poles are found and classified exactly. A pole that
  // is nearer to the contour than the rounding of these floats is classified
  // `undetermined`. Because an operand is a float, the value is a float.
  const exact =
    original.isValid && original.isPure
      ? exactFloatLiterals(original)
      : undefined;
  const parsed = parseContour(ce, contour, variable, exact?.rounding);
  if ('status' in parsed) return { ...report, ...parsed };
  report.contour = parsed.contour;
  if (!variable || !isSymbol(ce.expr(variable)))
    return { ...report, reason: 'The integration variable must be a symbol.' };
  if (!original.isValid || !original.isPure)
    return {
      ...report,
      reason: 'The integrand must be a valid, pure expression.',
    };

  // Use a fresh complex variable so assigned values and real-only declarations
  // on the caller's variable cannot hide poles or filter complex roots.
  const v = freshSymbol(original, variable);
  ce.pushScope();
  try {
    ce.declare(v, 'complex');
    const body = (exact?.value ?? original).subs({
      [variable]: ce.symbol(v),
    });
    if (ce.angularUnit !== 'rad' && (body.has('Sin') || body.has('Cos')))
      return {
        ...report,
        reason: 'Trigonometric contour integration requires radians.',
      };
    if (body.unknowns.some((name) => name !== v))
      return {
        ...report,
        reason:
          'Unresolved parameters prevent unconditional pole classification.',
      };
    const candidates = poleCandidates(body, v, parsed.realBounds);
    if (!candidates)
      return {
        ...report,
        reason:
          'A complete pole set for the contour could not be certified. Supported denominators are polynomials and products of real-affine sine/cosine factors within the enumeration budget.',
      };
    report.polesComplete = true;
    report.poleScope = candidates.scope;
    const poles: ContourPole[] = [];
    for (const p of candidates.points) {
      checkDeadline(ce._deadlineFrame);
      const location = parsed.classify(p);
      const entry: ContourPole = {
        point: p,
        location,
        enclosed:
          location === 'inside'
            ? true
            : location === 'outside'
              ? false
              : undefined,
        ...analyzePole(body, v, p),
      };
      poles.push(entry);
    }
    report.poles = poles;
    if (
      poles.some(
        (p) =>
          (p.kind === 'pole' || p.kind === 'essential') &&
          p.location === 'boundary'
      )
    )
      return {
        ...report,
        status: 'pole-on-contour',
        reason:
          'An isolated singularity lies on the contour. The ordinary residue theorem does not define this integral.',
      };
    if (
      poles.some(
        (p) =>
          p.kind !== 'removable' &&
          (p.kind === 'undetermined' ||
            p.location === 'undetermined' ||
            (p.location === 'inside' &&
              (!p.residue || !finiteValue(p.residue))))
      )
    )
      return {
        ...report,
        status: 'undetermined',
        reason:
          'A pole, its location, or an enclosed residue could not be determined.',
      };
    const sum = realOrImaginaryForm(
      ce
        .function(
          'Add',
          poles
            .filter(
              (p) =>
                (p.kind === 'pole' || p.kind === 'essential') &&
                p.location === 'inside'
            )
            .map((p) => p.residue!)
        )
        .simplify()
    );
    const direction = parsed.contour.orientation === 'clockwise' ? -2 : 2;
    const value = ce
      .function('Multiply', [ce.number(direction), ce.Pi, ce.I, sum])
      .simplify();
    return {
      ...report,
      status: 'success',
      residueSum: sum,
      // A float contour coordinate or a float in the integrand makes the
      // value a float, as a float operand does elsewhere.
      value: parsed.inexact || exact ? value.N() : value,
    };
  } finally {
    ce.popScope();
  }
}

/** Replace each finite float literal of `e` by the exact rational value that
 * it holds (see `exactValueOfFloat()`). The result has the expression with
 * the exact values, and `rounding`, the sum of the rounding bounds of the
 * replaced floats. `undefined` when `e` has no float literal.
 *
 * The rounding of a coefficient is not a bound on the displacement of a
 * root in all cases: the root of a·z − b moves by about |b/a²| times the
 * error in `a`, and a multiple root moves by a fractional power of the
 * error. The margin only keeps the classification of a pole that is very
 * near the contour from depending on the last bit of a float. */
function exactFloatLiterals(
  e: Expression
): { value: Expression; rounding: Expression } | undefined {
  const ce = e.engine;
  const bounds: Expression[] = [];
  const visit = (x: Expression): Expression => {
    checkDeadline(ce._deadlineFrame);
    const exact = exactValueOfFloat(x);
    if (exact) {
      bounds.push(exact.bound);
      return exact.value;
    }
    if (!isFunction(x)) return x;
    const ops = x.ops.map(visit);
    return ops.every((op, i) => op === x.ops[i])
      ? x
      : ce.function(x.operator, ops);
  };
  const value = visit(e);
  if (bounds.length === 0) return undefined;
  return { value, rounding: ce.function('Add', bounds).evaluate() };
}

/** `simplify()` does not always combine residues written with complex
 * denominators: for 1/(z⁶+1) on |z| = 2 the sum of the residues is 0, but it
 * stays a sum of four fractions. Exact Cartesian parts combine them. Use them
 * only when one part is exactly zero: building x + iy from two nonzero
 * parts can turn exact radicals into a floating-point complex number. */
function realOrImaginaryForm(e: Expression): Expression {
  const parts = exactComplexParts(e);
  if (!parts) return e;
  // `simplify()` can leave a part that is 0 as a sum of terms that do not
  // cancel, for example (1 − √3)⁻² − (√3 − 1)⁻². Replace a part with 0 when
  // `exactZeroPart()` proves that it is 0.
  const zeroOr = (part: Expression) =>
    !part.isSame(0) && exactZeroPart(part) ? e.engine.Zero : part;
  const x = zeroOr(parts.x.simplify());
  const y = zeroOr(parts.y.simplify());
  if (y.isSame(0)) return x;
  if (x.isSame(0)) return e.engine.function('Multiply', [y, e.engine.I]);
  return e;
}

type PoleData = Pick<
  ContourPole,
  'kind' | 'order' | 'residue' | 'leadingCoefficient'
>;

function analyzePole(
  body: Expression,
  variable: string,
  p: Expression
): PoleData {
  const ce = body.engine;
  const essential = polynomialExponentialSingularity(body, variable);
  if (essential && exactZero(p.sub(essential.point)))
    return { kind: essential.kind, residue: essential.residue };
  let data = laurentData(body, variable, p, ce, 4);
  // A denominator of degree m can hide its first nonzero coefficient beyond
  // the default four-term window. Widen only when necessary, and never read
  // the residue outside the Laurent kernel's reliable coefficient interval.
  if (!data || (data.v < 0 && data.hi < -1)) {
    const degree = polynomialDegree(body.denominator, variable);
    if (degree > 4 && degree <= MAX_DEGREE)
      data = laurentData(body, variable, p, ce, degree);
  }
  if (data && (data.v >= 0 || data.hi >= -1))
    return data.v >= 0
      ? { kind: 'removable', order: 0, residue: ce.Zero }
      : {
          kind: 'pole',
          order: -data.v,
          residue: data.coeff(-1).evaluate(),
          leadingCoefficient: data.coeff(data.v).evaluate(),
        };
  // The Laurent kernel can decline an exact symbolic expansion point.
  // For an entire numerator and a simple analytic denominator zero, the
  // exact local formula h(p)/q'(p) needs no series expansion at that point.
  const [numerator, denominator] = body.numeratorDenominator;
  if (
    isEntire(numerator, variable) &&
    isEntire(denominator, variable) &&
    exactZero(denominator.subs({ [variable]: p }))
  ) {
    const d = differentiate(denominator, variable);
    const dp = d
      ?.subs({ [variable]: p })
      .simplify()
      .evaluate();
    const parts = dp && exactComplexParts(dp);
    if (
      parts &&
      (exactSign(parts.x) === 1 ||
        exactSign(parts.x) === -1 ||
        exactSign(parts.y) === 1 ||
        exactSign(parts.y) === -1)
    ) {
      const h = numerator.subs({ [variable]: p }).simplify();
      const removable = exactZero(h);
      if (finiteValue(h) && removable)
        return { kind: 'removable', order: 0, residue: ce.Zero };
      if (finiteValue(h) && nonzero(h)) {
        // At a simple pole, the leading coefficient is the residue.
        const residue = ce.function('Divide', [h, dp!]).simplify();
        return {
          kind: 'pole',
          order: 1,
          residue,
          leadingCoefficient: residue,
        };
      }
    }
  }
  const analytic = analyticPoleData(body, variable, p);
  if (analytic) return analytic;
  return { kind: 'undetermined' };
}

/** Local Taylor division for entire denominators at exact symbolic
 * points that the Laurent kernel cannot expand. If q has order m, the
 * residue is coefficient m-1 of h(p+t)/(q(p+t)/t^m). */
function analyticPoleData(
  body: Expression,
  variable: string,
  point: Expression
): PoleData | undefined {
  const ce = body.engine;
  const [h, q] = body.numeratorDenominator;
  if (
    !exactComplexParts(point) ||
    !isEntire(h, variable) ||
    !isEntire(q, variable)
  )
    return undefined;
  const evaluateAtPoint = (e: Expression) =>
    e.subs({ [variable]: point }).simplify();
  if (!exactZero(evaluateAtPoint(q))) return undefined;

  // This fallback is bounded independently of polynomial degree: repeated
  // symbolic differentiation can otherwise grow much faster than the input.
  const maxOrder = 8;
  let derivative: Expression = q;
  let factorial = 1;
  let order: number | undefined;
  const denominator: Expression[] = [ce.Zero];
  for (let k = 1; k <= 2 * maxOrder - 1; k++) {
    checkDeadline(ce._deadlineFrame);
    const next = differentiate(derivative, variable);
    if (!next) return undefined;
    derivative = next;
    factorial *= k;
    const c = evaluateAtPoint(derivative).div(factorial).simplify();
    if (!exactComplexParts(c)) return undefined;
    denominator.push(c);
    if (order === undefined) {
      if (nonzero(c)) order = k;
      else if (!exactZero(c)) return undefined;
      if (order === undefined && k === maxOrder) return undefined;
    }
    if (order !== undefined && k >= 2 * order - 1) break;
  }
  if (order === undefined || order > maxOrder) return undefined;

  derivative = h;
  factorial = 1;
  let numeratorOrder: number | undefined;
  const quotient: Expression[] = [];
  for (let j = 0; j < order; j++) {
    checkDeadline(ce._deadlineFrame);
    if (j > 0) {
      const next = differentiate(derivative, variable);
      if (!next) return undefined;
      derivative = next;
      factorial *= j;
    }
    const c = evaluateAtPoint(derivative).div(factorial).simplify();
    if (!finiteValue(c)) return undefined;
    if (numeratorOrder === undefined) {
      if (nonzero(c)) numeratorOrder = j;
      else if (!exactZero(c)) return undefined;
    }
    const convolution = ce.function(
      'Add',
      Array.from({ length: j }, (_, k) =>
        denominator[order + k + 1].mul(quotient[j - k - 1])
      )
    );
    quotient.push(c.sub(convolution).div(denominator[order]).simplify());
  }
  return numeratorOrder === undefined
    ? { kind: 'removable', order: 0, residue: ce.Zero }
    : {
        kind: 'pole',
        order: order - numeratorOrder,
        residue: quotient[order - 1],
        leadingCoefficient: quotient[numeratorOrder],
      };
}

/** The value of a real integral whose path goes through poles of a real
 * integrand. Each term gives the order m of one pole and the coefficient c of
 * the leading term c/(t - t0)^m of the integrand next to it, where c must be
 * real. The integral over the rest of the path must be finite.
 * - A pole of odd order: the integrand tends to +infinity on one side of it
 *   and to -infinity on the other side, so the integral has no value.
 * - Poles of even order only: the integral is +infinity when every c is
 *   positive, -infinity when every c is negative, and has no value when the
 *   signs differ.
 * The result is `undetermined` when an order or a sign cannot be decided. */
export function realPathDivergence(
  terms: readonly { order?: number; coefficient?: Expression }[]
): NonNullable<ContourIntegralResult['divergence']> {
  if (terms.some((t) => t.order !== undefined && t.order % 2 === 1))
    return 'no-value';
  const signs = new Set<number>();
  for (const { order, coefficient } of terms) {
    if (order === undefined || order < 2 || !coefficient) return 'undetermined';
    const parts = exactComplexParts(coefficient);
    const sign = parts && exactSign(parts.x);
    if (!parts || exactSign(parts.y) !== 0 || (sign !== 1 && sign !== -1))
      return 'undetermined';
    signs.add(sign);
  }
  if (signs.size !== 1) return signs.size === 0 ? 'undetermined' : 'no-value';
  return signs.has(1) ? 'positive-infinity' : 'negative-infinity';
}

/** The divergence of a real-line integral of a complex integrand through
 * poles on the path. Next to a pole of order m, the integrand behaves like
 * c/(t - t0)^m, whose modulus is not integrable, so the real part or the
 * imaginary part of the integral diverges. For a pole of odd order, that part
 * changes sign across the pole. For a pole of even order, it can diverge in
 * one direction (∫ i/x² dx tends to i·∞), but no complex number is its value
 * and the engine has no directed complex infinity. In both cases the
 * integral has no value. */
function complexPathDivergence(
  terms: readonly unknown[]
): NonNullable<ContourIntegralResult['divergence']> {
  return terms.length > 0 ? 'no-value' : 'undetermined';
}

/** Close a rational Fourier integral in the half-plane where exp(i*a*z)
 * decays. Integrating cos(z) itself around a semicircle would not work:
 * one of its exponential terms grows there. */
function realLineIntegral(
  ce: IComputeEngine,
  integrand: ExpressionInput,
  variable: string,
  principalValue: boolean
): ContourIntegralResult {
  const report: ContourIntegralResult = {
    method: 'residue-theorem',
    status: 'unsupported',
    poles: [],
    polesComplete: false,
  };
  if (
    typeof principalValue !== 'boolean' ||
    !variable ||
    !isSymbol(ce.expr(variable))
  )
    return {
      ...report,
      reason: 'Invalid real-line contour or integration variable.',
    };
  const original = ce.expr(integrand);
  if (!original.isPure || !original.isValid)
    return {
      ...report,
      reason: 'The integrand must be a valid, pure expression.',
    };
  const v = freshSymbol(original, variable);
  ce.pushScope();
  try {
    ce.declare(v, 'complex');
    const body = original.subs({ [variable]: ce.symbol(v) });
    // A sum of fractions has no denominator of its own: put it over a common
    // denominator, so that the poles of every term are found.
    const [rawNumerator, denominator] = (
      isFunction(body, 'Add')
        ? ce.function('Together', [body]).evaluate()
        : body
    ).numeratorDenominator;
    let numerator = rawNumerator;
    let projection: 'none' | 'real' | 'imaginary' = 'none';
    let direction: 1 | -1 = 1;
    let exponential: Expression | undefined;
    const factors = isFunction(numerator, 'Multiply')
      ? [...numerator.ops]
      : [numerator];
    const oscillatory = factors.filter(
      (f) =>
        isFunction(f, 'Cos') ||
        isFunction(f, 'Sin') ||
        (isFunction(f, 'Power') &&
          isSymbol(f.op1) &&
          f.op1.symbol === 'ExponentialE')
    );
    if (oscillatory.length > 1)
      return {
        ...report,
        reason: 'Only one linear Fourier factor is supported.',
      };
    if (oscillatory.length === 1) {
      const trig = oscillatory[0];
      if (!isFunction(trig))
        return { ...report, reason: 'The Fourier factor is not a function.' };
      const isTrig = trig.operator === 'Cos' || trig.operator === 'Sin';
      if (isTrig && ce.angularUnit !== 'rad')
        return {
          ...report,
          reason: 'Fourier contour integration currently requires radians.',
        };
      const arg = isTrig ? trig.op1 : trig.op2;
      const coeffs = getPolynomialCoefficients(arg, v);
      if (!coeffs || coeffs.length !== 2)
        return { ...report, reason: 'The Fourier argument must be linear.' };
      const a = exactComplexParts(coeffs[1]);
      const b = exactComplexParts(coeffs[0]);
      const shape = isTrig
        ? 'The argument of a cosine or sine must be a real linear function.'
        : 'The exponent must be i times a real linear function.';
      if (!a || !b) return { ...report, reason: shape };
      if (
        exactSign(isTrig ? a.y : a.x) !== 0 ||
        exactSign(isTrig ? b.y : b.x) !== 0
      )
        return { ...report, reason: shape };
      const frequency = exactSign(isTrig ? a.x : a.y);
      if (frequency !== 1 && frequency !== -1)
        return {
          ...report,
          reason: 'The sign of the Fourier frequency could not be decided.',
        };
      direction = frequency;
      projection = isTrig
        ? trig.operator === 'Cos'
          ? 'real'
          : 'imaginary'
        : 'none';
      exponential = isTrig
        ? ce.function('Exp', [ce.function('Multiply', [ce.I, arg])])
        : trig;
      numerator = ce.function(
        'Multiply',
        factors.filter((f) => f !== trig)
      );
    }
    if (
      polynomialDegree(numerator, v) < 0 ||
      polynomialDegree(denominator, v) < 1 ||
      polynomialDegree(numerator, v) > MAX_DEGREE ||
      polynomialDegree(denominator, v) > MAX_DEGREE
    )
      return {
        ...report,
        reason:
          'Expected a rational function times an optional linear Fourier factor.',
      };
    // The written degree can be too high: in (x+1)³ − x³ the cubic terms
    // cancel. The decay test needs the true degree, so read each degree from
    // the exact coefficients after removing the leading zero coefficients.
    const coefficients = [numerator, denominator].map((poly) => {
      const cs = polynomialCoefficients(poly, v)?.map((c) =>
        c.simplify().evaluate()
      );
      while (cs && cs.length > 1 && exactZero(cs[cs.length - 1])) cs.pop();
      return cs;
    });
    if (
      coefficients.some(
        (cs) =>
          !cs ||
          cs.some(
            (n) =>
              !exactNumber(n) ||
              (projection !== 'none' &&
                exactComplexParts(n)?.y.isSame(0) !== true)
          ) ||
          !nonzero(cs[cs.length - 1])
      )
    )
      return {
        ...report,
        reason:
          'Rational coefficients must be exact; cosine/sine projection requires real coefficients.',
      };
    const [numeratorCoefficients, denominatorCoefficients] = coefficients as [
      Expression[],
      Expression[],
    ];
    const numDegree = numeratorCoefficients.length - 1;
    const denDegree = denominatorCoefficients.length - 1;
    if (denDegree < 1)
      return {
        ...report,
        reason:
          'Expected a rational function times an optional linear Fourier factor.',
      };
    // With no Fourier factor and real coefficients, the integrand is real on
    // the real axis, so the integral is real. The residue sum then has an
    // imaginary part that is zero but is not always written as zero, so keep
    // only the real part.
    if (
      !exponential &&
      coefficients.every((cs) =>
        cs!.every((c) => exactSign(exactComplexParts(c)?.y ?? ce.NaN) === 0)
      )
    )
      projection = 'real';
    // O(1/z²) kills a rational semicircle; with a nonzero Fourier frequency,
    // Jordan's lemma only requires the rational factor to tend to zero.
    const hasLargeArc =
      !exponential && principalValue && denDegree - numDegree === 1;
    if (denDegree - numDegree < (exponential || hasLargeArc ? 1 : 2))
      return {
        ...report,
        reason: 'Decay on the closing arc could not be established.',
      };
    const roots = polynomialZeros(denominator, v);
    if (!roots)
      return {
        ...report,
        reason: 'A complete complex pole set could not be certified.',
      };
    const candidates: Expression[] = [];
    for (const root of roots) {
      const known = isKnownPoint(candidates, root);
      if (known === undefined)
        return {
          ...report,
          reason: 'Two poles could not be proved equal or distinct.',
        };
      if (!known) candidates.push(root);
    }
    const kernel = ce.function('Divide', [
      exponential
        ? ce.function('Multiply', [numerator, exponential])
        : numerator,
      denominator,
    ]);
    report.polesComplete = true;
    report.poleScope = 'global';
    report.contour = {
      kind: 'real-line',
      principalValue,
      orientation: direction === 1 ? 'counterclockwise' : 'clockwise',
    };
    report.realIntegral = {
      closure: direction === 1 ? 'upper' : 'lower',
      projection,
      principalValue,
    };
    // For R(z) = c/z + O(1/z²), the upper semicircle tends to iπc,
    // not zero. Only the symmetric principal value converges at infinity.
    const largeArc = hasLargeArc
      ? ce.I.mul(ce.Pi)
          .mul(
            numeratorCoefficients[numDegree].div(
              denominatorCoefficients[denDegree]
            )
          )
          .simplify()
      : ce.Zero;
    if (hasLargeArc) report.realIntegral.largeArcContribution = largeArc;
    const poles: ContourPole[] = [];
    let boundaryPole = false;
    const boundaryTerms: { order?: number; coefficient?: Expression }[] = [];
    for (const p of candidates) {
      checkDeadline(ce._deadlineFrame);
      const parts = exactComplexParts(p);
      const s = parts && exactSign(parts.y);
      const location =
        s === undefined
          ? 'undetermined'
          : s === 0
            ? 'boundary'
            : s === direction
              ? 'inside'
              : 'outside';
      const local = analyzePole(kernel, v, p);
      poles.push({
        point: p,
        location,
        enclosed:
          location === 'inside'
            ? true
            : location === 'outside'
              ? false
              : undefined,
        ...local,
      });
      if (location === 'boundary') {
        const actual = analyzePole(body, v, p);
        if (actual.kind === 'pole') {
          boundaryPole = true;
          boundaryTerms.push({
            order: actual.order,
            coefficient: actual.leadingCoefficient,
          });
        } else if (actual.kind === 'undetermined')
          return {
            ...report,
            poles,
            status: 'undetermined',
            reason: 'The real-axis singularity could not be classified.',
          };
      }
    }
    report.poles = poles;
    if (boundaryPole && !principalValue)
      return {
        ...report,
        status: 'pole-on-contour',
        divergence: poles.some(
          (p) => p.kind !== 'removable' && p.location === 'undetermined'
        )
          ? // A candidate that may be on the path could change the verdict.
            'undetermined'
          : projection !== 'none'
            ? // A cosine or sine factor with real coefficients, or a
              // rational function with real coefficients, is real on the
              // real axis.
              realPathDivergence(boundaryTerms)
            : complexPathDivergence(boundaryTerms),
        reason:
          'The ordinary real integral has a real-axis pole. Request principalValue explicitly for a Cauchy principal value.',
      };
    if (
      poles.some(
        (p) =>
          p.kind === 'undetermined' ||
          p.location === 'undetermined' ||
          (p.kind === 'pole' &&
            p.location !== 'outside' &&
            (!p.residue || !finiteValue(p.residue)))
      )
    )
      return {
        ...report,
        status: 'undetermined',
        reason: 'A pole or residue could not be determined.',
      };
    if (
      poles.some(
        (p) => p.kind === 'pole' && p.location === 'boundary' && p.order !== 1
      )
    )
      return {
        ...report,
        status: 'unsupported',
        reason:
          'Real-axis indentation currently supports only simple poles; no Hadamard finite part is assumed.',
      };
    const enclosed = poles.filter(
      (p) => p.kind === 'pole' && p.location === 'inside'
    );
    const boundary = poles.filter(
      (p) => p.kind === 'pole' && p.location === 'boundary'
    );
    const sum = ce
      .function('Add', [
        ...enclosed.map((p) => p.residue!),
        ...boundary.map((p) => ce.function('Multiply', [ce.Half, p.residue!])),
      ])
      .simplify();
    let value = ce
      .function('Multiply', [2 * direction, ce.Pi, ce.I, sum])
      .sub(largeArc)
      .simplify();
    if (projection !== 'none') {
      // Take the part from the exact Cartesian form of the value. A bare
      // `Real(…)` or `Imaginary(…)` wrapper stays unevaluated after
      // `simplify()`: the sinc integral would read `Imaginary(iπ)`, not `π`.
      const parts = exactComplexParts(value);
      value = parts
        ? (projection === 'real' ? parts.x : parts.y).simplify()
        : ce
            .function(projection === 'real' ? 'Real' : 'Imaginary', [value])
            .evaluate();
    }
    return { ...report, status: 'success', residueSum: sum, value };
  } finally {
    ce.popScope();
  }
}
