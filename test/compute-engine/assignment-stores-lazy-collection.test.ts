/**
 * What an assignment statement stores for a lazy collection (user decision
 * 2026-09-30).
 *
 * `Filter`, `Map`, `Scan`, `TakeWhile` and a comprehension are lazy, and the
 * evaluated value keeps by name each variable it reads. Stored as it was, the
 * value followed later assignments of those variables, and a variable
 * assigned a collection over itself was never evaluated. An assignment
 * statement (`Assign`, `Declare` with a value) now stores the list of the
 * elements when the collection is finite and reads a variable
 * (`assignedValue`, `library/core.ts`). The host function `ce.assign()` is
 * not changed.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import {
  executeEpsil,
  parseEpsil,
  resolveLibraryNames,
} from '../../src/epsil';

function run(src: string): string {
  const result: any = executeEpsil(new ComputeEngine(), src);
  expect((result.diagnostics ?? []).map((d: any) => d.message)).toEqual([]);
  return String(result.value ?? result.result);
}

function compiled(src: string): unknown {
  const [program] = parseEpsil(src);
  const ce = new ComputeEngine();
  const result = compile(ce.box(resolveLibraryNames(program, src, ce)), {
    to: 'javascript',
  });
  if (!result.success) throw new Error(result.error);
  return result.run!({});
}

describe('a variable assigned a lazy collection over itself', () => {
  test.each([
    ['filter', 'xs = filter(xs, c => c > 1)', '[2,3]'],
    ['map', 'xs = map(c => c + 1, xs)', '[2,3,4]'],
    ['scan', 'xs = scan(xs, (a, b) => a + b)', '[1,3,6]'],
    ['takeWhile', 'xs = takeWhile(xs, c => c < 3)', '[1,2]'],
    // This one overflowed the stack.
    ['a comprehension', 'xs = [c * 2 for c in xs]', '[2,4,6]'],
  ])('%s holds the list of the elements', (_label, statement, expected) => {
    expect(run(`let xs = [1, 2, 3]\n${statement}\nxs`)).toBe(expected);
  });

  test('a later read is a computation over a list', () => {
    expect(
      run('let xs = [1, 2, 3]\nxs = filter(xs, c => c > 1)\nlength(xs)')
    ).toBe('2');
    expect(
      run('let xs = [1, 2, 3]\nxs = filter(xs, c => c > 1)\nfirst(xs)')
    ).toBe('2');
  });

  test('in a function body, over a parameter', () => {
    expect(
      run(
        'function h(a) { let out = a\n out = filter(out, c => c > 1)\n length(out) }\nh([1, 2, 3])'
      )
    ).toBe('2');
  });

  // The predicate kept `k` by name, and `k` does not exist after the loop.
  test('in a loop, the predicate reads the loop variable of that iteration', () => {
    const src =
      'let xs = [1, 2, 3, 4, 5, 6]\nfor k in [1, 2, 3] { xs = filter(xs, c => c > k) }\nxs';
    expect(run(src)).toBe('[4,5,6]');
    expect(compiled(src)).toEqual([4, 5, 6]);
  });
});

describe('a variable assigned a lazy collection over another variable', () => {
  test.each([
    ['filter', 'filter(xs, c => c > 1)', '[2,3]'],
    ['map', 'map(c => c + 1, xs)', '[2,3,4]'],
    ['a comprehension', '[c * 2 for c in xs]', '[2,4,6]'],
  ])('%s does not follow a later assignment', (_label, rhs, expected) => {
    expect(
      run(`let xs = [1, 2, 3]\nlet ys = ${rhs}\nxs = [7, 8]\nlistFrom(ys)`)
    ).toBe(expected);
  });

  test('a destructuring declaration stores each leaf in the same way', () => {
    expect(
      run(
        'let xs = [1, 2, 3]\nlet (ys, n) = (filter(xs, c => c > 1), 5)\nxs = [7, 8]\nlistFrom(ys)'
      )
    ).toBe('[2,3]');
  });

  // Epsil has no bare destructuring `=`; the operator form is reachable
  // from MathJSON.
  test('a destructuring assignment stores each leaf in the same way', () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2, 3]));
    ce.box([
      'Assign',
      ['Tuple', 'ys', 'n'],
      ['Tuple', ['Filter', 'xs', ['Function', ['Greater', 'c', 1], 'c']], 5],
    ]).evaluate();
    ce.assign('xs', ce.box(['List', 7, 8]));
    expect(ce.box(['ListFrom', 'ys']).evaluate().toString()).toBe('[2,3]');
  });

  test('a declaration with a type, and a constant', () => {
    expect(
      run(
        'let xs = [1, 2, 3]\nlet ys: list<number> = filter(xs, c => c > 1)\nxs = [7, 8]\nlistFrom(ys)'
      )
    ).toBe('[2,3]');
    expect(
      run(
        'let xs = [1, 2, 3]\nconst ys = filter(xs, c => c > 1)\nxs = [7, 8]\nlistFrom(ys)'
      )
    ).toBe('[2,3]');
  });

  test('a filter over a set stores a set', () => {
    const ce = new ComputeEngine();
    ce.assign('S', ce.box(['Set', 1, 2, 3]));
    ce.box([
      'Assign',
      'T',
      ['Filter', 'S', ['Function', ['Greater', 'c', 1], 'c']],
    ]).evaluate();
    ce.assign('S', ce.box(['Set', 9]));
    expect(ce.box('T').evaluate().operator).toBe('Set');
    expect(ce.box(['Length', 'T']).evaluate().toString()).toBe('2');
  });
});

describe('what stays lazy', () => {
  test('a collection that is not known to be finite', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 3);
    ce.box([
      'Assign',
      'evens',
      [
        'Filter',
        ['Range', 1, 'PositiveInfinity'],
        ['Function', ['Greater', 'c', 'k'], 'c'],
      ],
    ]).evaluate();
    const held = ce.box('evens').evaluate();
    expect(held.operator).toBe('Filter');
    expect(ce.box(['First', 'evens']).evaluate().toString()).toBe('4');
  });

  test('a lazy collection that reads no variable', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'r',
      ['Map', ['Function', ['Multiply', 'c', 2], 'c'], ['Range', 1, 1000000]],
    ]).evaluate();
    expect(ce.box('r').evaluate().operator).toBe('Map');
    expect(ce.box(['At', 'r', 10]).evaluate().toString()).toBe('20');
  });

  // A filter over a dictionary is a dictionary: listing it would store a
  // list of key-value pairs, which a keyed read does not understand.
  test('a lazy collection that is neither a list nor a set', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 2);
    const source = [
      'Dictionary',
      ['KeyValuePair', { str: 'a' }, 1],
      ['KeyValuePair', { str: 'b' }, 5],
    ];
    const filtered = [
      'Filter',
      source,
      ['Function', ['Greater', ['Second', 'c'], 'k'], 'c'],
    ];
    const before = ce.box(filtered as any).evaluate();
    ce.box(['Assign', 'z', filtered] as any).evaluate();
    const held = ce.box('z').evaluate();
    expect(held.operator).toBe(before.operator);
    expect(held.operator).not.toBe('List');
  });

  test('a very large collection is listed, not left as a live view', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 2);
    ce.box([
      'Assign',
      'big',
      ['Map', ['Function', ['Multiply', 'c', 'k'], 'c'], ['Range', 1, 300000]],
    ]).evaluate();
    ce.assign('k', 10);
    expect(ce.box(['At', 'big', 300000]).evaluate().toString()).toBe('600000');
  });

  // A host that defines one name from another wants the live view.
  test('the host function ce.assign() stores the value it is given', () => {
    const ce = new ComputeEngine();
    ce.assign('xs', ce.box(['List', 1, 2, 3]));
    ce.assign(
      'ys',
      ce
        .box(['Filter', 'xs', ['Function', ['Greater', 'c', 1], 'c']])
        .evaluate()
    );
    ce.assign('xs', ce.box(['List', 7, 8]));
    expect(ce.box(['ListFrom', 'ys']).evaluate().toString()).toBe('[7,8]');
  });
});
