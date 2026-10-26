import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The count, the emptiness and the finiteness of a `Comprehension` agree with
// the cells its walk yields, and the finiteness test does not run the
// callbacks of the domains.
//
// A clause that fails for an element (a guard that gives an error, an element
// that does not match a destructuring pattern) yields one error cell for that
// element and does not visit the later clauses. So a later empty clause does
// not make the count 0 (CE-493).
//
// `isFiniteCollection` is read before a walk (`isWalkableFiniteCollection`),
// so it must not walk a domain that calls user code (CE-494).
//

const ce = new ComputeEngine();
// A guard that gives an error at evaluation for each element.
ce.declare('bad', {
  signature: '(integer) -> boolean',
  evaluate: () => ce.error('bad-guard'),
});

function walk(x: Expression): number {
  return [...x.each()].length;
}

const BAD_GUARD = ['bad', 'i'];

describe('COMPREHENSION COUNT — a clause that can fail', () => {
  test('a guard that gives an error before an empty clause', () => {
    const c = ce.box([
      'Comprehension',
      'j',
      ['Element', 'i', ['Range', 1, 3], BAD_GUARD],
      ['Element', 'j', ['List']],
    ]);
    expect(c.count).toBe(3);
    expect(c.isEmptyCollection).toBe(false);
    expect(c.isFiniteCollection).toBe(true);
    expect(walk(c)).toBe(3);
  });

  test('a destructuring pattern before an empty clause', () => {
    const c = ce.box([
      'Comprehension',
      'j',
      [
        'Element',
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 2], 5, ['Tuple', 3, 4]],
      ],
      ['Element', 'j', ['List']],
    ]);
    expect(c.count).toBe(1);
    expect(c.isEmptyCollection).toBe(false);
    expect(walk(c)).toBe(1);
  });

  test('a destructuring pattern before a later clause', () => {
    // `5` does not match: one error cell, not one cell for each `j`.
    const c = ce.box([
      'Comprehension',
      'j',
      [
        'Element',
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 2], 5, ['Tuple', 3, 4]],
      ],
      ['Element', 'j', ['Range', 1, 2]],
    ]);
    expect(c.count).toBe(5);
    expect(walk(c)).toBe(5);
  });

  test('an empty clause with no clause that can fail before it', () => {
    const c = ce.box([
      'Comprehension',
      'j',
      ['Element', 'i', ['Range', 1, 'Infinity']],
      ['Element', 'j', ['List']],
    ]);
    expect(c.count).toBe(0);
    expect(c.isEmptyCollection).toBe(true);
    expect(c.isFiniteCollection).toBe(true);
  });

  test('a failing guard over an infinite domain before an empty clause', () => {
    // Each element gives an error cell: the comprehension is not empty, and
    // its count and finiteness are not known without a walk.
    const c = ce.box([
      'Comprehension',
      'j',
      ['Element', 'i', ['Range', 1, 'Infinity'], BAD_GUARD],
      ['Element', 'j', ['List']],
    ]);
    expect(c.count).toBeUndefined();
    expect(c.isFiniteCollection).toBeUndefined();
    expect(c.isEmptyCollection).toBe(false);
  });
});

describe('COMPREHENSION FINITENESS — no callback runs', () => {
  test('a dependent domain that calls a function', () => {
    let calls = 0;
    const ce = new ComputeEngine();
    ce.declare('keep', {
      signature: '(integer) -> boolean',
      pure: false,
      evaluate: () => {
        calls += 1;
        return ce.True;
      },
    });
    const c = ce.box([
      'Comprehension',
      'i',
      ['Element', 'i', ['Range', 1, 3]],
      ['Element', 'j', ['Filter', ['Range', 1, 'i'], 'keep']],
    ]);
    expect(c.isFiniteCollection).toBe(true);
    expect(calls).toBe(0);
    // The count walks the domains, and calls `keep` once for each element
    // of each domain: 1 + 2 + 3.
    expect(c.count).toBe(6);
    expect(calls).toBe(6);
    expect(walk(c)).toBe(6);
  });

  test('an independent domain that calls a function', () => {
    let calls = 0;
    const ce = new ComputeEngine();
    ce.declare('keep', {
      signature: '(integer) -> boolean',
      pure: false,
      evaluate: () => {
        calls += 1;
        return ce.True;
      },
    });
    const c = ce.box([
      'Comprehension',
      'i',
      ['Element', 'i', ['Filter', ['Range', 1, 3], 'keep']],
    ]);
    expect(c.isFiniteCollection).toBe(true);
    expect(calls).toBe(0);
  });

  test('the count walks an independent filter domain once', () => {
    // `keep` changes the symbol `calls`, so the memo of the domain expires
    // after each walk. The count reads the emptiness of the domain from its
    // count: a second read would walk the domain again (CE-494.2).
    for (const [cond, count] of [
      ['j > 0', 3],
      ['j > 5', 0],
    ] as const) {
      const ce = new ComputeEngine();
      const parseLatex = (latex: string): MathJsonExpression =>
        ce.parse(latex).json;
      const run = (source: string) =>
        executeEpsil(ce, source, { parseLatex }).value;
      run('let calls = 0');
      run(`function keep(j) scope { calls = calls + 1; ${cond} }`);
      const c = ce.box([
        'Comprehension',
        'i',
        ['Element', 'i', ['Filter', ['Range', 1, 3], 'keep']],
      ]);
      expect(c.count).toBe(count);
      expect(run('calls').json).toBe(3);
    }
  });

  test('a dependent range is finite from its form', () => {
    for (const domain of [
      ['Range', 1, 'i'],
      ['Range', 'i', ['Power', 'i', 2]],
      ['Range', 1, ['Add', ['Multiply', 2, 'i'], 1], 2],
      ['List', 'i', ['Add', 'i', 1]],
    ]) {
      const c = ce.box([
        'Comprehension',
        'j',
        ['Element', 'i', ['Range', 1, 3]],
        ['Element', 'j', domain],
      ]);
      expect(c.isFiniteCollection).toBe(true);
      expect(c.count).toBe(walk(c));
    }
  });

  test('a dependent domain of a later index', () => {
    const c = ce.box([
      'Comprehension',
      'k',
      ['Element', 'i', ['List', 1, 2]],
      ['Element', 'j', ['List', 'i', ['Add', 'i', 1]]],
      ['Element', 'k', ['Range', 1, 'j']],
    ]);
    expect(c.isFiniteCollection).toBe(true);
    expect(c.count).toBe(8);
    expect(walk(c)).toBe(8);
  });

  test('a pure dependent domain whose form decides nothing is walked', () => {
    const c = ce.box([
      'Comprehension',
      'j',
      ['Element', 'i', ['Range', 1, 3]],
      ['Element', 'j', ['Range', 1, ['Divide', 6, 'i']]],
    ]);
    expect(c.isFiniteCollection).toBe(true);
    expect(c.count).toBe(11);
    expect(walk(c)).toBe(11);
  });

  test('an infinite independent clause and nonempty other clauses', () => {
    const c = ce.box([
      'Comprehension',
      'i',
      ['Element', 'i', ['Range', 1, 'Infinity']],
      ['Element', 'j', ['Range', 1, 2]],
    ]);
    expect(c.isFiniteCollection).toBe(false);
    expect(c.count).toBe(Infinity);
  });
});

describe('COMPREHENSION FINITENESS — an impure independent domain', () => {
  // An independent domain that calls an impure function is not evaluated by
  // the finiteness test: the walk evaluates it, so each walk calls the
  // function once.
  function setup() {
    const counter = { calls: 0 };
    const ce = new ComputeEngine();
    ce.declare('mk', {
      signature: '() -> list<integer>',
      pure: false,
      evaluate: () => {
        counter.calls += 1;
        return ce.box(['List', 1, 2, 3]);
      },
    });
    return { ce, counter };
  }

  test('the finiteness test does not call the function', () => {
    const { ce, counter } = setup();
    const c = ce.box(['Comprehension', 'i', ['Element', 'i', ['mk']]]);
    // The form `mk()` does not tell whether the domain is finite.
    expect(c.isFiniteCollection).toBeUndefined();
    expect(counter.calls).toBe(0);
  });

  test('a walk calls the function once', () => {
    const { ce, counter } = setup();
    const c = ce.box(['Comprehension', 'i', ['Element', 'i', ['mk']]]);
    expect(walk(c)).toBe(3);
    expect(counter.calls).toBe(1);
    counter.calls = 0;
    expect(c.evaluate().toString()).toBe('[1,2,3]');
    expect(counter.calls).toBe(1);
  });

  test('a list literal with an impure element is finite from its form', () => {
    const { ce, counter } = setup();
    const c = ce.box([
      'Comprehension',
      'i',
      ['Element', 'i', ['List', 1, ['Length', ['mk']]]],
    ]);
    expect(c.isFiniteCollection).toBe(true);
    expect(counter.calls).toBe(0);
  });
});
