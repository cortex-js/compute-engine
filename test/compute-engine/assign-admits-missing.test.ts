import { ComputeEngine } from '../../src/compute-engine';
import {
  stripMissingFromType,
  typeContainsMissing,
} from '../../src/common/type/utils';
import { typeToString } from '../../src/common/type/serialize';

/**
 * A declared type is a contract on every value the symbol takes (user
 * decision P1 of `docs/plans/2026-10-21-presence-contracts-and-assertion.md`,
 * 2026-10-21). This file was written for the rule of 2026-09-09 that it
 * reverses, under which the value's `missing` member was removed before the
 * subtype test, so `(1, 2) {a > 0}` (typed `missing | tuple<integer,
 * integer>`) and the bare marker bound to a symbol declared
 * `tuple<number, number>`. Now:
 *
 * - a restricted NUMERIC value still binds to a numeric declaration: since
 *   2026-09-25 it masks to `NaN` and types `integer | nan`, and `nan` is a
 *   number;
 * - since `Missing` is a result only (`docs/ERROR-MODEL.md`, user decision
 *   of 2026-11-02), a declared type cannot name `missing`, and a store into
 *   a declared name accepts a value that holds the marker where the declared
 *   type accepts a present value (`s: number` takes `Missing`,
 *   `L: list<number>` takes `[1, Missing]`); the declared type stays
 *   exactly as written;
 * - a restricted value `If(c, e)` has the static type of `e`, with no `nan`
 *   and no `missing` arm, so a restricted tuple binds to a declared
 *   `tuple<number, number>` (the restriction-binding decision of 2026-11-02,
 *   `docs/plans/2026-11-02-restriction-binding.md`);
 * - subtyping is unchanged (`missing <: number` is still false), and a symbol
 *   with NO declaration still infers the `T | missing` arm.
 *
 * The alias section at the end pins the type helpers
 * (`typeContainsMissing`, `stripMissingFromType`), which other sites use.
 */

function gatedTuple(ce: ComputeEngine) {
  return ce.parse('(1,2)\\left\\{a>0\\right\\}');
}

function gatedScalar(ce: ComputeEngine) {
  return ce.parse('3\\left\\{a>0\\right\\}');
}

describe('the type a restriction carries', () => {
  // The static type of a single-branch `If(c, e)` is the type of `e`, with
  // no `missing` and no `nan` arm.
  test('a gated tuple has the type of the tuple', () => {
    const ce = new ComputeEngine();
    expect(gatedTuple(ce).type.toString()).toBe('tuple<integer, integer>');
  });

  test('a gated scalar has the type of the scalar', () => {
    const ce = new ComputeEngine();
    expect(gatedScalar(ce).type.toString()).toBe('integer');
  });
});

describe('ce.assign() of a gated value into a declared type', () => {
  test('a gated tuple binds to a declared tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    expect(() => ce.assign('P', gatedTuple(ce))).not.toThrow();
  });

  test('the declared type stays exactly as written', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    ce.assign('P', gatedTuple(ce));
    expect(ce.box('P').type.toString()).toBe('tuple<number, number>');
  });

  test('a gated scalar binds to `number`', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    expect(() => ce.assign('n', gatedScalar(ce))).not.toThrow();
    expect(ce.box('n').type.toString()).toBe('number');
  });
});

describe('the bound gate still decides at evaluation', () => {
  test('a satisfied gate answers the tuple', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    ce.assign('P', gatedTuple(ce));
    ce.assign('a', 1);
    expect(ce.box('P').evaluate().toString()).toBe('(1, 2)');
    expect(ce.box(['IsMissing', 'P']).evaluate().symbol).toBe('False');
  });

  test('a failed gate answers the marker', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    ce.assign('P', gatedTuple(ce));
    ce.assign('a', -1);
    // A false restriction of a point is the point of `NaN` coordinates
    // (user decision 2026-11-03), which `IsMissing` reads as absent.
    expect(ce.box('P').evaluate().toString()).toBe('(NaN, NaN)');
    expect(ce.box(['IsMissing', 'P']).evaluate().symbol).toBe('True');
  });

  test('a scalar gate decides the same way', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    ce.assign('n', gatedScalar(ce));
    ce.assign('a', 1);
    expect(ce.box('n').evaluate().toString()).toBe('3');
    ce.assign('a', -1);
    // A masked number is `NaN` (user decision 2026-09-25).
    expect(ce.box('n').evaluate().isNaN).toBe(true);
  });
});

describe('the marker itself binds to a declaration of a present value', () => {
  test('`Missing` binds to a declared `number`', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'number');
    expect(() => ce.assign('m', ce.symbol('Missing'))).not.toThrow();
    expect(ce.box('m').evaluate().symbol).toBe('Missing');
    expect(ce.box('m').type.toString()).toBe('number');
  });

  test('`Missing` binds to a declared tuple type', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tuple<number, number>');
    expect(() => ce.assign('T', ce.symbol('Missing'))).not.toThrow();
  });

  test('a declared type cannot name `missing`', () => {
    const ce = new ComputeEngine();
    expect(() => ce.declare('mm', 'number | missing')).toThrow(
      /cannot be declared/
    );
  });

  test('a declared FUNCTION SIGNATURE is not opened by the marker', () => {
    // A bare `missing` strips to the bottom type, which is a subtype of every
    // signature. Admitting it would install a CALLABLE definition under a
    // contract nothing proved, so signatures keep refusing it — the same
    // carve-out the `unknown` admission rule makes.
    const ce = new ComputeEngine();
    ce.declare('g', '(number) -> number');
    expect(() => ce.assign('g', ce.symbol('Missing'))).toThrow(
      /not compatible with the type/
    );
  });
});

describe('the other declared-type routes agree', () => {
  test('ce.declare() with a gated value', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('R', { type: 'tuple<number, number>', value: gatedTuple(ce) })
    ).not.toThrow();
    expect(ce.box('R').type.toString()).toBe('tuple<number, number>');
  });

  test('the `Assign` operator', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'tuple<number, number>');
    expect(
      ce.box(['Assign', 'Q', gatedTuple(ce)]).evaluate().operator
    ).not.toBe('Error');
  });

  test('the `:=` parse route', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number');
    ce.parse('u := 3\\left\\{a>0\\right\\}').evaluate();
    expect(ce.box('u').type.toString()).toBe('number');
    ce.assign('a', 1);
    expect(ce.box('u').evaluate().toString()).toBe('3');
  });
});

describe('an inferred type follows the restricted value', () => {
  test('an undeclared symbol takes the type of the restricted value', () => {
    const ce = new ComputeEngine();
    ce.assign('q', ce.parse('3\\left\\{a>0\\right\\}'));
    expect(ce.box('q').type.toString()).toBe('integer');
  });
});

describe('a genuinely incompatible value is still refused', () => {
  test('a list does not bind to a tuple type', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    expect(() => ce.assign('P', ce.box(['List', 1, 2]))).toThrow(
      /is not compatible with the type "tuple<number, number>"/
    );
  });

  test('a string does not bind to `number`', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'number');
    expect(() => ce.assign('s', ce.string('hello'))).toThrow(
      /is not compatible with the type "number"/
    );
  });

  test('a gated STRING does not bind to `number` either', () => {
    // The strip removes only the absence arm; the carrier still has to fit.
    const ce = new ComputeEngine();
    ce.declare('s', 'number');
    expect(() =>
      ce.assign('s', ce.parse('\\text{hello}\\left\\{a>0\\right\\}'))
    ).toThrow(/is not compatible with the type "number"/);
  });
});

describe('a declared element contract and an absent cell', () => {
  test('a list with an absent element binds to `list<number>`', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    expect(() =>
      ce.assign('L', ce.box(['List', 1, ce.symbol('Missing')]))
    ).not.toThrow();
    expect(ce.box('L').type.toString()).toBe('list<number>');
  });

  test('a record with a gated numeric field binds to a record type', () => {
    // A dictionary literal whose keys are bare identifiers types
    // `record{…}`; the gated field is `integer | nan`, which `number` admits.
    const ce = new ComputeEngine();
    ce.declare('R', 'record{x: number}');
    expect(() =>
      ce.assign(
        'R',
        ce.box(['Dictionary', ['Tuple', { str: 'x' }, gatedScalar(ce)]])
      )
    ).not.toThrow();
    expect(ce.box('R').type.toString()).toBe('record{x: number}');
  });

  test('a dictionary with a gated numeric value binds to `dictionary<number>`', () => {
    // A key that is not a bare identifier makes the literal type
    // `dictionary<T>` rather than `record{…}`.
    const ce = new ComputeEngine();
    ce.declare('D', 'dictionary<number>');
    expect(() =>
      ce.assign(
        'D',
        ce.box(['Dictionary', ['Tuple', { str: 'a b' }, gatedScalar(ce)]])
      )
    ).not.toThrow();
    expect(ce.box('D').type.toString()).toBe('dictionary<number>');
  });

  test('a set with a gated numeric element binds to `set<number>`', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'set<number>');
    expect(() =>
      ce.assign('S', ce.box(['Set', 1, gatedScalar(ce)]))
    ).not.toThrow();
    expect(ce.box('S').type.toString()).toBe('set<number>');
  });

  test('a nested carrier that does not fit is still refused', () => {
    const ce = new ComputeEngine();
    ce.declare('W', 'record{x: string}');
    expect(() =>
      ce.assign(
        'W',
        ce.box(['Dictionary', ['Tuple', { str: 'x' }, gatedScalar(ce)]])
      )
    ).toThrow(/is not compatible with the type "record\{x: string\}"/);
  });
});

describe('a declaration with a CALLABLE arm and the bare marker', () => {
  test('`Missing` binds to `number | (number) -> number` through its number arm', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'number | (number) -> number');
    expect(() => ce.assign('h', ce.symbol('Missing'))).not.toThrow();
  });

  test('a gated SCALAR binds through the non-callable arm', () => {
    // `3 {a > 0}` is `integer | nan`, which the `number` arm admits.
    const ce = new ComputeEngine();
    ce.declare('h', 'number | (number) -> number');
    expect(() => ce.assign('h', gatedScalar(ce))).not.toThrow();
    expect(ce.box('h').type.toString()).toBe('((number) -> number) | number');
  });

  test('the bare `function` wildcard refuses it too', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    expect(() => ce.assign('f', ce.symbol('Missing'))).toThrow(
      /not compatible with the type/
    );
  });
});

describe('subtyping itself is unchanged', () => {
  test('`missing` is still not a subtype of `number`', () => {
    const ce = new ComputeEngine();
    expect(ce.type('missing').matches('number')).toBe(false);
    expect(ce.type('integer | missing').matches('number')).toBe(false);
  });
});

describe('a `Typed` parameter is governed by its own missing policy', () => {
  // A parameter slot is NOT the assignment contract: the per-parameter
  // `missingBehavior` policy already decides what a gated argument does
  // (`validate.ts` strips the absence arm before the slot is matched), and
  // this ruling leaves that path alone. Pinned here so a change to either
  // mechanism shows up as a difference between the two.
  test('a gated argument reaches a `number` parameter', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', { str: 'number' }]])
    );
    expect(
      ce.box(['f', ce.parse('3\\left\\{a>0\\right\\}')]).type.toString()
    ).toBe('number');
    ce.assign('a', 1);
    expect(
      ce
        .box(['f', ce.parse('3\\left\\{a>0\\right\\}')])
        .evaluate()
        .toString()
    ).toBe('4');
  });

  test('an absent argument at a numeric parameter gives `Missing`', () => {
    // The call gives `Missing` without running the body (`docs/ERROR-MODEL.md`,
    // "`Missing` is a result only").
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', { str: 'number' }]])
    );
    expect(ce.box(['f', ce.symbol('Missing')]).evaluate().symbol).toBe(
      'Missing'
    );
  });
});

describe('the absence helpers read through a structural alias', () => {
  // A structural alias (`declareType(…, { alias: true })`) IS its definition,
  // so `typeContainsMissing` and `stripMissingFromType` read through a
  // reference to it. A declared type cannot name `missing`, so an alias has
  // no `missing` arm: the helpers keep it as it is.
  function engine() {
    const ce = new ComputeEngine();
    ce.declareType('npt', 'tuple<number, number>');
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    return ce;
  }

  test('an alias without a `missing` arm keeps its name', () => {
    const ce = engine();
    const t = ce.type('list<pt>').type;
    expect(typeContainsMissing(t)).toBe(false);
    expect(typeToString(stripMissingFromType(t))).toBe('list<pt>');
  });

  test('a nominal type keeps its name', () => {
    const ce = engine();
    const t = ce.type('list<npt>').type;
    expect(typeContainsMissing(t)).toBe(false);
    expect(typeToString(stripMissingFromType(t))).toBe('list<npt>');
  });

  test('a self-referential alias stops at its repeat', () => {
    const ce = new ComputeEngine();
    ce.declareType('json', 'list<json> | integer', { alias: true });
    const json = ce.type('json').type;
    expect(typeContainsMissing(json)).toBe(false);
    expect(stripMissingFromType(json)).toBe(json);
  });

  test('a nominal operand of `Dot` is still refused', () => {
    const ce = engine();
    ce.declare('q', 'npt');
    expect(ce.expr(['Dot', ['Tuple', 1, 2], 'q']).isValid).toBe(false);
  });
});
