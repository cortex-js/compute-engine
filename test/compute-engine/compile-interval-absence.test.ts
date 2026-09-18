/**
 * Absence on the interval target, across its whole value model.
 *
 * The target has no object domain: every value it produces is an enclosure,
 * an array of them (a collection at a consuming position) or a tri-state
 * verdict, and absence has a spelling in each — the whole-NaN marker or the
 * `empty` result for a value, the marker for an absent list (every collection
 * consumer propagates a non-array operand), the verdict `'false'` for an
 * absent condition. So the object-domain absence gate does not apply here
 * (`absence.numeric.coversValueModel`): a position typed
 * `list<number> | missing | number` compiles, and a type the target cannot
 * value is refused by its own lowering.
 *
 * The discharge primitives answer in the target's own domains: `IsMissing`
 * is a verdict (it used to be a JavaScript `false` for every kinded result,
 * the `empty` of a failed restriction included), `Coalesce` hands the
 * fallback back for an absent value and the hull for a partial one.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const iv = (lo: number, hi: number) => ({ lo, hi });
const ABSENT = { lo: NaN, hi: NaN };

describe('IsMissing and Coalesce on the interval target', () => {
  const ce = new ComputeEngine();
  const restricted = compile(ce.parse('\\operatorname{IsMissing}(x\\{x>0\\})'), {
    to: 'interval-js',
  });
  const plain = compile(ce.parse('\\operatorname{IsMissing}(x)'), {
    to: 'interval-js',
  });
  const coalesced = compile(
    ce.parse('\\operatorname{Coalesce}(x\\{x>0\\}, 7)'),
    { to: 'interval-js' }
  );

  test('IsMissing answers a verdict, not a JavaScript boolean', () => {
    expect(restricted.success).toBe(true);
    expect(restricted.code).toBe(
      '_IA.isAbsent(_IA.restrict(_IA.less(_k1, _.x), () => _.x))'
    );
    expect(restricted.run!({ x: iv(1, 2) })).toBe('false');
    // The restriction fails: the value is the `empty` result.
    expect(restricted.run!({ x: iv(-2, -1) })).toBe('true');
    // The cell straddles the boundary: present over part of it.
    expect(restricted.run!({ x: iv(-1, 1) })).toBe('maybe');
    // The marker handed in, through the restriction, is still absent.
    expect(restricted.run!({ x: ABSENT })).toBe('true');
    expect(plain.run!({ x: iv(1, 2) })).toBe('false');
    expect(plain.run!({ x: ABSENT })).toBe('true');
  });

  test('Coalesce hands the fallback back for an absent value, the hull for a partial one', () => {
    expect(coalesced.success).toBe(true);
    expect(coalesced.run!({ x: iv(1, 2) })).toEqual({
      kind: 'interval',
      value: iv(1, 2),
    });
    expect(coalesced.run!({ x: iv(-2, -1) })).toEqual(iv(7, 7));
    expect(coalesced.run!({ x: ABSENT })).toEqual(iv(7, 7));
    expect(coalesced.run!({ x: iv(-1, 1) })).toEqual({
      kind: 'interval',
      value: iv(-1, 7),
    });
  });
});

describe('the discharge primitives across the value model (review findings)', () => {
  const ce = new ComputeEngine();

  test('a verdict is a present value: Coalesce over a relation passes it through', () => {
    const fn = compile(ce.parse('\\operatorname{Coalesce}(x < 0, 7)'), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({ x: iv(1, 2) })).toBe('false');
    expect(fn.run!({ x: iv(-2, -1) })).toBe('true');
  });

  test('an absent fallback leaves a partial value as it is', () => {
    ce.declare('d', 'number');
    const fn = compile(ce.parse('\\operatorname{Coalesce}(x\\{x>0\\}, d)'), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    // Present over part of the cell, the fallback absent: the value keeps
    // its clipping rather than hulling with the marker (which wiped it).
    expect(fn.run!({ x: iv(-1, 1), d: ABSENT })).toEqual({
      kind: 'partial',
      value: iv(-1, 1),
      domainClipped: 'both',
    });
    expect(fn.run!({ x: iv(-1, 1), d: iv(7, 7) })).toEqual({
      kind: 'interval',
      value: iv(-1, 7),
    });
  });

  test('a list under an undecided restriction reads as partly present', () => {
    ce.declare('U', 'list<number> | number');
    const missing = compile(
      ce.parse('\\operatorname{IsMissing}(U\\{x>0\\})'),
      { to: 'interval-js' }
    );
    expect(missing.success).toBe(true);
    const U = [iv(1, 1), iv(2, 2)];
    expect(missing.run!({ U, x: iv(1, 2) })).toBe('false');
    expect(missing.run!({ U, x: iv(-2, -1) })).toBe('true');
    expect(missing.run!({ U, x: iv(-1, 1) })).toBe('maybe');
    // Coalesce over the same list: element by element against a fallback
    // list of the same length.
    ce.declare('W', 'list<number>');
    const coalesced = compile(
      ce.parse('\\operatorname{Coalesce}(U\\{x>0\\}, W)'),
      { to: 'interval-js' }
    );
    expect(coalesced.success).toBe(true);
    const W = [iv(5, 5), iv(6, 6)];
    expect(coalesced.run!({ U, W, x: iv(-2, -1) })).toEqual(W);
    expect(coalesced.run!({ U, W, x: iv(-1, 1) })).toEqual([
      { kind: 'interval', value: iv(1, 5) },
      { kind: 'interval', value: iv(2, 6) },
    ]);
  });

  test('a default-less Which keeps a list arm under an undecided condition', () => {
    ce.declare('A', 'list<number>');
    const fn = compile(ce.box(['Which', ['Greater', 'x', 0], 'A']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    const A = [iv(1, 1), iv(2, 2)];
    expect(fn.run!({ x: iv(1, 2), A })).toEqual(A);
    expect(fn.run!({ x: iv(-2, -1), A })).toEqual({ kind: 'empty' });
    // Hulled with the `empty` of no selection: the list, each element
    // clipped, not the marker.
    expect(fn.run!({ x: iv(-1, 1), A })).toEqual([
      { kind: 'partial', value: iv(1, 1), domainClipped: 'both' },
      { kind: 'partial', value: iv(2, 2), domainClipped: 'both' },
    ]);
  });

  test('a list of verdicts stays outside the value model', () => {
    // A verdict element would read as `entire` in the collection consumers;
    // the position keeps failing closed at the absence gate.
    ce.declare('B', 'list<boolean>');
    const fn = compile(ce.parse('B\\{x>0\\}'), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.error).toMatch(/object-domain absent/);
  });
});

describe('a restriction over a list value', () => {
  const ce = new ComputeEngine();
  ce.declare('U', 'list<number> | number');
  const fn = compile(ce.parse('U \\left\\{y > 0\\right\\}'), {
    to: 'interval-js',
  });

  test('the position typed `list<number> | missing | number` compiles', () => {
    expect(ce.parse('U \\left\\{y > 0\\right\\}').type.toString()).toBe(
      'list<number> | missing | number'
    );
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_IA.restrict(_IA.less(_k1, _.y), () => _.U)');
  });

  test('the list passes where the condition holds, is empty where it fails, and is clipped element by element in between', () => {
    const U = [iv(1, 1), iv(2, 2)];
    expect(fn.run!({ U, y: iv(1, 2) })).toEqual(U);
    expect(fn.run!({ U, y: iv(-2, -1) })).toEqual({ kind: 'empty' });
    expect(fn.run!({ U, y: iv(-1, 1) })).toEqual([
      { kind: 'partial', value: iv(1, 1), domainClipped: 'both' },
      { kind: 'partial', value: iv(2, 2), domainClipped: 'both' },
    ]);
    // A scalar in the same position takes the scalar reading.
    expect(fn.run!({ U: iv(5, 5), y: iv(1, 2) })).toEqual({
      kind: 'interval',
      value: iv(5, 5),
    });
  });
});

describe('a restriction over a relation', () => {
  // `y ≤ K(x) {K(x) > 0}` as ONE row: the restriction applies to the whole
  // relation. Where it fails the relation holds nowhere; where it is
  // undecided the relation holds at most where it held. The JavaScript
  // target reads the same way (its absent condition is falsy).
  const ce = new ComputeEngine();
  const expr = ce.box([
    'When',
    ['LessEqual', 'y', ['Sin', 'x']],
    ['Greater', ['Sin', 'x'], 0],
  ]);
  const fn = compile(expr, { to: 'interval-js' });

  test('the position typed `boolean | missing` compiles to a conjunction at run time', () => {
    expect(expr.type.toString()).toBe('boolean | missing');
    expect(fn.success).toBe(true);
    // x in [1, 1.5]: sin x in [0.84, 1] > 0, y = 0.5 ≤ sin x → 'true'.
    expect(fn.run!({ x: iv(1, 1.5), y: iv(0.5, 0.5) })).toBe('true');
    // x in [4, 4.5]: sin x < 0, the restriction fails → 'false', not absent.
    expect(fn.run!({ x: iv(4, 4.5), y: iv(-2, -2) })).toBe('false');
    // x in [-0.5, 0.5]: the restriction is undecided → at most 'maybe'.
    expect(fn.run!({ x: iv(-0.5, 0.5), y: iv(-2, -2) })).toBe('maybe');
    // The relation is evaluated only when the condition is not already
    // decided false.
    expect(fn.code).toMatch(/=== 'false' \? 'false' : _IA\.and\(/);
  });
});

describe('a conditional with list-valued arms', () => {
  const ce = new ComputeEngine();
  ce.declare('A', 'list<number>');
  ce.declare('B', 'list<number>');
  const fn = compile(
    ce.box(['Which', ['Greater', 'x', 0], 'A', 'True', 'B']),
    { to: 'interval-js' }
  );

  test('a decided condition picks the arm; an undecided one hulls element by element', () => {
    expect(fn.success).toBe(true);
    const A = [iv(1, 1), iv(2, 2)];
    const B = [iv(3, 3), iv(5, 5)];
    expect(fn.run!({ x: iv(1, 2), A, B })).toEqual(A);
    expect(fn.run!({ x: iv(-2, -1), A, B })).toEqual(B);
    expect(fn.run!({ x: iv(-1, 1), A, B })).toEqual([
      { kind: 'interval', value: iv(1, 3) },
      { kind: 'interval', value: iv(2, 5) },
    ]);
    // Lengths that differ have no elementwise hull: the marker.
    expect(fn.run!({ x: iv(-1, 1), A, B: [iv(3, 3)] })).toEqual(ABSENT);
  });
});
