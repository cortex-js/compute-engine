import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

/**
 * Assignment admits `missing` into a DECLARED type (ruled 2026-09-09).
 *
 * A restriction carries the absent case in its type: `3 {a > 0}` types
 * `integer | missing` while `a` is unbound, and `(1, 2) {a > 0}` types
 * `missing | tuple<integer, integer>`. Before this ruling the assignment
 * compatibility check demanded a subtype of the declared type, so both were
 * refused by a symbol declared `number` / `tuple<number, number>`.
 *
 * Absence is a state every type can take — the way `NaN` inhabits `number` —
 * so the value's `missing` member is removed before the subtype test. The
 * DECLARED type stays exactly as written, the value binds, and dereferencing
 * the symbol answers the gated value or the marker. Subtyping itself is
 * unchanged: `missing <: number` is still false, and a symbol with NO
 * declaration still infers the `T | missing` arm.
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

  test('a gated scalar has a `missing` arm', () => {
    const ce = new ComputeEngine();
    expect(gatedScalar(ce).type.toString()).toBe('integer | missing');
  });
});

describe('ce.assign() admits a gated value into a declared type', () => {
  test('a gated tuple binds to `tuple<number, number>`', () => {
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
    expect(ce.box('n').evaluate().symbol).toBe('Missing');
  });
});

describe('the marker itself binds to a declared type', () => {
  test('`Missing` binds to a declared `number`', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'number');
    expect(() => ce.assign('m', ce.symbol('Missing'))).not.toThrow();
    expect(ce.box('m').type.toString()).toBe('number');
    expect(ce.box('m').evaluate().symbol).toBe('Missing');
  });

  test('`Missing` binds to a declared tuple type', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tuple<number, number>');
    ce.assign('T', ce.symbol('Missing'));
    expect(ce.box('T').type.toString()).toBe('tuple<number, number>');
    expect(ce.box('T').evaluate().symbol).toBe('Missing');
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

describe('the other declared-type admission routes', () => {
  test('ce.declare() with a gated value', () => {
    const ce = new ComputeEngine();
    ce.declare('R', {
      type: 'tuple<number, number>',
      value: gatedTuple(ce),
    });
    expect(ce.box('R').type.toString()).toBe('tuple<number, number>');
  });

  test('the `Assign` operator', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', 'tuple<number, number>');
    expect(
      ce.box(['Assign', 'Q', gatedTuple(ce)]).evaluate().operator
    ).not.toBe('Error');
    expect(ce.box('Q').type.toString()).toBe('tuple<number, number>');
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
  test('an undeclared symbol keeps `integer | missing`', () => {
    const ce = new ComputeEngine();
    ce.assign('q', ce.parse('3\\left\\{a>0\\right\\}'));
    expect(ce.box('q').type.toString()).toBe('integer | missing');
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

describe('the strip reaches an absence arm nested in a collection', () => {
  test('a list with an absent element binds to `list<number>`', () => {
    // `stripMissingFromType` is the shared strip-before-validate helper and it
    // descends into element types, so a list holding an absent element is a
    // list of numbers whose element is absent. Same principle, one level down.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    expect(() =>
      ce.assign('L', ce.box(['List', 1, ce.symbol('Missing')]))
    ).not.toThrow();
    expect(ce.box('L').type.toString()).toBe('list<number>');
  });

  test('a record with an absent field binds to a record type', () => {
    // A dictionary literal whose keys are bare identifiers types
    // `record{…}`, so the absence arm sits on a FIELD.
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

  test('a dictionary with an absent value binds to `dictionary<number>`', () => {
    // A key that is not a bare identifier makes the literal type
    // `dictionary<T>` rather than `record{…}`, so this exercises the other
    // dictionary arm of the strip.
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

  test('a set with an absent element binds to `set<number>`', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'set<number>');
    expect(() =>
      ce.assign('S', ce.box(['Set', 1, gatedScalar(ce)]))
    ).not.toThrow();
    expect(ce.box('S').type.toString()).toBe('set<number>');
  });

  test('a nested carrier that does not fit is still refused', () => {
    // The strip removes the absence arm one level down too; the field's
    // carrier still has to fit the declared field type.
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

describe('a declaration with a CALLABLE arm still refuses the bare marker', () => {
  // `hasFunctionSignature` is true only when EVERY arm of a union is a
  // signature, so a mixed declaration escapes it. The carve-out asks the
  // weaker question — is ANY arm callable? — because the bare marker strips
  // to the bottom type, which is a subtype of every arm.
  test('`Missing` does not bind to `number | (number) -> number`', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'number | (number) -> number');
    expect(() => ce.assign('h', ce.symbol('Missing'))).toThrow(
      /not compatible with the type/
    );
  });

  test('a gated SCALAR still binds through the non-callable arm', () => {
    // Only a value that could match through the callable arm ALONE is
    // refused. `3 {a > 0}` strips to `integer`, which the `number` arm
    // admits on its own merits.
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

  test('a declared tuple compiles as its `| missing` spelling does', () => {
    expect(compiledTuple('tuple<number, number>')).toBe(
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
