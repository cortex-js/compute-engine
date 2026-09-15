import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';
import type { MathJsonExpression } from '../../src/math-json/types';

function bindListBuilder(
  ce: ComputeEngine,
  body: MathJsonExpression,
  params = ['n'],
  effects = ''
): void {
  ce.declare(
    'F',
    `(${params.map(() => 'number').join(', ')}) ${effects} -> list<number>`
  );
  ce.assign('F', ce.box(['Function', body, ...params]));
}

function countingBody(
  bound: MathJsonExpression = 'K',
  step: MathJsonExpression = ['Add', 'n', 1],
  element: MathJsonExpression = 'n'
): MathJsonExpression {
  return [
    'Which',
    ['Equal', 'n', bound],
    ['List', element],
    'True',
    ['Join', ['List', element], ['F', step]],
  ];
}

function values(ce: ComputeEngine, args: MathJsonExpression[] = [0]) {
  return Array.from(
    ce
      .box(['F', ...args])
      .evaluate()
      .each(),
    (x) => x.json
  );
}

function expectIterationLimit(run: () => unknown): void {
  let error: unknown;
  try {
    run();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(CancellationError);
  expect((error as CancellationError).cause).toBe('iteration-limit-exceeded');
}

describe('list-building recursion execution', () => {
  test('the stored source remains recursive before and after evaluation', () => {
    const ce = new ComputeEngine();
    ce.assign('K', 4);
    bindListBuilder(ce, countingBody());
    const source = ce.box('F').value!.json;
    const serialized = JSON.stringify(source);
    expect(serialized).toContain('"F"');
    expect(serialized).not.toContain('"Map"');
    expect(serialized).not.toContain('"Range"');
    expect(values(ce)).toEqual([0, 1, 2, 3, 4]);
    expect(values(ce, [2])).toEqual([2, 3, 4]);
    expect(ce.box('F').value!.json).toEqual(source);
    ce.assign('K', 5);
    expect(values(ce, [3])).toEqual([3, 4, 5]);
    expect(ce.box('F').value!.json).toEqual(source);
  });

  test('a parsed tuple-valued builder preserves the declared return type', () => {
    const ce = new ComputeEngine();
    ce.assign('D', 5);
    ce.declare('P', '(number) -> tuple<number, number, number>');
    ce.assign('P', ce.parse('n \\mapsto (n, 2n, 3n)'));
    ce.declare('F', '(number) -> list<tuple<number, number, number>>');
    ce.assign(
      'F',
      ce.parse(
        'n \\mapsto \\left\\{n=D-1:\\left[P(n)\\right], \\left[P(n)\\right].\\operatorname{join}\\left(F(n+1)\\right)\\right\\}'
      )
    );
    expect(ce.box(['F', 0]).evaluate().toString()).toBe(
      '[(0, 0, 0),(1, 2, 3),(2, 4, 6),(3, 6, 9),(4, 8, 12)]'
    );
  });

  test('a 10,000-element build stays below the recursion limit', () => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 16;
    ce.iterationLimit = 10001;
    ce.assign('K', 9999);
    bindListBuilder(ce, countingBody());
    expect(values(ce)).toEqual(Array.from({ length: 10000 }, (_, i) => i));
  });

  test('results larger than the collection cap remain fully iterable', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 3;
    ce.recursionLimit = 4;
    bindListBuilder(ce, countingBody(9));
    const result = ce.box(['F', 0]).evaluate();
    expect(result.operator).toBe('Join');
    expect(Array.from(result.each(), (x) => x.json)).toEqual(
      Array.from({ length: 10 }, (_, i) => i)
    );
  });

  test('a captured literal calls the current recursive binding', () => {
    const ce = new ComputeEngine();
    bindListBuilder(ce, countingBody(2));
    const original = ce.box('F').value!;
    ce.assign('F', ce.box(['Function', ['List', 99], 'n']));
    const result = ce.function('Apply', [original, ce.Zero]).evaluate();
    expect(Array.from(result.each(), (x) => x.json)).toEqual([0, 99]);
  });

  test.each(['unresolved', 'NaN'])(
    '%s bounds retain ordinary conditional evaluation',
    (bound) => {
      const run = (ordinary: boolean) => {
        const ce = new ComputeEngine();
        if (bound === 'unresolved') ce.declare('K', 'number');
        else ce.assign('K', NaN);
        const body: MathJsonExpression = [
          'Which',
          ['Equal', 'n', 'K'],
          ['List', 'n'],
          ['GreaterEqual', 'n', 3],
          ['List', 99],
          'True',
          ['Join', ['List', 'n'], ['F', ['Add', 'n', 1]]],
        ];
        // The extra pure statement preserves evaluation but prevents a plan.
        bindListBuilder(ce, ordinary ? ['Block', 0, body] : body);
        return ce.box(['F', 0]).evaluate().json;
      };
      expect(run(false)).toEqual(run(true));
    }
  );

  test.each(['next argument', 'list element'])(
    'an error in a %s matches ordinary recursive evaluation',
    (position) => {
      const run = (ordinary: boolean) => {
        const ce = new ComputeEngine();
        ce.declare('Fail', {
          signature: '(number) -> number',
          evaluate: ([n]) => (n.re === 0 ? ce.error('missing') : undefined),
        });
        const body = countingBody(
          2,
          position === 'next argument' ? ['Fail', 'n'] : ['Add', 'n', 1],
          position === 'list element' ? ['Fail', 'n'] : 'n'
        );
        bindListBuilder(ce, ordinary ? ['Block', 0, body] : body);
        return ce.box(['F', 0]).evaluate().json;
      };
      const expected = run(true);
      expect(JSON.stringify(expected)).toContain('"Error"');
      expect(run(false)).toEqual(expected);
    }
  );

  test.each([
    { start: 0, bound: 8, step: 2, expected: [0, 2, 4, 6, 8] },
    { start: 6, bound: 0, step: -2, expected: [6, 4, 2, 0] },
  ])('supports a step of $step', ({ start, bound, step, expected }) => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 2;
    bindListBuilder(ce, countingBody(bound, ['Add', 'n', step]));
    expect(values(ce, [start])).toEqual(expected);
  });

  test('evaluates non-additive next arguments', () => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 2;
    bindListBuilder(ce, countingBody(16, ['Multiply', 'n', 2]));
    expect(values(ce, [1])).toEqual([1, 2, 4, 8, 16]);
  });

  test('retains exact rational starts and steps', () => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 2;
    const third: MathJsonExpression = ['Rational', 1, 3];
    bindListBuilder(ce, countingBody(1, ['Add', 'n', third]));
    expect(ce.box(['F', third]).evaluate().toString()).toBe('[1/3,2/3,1]');
  });

  test('supports several guards, different prefixes and base lists', () => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 2;
    bindListBuilder(ce, [
      'Which',
      ['GreaterEqual', 'n', 4],
      ['List', 99, 100],
      ['Less', 'n', 2],
      ['Join', ['List', 'n', ['Negate', 'n']], ['F', ['Add', 'n', 1]]],
      'True',
      ['Join', ['List', ['Multiply', 'n', 10]], ['F', ['Add', 'n', 1]]],
    ]);
    expect(values(ce)).toEqual([0, 0, 1, -1, 20, 30, 99, 100]);
  });

  test('evaluates multiple next arguments using the current parameters', () => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 2;
    bindListBuilder(
      ce,
      [
        'Which',
        ['GreaterEqual', 'a', 5],
        ['List', 'a', 'b'],
        'True',
        ['Join', ['List', 'a'], ['F', 'b', ['Add', 'a', 'b']]],
      ],
      ['a', 'b']
    );
    expect(values(ce, [1, 1])).toEqual([1, 1, 2, 3, 5, 8]);
  });

  test('supports an empty base list', () => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 2;
    bindListBuilder(ce, [
      'Which',
      ['GreaterEqual', 'n', 3],
      ['List'],
      'True',
      ['Join', ['List', 'n'], ['F', ['Add', 'n', 1]]],
    ]);
    expect(values(ce)).toEqual([0, 1, 2]);
  });

  test.each([
    { start: 7, bound: 4, step: 1 },
    { start: 0, bound: 2.5, step: 1 },
    { start: 0, bound: 4, step: 0 },
  ])(
    'unreachable bound $bound from $start with step $step is cancelled',
    ({ start, bound, step }) => {
      const ce = new ComputeEngine();
      ce.iterationLimit = 24;
      ce.recursionLimit = 8;
      bindListBuilder(ce, countingBody(bound, ['Add', 'n', step]));
      expectIterationLimit(() => ce.box(['F', start]).evaluate());
    }
  );

  test('a bounded call succeeds after iteration-limit cancellation', () => {
    const ce = new ComputeEngine();
    ce.iterationLimit = 24;
    ce.recursionLimit = 8;
    ce.assign('K', 100);
    bindListBuilder(ce, countingBody());
    expectIterationLimit(() => ce.box(['F', 0]).evaluate());
    ce.assign('K', 3);
    expect(values(ce)).toEqual([0, 1, 2, 3]);
  });

  test('numeric evaluation agrees with evaluating then approximating', () => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 2;
    bindListBuilder(
      ce,
      countingBody(3, ['Add', 'n', 1], ['Divide', 1, ['Add', 'n', 1]])
    );
    const call = ce.box(['F', 0]);
    expect(Array.from(call.N().each(), (x) => x.re)).toEqual(
      Array.from(call.evaluate().each(), (x) => x.N().re)
    );
  });

  test('an effectful bound keeps one evaluation per recursive call', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Bound', {
      signature: '() random -> number',
      evaluate: () => {
        calls += 1;
        return ce.number(2);
      },
    });
    bindListBuilder(ce, countingBody(['Bound']), ['n'], 'random');
    calls = 0;
    expect(values(ce)).toEqual([0, 1, 2]);
    expect(calls).toBe(3);
  });

  test('an opaque element can change the bound during recursion', () => {
    const ce = new ComputeEngine();
    ce.assign('K', 2);
    ce.declare('P', {
      signature: '(number) any -> number',
      evaluate: ([n]) => {
        if (n.re === 0) ce.assign('K', 3);
        return n;
      },
    });
    bindListBuilder(
      ce,
      countingBody('K', ['Add', 'n', 1], ['P', 'n']),
      ['n'],
      'any'
    );
    expect(values(ce)).toEqual([0, 1, 2, 3]);
  });

  test('rechecks helper purity after redefinition and preserves the source', () => {
    const ce = new ComputeEngine();
    ce.assign('K', 2);
    ce.declare('P', '(number) any -> number');
    ce.assign('P', ce.box(['Function', 'n', 'n']));
    bindListBuilder(
      ce,
      countingBody('K', ['Add', 'n', 1], ['P', 'n']),
      ['n'],
      'any'
    );
    const source = ce.box('F').value!.json;
    expect(values(ce)).toEqual([0, 1, 2]);
    expect(ce.box('F').value!.json).toEqual(source);
    ce.assign(
      'P',
      ce.box(['Function', ['Block', ['Assign', 'K', 3], 'n'], 'n'])
    );
    expect(values(ce)).toEqual([0, 1, 2, 3]);
    expect(ce.box('F').value!.json).toEqual(source);
  });

  test('append recursion keeps reversed output through ordinary evaluation', () => {
    const ce = new ComputeEngine();
    bindListBuilder(ce, [
      'Which',
      ['Equal', 'n', 3],
      ['List', 'n'],
      'True',
      ['Join', ['F', ['Add', 'n', 1]], ['List', 'n']],
    ]);
    expect(values(ce)).toEqual([3, 2, 1, 0]);
  });
});
