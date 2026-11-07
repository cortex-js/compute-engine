import { ComputeEngine } from '../../src/compute-engine';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';
import { exactPredicateShape } from '../../src/compute-engine/library/map-exact-proof';

/**
 * The condition of a `Filter`, `Any` or `All` is computed by compiled code
 * when it is a comparison of integer operations over a source with proved
 * integer bounds (`exactPredicateShape()` in
 * `src/compute-engine/library/map-exact-proof.ts`), as the element function
 * of a `Map` is in the exact tier. Each test compares the result with the
 * result of the interpreter (`ce.jit = 'off'`), and reads the counters of
 * `_mapAutoCompileStats` to tell which one computed the elements.
 */

beforeEach(() => _resetMapAutoCompileStats());

/** The result of `json` with the interpreter only, then with the compiled
 * code, and the compiled hits of the second evaluation. Each evaluation has
 * its own engine, made by `setup`, so that the second one reads no memo of
 * the first. */
function both(
  setup: (ce: ComputeEngine) => void,
  json: any
): { interpreted: string; compiled: string; hits: number } {
  const off = new ComputeEngine();
  setup(off);
  off.jit = 'off';
  const interpreted = JSON.stringify(materialize(off.box(json).evaluate()));
  const ce = new ComputeEngine();
  setup(ce);
  _resetMapAutoCompileStats();
  const compiled = JSON.stringify(materialize(ce.box(json).evaluate()));
  return { interpreted, compiled, hits: stats.compiledHits };
}

const noSetup = (_ce: ComputeEngine): void => {};

/** The elements of a collection, or the expression itself. */
function materialize(x: any): any {
  if (x.isCollection && x.operator !== 'Range')
    return [...x.each()].map((e: any) => e.json);
  return x.json;
}

function defineIsEven(ce: ComputeEngine): void {
  ce.parse(
    '\\operatorname{isEven}(n) \\coloneq \\operatorname{mod}(n, 2) = 0'
  ).evaluate();
}

describe('A COMPILED CONDITION GIVES THE VALUES OF THE INTERPRETER', () => {
  test('Filter with a named condition', () => {
    const r = both(defineIsEven, ['Filter', ['Range', 1, 200], 'isEven']);
    expect(r.compiled).toBe(r.interpreted);
    expect(r.hits).toBe(200);
    const ce = new ComputeEngine();
    defineIsEven(ce);
    expect(
      ce.box(['Sum', ['Filter', ['Range', 1, 200], 'isEven']]).evaluate().re
    ).toBe(10100);
  });

  test('Filter with a lambda over negative integers', () => {
    const r = both(noSetup, [
      'Filter',
      ['Range', -100, 100],
      ['Function', ['Equal', ['Mod', 'k', 3], 1], 'k'],
    ]);
    expect(r.compiled).toBe(r.interpreted);
    expect(r.hits).toBe(201);
  });

  test('And, Or and Not of comparisons', () => {
    const r = both(noSetup, [
      'Filter',
      ['Range', 1, 300],
      [
        'Function',
        [
          'Or',
          ['And', ['Less', 'k', 50], ['NotEqual', ['Mod', 'k', 7], 0]],
          ['Not', ['GreaterEqual', ['Multiply', 'k', 'k'], 40000]],
          ['Equal', ['Add', 'k', 1], 300],
        ],
        'k',
      ],
    ]);
    expect(r.compiled).toBe(r.interpreted);
    expect(r.hits).toBe(300);
  });

  test('Any and All', () => {
    for (const json of [
      ['Any', ['Range', 1, 100], ['Function', ['Greater', 'k', 100], 'k']],
      ['Any', ['Range', 1, 100], ['Function', ['Equal', 'k', 99], 'k']],
      ['All', ['Range', 1, 100], ['Function', ['LessEqual', 'k', 100], 'k']],
      ['All', ['Range', 1, 100], 'isEven'],
    ]) {
      const r = both(defineIsEven, json);
      expect(r.compiled).toBe(r.interpreted);
      expect(r.hits).toBeGreaterThan(0);
    }
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Any', ['Range', 1, 100], ['Function', ['Greater', 'k', 100], 'k']])
        .evaluate().symbol
    ).toBe('False');
    expect(
      ce
        .box(['Any', ['Range', 1, 100], ['Function', ['Equal', 'k', 99], 'k']])
        .evaluate().symbol
    ).toBe('True');
  });

  test('A source that is a symbol and a source that is a Map', () => {
    const pred = ['Function', ['Equal', ['Mod', 'k', 5], 0], 'k'];
    const r1 = both((ce) => ce.assign('xs', ce.box(['Range', 1, 100])), [
      'Filter',
      'xs',
      pred,
    ]);
    expect(r1.compiled).toBe(r1.interpreted);
    expect(r1.hits).toBe(100);
    const r2 = both(noSetup, [
      'Filter',
      ['Map', ['Function', ['Add', ['Multiply', 'x', 'x'], 1], 'x'], ['Range', 1, 100]],
      pred,
    ]);
    expect(r2.compiled).toBe(r2.interpreted);
    // 100 elements of the compiled `Map`, and 100 of the compiled condition.
    expect(r2.hits).toBe(200);
  });

  test('Any on the asynchronous route', async () => {
    const json = [
      'Any',
      ['Range', 1, 100],
      ['Function', ['Equal', 'k', 99], 'k'],
    ];
    const ce = new ComputeEngine();
    const r = await ce.box(json).evaluateAsync();
    expect(r.symbol).toBe('True');
    expect(stats.compiledHits).toBe(99);
  });

  test('A condition that reads a loop index or a parameter', () => {
    const loop = [
      'Sum',
      [
        'Count',
        ['Filter', ['Range', 1, 100], ['Function', ['Less', 'k', 'j'], 'k']],
      ],
      ['Limits', 'j', 1, 10],
    ];
    const r1 = both(noSetup, loop);
    expect(r1.compiled).toBe(r1.interpreted);
    expect(r1.compiled).toBe('45');
    const define = (ce: ComputeEngine): void => {
      ce.parse(
        '\\operatorname{g}(m) \\coloneq \\operatorname{Any}(\\operatorname{Range}(1, 100), k \\mapsto k = m)'
      ).evaluate();
    };
    for (const m of [5, 200, 100, 0]) {
      const r = both(define, ['g', m]);
      expect(r.compiled).toBe(r.interpreted);
      expect(r.compiled).toBe(m >= 1 && m <= 100 ? '"True"' : '"False"');
    }
  });

  test('A named condition that is defined after the first walk', () => {
    const ce = new ComputeEngine();
    const filter = ce.box(['Filter', ['Range', 1, 100], 'p']);
    expect(exactPredicateShape(ce, filter)).toBeUndefined();
    ce.parse('\\operatorname{p}(n) \\coloneq n < 50').evaluate();
    expect(exactPredicateShape(ce, filter)).toBeDefined();
  });
});

describe('A CHANGE OF A VALUE OR A DEFINITION IS SEEN', () => {
  test('A redefinition of the named condition', () => {
    const ce = new ComputeEngine();
    defineIsEven(ce);
    const filter = ce.box(['Count', ['Filter', ['Range', 1, 100], 'isEven']]);
    expect(filter.evaluate().re).toBe(50);
    ce.parse(
      '\\operatorname{isEven}(n) \\coloneq \\operatorname{mod}(n, 4) = 0'
    ).evaluate();
    expect(filter.evaluate().re).toBe(25);
  });

  test('A new value of a symbol that the condition reads', () => {
    const ce = new ComputeEngine();
    ce.assign('m', 2);
    const filter = ce.box([
      'Count',
      ['Filter', ['Range', 1, 100], ['Function', ['Equal', ['Mod', 'k', 'm'], 0], 'k']],
    ]);
    expect(filter.evaluate().re).toBe(50);
    expect(stats.compiledHits).toBe(100);
    ce.assign('m', 10);
    expect(filter.evaluate().re).toBe(10);
    // A value that is not an integer revokes the proof: the interpreter
    // computes the elements.
    ce.assign('m', 2.5);
    _resetMapAutoCompileStats();
    expect(filter.evaluate().re).toBe(20);
    expect(stats.compiledHits).toBe(0);
  });

  test('A new value of the source symbol', () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['Range', 1, 100]));
    const filter = ce.box([
      'Count',
      ['Filter', 'xs', ['Function', ['Greater', 'k', 90], 'k']],
    ]);
    expect(filter.evaluate().re).toBe(10);
    ce.assign('xs', ce.box(['Range', 1, 200]));
    expect(filter.evaluate().re).toBe(110);
  });
});

describe('THE CASES THAT THE INTERPRETER COMPUTES', () => {
  test('a source with fewer elements than the size floor', () => {
    const ce = new ComputeEngine();
    const x = ce.box([
      'Count',
      ['Filter', ['Range', 1, 10], ['Function', ['Less', 'k', 5], 'k']],
    ]);
    expect(x.evaluate().re).toBe(4);
    expect(stats.compiledHits).toBe(0);
    expect(stats.attempts).toBe(0);
  });

  const declines: [string, (ce: ComputeEngine) => any][] = [
    [
      'a source with a float element',
      () => [
        'Filter',
        ['List', ...Array.from({ length: 70 }, (_, i) => i), 1.5],
        ['Function', ['Less', 'k', 5], 'k'],
      ],
    ],
    [
      'a source that is not bounded',
      () => [
        'Take',
        ['Filter', ['Range', 1, { num: '+Infinity' }], ['Function', ['Less', 'k', 5], 'k']],
        3,
      ],
    ],
    [
      'a condition that calls a user function',
      (ce) => {
        ce.parse('\\operatorname{h}(n) \\coloneq n + 1').evaluate();
        return [
          'Filter',
          ['Range', 1, 100],
          ['Function', ['Less', ['h', 'k'], 5], 'k'],
        ];
      },
    ],
    [
      'a condition with a division',
      () => [
        'Filter',
        ['Range', 1, 100],
        ['Function', ['Less', ['Divide', 'k', 3], 5], 'k'],
      ],
    ],
    [
      'a condition whose products can be larger than the safe integers',
      () => [
        'Filter',
        ['Range', 1, 100_000_000_000],
        ['Function', ['Less', ['Multiply', 'k', 'k', 'k'], 5], 'k'],
      ],
    ],
    [
      'a condition that is not a comparison',
      () => ['Filter', ['Range', 1, 100], ['Function', ['IsPrime', 'k'], 'k']],
    ],
  ];
  for (const [name, make] of declines) {
    test(name, () => {
      const ce = new ComputeEngine();
      const json = make(ce);
      const x = ce.box(json);
      const filter = x.operator === 'Take' ? x.op1 : x;
      expect(exactPredicateShape(ce, filter)).toBeUndefined();
      x.evaluate();
      expect(stats.compiledHits).toBe(0);
      expect(stats.attempts).toBe(0);
    });
  }

  test('a named condition whose signature refuses some integers', () => {
    const ce = new ComputeEngine();
    ce.declare('small', '(integer<0..10>) -> boolean');
    ce.assign('small', ce.box(['Function', ['Less', 'n', 5], 'n']));
    const x = ce.box(['Filter', ['Range', 1, 100], 'small']);
    expect(exactPredicateShape(ce, x)).toBeUndefined();
  });

  test('with jit off', () => {
    const ce = new ComputeEngine();
    ce.jit = 'off';
    ce.box([
      'Count',
      ['Filter', ['Range', 1, 100], ['Function', ['Less', 'k', 5], 'k']],
    ]).evaluate();
    expect(stats.compiledHits).toBe(0);
  });
});
