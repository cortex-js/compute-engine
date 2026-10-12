import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import {
  memoDepsStillValid,
  snapshotMemoDeps,
} from '../../src/compute-engine/boxed-expression/collection-element-memo';
import { hasAsyncOnlyApplication } from '../../src/compute-engine/boxed-expression/async-only-descendants';
import { holdsAsyncOnlyOperator } from '../../src/compute-engine/boxed-expression/listed-element';

function countingPredicate(max: number) {
  const ce = new ComputeEngine();
  ce.maxCollectionSize = max;
  let calls = 0;
  ce.declare('P', {
    signature: '(number) -> boolean',
    pure: false,
    evaluate: () => {
      calls += 1;
      return ce.True;
    },
  });
  return { ce, calls: () => calls };
}

test.each([false, true])(
  'impure filter listing uses safe bounds (spread=%s)',
  (spread) => {
    for (const max of [1, 10]) {
      const { ce, calls } = countingPredicate(max);
      const filter = ce.box(['Filter', ['List', 1, 2, 3], 'P']);
      const value = (
        spread
          ? ce.function('ListJoin', [filter])
          : ce.function('List', [filter])
      ).evaluate();
      expect(calls()).toBe(max === 1 ? 0 : 3);
      const target = spread ? value : value.op1;
      expect([...target.each()].map((x) => x.re)).toEqual([1, 2, 3]);
      expect(calls()).toBe(3);
      expect(target.operator).toBe(
        max === 1 ? (spread ? 'ListJoin' : 'Filter') : 'List'
      );
    }
  }
);

test.each([false, true])(
  'nested listings reserve impure parent cells (spread=%s)',
  (spread) => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 4;
    let calls = 0;
    ce.declare('Rows', {
      signature: '(number) -> list<integer>',
      pure: false,
      evaluate: () => {
        calls += 1;
        return ce.box(['Range', 1, 3]);
      },
    });
    const map = ce.box(['Map', 'Rows', ['List', 1, 2]]);
    const value = (
      spread ? ce.function('ListJoin', [map]) : ce.function('List', [map])
    ).evaluate();
    const rows = spread ? value : value.op1;
    expect(rows.operator).toBe('List');
    expect(rows.ops.map((x) => x.operator)).toEqual(['Range', 'Range']);
    expect(calls).toBe(2);
    expect(
      [...rows.each()].map((row) => [...row.each()].map((x) => x.re))
    ).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ]);
    expect(calls).toBe(2);
  }
);

test('a spread preflights later shrinking operands before starting an impure map', () => {
  const { ce, calls } = countingPredicate(3);
  const value = ce
    .box([
      'ListJoin',
      ['Map', ['Function', ['If', ['P', 'x'], 'x', 'x'], 'x'], ['List', 1, 2]],
      ['Filter', ['List', 3, 4, 5], ['Function', 'False', 'x']],
    ])
    .evaluate();
  expect(value.operator).toBe('ListJoin');
  expect(calls()).toBe(0);
  expect([...value.each()].map((x) => x.re)).toEqual([1, 2]);
  expect(calls()).toBe(2);
});

test('a pure sparse filter can still fit despite a larger source bound', () => {
  const ce = new ComputeEngine();
  ce.maxCollectionSize = 1;
  const value = ce
    .box([
      'List',
      ['Filter', ['Range', 1, 10], ['Function', ['Equal', 'x', 1], 'x']],
    ])
    .evaluate();
  expect(value.json).toEqual(['List', ['List', 1]]);
});

test('async-only detection follows helper calls and stored callback aliases', async () => {
  const ce = new ComputeEngine();
  ce.declare('AsyncOnly', {
    signature: '(number) -> number',
    evaluateAsync: async ([x]) => ce.number(x.re + 5),
  });
  ce.assign('h', ce.box(['Function', ['AsyncOnly', 'x'], 'x']));
  ce.assign('g', ce.box(['Function', ['h', 'x'], 'x']));
  ce.declare('alias', { value: ce.symbol('g') });
  for (const callback of ['h', 'g', 'alias']) {
    const literal = ce.box(['List', ['Map', callback, ['List', 1, 2]]]);
    expect(literal.evaluate().op1.operator).toBe('Map');
    expect((await literal.evaluateAsync()).op1.operator).toBe('Map');
  }
  expect(hasAsyncOnlyApplication(ce.box(['g', 1]))).toBe(true);
  expect(hasAsyncOnlyApplication(ce.box(['Hold', ['g', 1]]))).toBe(false);
  expect(
    hasAsyncOnlyApplication(ce.box(['ReleaseHold', ['Hold', ['g', 1]]]))
  ).toBe(true);
});

test('async-only detection terminates cycles and walks shared operands once', () => {
  const ce = new ComputeEngine();
  ce.declare('AsyncOnly', {
    signature: '() -> number',
    evaluateAsync: async () => ce.One,
  });
  ce.assign('f', ce.box(['Function', ['g', 'x'], 'x']));
  ce.assign('g', ce.box(['Function', ['f', 'x'], 'x']));
  expect(hasAsyncOnlyApplication(ce.box(['f', 1]))).toBe(false);
  let node = ce.box(['Add', 'x', 'y']);
  for (let i = 0; i < 12; i++) node = ce.function('Max', [node, node]);
  const watched = watchOperands(node);
  try {
    expect(holdsAsyncOnlyOperator(node)).toBe(false);
    expect(watched.reads()).toBeLessThan(watched.size * 3);
  } finally {
    watched.restore();
  }
});

function watchOperands(root: Expression) {
  let reads = 0;
  const nodes = new Set<Expression>();
  const visit = (node: Expression) => {
    if (nodes.has(node) || node.nops === 0) return;
    nodes.add(node);
    const ops = node.ops;
    for (const op of ops) visit(op);
    Object.defineProperty(node, 'ops', {
      configurable: true,
      get: () => {
        reads += 1;
        return ops;
      },
    });
  };
  visit(root);
  return {
    size: nodes.size,
    reads: () => reads,
    restore: () => {
      for (const node of nodes) Reflect.deleteProperty(node, 'ops');
    },
  };
}

test('numeric function recursion scans do not unfold unselected shared DAGs', () => {
  const ce = new ComputeEngine();
  let node = ce.box(['Add', 'x', 'y']);
  for (let i = 0; i < 12; i++) node = ce.function('Max', [node, node]);
  const literal = ce.box(['Function', ['If', 'True', 1, node], 't']);
  ce.assign('dagFn', literal);
  const watched = watchOperands(literal.op1);
  try {
    expect(ce.box(['dagFn', 1]).N().re).toBe(1);
    expect(watched.reads()).toBeLessThan(watched.size * 10);
  } finally {
    watched.restore();
  }
});

test('numeric recursion scans do not box store-backed list operands', () => {
  const reads = (numericApproximation: boolean) => {
    const ce = new ComputeEngine();
    const store = ce.list([1, 2, 3]);
    const literal = ce.box(['Function', ['If', 'True', 1, store], 't']);
    ce.assign('storeFn', literal);
    let count = 0;
    const ops = store.ops;
    Object.defineProperty(store, 'ops', {
      configurable: true,
      get: () => {
        count += 1;
        return ops;
      },
    });
    try {
      expect(ce.box(['storeFn', 1]).evaluate({ numericApproximation }).re).toBe(
        1
      );
      return count;
    } finally {
      Reflect.deleteProperty(store, 'ops');
    }
  };
  expect(reads(true)).toBe(reads(false));
});

test('chain-resolved memo dependencies validate pure shadows and follow their values', () => {
  const ce = new ComputeEngine();
  ce.assign('q', 2);
  const map = ce
    .box(['Map', ['Function', ['Add', 'x', 'r'], 'x'], ['List', 1, 2]])
    .evaluate();
  ce.pushScope();
  try {
    ce.declare('r', { value: ce.box(['Add', 'q', 1]) });
    const deps = snapshotMemoDeps(map)!;
    expect(deps).toBeDefined();
    expect(memoDepsStillValid(map, deps)).toBe(true);
    ce.assign('q', 10);
    expect(memoDepsStillValid(map, deps)).toBe(false);
  } finally {
    ce.popScope();
  }
});

test('chain-resolved memo dependencies reject impure stored shadows', () => {
  const ce = new ComputeEngine();
  ce.declare('Draw', {
    signature: '() -> number',
    pure: false,
    evaluate: () => ce.One,
  });
  const map = ce
    .box(['Map', ['Function', ['Add', 'x', 'r'], 'x'], ['List', 1, 2]])
    .evaluate();
  ce.pushScope();
  try {
    ce.declare('r', { value: ce.box(['Draw']) });
    expect(snapshotMemoDeps(map)).toBeUndefined();
  } finally {
    ce.popScope();
  }
});
