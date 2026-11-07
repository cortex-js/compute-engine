import { ComputeEngine } from '../../src/compute-engine';
import { BoxedFunction } from '../../src/compute-engine/boxed-expression/boxed-function';

/**
 * CE-882: an expression that holds several COPIES of one sub-expression
 * (distinct nodes with the same structure, as a host makes when it expands
 * its functions in place) computed each copy. One top-level evaluation now
 * keeps the result of a copy under the first node of its structure
 * (`BoxedFunction._sharedEvaluationKey()`, `shared-evaluation-memo.ts`), so
 * the third and later copies read the value of the second.
 *
 * `Costly` is a host operator that states its purity and counts its calls.
 */
function engineWithCounter(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let count = 0;
  ce.declare('Costly', {
    signature: '(real) -> real',
    pure: true,
    evaluate: ([x]) => {
      count += 1;
      return ce.number(2 * (x.re ?? NaN));
    },
  });
  return { ce, calls: () => count };
}

/** A new MathJSON array for each call, so that each copy is boxed as a
 * distinct node. */
const costly = (arg: unknown): unknown => ['Costly', arg];

describe('CE-882: COPIES OF A SUB-EXPRESSION ARE EVALUATED ONCE', () => {
  test('Six copies cost two evaluations, exact and numeric', () => {
    const { ce, calls } = engineWithCounter();
    ce.assign('a', 3);
    const copy = () => costly(['Add', 'a', 1]);
    const e = ce.box([
      'Add',
      copy(),
      copy(),
      copy(),
      ['Multiply', copy(), copy()],
      copy(),
    ] as any);
    expect(e.evaluate().json).toEqual(96);
    expect(calls()).toBe(2);
    expect(e.N().re).toEqual(96);
    expect(calls()).toBe(4);
  });

  test('A piecewise expression over a list, copied nine times', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', -2, -0.5, 0.25, 0.75, 3]));
    const piecewise = () => [
      'Which',
      ['Less', 'L', 0],
      ['Negate', 'L'],
      ['Greater', 'L', 1],
      ['Divide', 1, 'L'],
      'True',
      ['Power', 'L', 2],
    ];
    const f = (w: unknown) => ['Add', ['Multiply', w, w], w];
    const s = (u: unknown) => ['Add', u, ['Multiply', u, u]];
    const expanded = ce.box(s(f(piecewise())) as any).evaluate();
    // The same body with one shared node in place of the nine copies.
    const node = ce.box(piecewise() as any);
    const fn = (w: any) =>
      ce.function('Add', [ce.function('Multiply', [w, w]), w]);
    const sn = (u: any) =>
      ce.function('Add', [u, ce.function('Multiply', [u, u])]);
    expect(expanded.toString()).toBe(sn(fn(node)).evaluate().toString());
  });

  test('A symbol bound to another definition is not a copy', () => {
    const { ce } = engineWithCounter();
    ce.assign('x', 1);
    // The `x` of the block is a local of the block, the other two are the
    // global `x`.
    const e = ce.box([
      'List',
      costly(['Add', 'x', 1]),
      ['Block', ['Declare', 'x', "'integer'", 5], costly(['Add', 'x', 1])],
      costly(['Add', 'x', 1]),
    ] as any);
    expect(e.evaluate().toString()).toBe('[4,12,4]');
  });

  test('An exact number and a float with the same value are not copies', () => {
    const ce = new ComputeEngine();
    // `1/4` and `0.25` have the same hash.
    const e = ce.box([
      'List',
      ['Sqrt', ['Rational', 1, 4]],
      ['Sqrt', 0.25],
      ['Sqrt', ['Rational', 1, 4]],
      ['Sqrt', 0.25],
    ] as any);
    expect(e.evaluate().toString()).toBe('[1/2,0.5,1/2,0.5]');
  });

  test('Copies of an impure expression are evaluated at each occurrence', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'List',
      ['Random'],
      ['Random'],
      ['Random'],
      ['Random'],
    ] as any);
    const values = e.evaluate().ops!.map((x) => x.re);
    expect(new Set(values).size).toBe(4);
  });

  test('Copies in the body of a function read the parameter of each call', () => {
    const { ce } = engineWithCounter();
    ce.declare('g', 'function');
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Add', costly(['Add', 'n', 1]), costly(['Add', 'n', 1])],
        'n',
      ] as any)
    );
    // g(1) = 4 + 4, g(2) = 6 + 6
    const e = ce.box(['List', ['g', 1], ['g', 2], ['g', 1], ['g', 2]] as any);
    expect(e.evaluate().toString()).toBe('[8,12,8,12]');
  });

  test('A copy read after an assignment reads the new value', () => {
    const { ce } = engineWithCounter();
    ce.assign('x', 1);
    ce.declare('r', 'real');
    const e = ce.box([
      'Block',
      ['Assign', 'r', costly(['Add', 'x', 1])],
      ['Assign', 'x', 5],
      ['List', 'r', costly(['Add', 'x', 1]), costly(['Add', 'x', 1])],
    ] as any);
    expect(e.evaluate().toString()).toBe('[4,12,12]');
  });

  // A jest time limit cannot stop a synchronous test, so the time is
  // measured and compared to a generous limit. Each tower has 31 distinct
  // nodes and 2^30 paths: a comparison that does not remember the pairs it
  // accepted walks the paths.
  test('Two copies of a tower of shared nodes are compared in linear time', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    const tower = () => {
      let t = ce.box(['Add', 'x', 1]);
      for (let i = 0; i < 30; i++) t = ce.function('Max', [t, t]);
      return t;
    };
    const e = ce.function('List', [tower(), tower()]);
    const compare = jest.spyOn(
      BoxedFunction as unknown as { _sameFunctionNodes: () => boolean },
      '_sameFunctionNodes'
    );
    try {
      expect(e.evaluate().json).toEqual(['List', 3, 3]);
      // One comparison for each of the 31 pairs of distinct nodes.
      expect(compare.mock.calls.length).toBeGreaterThan(0);
      expect(compare.mock.calls.length).toBeLessThanOrEqual(31);
    } finally {
      compare.mockRestore();
    }
  });

  // Listing the integers of each row would read 2 * 10^9 numbers, many
  // minutes; the limit of 2 s is far above the time of the look-up. The time
  // is checked only under `CE_PERF=1`: in a normal run, other workers load
  // the machine.
  test('A copy of a long Range is found without listing its integers', () => {
    const ce = new ComputeEngine();
    const rows: unknown[] = ['List'];
    for (let i = 0; i < 2_000; i++) rows.push(['Range', 1, 1_000_000]);
    const start = Date.now();
    expect(ce.box(['Shape', rows] as any).evaluate().json).toEqual([
      'Tuple',
      2_000,
      1_000_000,
    ]);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(2000);
  });

  test('A held expression deeper than the call stack evaluates', () => {
    const ce = new ComputeEngine();
    let t = ce.box('x');
    for (let i = 0; i < 20_000; i++) t = ce.function('Sin', [t]);
    const held = ce.function('Hold', [t]);
    // The look-up of a copy reads the structure hash of the held expression.
    // The result is not printed: a failed `expect` would print the
    // expression, which overflows the stack.
    let operator: string | undefined;
    expect(() => {
      operator = held.evaluate().operator;
    }).not.toThrow();
    expect(operator).toBe('Hold');
  });

  test('The engine state is restored when the look-up of a copy throws', () => {
    const ce = new ComputeEngine();
    // The structure hash is read only by the look-up of a copy. It throws
    // here as a stack overflow on a very deep expression would.
    const hash = jest
      .spyOn(
        BoxedFunction.prototype as unknown as {
          _sharedStructureHash: () => number;
        },
        '_sharedStructureHash'
      )
      .mockImplementation(() => {
        throw new RangeError('Maximum call stack size exceeded');
      });
    try {
      expect(() => ce.box(['Sin', ['Add', 'x', 1]]).evaluate()).toThrow(
        RangeError
      );
    } finally {
      hash.mockRestore();
    }
    const engine = ce as unknown as {
      _evaluationDepth: number;
      _evaluationEffects: object | undefined;
    };
    expect(engine._evaluationDepth).toBe(0);
    expect(engine._evaluationEffects).toBeUndefined();
    expect(ce.box(['Add', 1, 2]).evaluate().json).toEqual(3);
  });

  test('Copies of a scoped expression are evaluated each, with their value', () => {
    const ce = new ComputeEngine();
    const sum = () => ['Sum', 'k', ['Limits', 'k', 1, 3]];
    const e = ce.box(['Add', sum(), sum(), ['Multiply', 2, sum()]] as any);
    expect(e.evaluate().json).toEqual(24);
  });
});
