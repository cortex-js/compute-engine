import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';
import { _clearElementMemoForTest } from '../../src/compute-engine/boxed-expression/collection-element-memo';

/**
 * The compiled element function of a lazy `Map` holds the values of the symbols
 * that its body reads. A symbol can get a new value with no change of
 * `ce._semanticVersion`: the parameter of a new call, a local of a new call and
 * a loop index. Each drain must see that value. A function that gave its first
 * value for every call was the defect: with
 * `f(d) := Sum(Map(x => x + d, Range(1, 128)))`, `f(1); f(2); f(3)` was
 * `8384; 8384; 8384`.
 *
 * Each test compares with the interpreter (`ce.jit = 'off'`) and asserts the
 * counters of `_mapAutoCompileStats`, so that an implementation that only uses
 * the interpreter does not pass.
 */

const R = ['Range', 1, 128];
const fn = (body: unknown, ...params: string[]) => [
  'Function',
  body,
  ...params,
];
const mapAdd = (name: string) => ['Map', fn(['Add', 'x', name], 'x'), R];

type Precision = 'machine' | 'auto';

function values(
  jit: boolean,
  precision: Precision,
  definitions: Record<string, unknown>,
  calls: unknown[]
): unknown[] {
  const ce = new ComputeEngine();
  ce.precision = precision;
  if (!jit) ce.jit = 'off';
  for (const [name, value] of Object.entries(definitions))
    ce.assign(name, typeof value === 'number' ? value : ce.box(value as never));
  return calls.map((call) => ce.box(call as never).evaluate().json);
}

/** The values of `calls` with the compiler, after a check that the interpreter
 * gives the same values. */
function compiled(
  precision: Precision,
  definitions: Record<string, unknown>,
  calls: unknown[]
): unknown[] {
  const interpreted = values(false, precision, definitions, calls);
  _resetMapAutoCompileStats();
  const result = values(true, precision, definitions, calls);
  expect(result).toEqual(interpreted);
  return result;
}

let savedPrecision: number;

beforeAll(() => {
  savedPrecision = BigDecimal.precision;
});

afterAll(() => {
  BigDecimal.precision = savedPrecision;
});

describe.each<Precision>(['machine', 'auto'])(
  'the exact tier reads the current value (precision %s)',
  (precision) => {
    test('the parameter of a new call', () => {
      expect(
        compiled(precision, { f: fn(['Sum', mapAdd('d')], 'd') }, [
          ['f', 1],
          ['f', 2],
          ['f', 3],
        ])
      ).toEqual([8384, 8512, 8640]);
      expect(stats.compiledHits).toBe(384);
      expect(stats.recompiles).toBe(2);
    });

    test('a local of a new call', () => {
      const body = [
        'Block',
        ['Declare', 'e', 'integer', ['Multiply', 'd', 2]],
        ['Sum', mapAdd('e')],
      ];
      expect(
        compiled(precision, { f: fn(body, 'd') }, [
          ['f', 1],
          ['f', 2],
        ])
      ).toEqual([8512, 8768]);
      expect(stats.compiledHits).toBe(256);
    });

    test('a loop index', () => {
      expect(
        compiled(precision, {}, [
          ['Sum', ['Sum', mapAdd('k')], ['Limits', 'k', 1, 3]],
        ])
      ).toEqual([25536]);
      expect(stats.compiledHits).toBe(384);
      expect(stats.recompiles).toBe(2);
    });

    test('the parameter of an enclosing lambda', () => {
      expect(
        compiled(precision, {}, [
          ['Sum', ['Map', fn(['Sum', mapAdd('d')], 'd'), ['Range', 1, 3]]],
        ])
      ).toEqual([25536]);
      expect(stats.compiledHits).toBe(384);
    });

    test('a recursive call that returns before the Map is drained', () => {
      // The inner call compiles the `Map` with its own `n`. When it returns,
      // the outer call drains the same `Map` with its `n`.
      const body = [
        'Block',
        [
          'Declare',
          'a',
          'integer',
          ['If', ['Greater', 'n', 0], ['f', ['Subtract', 'n', 1]], 0],
        ],
        ['Add', 'a', ['Sum', mapAdd('n')]],
      ];
      expect(compiled(precision, { f: fn(body, 'n') }, [['f', 2]])).toEqual([
        25152,
      ]);
      expect(stats.compiledHits).toBe(384);
    });

    test('a new value that the proof does not admit', () => {
      // The proof of the first call holds for `d = 1`. At `d = 2^53 - 1`, the
      // value of `x + d` is not a safe integer: the compiled code rounds it, and
      // the result of `Mod` is a wrong safe integer. The interpreter computes
      // that call, and the next call compiles again.
      expect(
        compiled(
          precision,
          {
            f: fn(
              ['Sum', ['Map', fn(['Mod', ['Add', 'x', 'd'], 7], 'x'), R]],
              'd'
            ),
          },
          [
            ['f', 1],
            ['f', 9007199254740991],
            ['f', 3],
          ]
        )
      ).toEqual([383, 387, 387]);
      expect(stats.compiledHits).toBe(256);
      expect(stats.recompiles).toBe(1);
    });

    test('a new value that is not an integer, then an integer', () => {
      expect(
        compiled(precision, { f: fn(['Sum', mapAdd('d')], 'd') }, [
          ['f', 1],
          ['f', ['Rational', 3, 2]],
          ['f', 2],
        ])
      ).toEqual([8384, 8448, 8512]);
      expect(stats.compiledHits).toBe(256);
    });

    test('a source that is the parameter of a new call', () => {
      // The compiled code does not read the source, so it does not compile
      // again. The bounds of the proof are the bounds of the new source: no
      // element goes to the interpreter.
      expect(
        compiled(
          precision,
          { f: fn(['Sum', ['Map', fn(['Add', 'x', 1], 'x'), 'L']], 'L') },
          [
            ['f', ['Range', 1, 128]],
            ['f', ['Range', 2, 129]],
          ]
        )
      ).toEqual([8384, 8512]);
      expect(stats.compiledHits).toBe(256);
      expect(stats.attempts).toBe(1);
      expect(stats.elementFallbacks).toBe(0);
    });
  }
);

describe('the float tier reads the current value', () => {
  const numeric = (v: unknown) =>
    typeof v === 'object' && v !== null && 'num' in v
      ? Number((v as { num: string }).num)
      : v;

  test('the parameter of a new call', () => {
    const body = [
      'Sum',
      ['Map', fn(['N', ['Sin', ['Add', 'x', 'd']]], 'x'), R],
    ];
    const result = compiled('machine', { f: fn(body, 'd') }, [
      ['f', 1],
      ['f', 2],
      ['f', 3],
    ]).map(numeric) as number[];
    expect(result[0]).toBeCloseTo(0.874987, 5);
    expect(result[1]).toBeCloseTo(-0.964416, 5);
    expect(result[2]).toBeCloseTo(-1.91714, 4);
    expect(stats.compiledHits).toBe(384);
    expect(stats.recompiles).toBe(2);
  });

  test('N of the whole expression', () => {
    expect(
      compiled('machine', { f: fn(['N', ['Sum', mapAdd('d')]], 'd') }, [
        ['f', 1],
        ['f', 2],
      ]).map(numeric)
    ).toEqual([8384, 8512]);
    expect(stats.compiledHits).toBe(256);
  });

  test('a loop index', () => {
    const body = [
      'Sum',
      ['Map', fn(['N', ['Sin', ['Add', 'x', 'k']]], 'x'), R],
    ];
    const [result] = compiled('machine', {}, [
      ['Sum', body, ['Limits', 'k', 1, 3]],
    ]).map(numeric) as number[];
    expect(result).toBeCloseTo(-2.006569, 5);
    expect(stats.compiledHits).toBe(384);
  });

  test('a body with a jump, and a new value that the proof does not admit', () => {
    // The compiled code computes an exact input only under a proof over the
    // values of this call (`exactJumpInputAllowed` in `map-auto-compile.ts`).
    const body = [
      'Sum',
      ['Map', fn(['N', ['Mod', ['Add', 'x', 'd'], 7]], 'x'), R],
    ];
    expect(
      compiled('machine', { f: fn(body, 'd') }, [
        ['f', 1],
        ['f', 9007199254740991],
        ['f', 3],
      ]).map(numeric)
    ).toEqual([383, 387, 387]);
  });
});

describe('a compiled record is kept when no value it reads changed', () => {
  test('a call with a parameter that the Map does not read', () => {
    expect(
      compiled(
        'machine',
        { u: 5, f: fn(['Add', 'd', ['Sum', mapAdd('u')]], 'd') },
        [
          ['f', 1],
          ['f', 2],
          ['f', 3],
        ]
      )
    ).toEqual([8897, 8898, 8899]);
    expect(stats.compiledHits).toBe(384);
    expect(stats.attempts).toBe(1);
    expect(stats.recompiles).toBe(0);
  });

  test('a loop index that the Map does not read', () => {
    expect(
      compiled('machine', { u: 5 }, [
        ['Sum', ['Add', 'k', ['Sum', mapAdd('u')]], ['Limits', 'k', 1, 3]],
      ])
    ).toEqual([26694]);
    expect(stats.attempts).toBe(1);
    expect(stats.recompiles).toBe(0);
  });
});

describe('a write during a drain', () => {
  test('a write that moves only the `any` version reaches the next element', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('k', 10);
    const m = ce.box(['Map', fn(['N', ['Multiply', 'k', 'x']], 'x'), R]);
    _resetMapAutoCompileStats();
    const it = m.each();
    // The first element compiles and the second makes the full check. The
    // later elements of the drain skip it while no version moves.
    expect(it.next().value!.re).toBe(10);
    expect(it.next().value!.re).toBe(20);
    const walks = stats.revalidations;
    expect(it.next().value!.re).toBe(30);
    expect(stats.revalidations).toBe(walks);

    // The write of a loop index: `_semanticVersion` does not move.
    const semantic = ce._semanticVersion;
    ce._ephemeralWriteDepth += 1;
    try {
      ce.assign('k', 100);
    } finally {
      ce._ephemeralWriteDepth -= 1;
    }
    expect(ce._semanticVersion).toBe(semantic);

    expect(it.next().value!.re).toBe(400);
    expect(stats.recompiles).toBe(1);
  });

  test('a redefinition of a called function reaches the next element', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('h', ce.box(fn(['Add', 'y', 0.5], 'y') as never));
    const m = ce.box(['Map', fn(['N', ['h', 'x']], 'x'), R]);
    _resetMapAutoCompileStats();
    const it = m.each();
    expect(it.next().value!.re).toBe(1.5);
    expect(it.next().value!.re).toBe(2.5);
    expect(it.next().value!.re).toBe(3.5);

    ce.assign('h', ce.box(fn(['Add', 'y', 10.5], 'y') as never));

    expect(it.next().value!.re).toBe(14.5);
    expect(stats.recompiles).toBe(1);
  });

  test('an event that moves only the `semantic` version has the full check', () => {
    // `axisMaskOf()`: this event moves `_semanticVersion` and `_worldVersion`,
    // and leaves `_anyVersion` as it is. The full check sees the world version,
    // so the code compiles again.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('k', 10);
    const m = ce.box(['Map', fn(['N', ['Multiply', 'k', 'x']], 'x'), R]);
    _resetMapAutoCompileStats();
    const it = m.each();
    expect(it.next().value!.re).toBe(10);
    expect(it.next().value!.re).toBe(20);

    const any = ce._anyVersion;
    ce._noteStateEvent({
      kind: 'redefine',
      callableBefore: true,
      callableAfter: true,
    });
    expect(ce._anyVersion).toBe(any);

    expect(it.next().value!.re).toBe(30);
    expect(stats.recompiles).toBe(1);
  });

  test('the elements of a drain with no write have one full check', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('k', 10);
    const m = ce.box(['Map', fn(['N', ['Multiply', 'k', 'x']], 'x'), R]);
    [...m.each()];
    // The element memo, above the compile cache, would serve the second drain.
    _clearElementMemoForTest(m);
    _resetMapAutoCompileStats();
    [...m.each()];
    expect(stats.compiledHits).toBe(128);
    expect(stats.revalidations).toBe(1);
  });

  test('a body with a jump takes its proof again after the write', () => {
    // At `k = 1` the proof admits each input. At `k = 2^53 - 1` it does not:
    // the compiled code would round `2 + k` to `2^53`, and give 4. The
    // interpreter computes the element: `2^53 + 1` is 5 modulo 7.
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('k', 1);
    const m = ce.box(['Map', fn(['N', ['Mod', ['Add', 'x', 'k'], 7]], 'x'), R]);
    const it = m.each();
    expect(it.next().value!.re).toBe(2);

    ce._ephemeralWriteDepth += 1;
    try {
      ce.assign('k', 9007199254740991);
    } finally {
      ce._ephemeralWriteDepth -= 1;
    }

    expect(it.next().value!.re).toBe(5);
    expect(it.next().value!.re).toBe(6);
  });
});
