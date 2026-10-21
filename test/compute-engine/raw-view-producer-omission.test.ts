import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { collectionElementType } from '../../src/common/type/utils';
import { isSubtype } from '../../src/common/type/subtype';
import type { Expression } from '../../src/compute-engine';

function first(view: Expression, n: number): unknown[] {
  const it = view.each();
  return Array.from({ length: n }, () => it.next().value?.json);
}

describe('raw producer omission', () => {
  test.each(['Tabulate', 'Table'])(
    '%s preserves positions and compacts only at ListFrom',
    (head) => {
      const ce = new ComputeEngine();
      const view = ce.box([
        head,
        ['Function', ['If', ['Equal', 'k', 2], 'Nothing', 'k'], 'k'],
        3,
      ]);
      expect(view.count).toBe(3);
      expect(first(view, 3)).toEqual([1, 'Nothing', 3]);
      expect(view.at(2)?.json).toBe('Nothing');
      expect(isSubtype('nothing', collectionElementType(view.type.type)!)).toBe(
        true
      );
      expect(ce.box(['ListFrom', view]).evaluate().json).toEqual([
        'List',
        1,
        3,
      ]);
      expect(compile(view).success).toBe(false);
    }
  );

  test('2-D Tabulate keeps each row lazy and omits only when that row is collected', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('cell', {
      signature: '(integer, integer) -> integer | nothing',
      evaluate: ([i, j]) => {
        calls += 1;
        return j.is(2) ? ce.Nothing : i.add(j);
      },
    });
    const view = ce.box(['Tabulate', 'cell', 2, 3]);
    expect(view.count).toBe(2);
    const row = view.at(1)!;
    expect(row.count).toBe(3);
    expect(calls).toBe(0);
    expect(row.at(2)?.json).toBe('Nothing');
    expect(calls).toBe(1);
    expect(first(row, 3)).toEqual([2, 'Nothing', 4]);
    const rowType = collectionElementType(view.type.type)!;
    expect(isSubtype('nothing', rowType)).toBe(false);
    expect(isSubtype('nothing', collectionElementType(rowType)!)).toBe(true);
    expect(ce.box(['ListFrom', row]).evaluate().json).toEqual(['List', 2, 4]);
    expect(compile(view).success).toBe(false);
  });

  test('Scan retains each callback result, including Nothing', () => {
    const ce = new ComputeEngine();
    const view = ce.box([
      'Scan',
      ['List', 1, 2, 3],
      ['Function', ['If', ['Equal', 'x', 2], 'Nothing', 'x'], 'a', 'x'],
      0,
    ]);
    expect(view.count).toBe(3);
    expect(first(view, 3)).toEqual([1, 'Nothing', 3]);
    expect(view.at(2)?.json).toBe('Nothing');
    expect(isSubtype('nothing', collectionElementType(view.type.type)!)).toBe(
      true
    );
    expect(ce.box(['ListFrom', view]).evaluate().json).toEqual(['List', 1, 3]);
    expect(compile(view).success).toBe(false);
  });

  test('Iterate preserves omitted positions in a bounded demand', () => {
    const ce = new ComputeEngine();
    const view = ce.box([
      'Iterate',
      ['Function', ['If', ['Equal', 'k', 2], 'Nothing', 'k'], 'k', 'a'],
      0,
    ]);
    expect(view.count).toBe(Infinity);
    expect(first(view, 3)).toEqual([1, 'Nothing', 3]);
    expect(view.at(2)?.json).toBe('Nothing');
    expect(isSubtype('nothing', collectionElementType(view.type.type)!)).toBe(
      true
    );
    expect(ce.box(['ListFrom', ['Take', view, 3]]).evaluate().json).toEqual([
      'List',
      1,
      3,
    ]);
    expect(compile(ce.box(['Take', view, 3])).success).toBe(false);
  });

  test.each(['Tabulate', 'Scan', 'Iterate'])(
    '%s count does not run its callback',
    (head) => {
      const ce = new ComputeEngine();
      let calls = 0;
      ce.declare('tick', {
        signature: '(integer, integer?) -> integer',
        evaluate: () => {
          calls++;
          return ce.One;
        },
      });
      const view =
        head === 'Scan'
          ? ce.box([head, ['Range', 1, 1000000], 'tick', 0])
          : ce.box([head, 'tick', 1000000]);
      expect(view.count).toBe(head === 'Iterate' ? Infinity : 1000000);
      expect(calls).toBe(0);
    }
  );
});

describe('producer compilation retains its omission boundary', () => {
  test.each(['javascript', 'python'] as const)(
    'opaque callback results refuse %s compilation',
    (target) => {
      const ce = new ComputeEngine();
      ce.declare('generator', '(integer) -> any');
      ce.declare('reducer', '(any, integer) -> any');
      for (const view of [
        ce.box(['Tabulate', 'generator', 3]),
        ce.box(['Scan', ['List', 1, 2], 'reducer', 0]),
      ]) {
        if (target === 'python')
          expect(() => new PythonTarget().compile(view)).toThrow(/Nothing/);
        else expect(compile(view).success).toBe(false);
      }
    }
  );

  test('a numeric two-dimensional tabulation still compiles', () => {
    const ce = new ComputeEngine();
    const view = ce.box([
      'Tabulate',
      ['Function', ['Add', 'i', 'j'], 'i', 'j'],
      2,
      3,
    ]);
    const compiled = compile(view);
    expect(compiled.success).toBe(true);
    expect(compiled.run!({})).toEqual([
      [2, 3, 4],
      [3, 4, 5],
    ]);
    expect(first(view.at(2)!, 3)).toEqual([3, 4, 5]);
  });

  test('Iterate which always returns Nothing reports and retains omitted cells', () => {
    const ce = new ComputeEngine();
    const view = ce.box(['Iterate', ['Function', 'Nothing', 'x'], 0]);
    expect(isSubtype('nothing', collectionElementType(view.type.type)!)).toBe(
      true
    );
    expect(first(view, 3)).toEqual(['Nothing', 'Nothing', 'Nothing']);
    expect(ce.box(['ListFrom', ['Take', view, 3]]).evaluate().json).toEqual([
      'List',
    ]);
  });
});

test('a generated tabulation row never looks up a user-defined Apply', () => {
  const ce = new ComputeEngine();
  ce.declare('Apply', {
    signature: '(any*) -> string',
    evaluate: () => ce.string('user'),
  });
  const view = ce.box([
    'Tabulate',
    ['Function', ['Add', 'i', 'j'], 'i', 'j'],
    2,
    3,
  ]);
  expect(first(view.at(1)!, 3)).toEqual([2, 3, 4]);
});

test('rows preserve the captured generator and observe updates to that binding', () => {
  const ce = new ComputeEngine();
  ce.pushScope();
  ce.declare('generator', 'function');
  ce.assign('generator', ce.box(['Function', ['Add', 'i', 'j'], 'i', 'j']));
  const view = ce.box(['Tabulate', 'generator', 2, 3]);
  const row = view.at(1)!;
  expect(first(row, 3)).toEqual([2, 3, 4]);
  ce.assign(
    'generator',
    ce.box(['Function', ['Multiply', 'i', 'j'], 'i', 'j'])
  );
  expect(first(row, 3)).toEqual([1, 2, 3]);
  ce.popScope();
  ce.assign('generator', ce.box(['Function', 9, 'i', 'j']));
  expect(first(view.at(1)!, 3)).toEqual([1, 2, 3]);
});

test('a generated row has the outer tabulation element contract', () => {
  const ce = new ComputeEngine();
  ce.declare('cell', {
    signature: '(integer, integer) -> integer',
    evaluate: ([i, j]) => i.add(j),
  });
  const view = ce.box(['Tabulate', 'cell', 2, 3]);
  expect(
    isSubtype(view.at(1)!.type.type, collectionElementType(view.type.type)!)
  ).toBe(true);
});

test('two-dimensional iterator Table preserves omitted coordinates in its rows', () => {
  const ce = new ComputeEngine();
  const table = ce.box([
    'Table',
    ['If', ['Equal', 'j', 2], 'Nothing', ['Add', 'i', 'j']],
    ['Tuple', 'i', 1, 2],
    ['Tuple', 'j', 1, 3],
  ]);
  expect(table.count).toBe(2);
  expect(first(table.at(1)!, 3)).toEqual([2, 'Nothing', 4]);
});

test.each(['Tabulate', 'Scan'])(
  '%s cannot use a global proof for a runtime callback',
  (head) => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 7, 'a', 'b']));
    const body =
      head === 'Scan'
        ? ['Scan', ['List', 1, 2], 'h', 0]
        : ['Tabulate', 'h', 2, 3];
    const expr = ce.box([
      'Function',
      body,
      ['Typed', 'h', "'(integer, integer) -> any'"],
    ]);
    expect(compile(expr).success).toBe(false);
  }
);

test('a generated literal row round-trips without a hidden callable name', () => {
  const ce = new ComputeEngine();
  const view = ce.box([
    'Tabulate',
    ['Function', ['Add', 'i', 'j'], 'i', 'j'],
    2,
    3,
  ]);
  const row = view.at(1)!;
  expect(first(ce.box(row.json), 3)).toEqual([2, 3, 4]);
  expect(row.toString()).not.toContain('_tabulateGenerator');
  const listed = ce.box(['ListFrom', view]).evaluate();
  expect(listed.nops).toBe(2);
  expect(first(listed.op1, 3)).toEqual([2, 3, 4]);
  expect(ce.box(['Shape', view]).evaluate().json).toEqual(['Tuple', 2, 3]);
});

test('a generator name cannot collide with the generated row parameter', () => {
  const ce = new ComputeEngine();
  ce.assign(
    '_tabulateIndex',
    ce.box(['Function', ['Add', 'i', 'j'], 'i', 'j'])
  );
  const view = ce.box(['Tabulate', '_tabulateIndex', 2, 3]);
  expect(first(view.at(1)!, 3)).toEqual([2, 3, 4]);
});

test('reading an unresolved generator row does not require its callback to run', () => {
  const ce = new ComputeEngine();
  const view = ce.box(['Tabulate', 'notDefinedYet', 2, 3]);
  expect(view.count).toBe(2);
  expect(view.at(1)?.count).toBe(3);
});

test.each([[3], [2, 3]])(
  'Shape preserves raw Nothing coordinates for dimensions %j',
  (...dimensions) => {
    const ce = new ComputeEngine();
    const view = ce.box([
      'Tabulate',
      [
        'Function',
        [
          'If',
          ['Equal', dimensions.length === 1 ? 'i' : 'j', 2],
          'Nothing',
          ['Add', 'i', 1],
        ],
        'i',
        ...(dimensions.length === 1 ? [] : ['j']),
      ],
      ...dimensions,
    ]);
    expect(ce.box(['Shape', view]).evaluate().json).toEqual([
      'Tuple',
      ...dimensions,
    ]);
  }
);

test('Shape preserves omissions from an opaque scalar producer', () => {
  const ce = new ComputeEngine();
  ce.declare('opaque', {
    signature: '(integer) -> any',
    evaluate: ([x]) => (x.isSame(2) ? ce.Nothing : x),
  });
  const view = ce.box(['Tabulate', 'opaque', 3]);
  expect(ce.box(['Shape', view]).evaluate().json).toEqual(['Tuple', 3]);
});

test('Shape treats tuple cells as scalars beside omitted coordinates', () => {
  const ce = new ComputeEngine();
  ce.declare('opaque', {
    signature: '(integer) -> any',
    evaluate: ([x]) => (x.isSame(2) ? ce.Nothing : ce.tuple(1, 2)),
  });
  const view = ce.box(['Tabulate', 'opaque', 3]);
  expect(ce.box(['Shape', view]).evaluate().json).toEqual(['Tuple', 3]);
});

test.each([
  [[0, 3], [0]],
  [
    [2, 0],
    [2, 0],
  ],
])('Shape preserves an empty axis for dimensions %j', (dimensions, shape) => {
  const ce = new ComputeEngine();
  const view = ce.box([
    'Tabulate',
    ['Function', ['Add', 'i', 'j'], 'i', 'j'],
    ...dimensions,
  ]);
  expect(ce.box(['Shape', view]).evaluate().json).toEqual(['Tuple', ...shape]);
});
