import type { Expression, IComputeEngine } from '../global-types.js';
import type {
  ContourInput,
  ContourOrientation,
  ContourPole,
  NormalizedContour,
} from '../types-contour.js';
import {
  isFunction,
  isNumber,
  isSymbol,
  sym,
} from '../boxed-expression/type-guards.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import type { BigDecimal } from '../../big-decimal/index.js';
import { checkDeadline } from '../../common/interruptible.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import {
  isExactConstantExpression,
  refineExactConstants,
} from '../boxed-expression/compare.js';

type Point = { x: Expression; y: Expression };
type Location = ContourPole['location'];
type Sign = -1 | 0 | 1;

export type ParsedContour =
  | {
      contour: NormalizedContour;
      classify: (point: Expression) => Location;
      /** The real projection is bounded by the minimum and maximum of these
       * exact coordinates. No rounded extrema are used to enumerate poles. */
      realBounds: readonly Expression[];
      /** True when a coordinate of the contour was a float. The coordinate
       * is read as the exact rational value that the float holds, so that
       * the poles are classified exactly. A pole that is nearer to the
       * contour than the rounding of these floats is classified
       * `undetermined`, because the value that a float stands for can put
       * that pole on the contour. Because an operand was a float, the caller
       * must return the value of the integral as a float. */
      inexact?: boolean;
    }
  | { status: 'invalid-contour' | 'unsupported'; reason: string };

/** The sign of an exact constant, or `undefined` when it cannot be proved.
 * Exact arithmetic proves that a value is 0. Otherwise the sign comes from the
 * enclosures of `refineExactConstants()`, and only an enclosure that excludes
 * 0 decides it. When the enclosures reach the precision limit and still
 * contain 0, the resolver can call two values equal; that is not a proof, and
 * accepting it would put a point at a very small nonzero distance from the
 * contour onto the contour. */
export function exactSign(e: Expression): Sign | undefined {
  if (!isExactConstantExpression(e) && !(isNumber(e) && e.isExact))
    return undefined;
  const algebraic = algebraicSign(e);
  if (algebraic !== undefined) return algebraic;
  return refineExactConstants([e], ([[lo, hi]]) =>
    lo.gt(0) ? 1 : hi.lt(0) ? -1 : undefined
  );
}

function algebraicSign(e: Expression): Sign | undefined {
  // `evaluate()` decides most signs. `simplify()` costs much more, so use it
  // only when the evaluated value is not an exact number literal.
  let v = e.evaluate();
  if (!isNumber(v) || !v.isExact) v = e.simplify().evaluate();
  // Sums a + b*sqrt(d) remain symbolic in the numeric layer. When the two
  // terms have opposite signs, compare their squared magnitudes exactly.
  // No rounded approximation participates in the inside/boundary decision.
  if (isFunction(v, 'Add')) {
    const ce = e.engine;
    const terms = new Map<number, Expression>();
    for (const term of v.ops) {
      const t = term.evaluate();
      if (!isNumber(t) || t.isFinite !== true) return undefined;
      const n = t.numericValue;
      let radical = 1;
      let coefficient: Expression;
      if (typeof n === 'number') {
        if (!Number.isSafeInteger(n)) return undefined;
        coefficient = t;
      } else {
        if (!(n instanceof ExactNumericValue) || !n.isExact || n.isComplex)
          return undefined;
        radical = n.radical;
        coefficient = ce.number(n.rational);
      }
      terms.set(radical, (terms.get(radical) ?? ce.Zero).add(coefficient));
    }
    const a = terms.get(1) ?? ce.Zero;
    terms.delete(1);
    if (terms.size !== 1) return undefined;
    const [d, b] = [...terms][0];
    const sa = exactSign(a);
    const sb = exactSign(b);
    if (sa === undefined || sb === undefined) return undefined;
    if (sa === 0) return sb;
    if (sb === 0 || sa === sb) return sa;
    const comparison = exactSign(a.pow(2).sub(b.pow(2).mul(d)));
    return comparison === undefined ? undefined : ((sa * comparison) as Sign);
  }
  if (!isNumber(v) || v.isFinite !== true) return undefined;
  const n = v.numericValue;
  if (typeof n === 'number')
    return Number.isSafeInteger(n) ? (Math.sign(n) as Sign) : undefined;
  if (!n.isExact || n.isComplex) return undefined;
  return n.sgn();
}

/** The exponent of `e` when `e` is a `Power` whose exponent is an exact real
 * integer literal that is a safe JavaScript integer, otherwise `undefined`.
 * Reading only `op2.re` is not enough: the real part of the complex exponent
 * `2 + i` is the integer 2, and the real part of the symbol `i` is the
 * integer 0. The `re` and `im` doubles are also rounded: the exact rational
 * `(10^20 + 1)/10^20` has `re === 2`, and an exact imaginary part that is
 * too small for a double has `im === 0`. Thus the exactness, the real type
 * and the integer type are read from the literal itself. */
export function integerExponent(e: Expression): number | undefined {
  if (!isFunction(e, 'Power')) return undefined;
  const n = e.op2;
  if (!isNumber(n) || !n.isExact || n.isComplex || n.isInteger !== true)
    return undefined;
  return Number.isSafeInteger(n.re) ? n.re : undefined;
}

/** Whether two exact complex constants are equal: `true` or `false` when
 * exact arithmetic decides it, `undefined` when it does not. `isSame()` is
 * not enough to remove duplicate poles: one number can be written in two
 * forms, for example `√i` and `√2/2 + (√2/2)i`. */
export function exactlyEqual(
  a: Expression,
  b: Expression
): boolean | undefined {
  if (a.isSame(b)) return true;
  const p = exactComplexParts(a);
  const q = exactComplexParts(b);
  if (!p || !q) return undefined;
  const x = exactSign(sub(p.x, q.x));
  if (x === 1 || x === -1) return false;
  const y = exactSign(sub(p.y, q.y));
  if (y === 1 || y === -1) return false;
  return x === 0 && y === 0 ? true : undefined;
}

const sign = exactSign;

/** The exact real and imaginary parts of a pure constant expression, or
 * `undefined` when they cannot be computed exactly.
 *
 * The callers compute the parts of the same constant many times: a pole is
 * classified, compared with the other poles, and tested for a zero numerator
 * and denominator, and each step builds a new expression that contains the
 * pole. Thus the parts are kept in a memo for each engine, keyed by the
 * structure of the expression (its hash, then `isSame()`). The memo is used
 * only for an expression whose symbols are all constants: the value of a
 * constant cannot change, so the parts stay valid. The parts of `Exp` depend
 * on the angular unit and the enclosures depend on the precision, thus both
 * are part of the key. */
export function exactComplexParts(z: Expression): Point | undefined {
  if (!z.isPure) return undefined;
  if (!hasOnlyConstantSymbols(z)) return computeExactComplexParts(z);
  const ce = z.engine;
  let memo = partsMemo.get(ce);
  if (!memo || memo.size > MAX_MEMO_SIZE) {
    memo = new Map();
    partsMemo.set(ce, memo);
  }
  const key = `${ce.angularUnit} ${ce.precision}`;
  const bucket = memo.get(z.hash);
  const hit = bucket?.find((entry) => entry.key === key && entry.z.isSame(z));
  if (hit) return hit.parts;
  const parts = computeExactComplexParts(z);
  const entry = { z, key, parts };
  if (bucket) bucket.push(entry);
  else memo.set(z.hash, [entry]);
  return parts;
}

const partsMemo = new WeakMap<
  IComputeEngine,
  Map<number, { z: Expression; key: string; parts: Point | undefined }[]>
>();

/** When the memo of an engine has more entries than this, it is cleared. */
const MAX_MEMO_SIZE = 2000;

function hasOnlyConstantSymbols(z: Expression): boolean {
  if (isSymbol(z)) return z.isConstant === true;
  if (isFunction(z)) return z.ops.every(hasOnlyConstantSymbols);
  return true;
}

function computeExactComplexParts(z: Expression): Point | undefined {
  const ce = z.engine;
  if (isFunction(z, 'Add') || isFunction(z, 'Negate')) {
    const parts = z.ops.map(exactComplexParts);
    if (parts.some((p) => !p)) return undefined;
    return {
      x: z.engine.function(
        z.operator,
        parts.map((p) => p!.x)
      ),
      y: z.engine.function(
        z.operator,
        parts.map((p) => p!.y)
      ),
    };
  }
  if (isFunction(z, 'Multiply')) {
    let product: Point | undefined;
    for (const op of z.ops) {
      const p = exactComplexParts(op);
      if (!p) return undefined;
      product = product ? multiplyPoints(product, p) : p;
    }
    return product ?? { x: ce.One, y: ce.Zero };
  }
  if (isFunction(z, 'Divide')) {
    const a = exactComplexParts(z.op1);
    const b = exactComplexParts(z.op2);
    if (!a || !b) return undefined;
    const norm = ce.function('Add', [mul(b.x, b.x), mul(b.y, b.y)]);
    if (sign(norm) !== 1) return undefined;
    const product = multiplyPoints(a, { x: b.x, y: b.y.neg() });
    return {
      x: ce.function('Divide', [product.x, norm]),
      y: ce.function('Divide', [product.y, norm]),
    };
  }
  const exponent = integerExponent(z);
  if (
    isFunction(z, 'Power') &&
    exponent !== undefined &&
    exponent >= 0 &&
    exponent <= 64
  ) {
    const base = exactComplexParts(z.op1);
    if (!base) return undefined;
    if (exponent === 0) return { x: ce.One, y: ce.Zero };
    let product = base;
    for (let i = 1; i < exponent; i++) product = multiplyPoints(product, base);
    return product;
  }
  // e^(a + ib) = e^a (cos b + i sin b). `Cos` and `Sin` read their argument
  // in the engine's angular unit, so this applies only in radians. A real
  // exponent is handled below, as an exact real constant.
  const power = isFunction(z, 'Exp')
    ? z.op1
    : isFunction(z, 'Power') && sym(z.op1) === 'ExponentialE'
      ? z.op2
      : undefined;
  if (power && ce.angularUnit === 'rad') {
    const w = exactComplexParts(power);
    if (!w) return undefined;
    if (exactSign(w.y) !== 0) {
      const modulus = ce.function('Exp', [w.x]);
      return {
        x: mul(modulus, ce.function('Cos', [w.y])),
        y: mul(modulus, ce.function('Sin', [w.y])),
      };
    }
  }
  const v = z.evaluate();
  if (!isNumber(v)) {
    // The resolver supplies a real, finite enclosure or declines. Keep the
    // exact expression, not the midpoint of its enclosure, as the coordinate.
    if (
      isExactConstantExpression(z) &&
      refineExactConstants([z], () => true) === true
    )
      return { x: z, y: ce.Zero };
    return undefined;
  }
  if (v.isFinite !== true) return undefined;
  const n = v.numericValue;
  if (typeof n === 'number')
    return Number.isSafeInteger(n) ? { x: v, y: ce.Zero } : undefined;
  if (!(n instanceof ExactNumericValue) || !n.isExact) return undefined;
  return {
    x: ce.function('Multiply', [
      ce.number(n.rational),
      ce.function('Sqrt', [ce.number(n.radical)]),
    ]),
    y: ce.function('Multiply', [
      ce.number(n.imRational),
      ce.function('Sqrt', [ce.number(n.imRadical)]),
    ]),
  };
}

/** (a.x + i·a.y)·(b.x + i·b.y), as exact real and imaginary parts. A
 * product with a factor that is the literal 0 is left out, and a factor that
 * is the literal 1 is not multiplied. */
function multiplyPoints(a: Point, b: Point): Point {
  const ce = a.x.engine;
  const xx = product(a.x, b.x);
  const yy = product(a.y, b.y);
  const xy = product(a.x, b.y);
  const yx = product(a.y, b.x);
  const x =
    xx && yy
      ? sub(xx, yy)
      : (xx ?? (yy ? ce.function('Negate', [yy]) : ce.Zero));
  const y = xy && yx ? add(xy, yx) : (xy ?? yx ?? ce.Zero);
  return { x: reduceExactly(x), y: reduceExactly(y) };
}

/** The product `u·v`, or `undefined` when a factor is the literal 0. */
function product(u: Expression, v: Expression): Expression | undefined {
  if (u.isSame(0) || v.isSame(0)) return undefined;
  if (u.isSame(1)) return v;
  if (v.isSame(1)) return u;
  return mul(u, v);
}

/** A shorter form of the exact constant `e`, with the same value. The parts
 * of a product must be reduced, or they grow with each factor of a power.
 * `simplify()` applies all the simplification rules and costs much more than
 * necessary here. An expansion followed by `evaluate()` collects the like
 * terms and the products of radicals, and both operations are exact.
 * `evaluate()` can combine √a·√b into √(a·b) with a product of sums in the
 * radicand, thus expand again until the form does not change, at most a few
 * times. */
function reduceExactly(e: Expression): Expression {
  if (isNumber(e) || isSymbol(e)) return e;
  const ce = e.engine;
  let v = ce.function('ExpandAll', [e]).evaluate();
  for (let i = 0; i < 4; i++) {
    const w = ce.function('ExpandAll', [v]).evaluate();
    if (w.isSame(v)) return w;
    v = w;
  }
  return v;
}

const point = exactComplexParts;

function sub(a: Expression, b: Expression): Expression {
  return a.engine.function('Subtract', [a, b]);
}
function add(a: Expression, b: Expression): Expression {
  return a.engine.function('Add', [a, b]);
}
function mul(a: Expression, b: Expression): Expression {
  return a.engine.function('Multiply', [a, b]);
}
function cross(a: Point, b: Point, c: Point): Sign | undefined {
  return sign(
    sub(mul(sub(b.x, a.x), sub(c.y, a.y)), mul(sub(b.y, a.y), sub(c.x, a.x)))
  );
}
function onSegment(a: Point, b: Point, p: Point): boolean | undefined {
  const c = cross(a, b, p);
  if (c === undefined) return undefined;
  if (c !== 0) return false;
  const d = sign(
    a.x.engine.function('Add', [
      mul(sub(p.x, a.x), sub(p.x, b.x)),
      mul(sub(p.y, a.y), sub(p.y, b.y)),
    ])
  );
  return d === undefined ? undefined : d <= 0;
}

function intersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point
): boolean | undefined {
  const ac = cross(a, b, c);
  const ad = cross(a, b, d);
  const ca = cross(c, d, a);
  const cb = cross(c, d, b);
  if (
    ac === undefined ||
    ad === undefined ||
    ca === undefined ||
    cb === undefined
  )
    return undefined;
  if (ac * ad < 0 && ca * cb < 0) return true;
  const touches = [
    ac === 0 ? onSegment(a, b, c) : false,
    ad === 0 ? onSegment(a, b, d) : false,
    ca === 0 ? onSegment(c, d, a) : false,
    cb === 0 ? onSegment(c, d, b) : false,
  ];
  if (touches.includes(true)) return true;
  return touches.includes(undefined) ? undefined : false;
}

/** Whether the distance from `p` to the segment from `a` to `b` is proved
 * to be larger than `e`. The nearest point of the segment is `a` or `b`,
 * except when the projection of `p` is strictly between `a` and `b`. Then
 * the nearest point is on the line through `a` and `b`, at the distance
 * |cross(b − a, p − a)| / |b − a|. */
function fartherFromSegment(a: Point, b: Point, p: Point, e: Expression) {
  const e2 = mul(e, e);
  const square = (u: Point, v: Point) =>
    add(mul(sub(u.x, v.x), sub(u.x, v.x)), mul(sub(u.y, v.y), sub(u.y, v.y)));
  if (sign(sub(square(p, a), e2)) !== 1) return false;
  if (sign(sub(square(p, b), e2)) !== 1) return false;
  const dot = (u: Point, v: Point, w: Point) =>
    add(mul(sub(w.x, u.x), sub(v.x, u.x)), mul(sub(w.y, u.y), sub(v.y, u.y)));
  const fromA = sign(dot(a, b, p));
  const fromB = sign(dot(b, a, p));
  if (fromA !== undefined && fromB !== undefined && (fromA <= 0 || fromB <= 0))
    return true;
  const c = sub(
    mul(sub(b.x, a.x), sub(p.y, a.y)),
    mul(sub(b.y, a.y), sub(p.x, a.x))
  );
  return sign(sub(mul(c, c), mul(e2, square(a, b)))) === 1;
}

function classifyPolygon(vertices: Point[], p: Point): Location {
  let winding = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const boundary = onSegment(a, b, p);
    if (boundary === undefined) return 'undetermined';
    if (boundary) return 'boundary';
    const ay = sign(sub(a.y, p.y));
    const by = sign(sub(b.y, p.y));
    const c = cross(a, b, p);
    if (ay === undefined || by === undefined || c === undefined)
      return 'undetermined';
    if (ay <= 0 && by > 0 && c > 0) winding++;
    if (ay > 0 && by <= 0 && c < 0) winding--;
  }
  return winding === 0 ? 'outside' : 'inside';
}

const invalid = (reason: string): ParsedContour => ({
  status: 'invalid-contour',
  reason,
});
const unsupported = (reason: string): ParsedContour => ({
  status: 'unsupported',
  reason,
});

/** Parse contour data separately from integration so other integration methods
 * can share the same representations and orientation conventions.
 *
 * `margin` is an optional bound on the error in the position of the poles,
 * for example the rounding of the floats in the integrand. A pole that is
 * nearer to the contour than `margin` (plus the rounding of the float
 * coordinates of the contour) is classified `undetermined`. */
export function parseContour(
  ce: IComputeEngine,
  input: ContourInput,
  variable?: string,
  margin?: Expression
): ParsedContour {
  let kind: string;
  let args: Expression[];
  let orientation: ContourOrientation | undefined;
  if (input !== null && typeof input === 'object' && 'kind' in input) {
    kind = input.kind;
    if (input.kind === 'real-line')
      return unsupported(
        'The real line is handled by the improper-integral driver.'
      );
    orientation = input.orientation;
    if (kind === 'circle') {
      const c = input as Extract<typeof input, { kind: 'circle' }>;
      args = [ce.expr(c.center), ce.expr(c.radius)];
    } else if (kind === 'rectangle') {
      const c = input as Extract<typeof input, { kind: 'rectangle' }>;
      args = [ce.expr(c.lowerLeft), ce.expr(c.upperRight)];
    } else if (kind === 'polygon') {
      const c = input as Extract<typeof input, { kind: 'polygon' }>;
      args = c.vertices.map((z) => ce.expr(z));
    } else return unsupported('Unknown contour kind.');
  } else {
    let e = ce.expr(input);
    if (e.isPure && !isFunction(e, 'Equal')) e = e.evaluate();
    if (variable && isFunction(e, 'Equal') && e.nops === 2) {
      const [lhs, rhs] = isFunction(e.op2, 'Abs')
        ? [e.op2, e.op1]
        : [e.op1, e.op2];
      if (isFunction(lhs, 'Abs') && !rhs.has(variable)) {
        // |a·z + b| = r is the circle with center −b/a and radius r/|a|,
        // when the coefficient `a` is an exact nonzero number.
        const cs = getPolynomialCoefficients(lhs.op1, variable);
        const a = cs?.length === 2 ? cs[1] : undefined;
        if (a?.isSame(1)) e = ce.function('CircleContour', [cs![0].neg(), rhs]);
        else if (a && isNumber(a) && a.isExact && !a.isSame(0))
          e = ce.function('CircleContour', [
            ce.function('Divide', [cs![0].neg(), a]).evaluate(),
            ce.function('Divide', [rhs, ce.function('Abs', [a])]).evaluate(),
          ]);
      }
    }
    if (!isFunction(e)) return unsupported('Expected a contour constructor.');
    const names: Record<string, string> = {
      CircleContour: 'circle',
      PolygonContour: 'polygon',
      RectangleContour: 'rectangle',
    };
    kind = names[e.operator];
    if (!kind) return unsupported('Unknown contour constructor.');
    const arity = kind === 'polygon' ? 1 : 2;
    if (e.nops !== arity && e.nops !== arity + 1)
      return invalid('Incorrect contour constructor arity.');
    const direction = e.ops[arity];
    if (direction) {
      if (direction.isSame(1)) orientation = 'counterclockwise';
      else if (direction.isSame(-1)) orientation = 'clockwise';
      else return invalid('Orientation must be +1 or -1.');
    }
    if (kind === 'polygon') {
      if (!isFunction(e.op1, 'List'))
        return invalid('Polygon vertices must be a List.');
      args = [...e.op1.ops];
    } else args = e.ops.slice(0, 2);
  }
  if (
    orientation !== undefined &&
    orientation !== 'clockwise' &&
    orientation !== 'counterclockwise'
  )
    return invalid('Unknown contour orientation.');
  if (args.some((e) => !e.isValid || !e.isPure))
    return invalid('Contour coordinates must be valid, pure expressions.');
  // A float coordinate is read as the exact rational value that it holds.
  // `rounding` is the sum of the rounding bounds of these floats: when every
  // float moves by at most its bound, no point of the contour moves farther
  // than `rounding`. The `margin` of the caller is added to it.
  const floats = args.map(exactValueOfFloat);
  const inexact = floats.some((f) => f !== undefined);
  let rounding: Expression | undefined;
  if (inexact || margin) {
    args = args.map((z, i) => floats[i]?.value ?? z);
    rounding = ce
      .function('Add', [
        ...floats.filter((f) => f !== undefined).map((f) => f.bound),
        ...(margin ? [margin] : []),
      ])
      .evaluate();
  }
  const points = args.map(point);
  if (points.some((p) => p === undefined))
    return unsupported(
      'Contour coordinates require finite exact numeric values.'
    );
  const ps = points as Point[];
  if (kind === 'circle') {
    const imaginary = sign(ps[1].y);
    const positive = sign(ps[1].x);
    if (imaginary === undefined || positive === undefined)
      return unsupported('A positive real radius could not be established.');
    if (imaginary !== 0 || positive !== 1)
      return invalid('A circle requires a positive real radius.');
    const center = ps[0];
    const radius = ps[1].x;
    return {
      ...(inexact ? { inexact } : {}),
      contour: {
        kind,
        center: args[0],
        radius,
        orientation: orientation ?? 'counterclockwise',
      },
      realBounds: [
        sub(center.x, rounding ? add(radius, rounding) : radius),
        ce.function('Add', [center.x, radius, ...(rounding ? [rounding] : [])]),
      ],
      classify: (z) => {
        const p = point(z);
        if (!p) return 'undetermined';
        const dx = sub(p.x, center.x);
        const dy = sub(p.y, center.y);
        const d2 = ce.function('Add', [mul(dx, dx), mul(dy, dy)]);
        const s = sign(sub(d2, mul(radius, radius)));
        if (s === undefined) return 'undetermined';
        if (s === 0) return 'boundary';
        // With float coordinates, the distance d from the pole to the center
        // must differ from the radius r by more than the rounding e:
        // d < r − e inside, and d > r + e outside. Compare the squares.
        if (rounding) {
          const r = s < 0 ? sub(radius, rounding) : add(radius, rounding);
          if (s < 0 && sign(r) !== 1) return 'undetermined';
          if (sign(sub(d2, mul(r, r))) !== s) return 'undetermined';
        }
        return s < 0 ? 'inside' : 'outside';
      },
    };
  }
  if (kind === 'rectangle') {
    const [a, b] = ps;
    const width = sign(sub(b.x, a.x));
    const height = sign(sub(b.y, a.y));
    if (width === undefined || height === undefined)
      return unsupported(
        'Positive rectangle dimensions could not be established.'
      );
    if (width !== 1 || height !== 1)
      return invalid(
        'Rectangle corners must define positive width and height.'
      );
    ps.splice(0, ps.length, a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y });
    args = ps.map((p) => ce.function('Add', [p.x, mul(ce.I, p.y)]));
    orientation ??= 'counterclockwise';
  }
  // Accept an explicitly repeated closing vertex, but no degenerate edges.
  if (args.length > 1 && args[0].isSame(args[args.length - 1])) {
    args.pop();
    ps.pop();
  }
  if (ps.length < 3 || ps.length > 128)
    return invalid('A polygon requires 3 to 128 vertices.');
  // A vertex in the middle of a straight edge does not change the contour:
  // its neighbors are collinear with it, and it lies strictly between them.
  // Remove it, so that the check below rejects only a repeated vertex or an
  // edge that turns back on itself.
  for (let i = 0; ps.length > 3 && i < ps.length;) {
    checkDeadline(ce._deadlineFrame);
    const a = ps[(i + ps.length - 1) % ps.length];
    const b = ps[i];
    const c = ps[(i + 1) % ps.length];
    const straight =
      cross(a, b, c) === 0 &&
      sign(
        ce.function('Add', [
          mul(sub(b.x, a.x), sub(c.x, b.x)),
          mul(sub(b.y, a.y), sub(c.y, b.y)),
        ])
      ) === 1;
    if (straight) {
      ps.splice(i, 1);
      args.splice(i, 1);
    } else i++;
  }
  for (let i = 0; i < ps.length; i++) {
    checkDeadline(ce._deadlineFrame);
    const turn = cross(ps[i], ps[(i + 1) % ps.length], ps[(i + 2) % ps.length]);
    if (turn === undefined)
      return unsupported('Polygon geometry cannot be decided exactly.');
    if (turn === 0)
      return invalid(
        'A polygon must not repeat a vertex or turn back along an edge.'
      );
    for (let j = i + 2; j < ps.length; j++) {
      checkDeadline(ce._deadlineFrame);
      if (i === 0 && j === ps.length - 1) continue;
      const hit = intersect(
        ps[i],
        ps[(i + 1) % ps.length],
        ps[j],
        ps[(j + 1) % ps.length]
      );
      if (hit === undefined)
        return unsupported('Polygon intersections cannot be decided exactly.');
      if (hit)
        return invalid(
          'The polygon must be simple (no crossing or touching edges).'
        );
    }
  }
  const area = sign(
    ce.function(
      'Add',
      ps.map((p, i) => {
        const q = ps[(i + 1) % ps.length];
        return sub(mul(p.x, q.y), mul(p.y, q.x));
      })
    )
  );
  if (area === undefined)
    return unsupported('Polygon orientation cannot be decided exactly.');
  if (area === 0) return invalid('The polygon must have nonzero area.');
  return {
    ...(inexact ? { inexact } : {}),
    contour: {
      kind: 'polygon',
      vertices: args,
      orientation: orientation ?? (area > 0 ? 'counterclockwise' : 'clockwise'),
    },
    realBounds: rounding
      ? ps.flatMap((p) => [sub(p.x, rounding), add(p.x, rounding)])
      : ps.map((p) => p.x),
    classify: (z) => {
      const p = point(z);
      if (!p) return 'undetermined';
      const location = classifyPolygon(ps, p);
      // With float coordinates, a pole inside or outside must be farther
      // than the rounding from every edge.
      if (rounding && (location === 'inside' || location === 'outside'))
        for (let i = 0; i < ps.length; i++) {
          checkDeadline(ce._deadlineFrame);
          const a = ps[i];
          const b = ps[(i + 1) % ps.length];
          if (!fartherFromSegment(a, b, p, rounding)) return 'undetermined';
        }
      return location;
    },
  };
}

/** Whether `z` is a finite number literal that is not exact (a float). */
function isFiniteFloat(z: Expression): boolean {
  return isNumber(z) && !z.isExact && z.isFinite === true;
}

/** The exact value of the float literal `z`, as an exact complex number
 * whose real and imaginary parts are rationals, and a bound on the
 * distance from this value to the value that the float stands for. A double
 * is a binary fraction `m·2^-k` and a big decimal is
 * `significand·10^exponent`, so both are exact rationals. `undefined` when
 * `z` is not a finite float.
 *
 * The bound is `(|x| + |y|)·2^-52` for the parts `x` and `y`. A float stands
 * for any value that rounds to its double, which is at most half a unit in
 * the last place (`|x|·2^-53`) from the double. The decimal digits that the
 * literal holds are at most half a unit in the last place from that double.
 * The sum of the two is at most `|x|·2^-52`. */
export function exactValueOfFloat(
  z: Expression
): { value: Expression; bound: Expression } | undefined {
  if (!isNumber(z) || !isFiniteFloat(z)) return undefined;
  const ce = z.engine;
  const n = z.numericValue;
  const re = exactRational(typeof n === 'number' ? n : (n.bignumRe ?? n.re));
  const im = exactRational(typeof n === 'number' ? 0 : (n.bignumIm ?? n.im));
  if (!re || !im) return undefined;
  const ulp = (r: [bigint, bigint]) =>
    ce.number([r[0] < 0n ? -r[0] : r[0], r[1] * 2n ** 52n]);
  const bound = ce.function('Add', [ulp(re), ulp(im)]).evaluate();
  if (im[0] === 0n) return { value: ce.number(re), bound };
  return {
    value: ce.function('Add', [
      ce.number(re),
      ce.function('Multiply', [ce.number(im), ce.I]),
    ]),
    bound,
  };
}

/** The exact rational `[numerator, denominator]` of a finite double or big
 * decimal, or `undefined` when the value is not finite. */
function exactRational(y: number | BigDecimal): [bigint, bigint] | undefined {
  if (typeof y === 'number') {
    if (!Number.isFinite(y)) return undefined;
    // Doubling a double is exact until the double is an integer: at most
    // 1074 steps, for the smallest subnormal double.
    let m = y;
    let k = 0;
    while (!Number.isInteger(m)) {
      m *= 2;
      k += 1;
    }
    return [BigInt(m), 2n ** BigInt(k)];
  }
  if (!y.isFinite()) return undefined;
  const e = y.exponent;
  return e >= 0
    ? [y.significand * 10n ** BigInt(e), 1n]
    : [y.significand, 10n ** BigInt(-e)];
}
