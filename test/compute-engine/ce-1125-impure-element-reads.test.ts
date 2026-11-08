import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { validElementMemo } from '../../src/compute-engine/boxed-expression/collection-element-memo';

/**
 * One instance of a lazy collection has one set of random draws
 * (`docs/RANDOMNESS-MODEL.md` §6, "One instance, one draw set"): an element
 * read by position is the element of the list, however many times it is
 * read, and in whatever order the reads come. Two mechanisms make this true
 * (CE-1125):
 *
 * - a read by position of an impure finite instance is served from one
 *   complete walk that the element memo keeps
 *   (`elementMemoComputeCell()` in `collection-element-memo.ts`), because
 *   the memo keeps no partial walk and no single cell of an impure instance;
 * - `evaluate()` of a lazy view with an element memo and no `evaluate`
 *   handler (`Map`, `Filter`, `Tabulate`) whose operands did not change is
 *   the same instance (`BoxedFunction.evaluate()`), so a symbol that holds
 *   such a view gives the same instance, with its memo, at each read.
 */

function run(source: string): string {
  return executeEpsil(new ComputeEngine(), source).value.toString();
}

/** The numbers of a printed list such as `[1,3,5]`. */
function listOf(text: string): number[] {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  return inner === '' ? [] : inner.split(',').map((x) => Number(x));
}

/** Split `(a, b, [c, d], e)` into `a`, `b`, the list `[c, d]` and `e`. */
function partsOf(text: string): [number, number, number[], number] {
  const m = /^\((.*?), (.*?), (\[.*\]), (.*?)\)$/.exec(
    text.replace(/\s+/g, ' ')
  );
  if (m === null) throw new Error(`not a 4-tuple: ${text}`);
  return [Number(m[1]), Number(m[2]), listOf(m[3]), Number(m[4])];
}

/** The second element read twice, then the list, then the second element
 * once more, of one instance of `view` held by a symbol. */
function readsThroughSymbol(
  ce: ComputeEngine,
  view: unknown
): [number, number, number[], number] {
  ce.pushScope();
  try {
    ce.declare('v', 'list');
    ce.assign('v', ce.box(view as Parameters<typeof ce.box>[0]).evaluate());
    const read = () => ce.box(['At', 'v', 2]).evaluate().re;
    const a = read();
    const b = read();
    const list = listOf(ce.box(['ListFrom', 'v']).evaluate().toString());
    return [a, b, list, read()];
  } finally {
    ce.popScope();
  }
}

// The guards keep 9 and 10 always, so the list has at least two elements
// also in an unseeded run, and the second element still depends on the
// draws (it is 2 when the draw for 2 accepts, 10 when every draw refuses).
const RANDOM_GUARD_COMPREHENSION = [
  'Comprehension',
  'j',
  [
    'Element',
    'j',
    ['Range', 1, 10],
    ['Or', ['Less', ['Random'], 0.5], ['Greater', 'j', 8]],
  ],
];
const RANDOM_MAP = ['Map', ['Function', ['Random'], 'x'], ['Range', 1, 5]];
const RANDOM_FILTER = [
  'Filter',
  ['Range', 1, 10],
  ['Function', ['Or', ['Less', ['Random'], 0.5], ['Greater', 'x', 8]], 'x'],
];
const RANDOM_TABULATE = ['Tabulate', ['Function', ['Random'], 'i'], 5];

const VIEWS: [string, unknown][] = [
  ['a comprehension with a random guard', RANDOM_GUARD_COMPREHENSION],
  ['a Map whose function draws', RANDOM_MAP],
  ['a Filter whose predicate draws', RANDOM_FILTER],
  ['a Tabulate whose function draws', RANDOM_TABULATE],
];

describe('the witness of CE-1125', () => {
  test.each([1, 7, 11, 23, 42])(
    'v[2], v[2] and the second element of v agree (seed %d)',
    (seed) => {
      const [a, b, list, c] = partsOf(
        run(
          `WithRandomSeed(${seed}, do { let v = [j for j in 1..10 if random() < 0.5]; (v[2], v[2], v, v[2]) })`
        )
      );
      expect(a).toBe(list[1]);
      expect(b).toBe(list[1]);
      expect(c).toBe(list[1]);
    }
  );
});

describe('a read by position of an impure instance is one of its draw set', () => {
  test.each(VIEWS)('%s, held by a symbol, read live', (_label, view) => {
    const [a, b, list, c] = readsThroughSymbol(new ComputeEngine(), view);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(a).toBe(list[1]);
    expect(b).toBe(list[1]);
    expect(c).toBe(list[1]);
  });

  test.each(VIEWS)(
    '%s, one boxed instance read in a seeded frame',
    (_label, view) => {
      const ce = new ComputeEngine();
      const inst = ce.box(view as Parameters<typeof ce.box>[0]);
      const tuple = ce.function('Tuple', [
        ce.function('At', [inst, 2]),
        ce.function('At', [inst, 2]),
        ce.function('ListFrom', [inst]),
        ce.function('At', [inst, 2]),
      ]);
      const [a, b, list, c] = partsOf(
        ce.function('WithRandomSeed', [3, tuple]).evaluate().toString()
      );
      expect(a).toBe(list[1]);
      expect(b).toBe(list[1]);
      expect(c).toBe(list[1]);
    }
  );

  test('the last element, read twice, is the last element of the list', () => {
    const ce = new ComputeEngine();
    const inst = ce.box(RANDOM_MAP as Parameters<typeof ce.box>[0]);
    const a = inst.at(-1)?.re;
    const b = inst.at(-1)?.re;
    const list = [...inst.each()].map((x: Expression) => x.re);
    expect(a).toBe(list[4]);
    expect(b).toBe(list[4]);
  });

  test('a read past the end of the kept walk is the absence marker', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['At', RANDOM_MAP, 9]).evaluate().toString()).toBe('NaN');
  });
});

describe('evaluate() of an evaluated lazy view is the same instance', () => {
  test.each(VIEWS)('%s', (_label, view) => {
    const ce = new ComputeEngine();
    const once = ce.box(view as Parameters<typeof ce.box>[0]).evaluate();
    // Compared as a boolean: a failed `toBe` of two boxed expressions makes
    // Jest serialize them, which its worker cannot do.
    expect(once.evaluate() === once).toBe(true);
  });

  test('the kept instance follows a write to its source', () => {
    // The instance is kept, not its elements: a write to a symbol that the
    // instance depends on invalidates its memo (`docs/RANDOMNESS-MODEL.md`
    // §6), and the next read walks and draws again.
    const ce = new ComputeEngine();
    ce.pushScope();
    try {
      ce.declare('n', 'integer');
      ce.assign('n', 3);
      const view = ce
        .box(['Map', ['Function', ['Random'], 'x'], ['Range', 1, 'n']])
        .evaluate();
      const before = [...view.each()].map((x: Expression) => x.re);
      expect(before).toHaveLength(3);
      expect(view.at(2)?.re).toBe(before[1]);
      ce.assign('n', 4);
      expect(view.evaluate() === view).toBe(true);
      const after = [...view.each()].map((x: Expression) => x.re);
      expect(after).toHaveLength(4);
      expect(view.at(2)?.re).toBe(after[1]);
    } finally {
      ce.popScope();
    }
  });
});

describe('what the complete walk does not cover', () => {
  test('a walk that the memo refuses is not repeated at each read', () => {
    // A host function that states no purity is host code that no memo keeps
    // a result across (an operator that states `pure: false` is kept: its
    // code runs once per instance). The body draws too, so the instance is
    // impure and the complete walk is made, then refused. The refusal is
    // recorded: the second read computes its one element and does not walk
    // the five elements again.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Datum', {
      signature: '(integer) -> number',
      evaluate: ([i]) => {
        calls++;
        return ce.number(i.re * 10);
      },
    });
    const view = ce.box([
      'Map',
      ['Function', ['Add', ['Datum', 'x'], ['Random']], 'x'],
      ['Range', 1, 5],
    ]);
    expect(view.isPure).toBe(false);
    expect(typeof view.at(2)?.re).toBe('number');
    // The first read: the refused walk of five elements, then one element.
    const afterFirst = calls;
    expect(afterFirst).toBe(6);
    expect(validElementMemo(view)).toBeUndefined();
    expect(typeof view.at(3)?.re).toBe('number');
    expect(calls).toBe(afterFirst + 1);
    expect(typeof view.at(3)?.re).toBe('number');
    expect(calls).toBe(afterFirst + 2);
  });

  test('a read made while a walk of the instance runs keeps its own complete walk', () => {
    // The body of a consumer of `v` reads `v[2]` between two pulls of the
    // walk of `v`. The read makes a complete walk of its own, which the memo
    // keeps; the walk of the consumer, when it ends, does not replace it. So
    // the read made during the walk and every later read agree; the consumer
    // saw the elements of its own walk.
    const ce = new ComputeEngine();
    const view = ce.box(RANDOM_MAP as Parameters<typeof ce.box>[0]).evaluate();
    const walked: number[] = [];
    let duringWalk: number | undefined;
    for (const element of view.each()) {
      walked.push(element.re);
      if (walked.length === 1) {
        duringWalk = view.at(2)?.re;
        expect(validElementMemo(view)?.complete).toBe(true);
      }
    }
    expect(typeof duringWalk).toBe('number');
    expect(walked).toHaveLength(5);
    const kept = validElementMemo(view);
    expect(kept?.complete).toBe(true);
    expect(kept?.elements).toHaveLength(5);
    expect(view.at(2)?.re).toBe(duringWalk);
    expect([...view.each()][1].re).toBe(duringWalk);
  });

  test('an each() iterator pulled once and dropped does not stop the reads', () => {
    // A consumer that stops pulling a walk without closing it (a `Map` over
    // `v` and a shorter list) leaves the generator of the walk suspended. The
    // reads by position do not depend on that generator: the next read makes
    // its complete walk, and the reads agree with the list.
    const ce = new ComputeEngine();
    const view = ce.box(RANDOM_MAP as Parameters<typeof ce.box>[0]).evaluate();
    const dropped = view.each();
    expect(typeof dropped.next().value?.re).toBe('number');
    const a = view.at(2)?.re;
    const b = view.at(2)?.re;
    const list = [...view.each()].map((x: Expression) => x.re);
    expect(a).toBe(list[1]);
    expect(b).toBe(list[1]);
  });

  test('a write to a dependency drops the record of a refused walk', () => {
    // After the record is dropped, the next read walks the instance again
    // (n host calls) and computes its one element.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Datum', {
      signature: '(integer) -> number',
      evaluate: ([i]) => {
        calls++;
        return ce.number(i.re * 10);
      },
    });
    ce.declare('n', 'integer');
    ce.assign('n', 4);
    const view = ce.box([
      'Map',
      ['Function', ['Add', ['Datum', 'x'], ['Random']], 'x'],
      ['Range', 1, 'n'],
    ]);
    expect(typeof view.at(2)?.re).toBe('number');
    expect(calls).toBe(5);
    expect(typeof view.at(2)?.re).toBe('number');
    expect(calls).toBe(6);
    ce.assign('n', 6);
    expect(typeof view.at(2)?.re).toBe('number');
    expect(calls).toBe(6 + 7);
    expect(typeof view.at(2)?.re).toBe('number');
    expect(calls).toBe(6 + 8);
  });

  test('a pure instance read by position computes one element', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['At', ['Map', ['Function', ['Square', 'x'], 'x'], ['Range', 1, 5]], 2])
        .evaluate()
        .toString()
    ).toBe('4');
  });

  test('a read by position of a Map over an infinite Range gives a number', () => {
    const ce = new ComputeEngine();
    const view = [
      'Map',
      ['Function', ['Random'], 'x'],
      ['Range', 1, { sym: 'PositiveInfinity' }],
    ];
    const value = ce.box(['At', view, 2] as Parameters<typeof ce.box>[0]).evaluate();
    expect(typeof value.re).toBe('number');
    expect(Number.isFinite(value.re)).toBe(true);
  });
});
