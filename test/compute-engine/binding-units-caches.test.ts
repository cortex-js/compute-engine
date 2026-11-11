import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import * as DerivativeModule from '../../src/compute-engine/symbolic/derivative';
import {
  beginObjectDeps,
  endObjectDeps,
  objectDepsValid,
  recordObjectRead,
  stampObjectDepsAtEnd,
} from '../../src/compute-engine/boxed-expression/object-deps';
import { unitEnvironmentOfOperands } from '../../src/compute-engine/binding-unit';
import { effectsComputeCount } from '../../src/compute-engine/boxed-expression/boxed-function';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// Phase E of slice 1 of binding units: the caches that read the entries of unit environments hit across
// operations, and are computed again when what they read changed (rules 4
// and 9 of `docs/plans/2026-11-09-binding-units-slice-1-spec.md`).

function engine(): ComputeEngine {
  return new ComputeEngine();
}

/** The number of calls of `differentiate()` from outside its own module
 * while `run` runs. */
function attempts(run: () => void): number {
  const spy = jest.spyOn(DerivativeModule, 'differentiate');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

describe('BINDING UNITS: CACHES', () => {
  test('the closed form of a D node is recorded across operations', () => {
    // The attempt writes `x: number` in the environment of the operation,
    // after its first read of `x`; the next operation finds the entry that
    // the first one wrote, through the symbols of its result.
    const ce = engine();
    const d = ce.box(['D', ['Sin', 'x'], 'x']);
    expect(attempts(() => d.evaluate())).toBe(1);
    expect(attempts(() => d.evaluate())).toBe(0);
    expect(attempts(() => d.N())).toBe(1);
    expect(attempts(() => d.N())).toBe(0);
    expect(d.evaluate().json).toEqual(['Cos', 'x']);
  });

  test('the decline of a D node is recorded, across operations and in one', () => {
    const ce = engine();
    ce.declare('a', 'real');
    ce.assign('a', 2);
    ce.declare('w', 'function');
    ce.assign(
      'w',
      ce.box([
        'Function',
        ['ND', ['Function', ['Multiply', 'a', 'x', 't'], 'x'], 1],
        't',
      ])
    );
    const d = ce.box(['D', ['w', 'u'], 'u']);
    let value: Expression = d;
    expect(attempts(() => (value = d.evaluate()))).toBe(1);
    expect(attempts(() => value.evaluate())).toBe(0);
    // In one operation: the parameter read evaluates the node again, with
    // the type of `u` that the first attempt wrote.
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('p\\mapsto p.x+p.x+p.x'));
    const call = ce.box(['f', ['Tuple', ['D', ['w', 'u'], 'u'], 0, 0]]);
    expect(attempts(() => call.evaluate())).toBe(1);
    // A value write to a symbol that the function reads: worked out again.
    ce.assign('a', 3);
    expect(attempts(() => value.evaluate())).toBe(1);
  });

  test('a type written onto the differentiation variable: the record is not served', () => {
    const ce = engine();
    const d = ce.box(['D', ['Abs', 'x'], 'x']);
    const x = d.ops![1];
    x.valueDefinition!.type = ce.type('real');
    expect(d.evaluate().json).toEqual(['Sign', 'x']);
    expect(attempts(() => d.evaluate())).toBe(0);
    x.valueDefinition!.type = ce.type('tuple<real, real>');
    let value: Expression = d;
    expect(attempts(() => (value = d.evaluate()))).toBe(1);
    expect(value.toString()).toBe('D(|x|, x)');
  });

  test('a record stamped at the end is valid at the first version of a unit read and at its last', () => {
    // The protocol of `object-deps.ts` for a `UnitReadToken`: its version is
    // what the read finds now, not a counter.
    let version = 0;
    const token = {
      _readAgainAtEnd: true,
      get _version() {
        return version;
      },
    };
    beginObjectDeps();
    recordObjectRead(token, token._version);
    version = 7;
    const deps = endObjectDeps();
    // A cache that does not stamp its dependencies keeps the first version.
    expect(objectDepsValid(deps)).toBe(false);
    stampObjectDepsAtEnd(deps);
    expect(objectDepsValid(deps)).toBe(true);
    version = 0;
    expect(objectDepsValid(deps)).toBe(true);
    version = 3;
    expect(objectDepsValid(deps)).toBe(false);
    // An object whose version is a counter keeps its first version only.
    let counter = 1;
    const object = {
      get _version() {
        return counter;
      },
    };
    beginObjectDeps();
    recordObjectRead(object, object._version);
    counter = 2;
    const counted = endObjectDeps();
    stampObjectDepsAtEnd(counted);
    expect(objectDepsValid(counted)).toBe(false);
  });

  test('a tower of shared dictionaries with no symbol is walked once per level', () => {
    // Each `ce.function()` with a boxed operand looks for the environment of
    // its first symbol (`unitEnvironmentOfOperands()`).
    const ce = engine();
    const kv = (key: string, value: Expression) =>
      ce.function('KeyValuePair', [ce.string(key), value]);
    const bottom = ce.function('Dictionary', [kv('v', ce.number(1))]);
    let reads = 0;
    const valuesOf = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(bottom),
      'values'
    )!.get!;
    Object.defineProperty(bottom, 'values', {
      get() {
        reads += 1;
        return valuesOf.call(this);
      },
    });
    let top = bottom;
    for (let k = 0; k < 12; k++)
      top = ce.function('Dictionary', [kv('a', top), kv('b', top)]);
    expect(reads).toBeLessThanOrEqual(2);
    // A symbol beside a node that holds none is still found.
    const q = ce.box('q');
    const env = (q as unknown as { _env?: object })._env;
    expect(env).toBeDefined();
    expect(unitEnvironmentOfOperands([top, kv('s', q)])).toBe(env);
  });

  test('a held node reads a later declaration of a free name in its effects', () => {
    // `p` is a free name when the nodes are boxed: the projection finds no
    // definition, and the declaration advances no axis. The effects memo of
    // a node, and the memo of a dictionary, depend on the resolution of `p`.
    const ce = engine();
    executeEpsil(ce, 'type R = record{age: integer}');
    const stmt = ['Assign', ['Field', 'p', { str: 'age' }], 43];
    const node = ce.box(stmt as never);
    const block = ce.box(['Block', stmt] as never);
    const dict = ce.box([
      'Dictionary',
      ['KeyValuePair', { str: 'a' }, stmt],
    ] as never);
    expect(node.effects).toEqual(['state']);
    expect(block.effects).toEqual(['state']);
    expect(dict.effects).toEqual(['state']);
    // With nothing declared, a second read is served by the memos.
    const count = effectsComputeCount();
    expect(node.effects).toEqual(['state']);
    expect(block.effects).toEqual(['state']);
    expect(dict.effects).toEqual(['state']);
    expect(effectsComputeCount()).toBe(count);

    ce.declare('p', 'R');

    expect(node.effects).toEqual(['scope']);
    expect(block.effects).toEqual(['scope']);
    expect(dict.effects).toEqual(['scope']);
    expect(node.isPure).toBe(false);
  });

  test('an evaluation enters the public evaluate() once', () => {
    const ce = engine();
    const e = ce.box(['Divisors', 12]);
    const proto = Object.getPrototypeOf(e);
    const original = proto.evaluate;
    let calls = 0;
    try {
      proto.evaluate = function (...args: unknown[]) {
        if (this.operator === 'Divisors') calls += 1;
        return original.apply(this, args);
      };
      expect(e.evaluate().json).toEqual(['List', 1, 2, 3, 4, 6, 12]);
    } finally {
      proto.evaluate = original;
    }
    expect(calls).toBe(1);
  });

  test('a recursive function typed again in an operation', () => {
    // The type of the body was cached when `m3` was assigned, with no entry
    // for the parameter `x` of the callback. The evaluation of a call writes
    // one (the rebuild of `x - 1` requires a number), so that type is not
    // valid in the operation, and the re-entrant read of the recursive call
    // is answered as an empty cell is, not computed again with no end.
    const ce = engine();
    ce.box([
      'Assign',
      'm3',
      [
        'Function',
        [
          'Map',
          [
            'Function',
            [
              'If',
              ['Less', 'x', 1],
              'y',
              ['m3', ['Subtract', 'x', 1], ['Add', 'y', 'x']],
            ],
            'x',
          ],
          ['List', 'n'],
        ],
        'n',
        'y',
      ],
    ]).evaluate();
    expect(ce.box(['m3', 1, 10]).evaluate().toString()).toBe('[[11]]');
    expect(ce.box(['m3', 3, 10]).evaluate().toString()).toBe('[[[[16]]]]');
  });

  test('a stored value whose call rebuilds the index of a comprehension', () => {
    // A call of `u2` rebuilds the comprehension of its body, and the index
    // `i` is given the type `integer` of its range again: the type that the
    // boxing of the body gave it. That requirement is not written in the
    // environment of the operation, so each operation reads the stored body
    // as the one before it did, and the stored value of `h` is served.
    const ce = engine();
    let calls = 0;
    ce.declare('tick', {
      signature: '(number) -> number',
      pure: true,
      evaluate: (ops) => {
        calls += 1;
        return ops[0].evaluate();
      },
    });
    const counting = (run: () => unknown): [unknown, number] => {
      const before = calls;
      const value = run();
      return [value, calls - before];
    };
    ce.declare('u2', 'function');
    ce.assign(
      'u2',
      ce.box([
        'Function',
        [
          'Comprehension',
          ['tick', ['At', 'l', ['Ceil', ['Divide', 'i', 2]]]],
          ['Element', 'i', ['Range', 1, ['Multiply', 2, ['Length', 'l']]]],
        ],
        'l',
      ])
    );
    ce.assign('base', ce.box(['List', 1, 2, 3, 4]));
    ce.assign('h', ce.box(['u2', ['u2', 'base']]));
    const scan = () =>
      [
        ...ce
          .box([
            'Comprehension',
            ['At', 'h', 'i'],
            ['Element', 'i', ['Range', 1, 16]],
          ])
          .evaluate()
          .each(),
      ].map((x) => x.re);
    const [first, c1] = counting(scan);
    expect(first).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
    expect(c1).toBeLessThan(2 * (8 + 16) + 8);
    expect(counting(scan)).toEqual([first, 0]);
    for (let k = 0; k < 3; k++)
      expect(counting(() => ce.box(['At', 'h', 3]).evaluate().re)).toEqual([
        1, 0,
      ]);
    // A write to a value that the stored value reads is still seen.
    ce.assign('base', ce.box(['List', 10, 20, 30, 40]));
    const [v, c2] = counting(() => ce.box(['At', 'h', 3]).evaluate().re);
    expect(v).toBe(10);
    expect(c2).toBeGreaterThan(0);
  });
});
