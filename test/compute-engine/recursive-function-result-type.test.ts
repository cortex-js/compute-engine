/**
 * A self-recursive function declared with a placeholder result
 * (`(unknown, unknown) -> unknown`) and assigned a list-building body is
 * typed `list<T>`. The recursive call reads the declared result, `unknown`,
 * while the body is typed, and an `unknown` operand of `Join` or `Append`
 * may hold a set, so the body derived `collection<number>` (row 338 of the
 * Tycho ledger, `tycho/docs/COMPUTE_ENGINE.md`, 2026-09-29). The derivation
 * now re-types the body under the hypothesis that the result is a list and
 * keeps the hypothesis only when that pass reproduces it. A base clause that
 * builds a set refutes it.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

/** `F(n, K) = { n = K - 1: [n], otherwise: join([n], F(n + 1, K)) }` with
 * the given join head and base-clause head. */
function recursion(join: string, base: string) {
  return [
    'Function',
    [
      'Which',
      ['Equal', 'n', ['Subtract', 'K', 1]],
      [base, 'n'],
      'True',
      [join, [base, 'n'], ['F', ['Add', 'n', 1], 'K']],
    ],
    'n',
    'K',
  ];
}

function declareAndAssign(body: any): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('F', '(unknown, unknown) -> unknown');
  ce.assign('F', ce.box(body));
  return ce;
}

describe('a list-building self-recursion is typed list<T> (Tycho row 338)', () => {
  test.each(['Join', 'ListJoin'])('with %s in the recursive clause', (join) => {
    const ce = declareAndAssign(recursion(join, 'List'));
    expect(ce.box('F').type.toString()).toBe(
      '(unknown, unknown) -> list<number>'
    );
    expect(ce.box(['F', 0, 5]).type.toString()).toBe('list<number>');
    expect(ce.box(['F', 0, 5]).evaluate().toString()).toBe('[0,1,2,3,4]');
    // The recursive clause itself, boxed outside the body, reads the derived
    // result.
    expect(
      ce.box([join, ['List', 'n'], ['F', ['Add', 'n', 1], 'K']]).type.toString()
    ).toBe('list<number>');
  });

  test('with Append in the recursive clause', () => {
    const ce = declareAndAssign([
      'Function',
      [
        'Which',
        ['Equal', 'n', ['Subtract', 'K', 1]],
        ['List', 'n'],
        'True',
        ['Append', ['F', ['Add', 'n', 1], 'K'], 'n'],
      ],
      'n',
      'K',
    ]);
    expect(ce.box('F').type.toString()).toBe(
      '(unknown, unknown) -> list<number>'
    );
    expect(ce.box(['F', 0, 3]).evaluate().toString()).toBe('[2,1,0]');
  });

  test('a set-building base clause refutes the hypothesis', () => {
    const ce = declareAndAssign(recursion('Join', 'Set'));
    expect(ce.box('F').type.toString()).toBe('(unknown, unknown) -> set<any>');
    expect(ce.box(['F', 0, 3]).evaluate().toString()).toBe('Set(0, 1, 2)');
  });

  test('parse route', () => {
    const ce = new ComputeEngine();
    ce.declare('F', '(unknown, unknown) -> unknown');
    ce.assign(
      'F',
      ce.parse(
        '(n, K) \\mapsto \\begin{cases} [n] & n = K-1 \\\\ \\operatorname{Join}([n], F(n+1, K)) & \\text{otherwise} \\end{cases}'
      )
    );
    expect(ce.box('F').type.toString()).toBe(
      '(unknown, unknown) -> list<number>'
    );
  });

  test('a head bound to the recursion and the compiled route read the list type', () => {
    const ce = declareAndAssign(recursion('Join', 'List'));
    ce.declare('C', 'unknown');
    ce.assign('C', ce.box(['F', 0, 5]));
    expect(ce.box('C').type.toString()).toBe('list<number>');
    const result = compile(ce.box(['F', 0, 5]), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run({})).toEqual([0, 1, 2, 3, 4]);
  });

  test('a numeric recursion and a non-recursive body are typed as before', () => {
    const ce = new ComputeEngine();
    ce.declare('fact', '(unknown) -> unknown');
    ce.assign(
      'fact',
      ce.box([
        'Function',
        [
          'Which',
          ['LessEqual', 'n', 1],
          1,
          'True',
          ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
        ],
        'n',
      ])
    );
    expect(ce.box('fact').type.toString()).toBe('(unknown) -> number');
    expect(ce.box(['fact', 5]).evaluate().toString()).toBe('120');
    ce.declare('g', '(unknown) -> unknown');
    ce.assign('g', ce.box(['Function', ['Join', ['List', 'x'], 'x'], 'x']));
    expect(ce.box('g').type.toString()).toBe(
      '(collection<any>) -> collection<any>'
    );
  });
});

describe('a mutually recursive pair is covered by the hypothesis', () => {
  /** `F` builds the collection through `G`, and `G` calls `F` back. The
   * hypothesis runs for a function whose body reaches its own name through
   * the functions it calls, so both are typed `list<number>`. */
  function mutual(base: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('F', '(unknown, unknown) -> unknown');
    ce.declare('G', '(unknown, unknown) -> unknown');
    ce.assign(
      'F',
      ce.box([
        'Function',
        [
          'Which',
          ['Equal', 'n', ['Subtract', 'K', 1]],
          [base, 'n'],
          'True',
          ['Join', [base, 'n'], ['G', ['Add', 'n', 1], 'K']],
        ],
        'n',
        'K',
      ])
    );
    ce.assign('G', ce.box(['Function', ['F', 'n', 'K'], 'n', 'K']));
    return ce;
  }

  test('a list base clause derives a list', () => {
    const ce = mutual('List');
    expect(ce.box('F').type.toString()).toBe(
      '(unknown, unknown) -> list<number>'
    );
    expect(ce.box('G').type.toString()).toBe(
      '(unknown, unknown) -> list<number>'
    );
    expect(ce.box(['G', 0, 4]).evaluate().toString()).toBe('[0,1,2,3]');
  });

  test('a set base clause derives set', () => {
    const ce = mutual('Set');
    // Bare `set` and `set<any>` denote the same type.
    expect(ce.box('F').type.toString()).toBe('(unknown, unknown) -> set');
    expect(ce.box('G').type.toString()).toBe('(unknown, unknown) -> set');
  });
});

describe('a pair that is also self-recursive', () => {
  // `F` calls itself and `G`, and `G` calls `F`. The signature of `G` is
  // derived while the one of `F` is, and reads a provisional `F`: that
  // result is not memoized, so `G` is derived again once `F` is settled.
  function pair(order: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('F', '(unknown, unknown) -> unknown');
    ce.declare('G', '(unknown, unknown) -> unknown');
    const F = [
      'Function',
      [
        'Which',
        ['Equal', 'n', ['Subtract', 'K', 1]],
        ['List', 'n'],
        ['Equal', 'n', ['Subtract', 'K', 2]],
        ['Join', ['List', 'n'], ['F', ['Add', 'n', 1], 'K']],
        'True',
        ['Join', ['List', 'n'], ['G', ['Add', 'n', 1], 'K']],
      ],
      'n',
      'K',
    ];
    const G = ['Function', ['F', 'n', 'K'], 'n', 'K'];
    for (const name of order) ce.assign(name, ce.box(name === 'F' ? F : G));
    return ce;
  }

  test.each(['FG', 'GF'])('assigned in the order %s', (order) => {
    const ce = pair(order);
    expect(ce.box('F').type.toString()).toBe(
      '(unknown, unknown) -> list<number>'
    );
    expect(ce.box('G').type.toString()).toBe(
      '(unknown, unknown) -> list<number>'
    );
    expect(ce.box(['G', 0, 4]).evaluate().toString()).toBe('[0,1,2,3]');
    // A second read gives the same answer.
    expect(ce.box('G').type.toString()).toBe(
      '(unknown, unknown) -> list<number>'
    );
  });
});

describe('a list-building self-recursion assigned without a declaration', () => {
  // The inferred signature of the undeclared name takes the hypothesis too
  // (`_refineRecursiveListResult`).
  test('is typed list<number>', () => {
    const ce = new ComputeEngine();
    ce.assign('F', ce.box(recursion('Join', 'List')));
    expect(ce.box('F').type.toString()).toBe(
      '(n: unknown, K: unknown) -> list<number>'
    );
    expect(ce.box(['F', 0, 5]).type.toString()).toBe('list<number>');
    expect(ce.box(['F', 0, 5]).evaluate().toString()).toBe('[0,1,2,3,4]');
  });

  test('a set base clause refutes the hypothesis', () => {
    const ce = new ComputeEngine();
    ce.assign('F', ce.box(recursion('Join', 'Set')));
    // Bare `set` and `set<any>` denote the same type.
    expect(ce.box('F').type.toString()).toBe('(n: unknown, K: unknown) -> set');
  });
});

describe('a call typed from the body of a recursive function', () => {
  // The body of `m` is typed with each parameter set to the type of its
  // argument (`callResultType`, call-result-type.ts). The self-call in the
  // other branch has no derived type, and a join with it kept only the base
  // case: `m(1, [0])` was typed `vector<integer^1>` and evaluates to
  // `[1, 2]`. The call now keeps the declared result.
  const body = [
    'Function',
    ['If', ['Equal', 'n', 0], 's', ['m', ['Subtract', 'n', 1], ['List', 1, 2]]],
    'n',
    's',
  ];

  test.each([
    ['assigned', false],
    ['declared as a function, then assigned', true],
  ])('%s', (_, declare) => {
    const ce = new ComputeEngine();
    if (declare) ce.declare('m', 'function');
    ce.assign('m', ce.box(body));
    const call = ce.box(['m', 1, ['List', 0]]);
    expect(call.evaluate().toString()).toBe('[1,2]');
    expect(call.type.toString()).not.toBe('vector<integer^1>');
    expect(call.type.isUnknown).toBe(true);
  });

  test('a recursion that is not a branch evaluates as before', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'fact',
      ce.box([
        'Function',
        [
          'If',
          ['LessEqual', 'n', 1],
          1,
          ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
        ],
        'n',
      ])
    );
    expect(ce.box(['fact', 5]).evaluate().toString()).toBe('120');
  });
});
