import { ComputeEngine } from '../../src/compute-engine';

// A `Set` literal lists its finite lazy elements when it is evaluated, as a
// `List` or `Tuple` literal does (user decision 2026-10-17): with `Tick(x)`
// returning `x + 10`, `{Map(Tick, [1, 2])}` evaluates to `{[11, 12]}` and
// calls `Tick` twice, at evaluation and never at boxing or parsing. The
// canonical `Set` then merges the elements that are equal, so
// `{Map(Tick, [1, 2]), [11, 12]}` has one element. An element that is
// infinite, or larger than `ce.maxCollectionSize`, stays lazy, and a `Range`
// element stays a range (`listedLiteralElements`,
// `boxed-expression/listed-element.ts`).

function engine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let count = 0;
  ce.declare('Tick', {
    signature: '(integer) -> integer',
    evaluate: ([x]) => {
      count += 1;
      return ce.number((x.re ?? 0) + 10);
    },
  });
  return { ce, calls: () => count };
}

const TICKS = ['Map', 'Tick', ['List', 1, 2]];

describe('a Set literal lists its finite lazy elements', () => {
  test('box route: the callback runs at evaluation, not at boxing', () => {
    const { ce, calls } = engine();
    const e = ce.box(['Set', TICKS]);
    expect(calls()).toBe(0);
    const v = e.evaluate();
    expect(v.toString()).toBe('Set([11,12])');
    expect(calls()).toBe(2);
    expect(v.count).toBe(1);
  });

  test('parse route: the callback runs at evaluation, not at parsing', () => {
    const { ce, calls } = engine();
    const e = ce.parse(
      String.raw`\{\operatorname{Map}(\operatorname{Tick}, [1,2])\}`
    );
    expect(calls()).toBe(0);
    expect(e.evaluate().toString()).toBe('Set([11,12])');
    expect(calls()).toBe(2);
  });

  test('the listed element and an equal element are merged', () => {
    const { ce } = engine();
    const v = ce.box(['Set', TICKS, ['List', 11, 12]]).evaluate();
    expect(v.toString()).toBe('Set([11,12])');
    expect(v.count).toBe(1);
    // A different element is kept.
    const w = ce.box(['Set', TICKS, ['List', 11, 13]]).evaluate();
    expect(w.count).toBe(2);
  });

  test('a List literal and a Set literal list the same element', () => {
    const { ce } = engine();
    expect(ce.box(['List', TICKS]).evaluate().toString()).toBe('[[11,12]]');
    expect(ce.box(['Set', TICKS]).evaluate().toString()).toBe('Set([11,12])');
  });

  test('the inner collection keeps its kind', () => {
    const { ce } = engine();
    expect(
      ce
        .box(['Set', ['Map', 'Tick', ['Set', 1, 2]]])
        .evaluate()
        .toString()
    ).toBe('Set(Set(11, 12))');
    expect(
      ce
        .box(['Set', ['Take', ['Range', 1, 10], 3]])
        .evaluate()
        .toString()
    ).toBe('Set([1,2,3])');
    // A range element is not listed: it stays a range.
    expect(
      ce
        .box(['Set', ['Range', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('Set(Range(1, 3))');
    // A nested list literal lists its own lazy element.
    expect(
      ce
        .box(['Set', ['List', TICKS]])
        .evaluate()
        .toString()
    ).toBe('Set([[11,12]])');
  });

  test('an infinite or oversized element stays lazy', () => {
    const { ce } = engine();
    expect(
      ce
        .box(['Set', ['Range', 1, 'PositiveInfinity']])
        .evaluate()
        .toString()
    ).toBe('Set(Range(1, +oo))');
    // A range element is never listed, so the oversized element is a `Take`
    // view, which would be listed if it were small.
    const big = ce
      .box(['Set', ['Take', ['Range', 1, 1000000], 100000]])
      .evaluate();
    expect(big.ops![0].operator).toBe('Take');
  });

  test('under .N() the listed element is approximated', () => {
    const { ce, calls } = engine();
    const v = ce
      .box([
        'Set',
        ['Map', ['Function', ['Divide', 'x', 3], 'x'], ['List', 1, 2]],
      ])
      .N();
    expect(v.toString()).toBe(
      'Set([0.333333333333333333333,0.666666666666666666667])'
    );
    expect(calls()).toBe(0);
  });

  test('async route: the same listing and the same number of calls', async () => {
    const { ce, calls } = engine();
    const e = ce.box(['Set', TICKS, ['List', 11, 12]]);
    expect(calls()).toBe(0);
    const v = await e.evaluateAsync();
    expect(v.toString()).toBe('Set([11,12])');
    expect(v.count).toBe(1);
    expect(calls()).toBe(2);
  });

  test('an impure element whose size is known is listed once', () => {
    const { ce } = engine();
    const v = ce
      .box(['Set', ['Map', ['Function', ['Random'], 'x'], ['List', 1, 2]]])
      .evaluate();
    expect(v.nops).toBe(1);
    const inner = v.ops![0];
    expect(inner.operator).toBe('List');
    expect(inner.nops).toBe(2);
    // The listed draws are values: reading them again draws nothing new.
    expect(v.ops![0].toString()).toBe(inner.toString());
  });
});
