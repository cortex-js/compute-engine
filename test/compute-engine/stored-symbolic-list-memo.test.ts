/**
 * A symbol that holds a list which is not written-out data keeps the value of
 * that list across reads, with the dependency checks of the stored-value
 * memo (`_memoizedStoredValue()`, `boxed-symbol.ts`).
 *
 * Before, the memo skipped every `List` value, as if each list were
 * written-out data. A list of symbolic elements was then evaluated again at
 * each read. Each element has an entry of its own in the evaluate memo of
 * its node, but that entry is keyed on the engine generation, which an
 * assignment to any symbol advances. So the value of `D(PointY(h(u)), u)`,
 * for a path `h` of 29 pieces read from a list of points, took about 40 ms at
 * each read of the symbol after an assignment to another symbol, and about
 * 0.01 ms with this memo.
 *
 * The counting operator `Probe` is declared pure, so the memos keep its
 * results; its handler counts its calls, which shows when the elements are
 * evaluated again.
 */

import { ComputeEngine } from '../../src/compute-engine';

function probeEngine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let count = 0;
  ce.declare('Probe', {
    signature: '(any) -> any',
    pure: true,
    evaluate: ([x], { engine }) => {
      count += 1;
      // A value with no free symbol is a number; otherwise the call stays
      // symbolic, as the closed form of a derivative does.
      return x.isNumberLiteral ? engine.number(x.re * 10) : undefined;
    },
  });
  ce.declare('z', 'real');
  ce.declare('a', 'real');
  ce.declare('L', 'list');
  return { ce, calls: () => count };
}

describe('a symbol that holds a list of symbolic elements', () => {
  test('an assignment to another symbol does not evaluate the elements again', () => {
    const { ce, calls } = probeEngine();
    ce.assign('L', ce.parse('[\\operatorname{Probe}(u), \\operatorname{Probe}(u)+1]'));
    const first = ce.box('L').evaluate();
    expect(first.toString()).toBe('[Probe(u),Probe(u) + 1]');
    const before = calls();
    ce.assign('z', 3);
    const again = ce.box('L').evaluate();
    expect(calls()).toBe(before);
    expect(again.isSame(first)).toBe(true);
  });

  test('an assignment to a symbol that an element reads gives the new value', () => {
    const { ce, calls } = probeEngine();
    ce.assign('a', 2);
    ce.assign('L', ce.box(['Hold', ['List', ['Probe', 'a'], ['Probe', 'u']]]).op1);
    expect(ce.box('L').evaluate().toString()).toBe('[20,Probe(u)]');
    const before = calls();
    ce.assign('a', 5);
    expect(ce.box('L').evaluate().toString()).toBe('[50,Probe(u)]');
    expect(calls()).toBeGreaterThan(before);
  });

  test('a numeric read has its own entry', () => {
    const { ce, calls } = probeEngine();
    ce.assign('a', 2);
    ce.assign('L', ce.box(['Hold', ['List', ['Divide', 'a', 3], ['Probe', 'u']]]).op1);
    expect(ce.box('L').evaluate().toString()).toBe('[2/3,Probe(u)]');
    // The `.re` of the exact `2/3` is also close to 2/3, so the test also
    // checks that the numeric element is not the exact rational.
    const numeric = ce.box('L').evaluate({ numericApproximation: true });
    expect(numeric.ops![0].re).toBeCloseTo(2 / 3, 12);
    expect(numeric.ops![0].toString()).not.toBe('2/3');
    const before = calls();
    ce.assign('z', 1);
    expect(ce.box('L').evaluate().toString()).toBe('[2/3,Probe(u)]');
    const again = ce.box('L').evaluate({ numericApproximation: true });
    expect(again.ops![0].re).toBeCloseTo(2 / 3, 12);
    expect(again.ops![0].toString()).not.toBe('2/3');
    expect(calls()).toBe(before);
  });

  test('a list nested in a list', () => {
    const { ce, calls } = probeEngine();
    ce.assign('L', ce.parse('[[1, 2], [\\operatorname{Probe}(u), 3]]'));
    const first = ce.box('L').evaluate();
    const before = calls();
    ce.assign('z', 2);
    expect(ce.box('L').evaluate().isSame(first)).toBe(true);
    expect(calls()).toBe(before);
  });

  test('a call frame that binds a name the list reads gives the value of the call', () => {
    // The list reads the global `u`. A function whose parameter is also
    // named `u` reads the symbol `L`, and the read inside the call must not
    // be served from an entry that the global read filled, nor the other
    // way: `L` is resolved in its own bindings, so both reads give the
    // value of the global `u`, which has none.
    const { ce } = probeEngine();
    ce.assign('L', ce.parse('[\\operatorname{Probe}(u), 1]'));
    ce.declare('g', 'function');
    ce.assign('g', ce.parse('u \\mapsto L'));
    const outside = ce.box('L').evaluate().toString();
    expect(ce.box(['g', 4]).evaluate().toString()).toBe(outside);
    ce.declare('u', 'real');
    ce.assign('u', 7);
    expect(ce.box('L').evaluate().toString()).toBe('[70,1]');
  });

  test('a list of numbers is still its own value', () => {
    const { ce } = probeEngine();
    ce.assign('L', ce.parse('[1, 2, 3]'));
    const stored = ce.box('L').value!;
    expect(ce.box('L').evaluate()).toBe(stored);
  });
});

describe('the value of the derivative of a path of linear pieces', () => {
  // The setup of Tycho ledger row 424, with `n` pieces.
  function pathEngine(n: number): ComputeEngine {
    const ce = new ComputeEngine();
    const points = Array.from({ length: 5 + n }, (_, i) => [
      'Tuple',
      i,
      (i * 7) % 5,
    ]);
    ce.declare('P', 'list');
    ce.assign('P', ce.box(['List', ...points]));
    const pieces = Array.from(
      { length: n },
      (_, k) =>
        `(1-\\operatorname{mod}(t,1))P[\\lceil t\\rceil+${k}]+\\operatorname{mod}(t,1)P[\\lceil t\\rceil+${k + 1}]`
    );
    ce.declare('h', 'function');
    ce.assign(
      'h',
      ce.parse(`t\\mapsto\\operatorname{join}(${pieces.join(',')})`)
    );
    ce.declare('z', 'real');
    return ce;
  }

  test('held by a symbol, it is not evaluated again after another assignment', () => {
    const ce = pathEngine(4);
    const value = ce.box(['D', ['PointY', ['h', 'u']], 'u']).evaluate();
    expect(value.operator).toBe('List');
    ce.declare('d', 'list');
    ce.assign('d', value);
    const first = ce.box('d').evaluate();
    ce.assign('z', 1);
    const spy = jest.spyOn(ce, 'function');
    let again = first;
    try {
      again = ce.box('d').evaluate();
      // An evaluation of the elements boxes new nodes; the memo hit boxes
      // none.
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(again.isSame(first)).toBe(true);
    // At `u = 2.5` the pieces run from (2,4) to (3,1), (3,1) to (4,3), …
    expect(
      again
        .subs({ u: 2.5 })
        .N()
        .ops!.map((x) => x.re)
    ).toEqual([-3, 2, -3, 2]);
  });
});
