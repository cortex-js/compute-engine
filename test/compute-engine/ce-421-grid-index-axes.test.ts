import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ComputeEngine,
  compile,
  createKernelPool,
} from '../../src/compute-engine';

// ROADMAP CE-421 (Tycho row 440): with `layout: 'grid'`, the `indexes`
// option names the inputs that are index axes. The input of such a variable
// is the axis length `n`, and at each cell the variable is the cell's
// position along that axis, 0 to n - 1. The values are those of the same
// grid with a column 0 … n - 1 for that axis, on every route: the ordinary
// body, the batch body (a shared list read directly), `interval-js`, the
// slices of `broadcastAsync` and the worker pool.

const WORKER_URL = pathToFileURL(join(__dirname, '../../src/kernel-worker.ts'));

/** The column `0, 1, …, n - 1`. */
const column = (n: number): Float64Array =>
  Float64Array.from({ length: n }, (_, j) => j);

/** The interval column of the point intervals `[j, j]`. */
const intervalColumn = (n: number): Float64Array =>
  Float64Array.from({ length: 2 * n }, (_, j) => Math.floor(j / 2));

const expectSame = (a: ArrayLike<number>, b: ArrayLike<number>): void => {
  expect(a.length).toBe(b.length);
  for (let n = 0; n < a.length; n++)
    if (!Object.is(a[n], b[n]))
      throw new Error(`value ${n}: ${a[n]} and ${b[n]}`);
};

// A marching kernel in the shape of Tycho row 432: the values of the shared
// list F at the two corners of the cell (ci, cj) of a grid NX points wide,
// the case index and the crossing fraction.
const NX = 7;
const NY = 5;
const corner = (di: number): unknown => [
  'At',
  'F',
  ['Add', 'ci', ['Multiply', NX, 'cj'], 1 + di],
];
const MARCH = [
  'Block',
  ['Declare', 'v0', 'real'],
  ['Assign', 'v0', corner(0)],
  ['Declare', 'v1', 'real'],
  ['Assign', 'v1', corner(1)],
  [
    'Tuple',
    [
      'Add',
      ['If', ['LessEqual', 'v0', 0], 1, 0],
      ['If', ['LessEqual', 'v1', 0], 2, 0],
    ],
    ['Divide', 'v0', ['Subtract', 'v0', 'v1']],
  ],
];
const F = Array.from({ length: NX * NY }, (_, k) => Math.sin(1.7 * k) - 0.2);

function marchEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('F', 'list<number>');
  ce.declare('ci', 'integer<0..>');
  ce.declare('cj', 'integer<0..>');
  return ce;
}

describe('CE-421: index axes of the grid layout', () => {
  // The batch body is built on request (ROADMAP CE-423).
  const march = compile(marchEngine().box(MARCH as never), {
    broadcast: true,
  });

  test('the march kernel has a batch body that reads F directly', () => {
    expect(march.success).toBe(true);
    expect(march.batch?.params.some((p) => p.direct)).toBe(true);
  });

  test.each([
    ['a plain array', F],
    ['a Float64Array', Float64Array.from(F)],
    ['an array the batch body refuses', [...F.slice(0, -1), 'x']],
  ])('march kernel, F %s: same values as the columns', (_, list) => {
    const nx = NX - 1;
    const withColumns = march.broadcast!(
      { ci: column(nx), cj: column(NY), F: list as never },
      { layout: 'grid' }
    );
    const withIndexes = march.broadcast!(
      { ci: nx, cj: NY, F: list as never },
      { layout: 'grid', indexes: ['ci', 'cj'] }
    );
    expect(withIndexes.length).toBe(2 * nx * NY);
    expectSame(withIndexes, withColumns);
  });

  test('an index axis among columns and scalars keeps its place in key order', () => {
    const r = compile(new ComputeEngine().parse('100a + 10j + x'));
    const xs = Float64Array.from([0.25, 0.5, 0.75]);
    const withColumns = r.broadcast!(
      { x: xs, a: 4, j: column(4) },
      { layout: 'grid' }
    );
    const withIndexes = r.broadcast!(
      { x: xs, a: 4, j: 4 },
      { layout: 'grid', indexes: ['j'] }
    );
    expectSame(withIndexes, withColumns);
    // `x` varies fastest: the second cell is (x = 0.5, j = 0).
    expect(withIndexes[1]).toBe(400.5);
    expect(withIndexes[3]).toBe(410.25);
  });

  test('an index axis of a variable declared complex', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const r = compile(ce.parse('z^2 + y'));
    const ys = Float64Array.from([1, 2]);
    expectSame(
      r.broadcast!({ z: 3, y: ys }, { layout: 'grid', indexes: ['z'] }),
      r.broadcast!({ z: column(3), y: ys }, { layout: 'grid' })
    );
  });

  test('an index axis of length 0 gives no cell', () => {
    const r = compile(new ComputeEngine().parse('i + j'));
    const out = r.broadcast!(
      { i: 0, j: column(3) },
      { layout: 'grid', indexes: ['i'] }
    );
    expect(out.length).toBe(0);
  });

  test('interval-js: an index axis is the point interval of the index', () => {
    const r = compile(new ComputeEngine().parse('\\sqrt{n} + x'), {
      to: 'interval-js',
    });
    expect(r.success).toBe(true);
    const xs = Float64Array.from([0, 0.5, 0.5, 1]);
    expectSame(
      r.broadcast!({ n: 4, x: xs }, { layout: 'grid', indexes: ['n'] }),
      r.broadcast!({ n: intervalColumn(4), x: xs }, { layout: 'grid' })
    );
  });

  test('broadcastAsync in slices gives the values of broadcast', async () => {
    const nx = NX - 1;
    const inputs = { ci: nx, cj: NY, F };
    const options = { layout: 'grid', indexes: ['ci', 'cj'] } as const;
    const { out, done } = await march.broadcastAsync!(inputs, {
      ...options,
      chunk: 4,
    });
    expect(done).toBe(nx * NY);
    expectSame(out, march.broadcast!(inputs, options));
  });

  test('the option is checked', () => {
    const r = compile(new ComputeEngine().parse('i + x'));
    const xs = column(3);
    expect(() => r.broadcast!({ i: 3, x: xs }, { indexes: ['i'] })).toThrow(
      /needs the `grid` layout/
    );
    expect(() =>
      r.broadcast!({ i: 3, x: xs }, { layout: 'grid', indexes: ['k'] })
    ).toThrow(/not a key of the inputs/);
    for (const bad of [-1, 2.5, NaN, Infinity])
      expect(() =>
        r.broadcast!({ i: bad, x: xs }, { layout: 'grid', indexes: ['i'] })
      ).toThrow(/non-negative integer/);
    expect(() =>
      r.broadcast!({ i: xs, x: xs }, { layout: 'grid', indexes: ['i'] })
    ).toThrow(/non-negative integer/);
    expect(() =>
      r.broadcast!(
        { i: 3, x: xs },
        { layout: 'grid', indexes: ['i'], shared: ['i'] }
      )
    ).toThrow(/both a shared input and an index axis/);
    expect(() =>
      r.broadcast!({ i: 3, x: xs }, { layout: 'grid', indexes: 'i' as never })
    ).toThrow(/array of variable names/);
    // The product of the lengths must be an exact integer.
    expect(() =>
      r.broadcast!(
        { i: 1e9, x: 1e9 },
        { layout: 'grid', indexes: ['i', 'x'] }
      )
    ).toThrow(/too many cells/);
  });
});

describe('CE-421: index axes on the worker pool', () => {
  const engine = marchEngine();
  let pool: ReturnType<typeof createKernelPool>;
  beforeAll(() => {
    pool = createKernelPool({
      create: () => new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] }),
      size: 2,
    });
    engine.workers = pool;
  });
  afterAll(() => {
    pool.dispose();
  });

  test('a large grid of index axes gives the values of broadcast', async () => {
    const big = new ComputeEngine();
    big.declare('ci', 'integer<0..>');
    big.declare('cj', 'integer<0..>');
    big.workers = pool;
    const r = compile(big.parse('\\sin(ci/7)\\cos(cj/11) + ci\\cdot cj'));
    const inputs = { ci: 400, cj: 300 };
    const options = { layout: 'grid', indexes: ['ci', 'cj'] } as const;
    const { out, done, route } = await r.broadcastAsync!(inputs, {
      ...options,
      inline: false,
    });
    expect(route).toBe('pool');
    expect(done).toBe(120_000);
    expectSame(out, r.broadcast!(inputs, options));
    expectSame(
      out,
      r.broadcast!({ ci: column(400), cj: column(300) }, { layout: 'grid' })
    );
  }, 30_000);
});
