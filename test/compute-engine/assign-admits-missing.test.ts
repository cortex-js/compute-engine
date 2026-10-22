import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
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
 * - a restricted non-numeric value and the bare marker need a declaration
 *   that admits absence (`tuple<number, number> | missing`), and the declared
 *   type stays exactly as written;
 * - a declared element contract judges an absent cell (decision P1b);
 * - subtyping is unchanged (`missing <: number` is still false), and a symbol
 *   with NO declaration still infers the `T | missing` arm.
 *
 * The alias and `Dot`/`Norm` sections at the end pin the type helpers
 * (`typeContainsMissing`, `stripMissingFromType`), which other sites use.
 */

function gatedTuple(ce: ComputeEngine) {
  return ce.parse('(1,2)\\left\\{a>0\\right\\}');
}

function gatedScalar(ce: ComputeEngine) {
  return ce.parse('3\\left\\{a>0\\right\\}');
}

describe('the type a restriction carries', () => {
  test('a gated tuple has a `missing` arm', () => {
    const ce = new ComputeEngine();
    expect(gatedTuple(ce).type.toString()).toBe(
      'missing | tuple<integer, integer>'
    );
  });

  test('a gated scalar has a `nan` arm', () => {
    // A masked number is `NaN` (user decision 2026-09-25); the arm was
    // `missing`.
    const ce = new ComputeEngine();
    expect(gatedScalar(ce).type.toString()).toBe('integer | nan');
  });
});

describe('ce.assign() of a gated value into a declared type', () => {
  test('a gated tuple needs a declaration that admits absence', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    expect(() => ce.assign('P', gatedTuple(ce))).toThrow(
      /not compatible with the type "tuple<number, number>"/
    );
    ce.declare('PM', 'tuple<number, number> | missing');
    expect(() => ce.assign('PM', gatedTuple(ce))).not.toThrow();
  });

  test('the declared type stays exactly as written', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number> | missing');
    ce.assign('P', gatedTuple(ce));
    expect(ce.box('P').type.toString()).toBe('missing | tuple<number, number>');
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
    ce.declare('P', 'tuple<number, number> | missing');
    ce.assign('P', gatedTuple(ce));
    ce.assign('a', 1);
    expect(ce.box('P').evaluate().toString()).toBe('(1, 2)');
    expect(ce.box(['IsMissing', 'P']).evaluate().symbol).toBe('False');
  });

  test('a failed gate answers the marker', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number> | missing');
    ce.assign('P', gatedTuple(ce));
    ce.assign('a', -1);
    expect(ce.box('P').evaluate().symbol).toBe('Missing');
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

describe('the marker itself needs a declaration that admits absence', () => {
  test('`Missing` does not bind to a declared `number`', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'number');
    expect(() => ce.assign('m', ce.symbol('Missing'))).toThrow(
      /not compatible with the type "number"/
    );
    ce.declare('mm', 'number | missing');
    expect(() => ce.assign('mm', ce.symbol('Missing'))).not.toThrow();
    expect(ce.box('mm').evaluate().symbol).toBe('Missing');
  });

  test('`Missing` does not bind to a declared tuple type', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tuple<number, number>');
    expect(() => ce.assign('T', ce.symbol('Missing'))).toThrow(
      /not compatible with the type "tuple<number, number>"/
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
    ).toThrow(/not compatible/);
    ce.declare('RM', {
      type: 'tuple<number, number> | missing',
      value: gatedTuple(ce),
    });
    expect(ce.box('RM').type.toString()).toBe('missing | tuple<number, number>');
  });

  test('the `Assign` operator', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'tuple<number, number>');
    expect(ce.box(['Assign', 'Q', gatedTuple(ce)]).evaluate().operator).toBe(
      'Error'
    );
    ce.declare('QM', 'tuple<number, number> | missing');
    expect(
      ce.box(['Assign', 'QM', gatedTuple(ce)]).evaluate().operator
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

describe('an inferred type still carries the `missing` arm', () => {
  test('an undeclared symbol keeps `integer | nan`', () => {
    const ce = new ComputeEngine();
    ce.assign('q', ce.parse('3\\left\\{a>0\\right\\}'));
    expect(ce.box('q').type.toString()).toBe('integer | nan');
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

describe('a declared element contract judges an absent cell (P1b)', () => {
  test('a list with an absent element does not bind to `list<number>`', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    expect(() =>
      ce.assign('L', ce.box(['List', 1, ce.symbol('Missing')]))
    ).toThrow(/not compatible with the type "list<number>"/);
    ce.declare('LM', 'list<number | missing>');
    expect(() =>
      ce.assign('LM', ce.box(['List', 1, ce.symbol('Missing')]))
    ).not.toThrow();
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

describe('a declaration with a CALLABLE arm refuses the bare marker', () => {
  test('`Missing` does not bind to `number | (number) -> number`', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'number | (number) -> number');
    expect(() => ce.assign('h', ce.symbol('Missing'))).toThrow(
      /not compatible with the type/
    );
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

describe('the compiler sees no new shape', () => {
  // A declared symbol bound to a gated value must compile exactly as the same
  // expression compiles when the symbol is declared with the `| missing` arm
  // spelled out. Both arms are measured, so a divergence fails here rather
  // than in a compile target.
  function compiledScalar(declared: string): string | null {
    const ce = new ComputeEngine();
    ce.declare('P', declared as any);
    ce.assign('P', ce.parse('3\\left\\{a>0\\right\\}'));
    return compile(ce.box(['Add', 'P', 1]))?.code ?? null;
  }

  function compiledTuple(declared: string): string | null {
    const ce = new ComputeEngine();
    ce.declare('P', declared as any);
    ce.assign('P', ce.parse('(1,2)\\left\\{a>0\\right\\}'));
    return compile(ce.box(['At', 'P', 1]))?.code ?? null;
  }

  test('a declared scalar compiles as its `| missing` spelling does', () => {
    expect(compiledScalar('number')).toBe(compiledScalar('number | missing'));
  });

  test('a declared tuple that admits absence compiles the gated read', () => {
    expect(compiledTuple('tuple<number, number> | missing')).toBe(
      compiledTuple('missing | tuple<number, number>')
    );
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

  test('the marker propagates through a numeric parameter as `NaN`', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', { str: 'number' }]])
    );
    expect(ce.box(['f', ce.symbol('Missing')]).evaluate().isNaN).toBe(true);
  });
});

describe('the absence helpers read through a structural alias', () => {
  // A structural alias (`declareType(…, { alias: true })`) IS its definition,
  // so `typeContainsMissing` and `stripMissingFromType` must read through a
  // reference to it, at the top and at a nested position. Before this, both
  // stopped at the reference node: `list<mpt>` kept its `missing` arm after
  // the strip, and the type handler of `Dot` and `Norm` then saw the arm and
  // answered the wide `value`.
  function engine() {
    const ce = new ComputeEngine();
    ce.declareType('mpt', 'missing | tuple<number, number>', { alias: true });
    ce.declareType('npt', 'missing | tuple<number, number>');
    ce.declareType('pt', 'tuple<number, number>', { alias: true });
    return ce;
  }

  test('the helpers see the `missing` arm of an alias', () => {
    const ce = engine();
    const top = ce.type('mpt').type;
    const nested = ce.type('list<mpt>').type;
    expect(typeContainsMissing(top)).toBe(true);
    expect(typeContainsMissing(nested)).toBe(true);
    expect(typeToString(stripMissingFromType(top))).toBe(
      'tuple<number, number>'
    );
    expect(typeToString(stripMissingFromType(nested))).toBe(
      'list<tuple<number, number>>'
    );
  });

  test('an alias without a `missing` arm keeps its name', () => {
    const ce = engine();
    const t = ce.type('list<pt>').type;
    expect(typeContainsMissing(t)).toBe(false);
    expect(typeToString(stripMissingFromType(t))).toBe('list<pt>');
  });

  test('a nominal type is opaque to the strip', () => {
    const ce = engine();
    const t = ce.type('list<npt>').type;
    expect(typeContainsMissing(t)).toBe(false);
    expect(typeToString(stripMissingFromType(t))).toBe('list<npt>');
  });

  test('a self-referential alias stops at its repeat', () => {
    const ce = new ComputeEngine();
    ce.declareType('nest', 'list<nest> | missing', { alias: true });
    ce.declareType('json', 'list<json> | integer', { alias: true });
    const nest = ce.type('nest').type;
    const json = ce.type('json').type;
    expect(typeContainsMissing(nest)).toBe(true);
    expect(typeContainsMissing(json)).toBe(false);
    // The descent unfolds `nest` a bounded number of times, so the strip
    // ends. The top-level `missing` arm is gone; the arm of the innermost
    // `nest` that the descent did not unfold stays.
    const stripped = stripMissingFromType(nest);
    expect(typeof stripped === 'object' && stripped.kind).toBe('list');
    expect(stripMissingFromType(json)).toBe(json);
  });

  test('`Dot` and `Norm` type an alias operand as the definition', () => {
    const ce = engine();
    ce.declare('m', 'missing | tuple<number, number>');
    ce.declare('n', 'mpt');
    ce.declare('K', 'list<missing | tuple<number, number>>');
    ce.declare('L', 'list<mpt>');
    for (const [direct, alias] of [
      ['m', 'n'],
      ['K', 'L'],
    ]) {
      const dotDirect = ce.expr(['Dot', ['Tuple', 1, 2], direct]);
      const dotAlias = ce.expr(['Dot', ['Tuple', 1, 2], alias]);
      expect(dotAlias.isValid).toBe(true);
      expect(dotAlias.type.toString()).toBe(dotDirect.type.toString());
      const normDirect = ce.expr(['Norm', direct]);
      const normAlias = ce.expr(['Norm', alias]);
      expect(normAlias.isValid).toBe(true);
      expect(normAlias.type.toString()).toBe(normDirect.type.toString());
    }
    expect(ce.expr(['Dot', ['Tuple', 1, 2], 'n']).type.toString()).toBe(
      'number'
    );
    expect(ce.expr(['Norm', 'n']).type.toString()).toBe('number');
  });

  test('`Dot` of a list of points with a list of an alias is valid', () => {
    const ce = engine();
    ce.declare('K', 'list<missing | tuple<number, number>>');
    ce.declare('L', 'list<mpt>');
    const direct = ce.expr(['Dot', ['List', ['Tuple', 1, 2]], 'K']);
    const alias = ce.expr(['Dot', ['List', ['Tuple', 1, 2]], 'L']);
    expect(alias.isValid).toBe(true);
    expect(alias.type.toString()).toBe(direct.type.toString());
    expect(alias.type.toString()).toBe('list<number>');
  });

  test('a nominal operand of `Dot` is still refused', () => {
    const ce = engine();
    ce.declare('q', 'npt');
    expect(ce.expr(['Dot', ['Tuple', 1, 2], 'q']).isValid).toBe(false);
  });
});
