import { ComputeEngine } from '../../src/compute-engine';

// Tycho item 164 (2026-08-10): the 0.103.2 narrowing of the point accessors
// to `(collection | tuple) -> any` rejected `At`'s optional result. An
// in-range-unprovable access types `missing | tuple<…>` (the out-of-range
// arm), and without a declared `missingBehavior` the checker refused the
// union, so every indexed-then-accessed chain (`S[n].x`) errored at
// canonicalization. The accessors, the `First` family and `Distance` now
// admit the `missing` arm through strip-before-validate (§3.B of
// `docs/TYPE-SYSTEM.md`):
//
// - `PointX`/`PointY`/`PointZ` declare `propagate` — a coordinate is a
//   numeric slot, so an absent point's coordinate is the numeric marker `NaN`;
// - `First`/`Second`/`Third`/`Last` declare `handle` — the element domain is
//   unknown, so they mirror `At` and propagate `Missing` itself;
// - `Distance` declares `propagate` with an explicit NaN absorption in its
//   evaluate handler (the §3.E gate defers to collection operands, and a
//   tuple is one).

describe('Tycho item 164: accessors over At results (missing | T)', () => {
  let ce: ComputeEngine;

  beforeEach(() => {
    ce = new ComputeEngine();
    ce.declare('S', 'list<tuple<number, number>>');
  });

  describe('canonicalization admits the missing arm (parse route)', () => {
    test('S[2].x is valid and types number', () => {
      const e = ce.parse('S\\left[2\\right].x');
      expect(e.isValid).toBe(true);
      expect(e.type.toString()).toBe('number');
    });

    test('PointY, PointZ, First, Last, Distance compose with At', () => {
      for (const src of [
        '\\operatorname{PointY}(S\\left[2\\right])',
        '\\operatorname{PointZ}(S\\left[2\\right])',
        '\\operatorname{First}(S\\left[2\\right])',
        '\\operatorname{Last}(S\\left[2\\right])',
        '\\operatorname{Distance}(S\\left[2\\right],\\left(0,0\\right))',
      ])
        expect(ce.parse(src).isValid).toBe(true);
    });
  });

  describe('box route (route parity)', () => {
    test('PointX(At(S, 2)) is valid and types number', () => {
      const e = ce.box(['PointX', ['At', 'S', 2]]);
      expect(e.isValid).toBe(true);
      expect(e.type.toString()).toBe('number');
    });

    test('First(At(S, 2)) is valid', () => {
      expect(ce.box(['First', ['At', 'S', 2]]).isValid).toBe(true);
    });
  });

  describe('runtime markers', () => {
    beforeEach(() => {
      ce.assign('S', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    });

    test('in-range: S[2].x is the coordinate', () => {
      expect(ce.parse('S\\left[2\\right].x').evaluate().json).toBe(3);
    });

    test('out-of-range coordinate is the numeric marker NaN', () => {
      expect(ce.parse('S\\left[5\\right].x').evaluate().isNaN).toBe(true);
    });

    test('out-of-range element access propagates Missing, mirroring At', () => {
      expect(
        ce.box(['First', ['At', 'S', 5]]).evaluate().symbol
      ).toBe('Missing');
    });

    test('Distance of an absent point is NaN; of a present one, the value', () => {
      expect(
        ce
          .box(['Distance', ['At', 'S', 5], ['Tuple', 0, 0]])
          .evaluate().isNaN
      ).toBe(true);
      expect(
        ce.box(['Distance', ['At', 'S', 2], ['Tuple', 0, 0]]).evaluate().json
      ).toBe(5);
    });
  });

  describe('ruled pins hold (non-regression)', () => {
    test('a 2-element numeric list is element-indexed, not a point', () => {
      expect(ce.box(['PointX', ['List', 3, 4]]).evaluate().json).toBe(3);
    });

    test('PointZ of a flat 2-element numeric list carries the marker', () => {
      expect(ce.box(['PointZ', ['List', 7, 8]]).evaluate().isNaN).toBe(true);
    });
  });
});
