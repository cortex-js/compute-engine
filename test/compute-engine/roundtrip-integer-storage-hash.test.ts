import { ComputeEngine } from '../../src/compute-engine';

/**
 * One exact integer must have ONE storage form, so that the four equality
 * predicates agree about it after a serialize→parse round trip.
 *
 * `ExactNumericValue` accepted an integer as either a machine `number` or a
 * `bigint` and kept whichever it was handed. `numberToString()` then formatted
 * the two differently — a bigint with more than five trailing zeros compacts to
 * an exponent (`1e+11`) while the identical machine integer prints in full
 * (`100000000000`) — and `BoxedNumber.hash` hashes that string. So
 * `ce.box(100000000000)` (machine) and its own reparsed serialization (bigint)
 * were `isSame` with byte-equal MathJSON yet hashed differently, breaking the
 * documented `isSame ⇒ equal hash` contract.
 *
 * The constructor now applies the same safe-integer normalization
 * `reducedRational()` already used (`numerics/rationals.ts`). Reported by the
 * Tycho team as item 178(b), found by re-running their item-153 corpus seed.
 */

/** The four predicates of the Tycho round-trip harness, on one engine. */
function predicates(json: number) {
  const ce = new ComputeEngine();
  const a = ce.box(json);
  const b = ce.parse(a.toLatex({ materialization: false }));
  return {
    jsonEq: JSON.stringify(a.json) === JSON.stringify(b.json),
    isSame: a.isSame(b),
    hashEq: a.hash === b.hash,
    rebox: a.isSame(ce.box(b.json)),
    aStr: a.toString(),
    bStr: b.toString(),
  };
}

describe('an exact integer round-trips with all four predicates agreeing', () => {
  // 1e11 is the filed witness; 1e6 is the smallest value that reached the
  // bigint compaction (more than five trailing zeros); 100000 has exactly five
  // and always agreed, so it guards the boundary from the other side.
  test.each([100000000000, 1000000, 100000, 12345678, 0, 1, -1000000])(
    '%p',
    (value) => {
      const p = predicates(value);
      expect(p).toMatchObject({
        jsonEq: true,
        isSame: true,
        hashEq: true,
        rebox: true,
      });
      // The two routes must also AGREE on the printed form, which is what the
      // hash was keyed on.
      expect(p.aStr).toEqual(p.bStr);
    }
  );
});

describe('bignum magnitudes keep their compact exponent form', () => {
  // The normalization must not reach past the safe-integer range: compaction
  // is what keeps a bignum result readable instead of a 150-digit literal.
  it('a 26-digit integer still serializes with an exponent', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Sqrt', { num: '12345670000000000000000000' }]).json
    ).toEqual(['Sqrt', { num: '1234567e+19' }]);
  });

  it('a value just past MAX_SAFE_INTEGER stays exact', () => {
    const ce = new ComputeEngine();
    const big = '9007199254740993'; // 2^53 + 1, not representable as a double
    expect(ce.box({ num: big }).toString()).toEqual(big);
  });

  it('50! is unaffected', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('50!').evaluate().toString()).toContain(
      '30414093201713378043612608166064768844377641568960512'
    );
  });
});
