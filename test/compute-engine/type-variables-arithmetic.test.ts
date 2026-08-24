import { ComputeEngine } from '../../src/compute-engine';

/**
 * Phase 3b of the type-variables design
 * (`docs/TYPE-SYSTEM.md`): the `arithmetic.ts`
 * conversions from a weak signature + imperative `type:` handler to a `where`
 * signature.
 *
 *   Chop       `(T) -> T where T: number`        (broadcastable)
 *   PlusMinus  `(T, U) -> tuple<T, U> where T: value, U: value`
 *   Remainder  `(T, T) -> T where T: number`     (broadcastable)
 *
 * The signature now IS the contract: each `type:` handler was deleted, so
 * these tests pin that the substituted result type reproduces what the
 * handler used to compute — including the D10 lifted-echo row (§4.4) for the
 * broadcastable ones and the one ACCEPTED delta (`Remainder`'s
 * non-inferable-`unknown` edge, §4.3 bound-join table).
 *
 * `Negate` (the fourth audited candidate) is NOT converted: its
 * `missingBehavior: 'propagate'` absorption reads the operand's own `missing`
 * type, which a stripped-before-inference position (§4.5) no longer supplies —
 * `Negate(Missing)` typed `value` instead of `number`, and `('x = y').solve('x')`
 * regressed to no solution. Its echo handler stays; see the round report.
 *
 * Every operator is probed on all three routes (`ce.function`, `ce.box`,
 * `ce.parse`) — the standing route-parity pin.
 */

function engine(): ComputeEngine {
  return new ComputeEngine();
}

describe('TYPE VARIABLES / arithmetic — declared signatures', () => {
  test('the four operators carry `where` signatures', () => {
    const ce = engine();
    const sig = (op: string) =>
      ce.box(op).operatorDefinition!.signature.toString();
    expect(sig('Chop')).toBe('(T) -> T where T: number');
    expect(sig('PlusMinus')).toBe(
      '(T, U) -> tuple<T, U> where T: value, U: value'
    );
    expect(sig('Remainder')).toBe('(T, T) -> T where T: number');
    // NOT converted — see the file header.
    expect(sig('Negate')).toBe('(value) -> value');
  });
});

describe('TYPE VARIABLES / Chop — `(T) -> T where T: number`', () => {
  test('result type echoes the operand (exact and inexact)', () => {
    const ce = engine();
    expect(ce.function('Chop', [ce.number(2)]).type.toString()).toBe(
      'finite_integer'
    );
    expect(ce.function('Chop', [ce.number(2.5)]).type.toString()).toBe(
      'finite_real'
    );
    expect(ce.box(['Chop', 2]).type.toString()).toBe('finite_integer');
    expect(ce.parse('\\operatorname{chop}(2)').type.toString()).toBe(
      'finite_integer'
    );
    expect(ce.parse('\\operatorname{chop}(2.5)').type.toString()).toBe(
      'finite_real'
    );
  });

  test('a declared operand echoes verbatim (bound satisfied)', () => {
    const ce = engine();
    ce.declare('chopN', 'integer');
    expect(ce.box(['Chop', 'chopN']).type.toString()).toBe('integer');
  });

  test('the declared bound still rejects a non-number', () => {
    const ce = engine();
    ce.declare('chopS', 'string');
    const e = ce.box(['Chop', 'chopS']);
    expect(e.type.toString()).toBe('error');
    expect(e.toString()).toContain('incompatible-type');
  });

  test('D10 lifted echo — a collection operand binds the FULL actual', () => {
    const ce = engine();
    // Admission is checked at the scalar base (`integer <: number`), but `T`
    // binds the whole collection, so the result type is the COLLECTION.
    expect(ce.box(['Chop', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(
      ce.function('Chop', [ce.box(['List', 1, 2, 3])]).type.toString()
    ).toBe('vector<finite_integer^3>');
    expect(
      ce.parse('\\operatorname{chop}(\\lbrack1,2,3\\rbrack)').type.toString()
    ).toBe('vector<finite_integer^3>');

    ce.declare('chopL', 'list<integer>');
    expect(ce.box(['Chop', 'chopL']).type.toString()).toBe('list<integer>');
  });

  test('evaluation is unchanged (elementwise under broadcast)', () => {
    const ce = engine();
    expect(ce.box(['Chop', 2]).evaluate().toString()).toBe('2');
    expect(ce.box(['Chop', 1e-12]).evaluate().toString()).toBe('0');
    expect(ce.box(['Chop', ['List', 1, 2, 3]]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
    expect(
      ce.box(['Chop', ['List', 1, 1e-12, 3]]).evaluate().json
    ).toEqual(['List', 1, 0, 3]);
  });
});

describe('TYPE VARIABLES / Negate — conversion DECLINED (blocking behavior)', () => {
  // The audit listed `Negate` as a bounded identity echo
  // (`(T) -> T where T: value`), but the conversion regressed two pinned
  // behaviors, both traced to the same cause: a `propagate` operator's absent
  // operand is stripped BEFORE inference (§4.5), so `T` falls to the S3
  // declared bound instead of echoing the operand's own (`missing`-bearing)
  // type — and the missing-absorption that used to widen that echo to `number`
  // has nothing to absorb. These pin the pre-migration behavior so a future
  // attempt has to confront it deliberately.
  test('an absent operand still types `number` (missing-value P2 §3.B)', () => {
    const ce = engine();
    const e = ce.box(['Negate', 'Missing']);
    expect(e.type.toString()).toBe('number'); // was `value` under the clause
    expect(e.evaluate().toString()).toBe('NaN');
    expect(ce.box('Negate').operatorDefinition!.resolvedMissingBehavior).toBe(
      'propagate'
    );
  });

  test('`(x = y).solve(x)` still yields the assignment', () => {
    // Regressed to `[]` under the converted signature.
    const ce = engine();
    expect(ce.parse('x = y').solve('x')?.map((x) => x.json)).toEqual(['y']);
  });

  test('the echo handler still preserves the operand type on every route', () => {
    const ce = engine();
    expect(ce.function('Negate', [ce.number(2)]).type.toString()).toBe('-2');
    expect(ce.box(['Negate', 2.5]).type.toString()).toBe('-2.5');
    expect(ce.parse('-2').type.toString()).toBe('-2');
    expect(ce.box(['Negate', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['Negate', ['List', 1, 2, 3]]).evaluate().json).toEqual([
      'List',
      -1,
      -2,
      -3,
    ]);
  });
});

describe('TYPE VARIABLES / PlusMinus — `(T, U) -> tuple<T, U> where T: value, U: value`', () => {
  test('the two variables are independent (per-position echo)', () => {
    const ce = engine();
    expect(
      ce.function('PlusMinus', [ce.number(2), ce.number(3)]).type.toString()
    ).toBe('tuple<finite_integer, finite_integer>');
    expect(ce.box(['PlusMinus', 2, 3]).type.toString()).toBe(
      'tuple<finite_integer, finite_integer>'
    );
    // Mixed exact/inexact: each position keeps its own type — the reason the
    // signature needs TWO variables.
    expect(ce.box(['PlusMinus', 2.5, 3]).type.toString()).toBe(
      'tuple<finite_real, finite_integer>'
    );
    expect(
      ce.parse('\\operatorname{PlusMinus}(2,3)').type.toString()
    ).toBe('tuple<finite_integer, finite_integer>');
  });

  test('evaluation is unchanged', () => {
    const ce = engine();
    expect(ce.box(['PlusMinus', 2, 3]).evaluate().json).toEqual([
      'Tuple',
      -1,
      5,
    ]);
    expect(
      ce.parse('\\operatorname{PlusMinus}(2,3)').evaluate().json
    ).toEqual(['Tuple', -1, 5]);
  });

  test('a non-numeric operand is still rejected', () => {
    const ce = engine();
    ce.declare('pmS', 'string');
    const e = ce.box(['PlusMinus', 'pmS', 3]);
    expect(e.type.toString()).toBe('error');
    expect(e.toString()).toContain('incompatible-type');
  });
});

describe('TYPE VARIABLES / Remainder — `(T, T) -> T where T: number`', () => {
  test('the repeated variable joins its two operands (was `widen`)', () => {
    const ce = engine();
    expect(
      ce.function('Remainder', [ce.number(5), ce.number(3)]).type.toString()
    ).toBe('finite_integer');
    expect(ce.box(['Remainder', 5, 3]).type.toString()).toBe('finite_integer');
    expect(ce.box(['Remainder', 5.5, 3]).type.toString()).toBe('finite_real');
    expect(
      ce.parse('\\operatorname{Remainder}(5,3)').type.toString()
    ).toBe('finite_integer');

    ce.declare('remN', 'integer');
    ce.declare('remR', 'real');
    expect(ce.box(['Remainder', 'remN', 'remR']).type.toString()).toBe('real');
  });

  test('D10 lifted echo over a collection operand', () => {
    const ce = engine();
    expect(
      ce.box(['Remainder', ['List', 10, 11, 12], 7]).type.toString()
    ).toBe('vector<finite_integer^3>');
    ce.declare('remL', 'list<integer>');
    expect(ce.box(['Remainder', 'remL', 3]).type.toString()).toBe(
      'list<integer>'
    );
  });

  test('evaluation is unchanged (including the tie-breaking lane)', () => {
    const ce = engine();
    expect(ce.box(['Remainder', 5, 3]).evaluate().toString()).toBe('-1');
    expect(ce.box(['Remainder', -5, 2]).evaluate().toString()).toBe('-1');
    expect(ce.box(['Remainder', 5.5, 3]).evaluate().toString()).toBe('-0.5');
    expect(
      ce.box(['Remainder', ['List', 10, 11, 12], 7]).evaluate().json
    ).toEqual(['List', 3, -3, -2]);
  });

  test('ACCEPTED TIGHTENING — a non-inferable `unknown` operand absorbs', () => {
    // §4.3 bound-join table: raw `widen(unknown, X) = X` DISCARDED the
    // unknown and overstated the result; `joinBounds` absorbs to `unknown`.
    // The old `type: widen(a, b)` handler produced `number` here (after the
    // operand was narrowed on admission); the generic signature yields
    // `unknown` and, per D8, defers the narrowing write.
    const ce = engine();
    ce.declare('remU', 'unknown');
    expect(ce.box('remU').valueDefinition!.inferredType).toBe(false);

    expect(ce.box(['Remainder', 'remU', 3]).type.toString()).toBe('unknown');
    expect(ce.box(['Remainder', 3, 'remU']).type.toString()).toBe('unknown');
    // D8: the position is admitted PROVISIONALLY, so nothing is written back.
    expect(ce.box('remU').type.toString()).toBe('unknown');

    // Same edge through an unknown-result application (never narrowable):
    ce.declare('remF', '(number) -> unknown');
    expect(ce.box(['Remainder', ['remF', 1], 3]).type.toString()).toBe(
      'broadcastable<unknown>'
    );
  });

  test('an INFERABLE symbol contributes no bound and narrows to the solution', () => {
    // §4.3 table, last row: the free symbol contributes nothing, `T` solves
    // from the literal, and the symbol narrows to the instantiated parameter.
    const ce = engine();
    expect(ce.box(['Remainder', 'remX', 3]).type.toString()).toBe(
      'finite_integer'
    );
    expect(ce.box('remX').type.toString()).toBe('finite_integer');
  });

  test('the declared bound still rejects a non-number', () => {
    const ce = engine();
    ce.declare('remS', 'string');
    const e = ce.box(['Remainder', 'remS', 3]);
    expect(e.type.toString()).toBe('error');
    expect(e.toString()).toContain('incompatible-type');
  });
});
