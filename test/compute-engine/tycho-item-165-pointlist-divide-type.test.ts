import { ComputeEngine } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';

// Tycho item 165 (2026-08-10): a CORE corpus state (`neyret/62urmx2dcm`, a
// Voronoï diagram) drew on CE 0.103.1 and went blank on 0.103.2 — while
// getting 2.8x FASTER, because the work was being skipped rather than done.
//
// The bisect pointed at the 0.103.2 point-accessor narrowing, but the defect
// is one step UPSTREAM of the accessors and PRE-DATES the window on both
// bundles: `Divide` dropped the tuple type of a `PointList` numerator.
//
// `canonicalDivide` scales a `tuple / scalar` component-wise only when the
// numerator's components are ACCESSIBLE — a `Tuple`/`Pair`/`Triple`/`Single`
// head. Every other tuple-TYPED numerator, notably the `PointList` head that
// importers emit, stays an inert `Divide`, and the type handler had no tuple
// branch, so that inert form collapsed to `number`. The collapse cascaded:
//
//   PointList(x,y)/n            -> number        (want tuple<number, number>)
//   [ p/n + p/n, ... ] (9x)     -> vector<9>     (a list of NUMBERS)
//   PointX(that list)           -> element INDEX read, not elementwise
//   (x - PointX(...))^2 + ...   -> finite_number (want vector<9>)
//
// and the consumer's type-first "is this collection-valued" proof then failed
// closed, so two document rows never registered and the state drew nothing.
//
// The fix is TYPE-ONLY and mirrors what `Multiply` already does (it also stays
// inert on this input, yet reports the tuple type): no canonical form changes,
// so the `PointList` head — which carries a consumer compile contract — is
// preserved. `Multiply`, `Add`, `Subtract` and `Negate` were already correct;
// `Divide` was the sole outlier.

describe('Tycho item 165: Divide preserves the tuple type of a PointList', () => {
  let ce: ComputeEngine;

  beforeEach(() => {
    ce = new ComputeEngine();
    for (const v of ['x', 'y', 'n']) ce.declare(v, 'number');
  });

  const isTupleType = (t: string) => t.startsWith('tuple<');

  describe('the minimal repro', () => {
    test('PointList(x,y) / n keeps the tuple type', () => {
      expect(
        ce.parse('\\frac{\\operatorname{PointList}(x, y)}{n}').type.toString()
      ).toMatch(/^tuple</);
    });

    test('PointList(x,y) / 2 (literal divisor) keeps the tuple type', () => {
      expect(
        ce.parse('\\frac{\\operatorname{PointList}(x, y)}{2}').type.toString()
      ).toMatch(/^tuple</);
    });

    test('the tuple type survives without distributing (PointList head kept)', () => {
      // The value-level form stays an inert Divide over the PointList head —
      // the fix must not rewrite it into a Tuple, which would drop the head a
      // consumer's compile handler dispatches on.
      const e = ce.box(['Divide', ['PointList', 'x', 'y'], 'n']);
      expect(JSON.stringify(e.json)).toContain('PointList');
      expect(e.type.toString()).toMatch(/^tuple</);
    });
  });

  describe('parity across the tuple-producing heads', () => {
    // Every one of these keeps the tuple type for `Tuple`; `PointList` must
    // agree. `T + T/n` and `2*T + T/n` previously did not merely mistype —
    // they ERRORED, because Add saw `tuple + number`.
    const CASES: [string, (t: () => unknown) => unknown][] = [
      ['T / n', (t) => ['Divide', t(), 'n']],
      ['T / 2', (t) => ['Divide', t(), 2]],
      ['T * n', (t) => ['Multiply', t(), 'n']],
      ['T + T', (t) => ['Add', t(), t()]],
      ['T - T', (t) => ['Subtract', t(), t()]],
      ['-T', (t) => ['Negate', t()]],
      ['T + T/n', (t) => ['Add', t(), ['Divide', t(), 'n']]],
      ['T/n + T/n', (t) => ['Add', ['Divide', t(), 'n'], ['Divide', t(), 'n']]],
      ['2*T + T/n', (t) => ['Add', ['Multiply', 2, t()], ['Divide', t(), 'n']]],
    ];

    for (const [label, build] of CASES) {
      for (const head of ['Tuple', 'Pair', 'PointList']) {
        test(`${label} over ${head} is tuple-typed`, () => {
          const e = ce.box(build(() => [head, 'x', 'y']) as never);
          expect(isTupleType(e.type.toString())).toBe(true);
        });
      }
    }
  });

  describe('the downstream cascade is repaired', () => {
    const element =
      '\\frac{\\operatorname{PointList}(x, y)}{n}+' +
      '\\frac{\\operatorname{PointList}(x, y)}{n}';

    test('a list of such quotients types as a list of tuples, not a vector', () => {
      const t = ce
        .parse(`\\bigl\\lbrack${element}, ${element}\\bigr\\rbrack`)
        .type.toString();
      expect(t).toMatch(/^list<tuple</);
    });

    test('PointX over that list is elementwise, not an index read', () => {
      expect(
        ce
          .parse(
            `\\mathrm{PointX}(\\bigl\\lbrack${element}, ${element}\\bigr\\rbrack)`
          )
          .type.toString()
      ).toBe('vector<2>');
    });

    test('the corpus shape (x - PointX(list))^2 stays a vector', () => {
      // At least `vector<2>`: the shape is the guard; the cell tier may refine.
      expectTypeBetween(
        ce.parse(
          `(x-\\mathrm{PointX}(\\bigl\\lbrack${element}, ${element}\\bigr\\rbrack))^{2}`
        ),
        { atMost: 'vector<2>' }
      );
    });
  });

  describe('rulings that must NOT move', () => {
    test('PointX over a FLAT numeric list is still the element-index read', () => {
      // The 0.103.2 narrowing is deliberate (item 164 round). Item 165 is not
      // a reason to revert it: the state reached it only with a list that had
      // already lost its tuple-ness.
      expect(ce.parse('\\left[3,4\\right].x').evaluate().toString()).toBe('3');
    });

    test('PointX over a real list of points is still elementwise', () => {
      expect(
        ce.parse('\\left[(1,2),(3,4)\\right].x').evaluate().toString()
      ).toBe('[1,3]');
    });

    test('tuple / tuple is still rejected', () => {
      const e = ce.box(['Divide', ['PointList', 'x', 'y'], ['PointList', 'x', 'y']]);
      expect(JSON.stringify(e.json)).toContain('Error');
    });

    test('scalar division is untouched', () => {
      expect(ce.parse('\\frac{6}{3}').evaluate().toString()).toBe('2');
      expect(ce.box(['Divide', 'x', 1]).type.toString()).toBe('number');
    });
  });

  describe('values are unchanged (only the TYPE was wrong)', () => {
    test('a concrete PointList quotient still evaluates component-wise', () => {
      expect(
        ce
          .box(['Divide', ['PointList', 6, 8], 2])
          .evaluate()
          .toString()
      ).toBe('(3, 4)');
    });

    test('the mixed form evaluates to the right point', () => {
      // (6,8)/2 + (6,8)/2 = (6,8)
      expect(
        ce
          .box([
            'Add',
            ['Divide', ['PointList', 6, 8], 2],
            ['Divide', ['PointList', 6, 8], 2],
          ])
          .evaluate()
          .toString()
      ).toBe('(6, 8)');
    });
  });
});
