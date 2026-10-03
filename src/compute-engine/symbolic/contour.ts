import type { Expression, IComputeEngine } from '../global-types.js';
import type {
  ContourInput,
  ContourOrientation,
  ContourPole,
  NormalizedContour,
} from '../types-contour.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
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
    }
  | { status: 'invalid-contour' | 'unsupported'; reason: string };

/** Exact arithmetic proves equality; disjoint resolver bounds prove strict
 * signs under CE's error model. Never use the resolver's narrow-at-limit tie:
 * even a tiny nonzero distance must not be rounded onto the contour. */
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
  const v = e.simplify().evaluate();
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

const sign = exactSign;

export function exactComplexParts(z: Expression): Point | undefined {
  if (!z.isPure) return undefined;
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
    let product: Point = { x: ce.One, y: ce.Zero };
    for (const op of z.ops) {
      const p = exactComplexParts(op);
      if (!p) return undefined;
      product = multiplyPoints(product, p);
    }
    return product;
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
  if (
    isFunction(z, 'Power') &&
    Number.isSafeInteger(z.op2.re) &&
    z.op2.re >= 0 &&
    z.op2.re <= 64
  ) {
    const base = exactComplexParts(z.op1);
    if (!base) return undefined;
    let product: Point = { x: ce.One, y: ce.Zero };
    for (let i = 0; i < z.op2.re; i++) product = multiplyPoints(product, base);
    return product;
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

function multiplyPoints(a: Point, b: Point): Point {
  return {
    x: sub(mul(a.x, b.x), mul(a.y, b.y)).simplify(),
    y: a.x.engine.function('Add', [mul(a.x, b.y), mul(a.y, b.x)]).simplify(),
  };
}

const point = exactComplexParts;

function sub(a: Expression, b: Expression): Expression {
  return a.engine.function('Subtract', [a, b]);
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
 * can share the same representations and orientation conventions. */
export function parseContour(
  ce: IComputeEngine,
  input: ContourInput,
  variable?: string
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
        const cs = getPolynomialCoefficients(lhs.op1, variable);
        if (cs?.length === 2 && cs[1].isSame(1))
          e = ce.function('CircleContour', [cs[0].neg(), rhs]);
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
      contour: {
        kind,
        center: args[0],
        radius,
        orientation: orientation ?? 'counterclockwise',
      },
      realBounds: [
        sub(center.x, radius),
        ce.function('Add', [center.x, radius]),
      ],
      classify: (z) => {
        const p = point(z);
        if (!p) return 'undetermined';
        const dx = sub(p.x, center.x);
        const dy = sub(p.y, center.y);
        const s = sign(
          sub(
            ce.function('Add', [mul(dx, dx), mul(dy, dy)]),
            mul(radius, radius)
          )
        );
        return s === undefined
          ? 'undetermined'
          : s === 0
            ? 'boundary'
            : s < 0
              ? 'inside'
              : 'outside';
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
  for (let i = 0; i < ps.length; i++) {
    checkDeadline(ce._deadlineFrame);
    const turn = cross(ps[i], ps[(i + 1) % ps.length], ps[(i + 2) % ps.length]);
    if (turn === undefined)
      return unsupported('Polygon geometry cannot be decided exactly.');
    if (turn === 0)
      return invalid(
        'Adjacent polygon edges must be nondegenerate and noncollinear.'
      );
    for (let j = i + 2; j < ps.length; j++) {
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
    contour: {
      kind: 'polygon',
      vertices: args,
      orientation: orientation ?? (area > 0 ? 'counterclockwise' : 'clockwise'),
    },
    realBounds: ps.map((p) => p.x),
    classify: (z) => {
      const p = point(z);
      return p ? classifyPolygon(ps, p) : 'undetermined';
    },
  };
}
