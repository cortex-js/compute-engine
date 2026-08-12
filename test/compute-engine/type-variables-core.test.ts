import { ComputeEngine } from '../../src/compute-engine';

/**
 * Phase 3b of the type-variables design
 * (`docs/plans/2026-08-01-type-variables-design.md` §7.3): the `core.ts`
 * conversions from a weak signature + imperative `type:` handler to a `where`
 * signature.
 *
 *   Identity   `(T) -> T where T`
 *   Prime      `(T, integer?) -> T where T`
 *   BaseForm   `(T, (string|number)?) -> T where T: number`
 *
 * The signature now IS the contract: each `type:` handler was deleted, so
 * these tests pin that the substituted result type reproduces what the
 * handler used to compute — plus the one INTENDED improvement, `Identity`,
 * whose *declared* result was `unknown` while its handler already echoed the
 * operand (so `ce.box('Identity').operatorDefinition!.signature` and the
 * observed result type disagreed).
 *
 * Route parity (`ce.function` / `ce.box` / `ce.parse`) is probed for all
 * three. Notes on the LaTeX routes:
 *   - `Identity` has NO entry in the LaTeX dictionary; the parse route is the
 *     generic `\operatorname{…}` application form.
 *   - `Prime` parses from the `^\prime` postfix trigger (`g'`).
 *   - `BaseForm` parses from the base-subscript numeral form (`1010_{2}`),
 *     which folds the digits into the value slot at parse time.
 */

function engine(): ComputeEngine {
  return new ComputeEngine();
}

describe('TYPE VARIABLES / core — declared signatures', () => {
  test('the three operators carry `where` signatures', () => {
    const ce = engine();
    const sig = (op: string) =>
      ce.box(op).operatorDefinition!.signature.toString();
    expect(sig('Identity')).toBe('(T) -> T where T');
    expect(sig('Prime')).toBe('(T, integer?) -> T where T');
    // The optional second parameter keeps its union spelling (the serializer
    // orders the members, `(string|number)?` → `number | string?`).
    expect(sig('BaseForm')).toBe(
      '(T, number | string?) -> T where T: number'
    );
  });
});

describe('TYPE VARIABLES / Identity — `(T) -> T where T`', () => {
  test('IMPROVEMENT — the DECLARED result is no longer `unknown`', () => {
    // Pre-migration the declared signature was `(any) -> unknown` and only the
    // `type:` handler echoed the operand. The signature now carries the echo,
    // so a consumer reading the definition sees the real contract.
    const ce = engine();
    const sig = ce.box('Identity').operatorDefinition!.signature;
    expect(sig.toString()).not.toContain('unknown');
    expect(ce.function('Identity', [ce.number(5)]).type.toString()).toBe(
      'finite_integer'
    );
  });

  test('result type echoes the operand on every route', () => {
    const ce = engine();
    expect(ce.function('Identity', [ce.number(5)]).type.toString()).toBe(
      'finite_integer'
    );
    expect(ce.box(['Identity', 5]).type.toString()).toBe('finite_integer');
    expect(ce.parse('\\operatorname{Identity}(5)').type.toString()).toBe(
      'finite_integer'
    );

    expect(ce.box(['Identity', 2.5]).type.toString()).toBe('finite_real');
    expect(ce.function('Identity', [ce.string('hi')]).type.toString()).toBe(
      'string'
    );
    expect(ce.parse('\\operatorname{Identity}(\\text{hi})').type.toString()).toBe(
      'string'
    );
    expect(ce.box(['Identity', 'True']).type.toString()).toBe('boolean');
  });

  test('a matrix-typed symbol keeps its dimensions VERBATIM', () => {
    const ce = engine();
    ce.declare('idM', 'matrix<real^(2x3)>');
    expect(ce.box(['Identity', 'idM']).type.toString()).toBe(
      'matrix<real^(2x3)>'
    );
    expect(ce.function('Identity', [ce.symbol('idM')]).type.toString()).toBe(
      'matrix<real^(2x3)>'
    );
    expect(ce.parse('\\operatorname{Identity}(\\mathrm{idM})').type.toString()).toBe(
      'matrix<real^(2x3)>'
    );

    ce.declare('idL', 'list<integer>');
    expect(ce.box(['Identity', 'idL']).type.toString()).toBe('list<integer>');
    // A literal list keeps its inferred shape too.
    expect(ce.box(['Identity', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
  });

  test('the unbounded variable admits ANY operand (no bound to violate)', () => {
    const ce = engine();
    ce.declare('idS', 'string');
    const e = ce.box(['Identity', 'idS']);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('string');
  });

  test('a non-inferable `unknown` operand stays `unknown`', () => {
    const ce = engine();
    ce.declare('idU', 'unknown');
    expect(ce.box('idU').valueDefinition!.inferredType).toBe(false);
    expect(ce.box(['Identity', 'idU']).type.toString()).toBe('unknown');
  });

  test('an inferable free symbol is NOT narrowed by an unbounded variable', () => {
    const ce = engine();
    expect(ce.box(['Identity', 'idFree']).type.toString()).toBe('unknown');
    expect(ce.box('idFree').type.toString()).toBe('unknown');
  });

  test('arity errors are unchanged', () => {
    const ce = engine();
    expect(ce.box(['Identity']).type.toString()).toBe('error');
    const extra = ce.box(['Identity', 1, 2]);
    expect(extra.type.toString()).toBe('error');
    expect(extra.toString()).toContain('unexpected-argument');
  });

  test('evaluation still returns the operand unchanged', () => {
    const ce = engine();
    expect(ce.box(['Identity', 5]).evaluate().toString()).toBe('5');
    expect(ce.function('Identity', [ce.string('hi')]).evaluate().string).toBe(
      'hi'
    );
    expect(ce.box(['Identity', ['List', 1, 2, 3]]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
    expect(ce.parse('\\operatorname{Identity}(5)').evaluate().toString()).toBe(
      '5'
    );
    // Nested: the echo composes.
    expect(ce.box(['Identity', ['Identity', 5]]).type.toString()).toBe(
      'finite_integer'
    );
    expect(ce.box(['Identity', ['Identity', 5]]).evaluate().toString()).toBe(
      '5'
    );
  });
});

describe('TYPE VARIABLES / Prime — `(T, integer?) -> T where T`', () => {
  test('the result mirrors the base on every route', () => {
    const ce = engine();
    ce.declare('g', 'integer');
    expect(ce.function('Prime', [ce.symbol('g')]).type.toString()).toBe(
      'integer'
    );
    expect(ce.box(['Prime', 'g']).type.toString()).toBe('integer');
    expect(ce.parse("g'").type.toString()).toBe('integer');
    // With the explicit order operand (the `^\doubleprime` parse form).
    expect(ce.box(['Prime', 'g', 2]).type.toString()).toBe('integer');
    expect(ce.parse("g''").type.toString()).toBe('integer');

    expect(ce.box(['Prime', 5]).type.toString()).toBe('finite_integer');
    ce.declare('primeM', 'matrix<real^(2x3)>');
    expect(ce.box(['Prime', 'primeM']).type.toString()).toBe(
      'matrix<real^(2x3)>'
    );
  });

  test('an undeclared base still yields `unknown` (S3 fallback)', () => {
    // The free symbol is inferable, so it contributes no bound; `T` falls to
    // its (absent) declared bound — `unknown`, exactly what the handler's
    // `x?.type` returned.
    const ce = engine();
    expect(ce.parse("f'").type.toString()).toBe('unknown');
    expect(ce.box(['Prime', 'f']).type.toString()).toBe('unknown');
  });

  test('the optional order operand is still typed `integer`', () => {
    const ce = engine();
    const e = ce.box(['Prime', 5, 2.5]);
    expect(e.type.toString()).toBe('error');
    expect(e.toString()).toContain('incompatible-type');
    expect(e.toString()).toContain('integer');
  });

  test('the handler `undefined` fallback was dead on every VALID route', () => {
    // The audit's claim, pinned: a zero-operand `Prime` never reaches a type
    // handler with `ops[0] === undefined` — `validateArguments` turns it into
    // an error expression first. The unvalidated `_fn` route (which does reach
    // it) yields the same `unknown` under the generic signature.
    const ce = engine();
    expect(ce.box(['Prime']).type.toString()).toBe('error');
    expect(ce.function('Prime', []).type.toString()).toBe('error');
    expect(ce.box(['Prime'], { canonical: false }).type.toString()).toBe(
      'unknown'
    );
  });

  test('evaluation is unchanged (opaque head)', () => {
    const ce = engine();
    expect(ce.box(['Prime', 'f']).evaluate().json).toEqual(['Prime', 'f']);
    expect(ce.parse("f''").evaluate().json).toEqual(['Prime', 'f', 2]);
  });
});

describe('TYPE VARIABLES / BaseForm — `(T, (string|number)?) -> T where T: number`', () => {
  test('result type echoes the value operand on every route', () => {
    const ce = engine();
    expect(
      ce.function('BaseForm', [ce.number(255), ce.number(16)]).type.toString()
    ).toBe('finite_integer');
    expect(ce.box(['BaseForm', 255, 16]).type.toString()).toBe(
      'finite_integer'
    );
    // Parse route: `1010_{2}` folds the digits into the value slot.
    expect(ce.parse('1010_{2}').type.toString()).toBe('finite_integer');
    expect(ce.parse('1010_{2}').json).toEqual(['BaseForm', 10, 2]);

    expect(ce.box(['BaseForm', 2.5, 16]).type.toString()).toBe('finite_real');
    // The base operand is optional.
    expect(ce.box(['BaseForm', 255]).type.toString()).toBe('finite_integer');

    ce.declare('bfN', 'integer');
    expect(ce.box(['BaseForm', 'bfN', 16]).type.toString()).toBe('integer');
  });

  test('the base operand accepts a string as well as a number', () => {
    const ce = engine();
    expect(
      ce.function('BaseForm', [ce.number(255), ce.string('hex')]).type.toString()
    ).toBe('finite_integer');
    expect(ce.box(['BaseForm', 255, { str: 'hex' }]).isValid).toBe(true);
  });

  test('the declared bound rejects a non-number value operand', () => {
    const ce = engine();
    ce.declare('bfS', 'string');
    const e = ce.box(['BaseForm', 'bfS']);
    expect(e.type.toString()).toBe('error');
    expect(e.toString()).toContain('incompatible-type');
    // The diagnostic names the BOUND, not a type variable.
    expect(e.toString()).toContain('number');
    expect(e.toString()).not.toContain('"T"');

    const l = ce.box(['BaseForm', ['List', 1, 2], 16]);
    expect(l.type.toString()).toBe('error');
    expect(l.toString()).toContain('incompatible-type');
  });

  test('an inferable free symbol narrows to the bound', () => {
    const ce = engine();
    expect(ce.box(['BaseForm', 'bfFree', 16]).type.toString()).toBe('number');
    expect(ce.box('bfFree').type.toString()).toBe('number');
  });

  test('ACCEPTED TIGHTENING — a non-inferable `unknown` operand absorbs (D8)', () => {
    // The one delta of this conversion, the same §4.3 bound-join edge that
    // `Remainder` recorded: the old handler echoed `unknown`, which the fixed
    // declared result (`-> number`) then narrowed back to `number`. The bound
    // variable absorbs instead, and per D8 the position is admitted
    // PROVISIONALLY, so nothing is written back to the symbol.
    const ce = engine();
    ce.declare('bfU', 'unknown');
    expect(ce.box('bfU').valueDefinition!.inferredType).toBe(false);
    const e = ce.box(['BaseForm', 'bfU', 16]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('unknown');
    expect(ce.box('bfU').type.toString()).toBe('unknown');
  });

  test('evaluation and serialization are unchanged', () => {
    const ce = engine();
    // `evaluate` echoes the value operand (the base is a display attribute).
    expect(ce.box(['BaseForm', 255, 16]).evaluate().toString()).toBe('255');
    expect(ce.parse('1010_{2}').evaluate().toString()).toBe('10');
    expect(ce.box(['BaseForm', 255, 16]).latex).toBe('\\mathrm{ff}_{16}');
  });
});
