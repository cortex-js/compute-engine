import { ComputeEngine, compile } from '../../src/compute-engine';

// ROADMAP CE-423 (user decision 2026-10-25): the `broadcast()` batch body of
// a `javascript` result is a second compilation of the same size as the
// first, so `compile()` builds it only when the caller passes
// `broadcast: true`. Without the option the result has no `batch` field and
// `broadcast()` runs the ordinary body for every cell, with the same values.

// The kernel of ROADMAP CE-410: the case index and the crossing fraction of
// a marching cell, from two values of the shared list F.
const FRACTION = (a: string, b: string): unknown => [
  'If',
  ['LessEqual', a, 0],
  ['If', ['LessEqual', b, 0], 'NaN', ['Divide', a, ['Subtract', a, b]]],
  ['If', ['LessEqual', b, 0], ['Divide', b, ['Subtract', b, a]], 'NaN'],
];
const CASE = (a: string, b: string): unknown => [
  'Add',
  ['If', ['LessEqual', a, 0], 1, 0],
  ['If', ['LessEqual', b, 0], 2, 0],
];
const MARCH = [
  'Block',
  ['Declare', 'v0', 'real'],
  ['Assign', 'v0', ['At', 'F', ['Add', 'i', 1]]],
  ['Declare', 'v1', 'real'],
  ['Assign', 'v1', ['At', 'F', ['Add', 'i', 2]]],
  ['Tuple', CASE('v0', 'v1'), FRACTION('v0', 'v1')],
];

/** An engine with `F: list<number>` and `i` of the type `iType`. */
function engine(iType: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('F', 'list<number>');
  ce.declare('i', iType);
  return ce;
}

const F = [0.5, -1, 2, -0.25, 4, -3, 0, 1.5];

const expectSame = (a: ArrayLike<number>, b: ArrayLike<number>): void => {
  expect(a.length).toBe(b.length);
  for (let n = 0; n < a.length; n++)
    if (!Object.is(a[n], b[n]))
      throw new Error(`value ${n}: ${a[n]} and ${b[n]}`);
};

describe('CE-423: the batch body is built on request', () => {
  test('the default has no batch body, `broadcast: true` has one', () => {
    for (const iType of ['integer', 'integer<0..>']) {
      const expr = engine(iType).box(MARCH as never);
      const plain = compile(expr);
      expect(plain.success).toBe(true);
      expect(plain.batch).toBeUndefined();
      expect(compile(expr, { broadcast: false }).batch).toBeUndefined();
      const asked = compile(expr, { broadcast: true });
      expect(asked.success).toBe(true);
      expect(
        asked.batch?.params.filter((p) => p.direct).map((p) => p.name)
      ).toEqual(['F']);
      // The ordinary body is the same either way.
      expect(asked.code).toBe(plain.code);
    }
  });

  test('`broadcast()` gives the same cells with and without it', () => {
    const expr = engine('integer<0..>').box(MARCH as never);
    const plain = compile(expr);
    const asked = compile(expr, { broadcast: true });
    const i = Float64Array.from({ length: F.length - 2 }, (_, c) => c);
    for (const shared of [F, Float64Array.from(F)]) {
      const want = asked.broadcast!({ i, F: shared });
      expectSame(plain.broadcast!({ i, F: shared }), want);
      // Two values per cell, one case index and one fraction.
      expect(want.length).toBe(2 * i.length);
    }
  });

  test('a kernel that reads no shared list has no batch body either way', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sin(x) + 1');
    expect(compile(expr).batch).toBeUndefined();
    expect(compile(expr, { broadcast: true }).batch).toBeUndefined();
  });

  test('the other targets accept the option and build no batch body', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sin(x) + 1');
    const interval = compile(expr, { to: 'interval-js', broadcast: true });
    expect(interval.success).toBe(true);
    expect(interval.batch).toBeUndefined();
    const python = compile(expr, { to: 'python', broadcast: true });
    expect(python.success).toBe(true);
    expect(python.batch).toBeUndefined();
  });

  test('a value that is not a boolean is refused', () => {
    const ce = new ComputeEngine();
    expect(() =>
      compile(ce.parse('x + 1'), { broadcast: 'yes' as never })
    ).toThrow('Invalid compilation option "broadcast": expected a boolean');
  });
});
