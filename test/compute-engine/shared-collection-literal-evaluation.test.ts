/**
 * A `Tuple` or `List` literal whose operands share a node evaluates that node
 * once per evaluation, not once per path to it.
 *
 * With `a0 := Map(…)`, `a1 := Tuple(a0, a0)`, …, `aN := Tuple(a(N-1),
 * a(N-1))`, each read of `aN` evaluates its stored value. The evaluate memo
 * did not keep the result of a `Tuple` or `List` node, so a shared operand
 * was evaluated again on each path: 2^N walks, about 30 s at depth 16, and a
 * result with a separate copy of each path. The memo now keeps the result of
 * these two operators, keyed on the generation
 * (`BoxedFunction._storeLazyCollectionValue`), so a value write still gives
 * a new value.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

function run(ce: ComputeEngine, src: string): string {
  const result: any = executeEpsil(ce, src);
  expect((result.diagnostics ?? []).map((d: any) => d.message)).toEqual([]);
  return String(result.value ?? result.result);
}

// The chain `a1 := wrap(a0, a0)`, …, `an := wrap(a(n-1), a(n-1))` in a loop,
// with a `Map` view that reads the loop index at the bottom. The first
// iteration stores the top of the chain in an outer variable. The view is
// finite: a result that holds an infinite view with an element memo, at any
// depth, is not kept, and such a chain is still evaluated once per path.
function chainInLoop(n: number, wrap: (x: string) => string): string {
  const lines = [
    'let h = 0',
    'for d in [3, 6] {',
    '  let a0 = map(x => x + d, Range(1, 1000))',
  ];
  for (let i = 1; i <= n; i++) lines.push(`  let a${i} = ${wrap(`a${i - 1}`)}`);
  lines.push(`  if d == 3 { h = a${n} }`, '}');
  return lines.join('\n');
}

const firstLeaf = (n: number) => `take(h${'[1]'.repeat(n)}, 2)`;

function distinctNodes(e: any, seen = new Set<unknown>()): number {
  if (!seen.has(e)) {
    seen.add(e);
    // A finite view in a tuple is replaced by the list of its elements: a
    // leaf of the count, as a view is.
    if (e.operator !== 'Map' && e.operator !== 'List')
      for (const op of e.ops ?? []) distinctNodes(op, seen);
  }
  return seen.size;
}

describe('a shared operand of a collection literal is evaluated once', () => {
  test('a chain of tuples of depth 20 in a loop', () => {
    const ce = new ComputeEngine();
    const start = Date.now();
    // The element reads the value of the index in the iteration that made
    // the view: `d = 3`.
    expect(run(ce, `${chainInLoop(20, (a) => `Tuple(${a}, ${a})`)}\n${firstLeaf(20)}`)).toBe(
      '[4,5]'
    );
    // A time bound fails on a loaded machine with no change to the code, so
    // it runs only under `CE_PERF=1`. Before the fix, depth 16 took about
    // 30 s.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(5000);
    // The result keeps the sharing: one node per level (and the `Map`
    // leaves), not 2^20 nodes.
    expect(distinctNodes(ce.symbol('h').value)).toBeLessThan(50);
  });

  test('a chain of lists of depth 20 in a loop', () => {
    const ce = new ComputeEngine();
    const start = Date.now();
    expect(run(ce, `${chainInLoop(20, (a) => `[${a}, ${a}]`)}\n${firstLeaf(20)}`)).toBe('[4,5]');
    // A time bound fails on a loaded machine with no change to the code, so
    // it runs only under `CE_PERF=1`. Before the fix, depth 16 took about
    // 30 s.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('the entry of a tuple does not serve a read after a write', () => {
  // The assignment of `t` stores the variables that the collection reads
  // with their values at that statement, but a variable that holds a
  // function is stored as that function, a closure that reads the later
  // values of its own variables (`src/epsil/docs/evaluation.md`). So the
  // view `map(f, …)` reads the current value of `d`, and the second read
  // must give the new elements, not the entry of the first read.
  test('the same stored tuple read before and after a write of its input', () => {
    const ce = new ComputeEngine();
    expect(
      run(
        ce,
        [
          'let d = 3',
          'let f = x => x + d',
          'let t = Tuple(map(f, Range(1, Infinity)), d)',
          'let before = take(t[1], 2)',
          'd = 5',
          '[before, take(t[1], 2), t[2]]',
        ].join('\n')
      )
    ).toBe('[[4,5],[6,7],3]');
  });

  // With an inline function too: the function keeps the activation it was
  // made in and reads `d` when an element is computed.
  test('a stored tuple whose inline function reads a variable reads it when an element is computed', () => {
    const ce = new ComputeEngine();
    expect(
      run(
        ce,
        [
          'let d = 3',
          'let t = Tuple(map(x => x + d, Range(1, Infinity)), d)',
          'let before = take(t[1], 2)',
          'd = 5',
          '[before, take(t[1], 2), t[2]]',
        ].join('\n')
      )
    ).toBe('[[4,5],[6,7],3]');
  });

  test('the same tuple node evaluated before and after a write', () => {
    const ce = new ComputeEngine();
    ce.assign('d', 3);
    const t = ce.function('Tuple', [
      ce.box(['Add', 'd', 1]),
      ce.box(['Map', ['Function', ['Add', 'x', 'd'], 'x'], ['Range', 1, 3]]),
    ]);
    expect(t.evaluate().json).toEqual(['Tuple', 4, ['List', 4, 5, 6]]);
    ce.assign('d', 5);
    expect(t.evaluate().json).toEqual(['Tuple', 6, ['List', 6, 7, 8]]);
  });

  test('the same list node evaluated before and after a write', () => {
    const ce = new ComputeEngine();
    ce.assign('d', 3);
    const l = ce.function('List', [ce.box(['Add', 'd', 1]), ce.symbol('d')]);
    expect(l.evaluate().json).toEqual(['List', 4, 3]);
    ce.assign('d', 5);
    expect(l.evaluate().json).toEqual(['List', 6, 5]);
  });

  test('each iteration of a loop reads its own index', () => {
    const ce = new ComputeEngine();
    expect(
      run(
        ce,
        [
          'let r = []',
          'for d in [3, 6] { r = [...r, Tuple(d, [d, d + 1])] }',
          'r',
        ].join('\n')
      )
    ).toBe('[(3, [3,4]),(6, [6,7])]');
  });
});

describe('a tuple or list that reads an impure value is not kept', () => {
  // The purity of a symbol does not follow its value: `List(r)` is pure by
  // its own flags, and a kept result would answer the first draw again.
  test.each(['List', 'Tuple'])('%s of a symbol whose value is Random()', (op) => {
    const ce = new ComputeEngine();
    ce.declare('r', {
      type: 'real',
      value: ce.box(['Random'], { form: 'raw' }),
    });
    const e = ce.box([op, 'r', 'r']);
    const draws = new Set<number>();
    for (let i = 0; i < 4; i++) draws.add(e.evaluate().ops[0].re);
    expect(draws.size).toBeGreaterThan(1);
  });
});

describe('a list that holds an infinite view with an element memo', () => {
  // The element cache of an infinite `Iterate` view grows with each read,
  // so a result that holds one as an element is not kept: each evaluation
  // gives a new result.
  test('is not kept', () => {
    const ce = new ComputeEngine();
    ce.assign('s', 1);
    const e = ce.box([
      'List',
      ['Iterate', ['Function', ['Add', 'x', 1], 'x'], 's'],
      's',
    ]);
    expect(e.evaluate()).not.toBe(e.evaluate());
    // A list of finite values is kept.
    const f = ce.box(['List', ['Add', 's', 1], 's']);
    expect(f.evaluate()).toBe(f.evaluate());
  });
});

describe('a result that holds an infinite view with an element memo at any depth', () => {
  test.each([
    ['a list in a list', ['List', ['List', 'v', 's'], 's']],
    ['a tuple in a list', ['List', ['Tuple', 'v', 's'], 's']],
  ])('%s is not kept', (_label, expr) => {
    const ce = new ComputeEngine();
    ce.assign('s', 1);
    const iterate = ['Iterate', ['Function', ['Add', 'x', 1], 'x'], 's'];
    const e = ce.box(
      JSON.parse(JSON.stringify(expr).replace('"v"', JSON.stringify(iterate)))
    );
    expect(e.evaluate()).not.toBe(e.evaluate());
  });

  test('the second level of a chain over an infinite view is not kept', () => {
    const ce = new ComputeEngine();
    const view = ['Map', ['Function', ['Add', 'x', 1], 'x'], ['Range', 1, 'PositiveInfinity']];
    const e = ce.box(['List', ['List', view, view], ['List', view, view]]);
    expect(e.evaluate()).not.toBe(e.evaluate());
  });
});

describe('the retention walk reads a shared node once', () => {
  // A chain of dictionaries `d(n+1) = {p: d(n), q: d(n)}`: a walk that read
  // each path took about 0.8 s at depth 20 for one store, against a few
  // milliseconds with one read per node.
  test('a chain of dictionaries of depth 20 in a tuple', () => {
    const ce = new ComputeEngine();
    ce.assign('s', 1);
    const entry = (k: string, v: any) =>
      ce.function('KeyValuePair', [ce.string(k), v]);
    let d: any = ce.function('Dictionary', [entry('p', ce.number(1))]);
    for (let i = 0; i < 20; i++)
      d = ce.function('Dictionary', [entry('p', d), entry('q', d)]);
    const t = ce.function('Tuple', [d, ce.symbol('s')]);
    const start = Date.now();
    const first = t.evaluate();
    expect(first.operator).toBe('Tuple');
    expect(t.evaluate()).toBe(first);
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('a result that holds an infinite view through a view without an element memo', () => {
  // `Rest` and `Zip` keep no element of their own, but the elements of the
  // inner `Map` view are kept in its cache as they are read through them.
  const view = [
    'Map',
    ['Function', ['Add', 'x', 1], 'x'],
    ['Range', 1, 'PositiveInfinity'],
  ];
  test.each([
    ['Rest', ['Rest', view]],
    ['Zip', ['Zip', view, ['Range', 1, 'PositiveInfinity']]],
  ])('%s is not kept', (_label, wrapped) => {
    const ce = new ComputeEngine();
    ce.assign('s', 1);
    const e = ce.box(['Tuple', wrapped, 's']);
    expect(e.evaluate()).not.toBe(e.evaluate());
  });
});
