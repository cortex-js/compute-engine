/**
 * CE-1736: compiled JavaScript builds a list of lists of run-time length in
 * the program (README of `src/compute-engine/compilation/ir/`, "The rows
 * lane"; `docs/COMPILATION-MODEL.md`, "Lists of two run-time lengths").
 *
 * A `Map` (or a `Comprehension`) whose element is a flat list of real or
 * integer numbers of run-time length builds the lane `rows` (the region
 * `rows.build`); a `Filter` of rows keeps them (`rows.filter`). The value
 * is read by the readers of the rows of an input (`Length`, `Count`, `Map`,
 * `At(At(v, i), j)`, `Flatten`, `Reduce`, `Fold`), is the result of the
 * program (`rows: true`), the value of a local, the result of a user
 * function, an operand of `If` or `Coalesce`, and a value that a `Loop`, a
 * `Reduce` or a `Fold` carries (step 2), an element of a list literal, a
 * join and an `Append` (step 3), and, when its rows have one length, an
 * operand of `Transpose`, `MatrixMultiply` and `Trace` (step 4).
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import type { Expression } from '../../src/compute-engine/global-types';

type Json = unknown;
type Grid = number[][];
type Point = { n: number; g: Grid; h: Grid; c: boolean; P: number[] };

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('c', 'boolean');
ce.declare('g', 'list<list<integer>>');
ce.declare('h', 'list<list<real>>');
ce.declare('P', 'list<integer>');
const defined = executeEpsil(
  ce,
  `step(g: list<list<integer>>) = map(r => map(x => x + 1, r), g)
tri(n: integer) = map(i => Range(1, i, 1), Range(1, n, 1))
half(g: list<list<integer>>) = map(r => map(x => x / 2, r), g)`
);
if (defined.diagnostics.some((d) => d.severity === 'error'))
  throw new Error(defined.diagnostics.map((d) => d.message).join());

const box = (json: Json): Expression => ce.box(json as never);
const F = (body: Json, ...params: string[]) => [
  'Function',
  body,
  ...(params.length > 0 ? params : ['i']),
];

/** The interpreter's value: a collection is an array (a `Map` is lazy). */
function read(e: Expression): unknown {
  if (e.symbol === 'True' || e.symbol === 'False') return e.symbol === 'True';
  if (e.isCollection) return [...e.each()].map(read);
  return e.N().re;
}

const list = (g: Grid) => box(['List', ...g.map((r) => ['List', ...r])]);

function interpreted(json: Json, p: Point): unknown {
  const values = {
    n: ce.number(p.n),
    c: p.c ? ce.True : ce.False,
    g: list(p.g),
    h: list(p.h),
    P: box(['List', ...p.P]),
  };
  return ce.withValues(values as never, () => read(box(json).evaluate()));
}

/** `v` and `w` have one shape and agree within 1e-12. */
function agree(v: unknown, w: unknown): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x))
    );
  if (typeof w === 'boolean') return v === w;
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    (Math.abs(v - w) <= 1e-12 * Math.max(1, Math.abs(w)) ||
      (Number.isNaN(v) && Number.isNaN(w)))
  );
}

// A count of 0, 1 and several; an empty row, a row of one, longer rows.
const POINTS: Point[] = [0, 1, 3].flatMap((n) => [
  { n, g: [], h: [], c: true, P: [] },
  { n, g: [[1, 2], [3], []], h: [[0.5], [], [1.25, -2]], c: false, P: [4] },
  { n, g: [[], [4, 5, 6], [7]], h: [[2.5, 3]], c: true, P: [-1, 2, 5] },
]);

function check(json: Json, options: object = {}) {
  const r = compile(box(json), { fallback: false, ...options });
  expect(r.success).toBe(true);
  for (const p of POINTS) {
    const got = r.run!(p as never);
    const want = interpreted(json, p);
    if (!agree(got, want))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return r;
}

/** The message of the decline of `json`. */
function declined(json: Json, options: object = {}): string {
  const r = compile(box(json), { ...options, fallback: false } as never);
  return r.success ? '' : (r.diagnostic?.message ?? '');
}
function declines(json: Json, options: object = {}): string {
  try {
    return declined(json, options);
  } catch (x) {
    return (
      (x as { diagnostic?: { message: string } }).diagnostic?.message ??
      (x as Error).message
    );
  }
}

// `Range(1, n, 1)` is empty at n = 0 (`Range(1, 0)` is `[1, 0]`); the row
// `Range(1, i - 1, 1)` is empty at i = 1.
const count = ['Range', 1, 'n', 1];
const tri = ['Map', F(['Range', 1, ['Subtract', 'i', 1], 1]), count];
const halves = [
  'Map',
  F(['Map', F(['Divide', 'j', 2], 'j'), ['Range', 1, 'i', 1]]),
  count,
];
const inc = ['Map', F(['Map', F(['Add', 'x', 1], 'x'), 'r'], 'r'), 'g'];
const long = F(['Greater', ['Length', 'r'], 1], 'r');
const kept = ['Filter', 'g', long];

describe('CE-1736: the rows that the program makes, as the result', () => {
  // prettier-ignore
  test.each([
    ['Map of a Range of integers', tri],
    ['Map of a Map of reals', halves],
    ['Map over the rows of an input', inc],
    ['Map over the rows of a real input', ['Map', F(['Map', F(['Multiply', 'x', 3], 'x'), 'r'], 'r'), 'h']],
    ['Map that yields each row', ['Map', F('r', 'r'), 'g']],
    ['Map of a built value', ['Map', F(['Map', F(['Add', 'x', 'n'], 'x'), 'r'], 'r'), tri]],
    ['Filter of an input', kept],
    ['Filter of a built value', ['Filter', tri, long]],
    ['Comprehension', ['Comprehension', ['Range', 1, 'i', 1], ['Element', 'i', count]]],
    ['Comprehension with a condition', ['Comprehension', 'r', ['Element', 'r', 'g', ['Greater', ['Length', 'r'], 0]]]],
    ['a user function', ['step', 'g']],
    ['a user function of its own result', ['step', ['step', 'g']]],
    ['a user function of reals', ['half', 'g']],
    ['a user function of a count', ['tri', 'n']],
    ['the value of a local', ['Block', ['Declare', 't', "'unknown'", tri], 't']],
    ['If of a built value and an input', ['If', 'c', tri, 'g']],
    ['If of reals and integers', ['If', 'c', ['Map', F(['Divide', 'r', 2], 'r'), 'g'], 'g']],
    ['Coalesce of a built value', ['Coalesce', tri, 'g']],
    ['Repeat of a run-time Range', ['Repeat', count, 2]],
    ['Reverse', ['Reverse', tri]],
    ['Take', ['Take', tri, 2]],
    ['the input itself', 'g'],
  ])('%s', (_, json) => {
    const r = check(json);
    expect(r).toMatchObject({ rows: true, shippable: false });
  });
});

describe('CE-1736: the readers of the rows that the program makes', () => {
  // prettier-ignore
  test.each([
    ['Length', ['Length', tri]],
    ['Count', ['Count', inc]],
    ['Map to the length of each row', ['Map', F(['Length', 'r'], 'r'), tri]],
    ['Map to the sum of each row', ['Map', F(['Sum', 'r'], 'r'), halves]],
    ['an element', ['At', ['At', inc, 2], 1]],
    ['an element out of range', ['At', ['At', tri, 9], 1]],
    ['an element of a user function result', ['At', ['At', ['step', 'g'], 1], 2]],
    ['Length of a user function result', ['Length', ['step', 'g']]],
    ['Map of a user function result', ['Map', F(['Sum', 'r'], 'r'), ['tri', 'n']]],
    ['Flatten', ['Flatten', tri]],
    ['Flatten of reals', ['Flatten', halves]],
    ['Flatten of a Map of an input', ['Flatten', ['Map', F('r', 'r'), 'g']]],
    ['Fold of the lengths', ['Fold', F(['Add', 'a', ['Length', 'b']], 'a', 'b'), 0, tri]],
    ['Reduce of the sums', ['Reduce', tri, F(['Add', 'a', ['Sum', 'b']], 'a', 'b'), 0]],
    ['Any', ['Any', tri, long]],
    ['FlatMap of rows of run-time lengths', ['FlatMap', count, F(['Range', 1, 't', 1], 't')]],
    ['IsMissing of a row past the end', ['IsMissing', ['At', kept, 3]]],
    ['Length of a Coalesce of an absent row', ['Length', ['Coalesce', ['At', tri, 9], ['List', 7, 8]]]],
    ['Length of a local', ['Block', ['Declare', 't', "'unknown'", tri], ['Length', 't']]],
    ['Map of a local', ['Block', ['Declare', 't', "'unknown'", tri], ['Map', F(['Length', 'r'], 'r'), 't']]],
    ['Length of an If', ['Length', ['If', 'c', tri, inc]]],
  ])('%s', (_, json) => {
    const r = check(json);
    expect(r.rows).toBeUndefined();
  });
});

describe('CE-1736: rows of a constant length keep the rank 2', () => {
  test('a Map of a Map of constant counts is a matrix', () => {
    const json = [
      'Map',
      F(['Map', F(['Add', 'i', 'j'], 'j'), ['Range', 1, 3]]),
      ['Range', 1, 2],
    ];
    const r = check(json);
    expect(r.rows).toBeUndefined();
    expect(r.code).not.toMatch(/rows/);
  });
});

// Step 2: a loop carries the rows, and a local of the rows is written again.
const step = (t: string) => [
  'Map',
  F(['Map', F(['Add', 'x', 1], 'x'), 'r'], 'r'),
  t,
];
const halve = (t: string) => [
  'Map',
  F(['Map', F(['Divide', 'x', 2], 'x'), 'r'], 'r'),
  t,
];
/** `t := start`, then `t := body` `n` times, then `tail`. */
const rebound = (
  body: Json,
  start: Json = ['Map', F('r', 'r'), 'g'],
  tail: Json = 't'
) => [
  'Block',
  ['Declare', 't', "'unknown'", start],
  ['Loop', ['Assign', 't', body], ['Element', 'j', count]],
  tail,
];
ce.declare('iter', '(list<list<integer>>, integer) -> list<list<integer>>');
ce.assign(
  'iter',
  box(F(rebound(step('t'), ['Map', F('r', 'r'), 'u']), 'u', 'n'))
);

describe('CE-1736: a loop carries the rows', () => {
  // prettier-ignore
  test.each([
    ['Fold by a user function', ['Fold', F(['step', 'a'], 'a', 'i'), 'g', count], true],
    ['Fold by a Map', ['Fold', F(step('a'), 'a', 'i'), 'g', count], true],
    ['Fold of integers to reals', ['Fold', F(halve('a'), 'a', 'i'), 'g', count], true],
    ['Fold of reals', ['Fold', F(step('a'), 'a', 'i'), 'h', count], true],
    ['Fold by a Filter', ['Fold', F(['Filter', 'a', F(['Greater', ['Length', 'r'], 'i'], 'r')], 'a', 'i'), 'g', count], true],
    ['Reduce whose step reads the element', ['Reduce', count, F(['Map', F(['Map', F(['Add', 'x', 'i'], 'x'), 'r'], 'r'), 'a'], 'a', 'i'), 'g'], true],
    ['Fold from a built value', ['Fold', F(step('a'), 'a', 'i'), tri, count], true],
    ['Length of a Fold', ['Length', ['Fold', F(step('a'), 'a', 'i'), 'g', count]], false],
    ['a Loop by a user function', rebound(['step', 't']), true],
    ['a Loop by a Map', rebound(step('t')), true],
    ['a Loop of integers to reals', rebound(halve('t')), true],
    ['a Loop from an input', rebound(step('t'), 'g'), true],
    ['a Loop from a built value', rebound(step('t'), tri), true],
    ['a Loop by a Filter', rebound(['Filter', 't', F(['Greater', ['Length', 'r'], 'j'], 'r')]), true],
    ['a Loop by an If', rebound(['If', ['Greater', 'j', 1], step('t'), 'g']), true],
    ['Length after a Loop', rebound(step('t'), 'g', ['Length', 't']), false],
    ['an element after a Loop', rebound(step('t'), 'g', ['At', ['At', 't', 1], 1]), false],
    ['Flatten after a Loop', rebound(step('t'), 'g', ['Flatten', 't']), false],
    ['nested Loops', ['Block', ['Declare', 't', "'unknown'", 'g'], ['Loop', ['Loop', ['Assign', 't', step('t')], ['Element', 'q', ['Range', 1, 2]]], ['Element', 'j', count]], 't'], true],
    ['a Loop with a Break', ['Block', ['Declare', 't', "'unknown'", 'g'], ['Loop', ['Block', ['If', ['Greater', 'j', 'n'], ['Break'], 'Nothing'], ['Assign', 't', step('t')]], ['Element', 'j', ['Range', 1, 5]]], 't'], true],
    ['two locals of the rows', ['Block', ['Declare', 't', "'unknown'", 'g'], ['Declare', 'u', "'unknown'", 'g'], ['Loop', ['Block', ['Assign', 't', step('u')], ['Assign', 'u', 't']], ['Element', 'j', count]], ['Tuple', ['Length', 't'], ['Length', 'u']]], false],
    ['a user function with a Loop', ['iter', 'g', 'n'], true],
    ['a user function of its own result', ['iter', ['iter', 'g', 'n'], 2], true],
    ['a write of a local of the rows', ['Block', ['Declare', 't', "'unknown'", 'g'], ['Assign', 't', step('t')], 't'], true],
    ['a write of reals to a local of integers', ['Block', ['Declare', 't', "'unknown'", 'g'], ['Assign', 't', halve('t')], 't'], true],
    ['a write in an If', ['Block', ['Declare', 't', "'unknown'", 'g'], ['If', ['Greater', 'n', 1], ['Assign', 't', step('t')], 'Nothing'], 't'], true],
  ] as [string, Json, boolean][])('%s', (_, json, rows) => {
    const r = check(json);
    expect(r.rows).toBe(rows ? true : undefined);
  });
});

// Step 3: rows made by a `List` literal, `Join`, `ListJoin`, `Append`, and a
// `Fold` from `List()`.
const joined = F(['Join', 'a', ['List', ['Range', 1, 'i', 1]]], 'a', 'i');

describe('CE-1736: rows made by a List literal, Join and Append', () => {
  // prettier-ignore
  test.each([
    ['a List literal of a Map and a List', ['List', ['Map', F(['Add', 'i', 1]), 'P'], ['List', ['Length', 'P']]], true],
    ['a List literal of a Range and a List', ['List', count, ['List', 1, 2]], true],
    ['a List literal of one Range', ['List', count], true],
    ['a List literal of reals and integers', ['List', ['Map', F(['Divide', 'i', 2]), count], 'P'], true],
    ['Map of a List literal', ['Map', F(['Sum', 'r'], 'r'), ['List', 'P', count]], false],
    ['Flatten of a List literal', ['Flatten', ['List', 'P', count]], false],
    ['Join of the rows and a List of a row', ['Join', 'g', ['List', count]], true],
    ['Join of the rows and a List of a row of constant length', ['Join', 'g', ['List', ['List', 1, 2]]], true],
    ['Join of two inputs', ['Join', 'g', 'h'], true],
    ['ListJoin of two built values', ['ListJoin', tri, inc], true],
    ['Append of a row', ['Append', 'g', count], true],
    ['Append of two rows to a built value', ['Append', tri, count, ['List', 'n']], true],
    ['Length of an Append', ['Length', ['Append', 'g', count]], false],
    ['Fold from List() by a Join', ['Fold', joined, ['List'], count], true],
    ['Length of a Fold from List()', ['Length', ['Fold', joined, ['List'], count]], false],
    ['Fold from List() of reals', ['Fold', F(['Join', 'a', ['List', ['Map', F(['Divide', 'j', 2], 'j'), ['Range', 1, 'i', 1]]]], 'a', 'i'), ['List'], count], true],
    ['Fold from List() by an Append', ['Fold', F(['Append', 'a', ['Range', 1, 'i', 1]], 'a', 'i'), ['List'], count], true],
    ['Fold from the rows by a Join', ['Fold', joined, 'g', count], true],
    ['a Loop that appends a row', ['Block', ['Declare', 't', "'unknown'", 'g'], ['Loop', ['Assign', 't', ['Join', 't', ['List', ['Range', 1, 'j', 1]]]], ['Element', 'j', count]], 't'], true],
    // A write of reals to a local of rows of integers in the step: the
    // program is lowered again with the local on the real lane.
    ['Fold from List() whose step widens a local', ['Fold', F(['Block', ['Declare', 't', "'unknown'", 'g'], ['Assign', 't', halve('t')], ['Join', 'a', 't']], 'a', 'i'), ['List'], count], true],
  ] as [string, Json, boolean][])('%s', (_, json, rows) => {
    const r = check(json);
    expect(r.rows).toBe(rows ? true : undefined);
  });

  test('a List literal of rows of constant lengths keeps its code', () => {
    const r = check(['List', ['List', 'n', 1], ['List', 2]]);
    expect(r.rows).toBeUndefined();
    expect(r.code).not.toMatch(/rows/);
  });
});

describe('CE-1736: what declines', () => {
  // prettier-ignore
  test.each([
    ['a Fold from the rows whose step is not rows', ['Fold', F(['Length', 'a'], 'a', 'i'), 'g', count], /Reduce from a list of lists of run-time length by a function whose value is not one/],
    ['Scan of the rows', ['Scan', count, F(['Map', F('r', 'r'), 'a'], 'a', 'i'), 'g'], /g of type list<list<integer>> other than/],
    ['a List literal of a row of run-time length and a scalar', ['List', count, 'n'], /a record with a field of a run-time length/],
    ['a List literal of rows of booleans', ['List', count, ['List', 'c']], /a list of lists of run-time length of booleans/],
    ['a List literal of an absent row', ['List', ['At', 'g', 'n'], ['List', 1]], /a row at an index known at run time as an element of a list/],
    ['a Join of the rows and a flat list', ['Join', 'g', 'P'], /an operand of Join of a list of lists of run-time length that is not a list of lists of numbers/],
    ['an Append of a scalar to the rows', ['Append', 'g', 'n'], /an element of Append of a list of lists of run-time length that is not a flat list of numbers/],
    ['a parallel write of a local of the rows', ['Block', ['Declare', 't', "'unknown'", 'g'], ['Declare', 'm', "'unknown'", 0], ['Assign', ['Tuple', 't', 'm'], ['Tuple', step('t'), 1]], 't'], /a parallel write of t, a local that holds a list of lists of run-time length/],
    ['Transpose', ['Transpose', tri], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['MatrixMultiply', ['MatrixMultiply', tri, tri], /MatrixMultiply of a list of lists of run-time length/],
    ['Determinant', ['Determinant', tri], /Determinant of a list of lists of run-time length/],
    ['rows of booleans', ['Map', F(['Map', F(['Greater', 'j', 1], 'j'), ['Range', 1, 'i']]), count], /a list of lists of run-time length of booleans/],
    ['rows of complex numbers', ['Map', F(['Map', F(['Multiply', 'j', 'ImaginaryUnit'], 'j'), ['Range', 1, 'i']]), count], /a list of lists of run-time length of complex numbers/],
    ['rows of points', ['Map', F(['Map', F(['Tuple', 'j', 'j'], 'j'), ['Range', 1, 'i']]), count], /a list of lists of run-time length/],
    ['a list of rows of run-time length (rank 3)', ['Map', F(tri, 'k'), count], /a list of lists of run-time length read whole/],
    ['an arithmetic operand', ['Add', tri, 1], /a list of lists of run-time length read whole other than by a reader of its rows/],
    ['Sort', ['Sort', tri], /a list of lists of run-time length read whole/],
    ['a Tuple', ['Tuple', tri, 'n'], /a list of lists of run-time length read whole/],
    ['a row at a run-time index as an element', ['Map', F(['At', 'g', 'i']), count], /a row at an index known at run time as an element of a list/],
  ])('%s', (_, json, cause) => {
    expect(declines(json)).toMatch(cause);
  });

  test.each([
    ['GLSL', { to: 'glsl' }],
    ['the interval mode', { to: 'interval-js' }],
    ['the bigint mode', { mode: 'bigint' }],
  ])('%s', (_, options) => {
    expect(declines(tri, options)).toMatch(
      /a list of lists of run-time length \(JavaScript only, outside the interval and the bigint modes\)/
    );
  });
});

// Step 4: a table whose rows have one length (`rowWidths`), read by
// `Transpose`, `MatrixMultiply` and `Trace`. The interpreter leaves these
// operators of a lazy `Map` unevaluated, so its value is that of the form
// whose tables and vectors are listed (`ListFrom`); of an empty table it
// has none.
ce.declare('m', 'integer');
const listed = (x: Json) => ['ListFrom', x];
const same = (x: Json) => x;
/** The n × m table whose element at (i, j) is i + 10j. */
const nm = [
  'Map',
  F(['Map', F(['Add', 'i', ['Multiply', 10, 'j']], 'j'), ['Range', 1, 'm', 1]]),
  count,
];
/** The n × n table of the census, whose element at (i, j) is i + j. */
const census = [
  'Map',
  F(['Map', F(['Add', 'i', 'j'], 'j'), ['Range', 1, 'n']]),
  ['Range', 1, 'n'],
];
const twice = (t: Json) => [
  'Map',
  F(['Map', F(['Multiply', 2, 'x'], 'x'), 'r'], 'r'),
  t,
];
ce.declare('square', '(integer) -> list<list<integer>>');
ce.assign('square', box(F(census, 'n')));
const SIZES = [
  { n: 2, m: 3 },
  { n: 3, m: 2 },
  { n: 1, m: 1 },
];

describe('CE-1736: the matrix operators of a table whose rows have one length', () => {
  // prettier-ignore
  test.each([
    ['Transpose of an n × m table', (w) => ['Transpose', w(nm)], true],
    ['ConjugateTranspose of an n × m table', (w) => ['ConjugateTranspose', w(nm)], true],
    ['Transpose of a local', (w) => ['Block', ['Declare', 't', "'unknown'", w(nm)], ['Transpose', 't']], true],
    ['Transpose of a Transpose', (w) => ['Transpose', ['Transpose', w(nm)]], true],
    ['Transpose of a Map of each element', (w) => ['Transpose', w(twice(nm))], true],
    ['Transpose of a Filter', (w) => ['Transpose', w(['Filter', nm, F(['Greater', ['Mod', ['At', 'r', 1], 2], 0], 'r')])], true],
    ['the census table times itself', (w) => ['MatrixMultiply', w(census), w(census)], true],
    ['a Map of the census table times it', (w) => ['MatrixMultiply', w(twice(census)), w(census)], true],
    ['a table times its transpose', (w) => ['MatrixMultiply', w(nm), w(['Transpose', nm])], true],
    ['a table times a vector', (w) => ['MatrixMultiply', w(nm), w(['Range', 1, 'm', 1])], false],
    ['a vector times a table', (w) => ['MatrixMultiply', w(count), w(nm)], false],
    ['a table times a matrix of rows of a constant length', (w) => ['MatrixMultiply', w(nm), w(['Map', F(['List', 'i', ['Multiply', 2, 'i']]), ['Range', 1, 'm', 1]])], false],
    ['Trace of the census table', (w) => ['Trace', w(census)], false],
  ] as [string, (w: (x: Json) => Json) => Json, boolean][])('%s', (_, form, rows) => {
    const r = compile(box(form(same)), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.rows).toBe(rows ? true : undefined);
    for (const p of SIZES) {
      const got = r.run!(p as never);
      const want = ce.withValues(
        { n: ce.number(p.n), m: ce.number(p.m) } as never,
        () => read(box(form(listed)).evaluate())
      );
      if (!agree(got, want))
        throw new Error(
          `at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
        );
    }
  });

  // A table of no row or of rows of no element has no pinned value: the
  // interpreter leaves the operator unevaluated there
  // (`docs/COMPILATION-MODEL.md`, "Known limitations").

  // prettier-ignore
  test.each([
    ['a ragged table', ['Transpose', tri], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a product of ragged tables', ['MatrixMultiply', tri, tri], /MatrixMultiply of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['an input', ['Transpose', 'g'], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a product of an input', ['MatrixMultiply', 'h', nm], /MatrixMultiply of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a value after an If', ['Transpose', ['If', 'c', nm, nm]], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a value after a Loop', ['Block', ['Declare', 't', "'unknown'", nm], ['Loop', ['Assign', 't', step('t')], ['Element', 'j', count]], ['Transpose', 't']], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a call result', ['Transpose', ['square', 'n']], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['a Join', ['Transpose', ['Join', nm, nm]], /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/],
    ['Determinant', ['Determinant', census], /Determinant of a matrix whose number of rows is known at run time only/],
    ['Inverse', ['Inverse', census], /Inverse of a matrix whose number of rows is known at run time only/],
  ])('%s declines', (_, json, cause) => {
    expect(declines(json)).toMatch(cause);
  });

  // Two lengths that the lowering does not prove equal are compared once at
  // run time (user decision 2026-11-25): the interpreter's value where they
  // agree, a `RangeError` where it gives the error
  // `incompatible-dimensions` or `expected-square-matrix`. The last form
  // has rows of a constant length and run-time counts (`product()`).
  // prettier-ignore
  test.each([
    ['an n × m table times itself', (w) => ['MatrixMultiply', w(nm), w(nm)]],
    ['an n × m table times a constant matrix', (w) => ['MatrixMultiply', w(nm), ['List', ['List', 1], ['List', 2], ['List', 3]]]],
    ['Trace of an n × m table', (w) => ['Trace', w(nm)]],
    ['two lists of rows of constant lengths', (w) => ['MatrixMultiply', w(['Map', F(['List', 'i', 'i']), count]), w(['Map', F(['List', 'i']), ['Range', 1, 'm', 1]])]],
  ] as [string, (w: (x: Json) => Json) => Json][])('%s: compared at run time', (_, form) => {
    const r = compile(box(form(same)), { fallback: false });
    expect(r.success).toBe(true);
    let [values, throws] = [0, 0];
    for (const p of [...SIZES, { n: 2, m: 2 }, { n: 3, m: 3 }]) {
      const want = ce.withValues(
        { n: ce.number(p.n), m: ce.number(p.m) } as never,
        () => box(form(listed)).evaluate()
      );
      if (want.operator === 'Error') {
        expect(() => r.run!(p as never)).toThrow(RangeError);
        throws += 1;
        continue;
      }
      const got = r.run!(p as never);
      if (!agree(got, read(want)))
        throw new Error(
          `at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(read(want))}`
        );
      values += 1;
    }
    expect(values).toBeGreaterThan(0);
    expect(throws).toBeGreaterThan(0);
  });
});

// Each operand of a `Join` and of an `Append` is lowered once, and a `Fold`
// from `List()` whose step is a user function that declines for the rows
// declines (step 3 review).
ce.declare('addRow', '(list<list<integer>>, integer) -> list<list<integer>>');
ce.assign(
  'addRow',
  box(F(['Join', ['Transpose', 'a'], ['List', ['Range', 1, 'i', 1]]], 'a', 'i'))
);

describe('CE-1736: an operand is lowered once', () => {
  test('a Join of a list with an effect draws once for each element', () => {
    const json = [
      'Join',
      ['Map', F(['List', ['Random'], 1]), count],
      ['List', ['List', 2, 3]],
    ];
    const r = compile(box(json), { fallback: false });
    expect(r.code.match(/drawNextRandomNumber/g)).toHaveLength(1);
    const v = r.run!({ n: 3 } as never) as number[][];
    expect(v).toHaveLength(4);
    expect(v[3]).toEqual([2, 3]);
  });

  test('a Join of two lists of rows of a constant length builds each once', () => {
    const json = [
      'Join',
      ['Map', F(['List', 'i', 1]), count],
      ['Map', F(['List', 'i', 2]), count],
    ];
    const r = check(json);
    // A build of each operand and one of the join.
    expect(r.code.match(/new Array\(/g)).toHaveLength(3);
  });

  test('a Fold from List() by a user function that declines for the rows', () => {
    expect(
      declines(['Fold', F(['addRow', 'a', 'i'], 'a', 'i'), ['List'], count])
    ).toMatch(
      /Transpose of a list of lists of run-time length \(its rows can have different lengths\)/
    );
  });
});
