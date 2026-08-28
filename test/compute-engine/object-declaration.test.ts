/**
 * The `object{…}` TYPE DECLARATION and its named-argument CONSTRUCTOR.
 *
 * `type Person = object{firstName: string, …}` declares a NOMINAL type whose
 * stored fields are fixed at declaration, and mints one constructor:
 * `Person(firstName: "Alan", …)`. Spec: `docs/TYPE_SYSTEM_ROADMAP.md`
 * Appendix B — "Declaring an object type" (the field list, ruling B7's
 * every-field-required constructor, ruling B11's required argument names, the
 * `object-type-not-inline` restriction), "No subtyping between object types",
 * "Generic object types" (ruling B13), "Every construction makes a new
 * object", and the lattice bullet of "The rest of the system" (ruling B6).
 *
 * The VALUE these produce — identity, equality, serialization, cycles — is
 * pinned by `object-core.test.ts`; this file is about the declaration, the
 * type it puts in the lattice, and the constructor.
 *
 * Both routes are exercised throughout. `DeclareType` is a lazy operator, and
 * a lazy operator's held operands arrive unbound, so a suite that only used
 * one route would miss that failure class entirely.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isObject } from '../../src/compute-engine/boxed-expression/type-guards';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** A `NamedArgument` carrier, as the Epsil parser emits for `name: value`. */
function named(name: string, value: unknown): unknown {
  return ['NamedArgument', { str: name }, value];
}

/** The `["Error", ["ErrorCode", code, …]]` codes anywhere inside `expr`. The
 * MathJSON spelling of a code is a quoted string (`"'missing'"`); the quotes
 * are stripped so a test names the code as the engine does. */
function errorCodes(expr: Expression): string[] {
  const codes: string[] = [];
  const unquote = (s: string): string => s.replace(/^'|'$/g, '');
  const walk = (x: any): void => {
    if (!Array.isArray(x)) return;
    if (x[0] === 'Error') {
      const detail = x[1];
      if (typeof detail === 'string') codes.push(unquote(detail));
      else if (Array.isArray(detail) && detail[0] === 'ErrorCode')
        codes.push(unquote(String(detail[1])));
    }
    for (const op of x) walk(op);
  };
  walk(expr.json);
  return codes;
}

/** Every code an Epsil run reports: each diagnostic's own code, plus — for the
 * `static-type-error` / `runtime-error` wrappers, which carry an ENGINE error
 * code in their last argument — that code too. */
function epsilCodes(source: string, engine = ce): string[] {
  const { diagnostics } = executeEpsil(engine, source);
  const codes: string[] = [];
  for (const d of diagnostics) {
    if (!Array.isArray(d.message)) {
      codes.push(String(d.message));
      continue;
    }
    codes.push(String(d.message[0]));
    const last = d.message[d.message.length - 1];
    if (d.message.length > 1 && typeof last === 'string' && last.length > 0)
      codes.push(last);
  }
  return codes;
}

describe('OBJECT TYPE — the `object{…}` type form', () => {
  test('parses and round-trips through serialization', () => {
    ce.declareType(
      'Person',
      'object{firstName: string, lastName: string, age: integer}'
    );
    const def = ce.type('Person').type;
    expect(typeof def === 'object' && def.kind === 'reference').toBe(true);
    const body = (def as { def: unknown }).def as {
      kind: string;
      elements: Record<string, unknown>;
    };
    expect(body.kind).toBe('object');
    // Field ORDER is the declared order: it is the constructor's parameter
    // order and the serialization order.
    expect(Object.keys(body.elements)).toEqual([
      'firstName',
      'lastName',
      'age',
    ]);
    expect(ce.type(body as never).toString()).toBe(
      'object{firstName: string, lastName: string, age: integer}'
    );
  });

  test('a re-parse of the serialized form yields the same type', () => {
    ce.declareType('A', 'object{x: integer, y: list<string>}');
    const text = ce
      .type(((ce.type('A').type as { def: unknown }).def as never) ?? 'never')
      .toString();
    expect(text).toBe('object{x: integer, y: list<string>}');
    ce.declareType('B', text);
    expect(
      ((ce.type('B').type as { def: unknown }).def as { kind: string }).kind
    ).toBe('object');
  });

  test('bare `object` is a usable type meaning "any object"', () => {
    expect(ce.type('object').toString()).toBe('object');
    // `object{}` with no fields is the bare primitive, not an empty layout.
    ce.declareType('Anything', 'object{}');
    expect(ce.type('Anything').toString()).toBe('Anything');
  });

  test('`object` and `record` are DISJOINT — in both directions (B6)', () => {
    expect(ce.type('object').matches('record')).toBe(false);
    expect(ce.type('record').matches('object')).toBe(false);
    ce.declareType('Data', 'record{id: string}');
    ce.declareType('MutableData', 'object{id: string}');
    expect(ce.type('Data').matches('object')).toBe(false);
    expect(ce.type('MutableData').matches('record')).toBe(false);
  });

  test('a value of a declared object type inhabits bare `object`', () => {
    const { diagnostics, value } = executeEpsil(
      new ComputeEngine(),
      'type P = object{a: integer}\nlet x: object = P(a: 1)\nx'
    );
    expect(diagnostics).toEqual([]);
    expect(value!.type.toString()).toBe('P');
  });

  test('a RECORD value does not inhabit bare `object`', () => {
    expect(
      epsilCodes(
        'type D = record{a: integer}\nlet x: object = D(a: 1)\nx',
        new ComputeEngine()
      )
    ).toContain('incompatible-type');
  });

  test('`object` is not a collection', () => {
    expect(ce.type('object').matches('collection')).toBe(false);
    expect(ce.type('object').matches('dictionary')).toBe(false);
    ce.declareType('MutableData', 'object{id: string}');
    expect(ce.type('MutableData').matches('collection')).toBe(false);
  });

  test('an inline `object{…}` annotation is rejected (box route)', () => {
    let code: string | undefined;
    let message = '';
    try {
      ce.declare('x', { type: 'object{id: string}' });
    } catch (e) {
      code = (e as { code?: string }).code;
      message = (e as Error).message;
    }
    expect(code).toBe('object-type-not-inline');
    expect(message).toContain('may only be the definition of a named type');
  });

  test('an inline `object{…}` annotation is rejected (Epsil route)', () => {
    expect(epsilCodes('let x: object{id: string} = 1')).toEqual([
      'object-type-not-inline',
    ]);
  });

  test('an `object{…}` NESTED in a declaration body is inline too', () => {
    expect(() => ce.declareType('T', 'list<object{a: integer}>')).toThrow(
      /may only be the definition of a named type/
    );
    expect(epsilCodes('type T = list<object{a: integer}>')).toEqual([
      'object-type-not-inline',
    ]);
    expect(epsilCodes('type T = object{a: integer} | integer')).toEqual([
      'object-type-not-inline',
    ]);
  });

  test('a `type alias` body may not be an `object{…}` layout', () => {
    // Object types are nominal. A structural alias to a layout would make two
    // aliases of one shape interchangeable — exactly the subtyping between
    // object types the appendix rules out.
    expect(() =>
      ce.declareType('P', 'object{a: integer}', { alias: true })
    ).toThrow(/may only be the definition of a named type/);
    expect(epsilCodes('type alias P = object{a: integer}\n1')).toEqual([
      'object-type-not-inline',
    ]);
  });

  test('a FIELD may not spell another `object{…}` layout', () => {
    // It would name a second, unnamed object type. Declare it and refer to it
    // by name instead.
    expect(() => ce.declareType('P', 'object{a: object{b: integer}}')).toThrow(
      /may only be the definition of a named type/
    );
    ce.declareType('Inner', 'object{b: integer}');
    expect(() => ce.declareType('Q', 'object{a: Inner}')).not.toThrow();
  });
});

describe('OBJECT TYPE — subtyping', () => {
  beforeEach(() => {
    ce.declareType('Counter', 'object{count: integer}');
    ce.declareType('Gauge', 'object{count: integer}');
    ce.declareType('Widened', 'object{count: number}');
  });

  test('two object types with IDENTICAL shapes are unrelated', () => {
    expect(ce.type('Counter').matches('Gauge')).toBe(false);
    expect(ce.type('Gauge').matches('Counter')).toBe(false);
  });

  test('a wider field type does not make a supertype either', () => {
    // The Counter/Gauge unsoundness of Appendix B: were this allowed, a store
    // of `1.5` through the `number` view would leave a non-integer in a field
    // whose type says `integer`.
    expect(ce.type('Counter').matches('Widened')).toBe(false);
    expect(ce.type('Widened').matches('Counter')).toBe(false);
  });

  test('every object type IS a subtype of bare `object`', () => {
    expect(ce.type('Counter').matches('object')).toBe(true);
    expect(ce.type('Gauge').matches('object')).toBe(true);
    expect(ce.type('Widened').matches('object')).toBe(true);
  });

  test('bare `object` is not a subtype of any declared object type', () => {
    expect(ce.type('object').matches('Counter')).toBe(false);
  });

  test('a nominal RECORD type is not a subtype of `object`', () => {
    ce.declareType('Badge', 'record{id: string}');
    expect(ce.type('Badge').matches('object')).toBe(false);
  });

  test('an object type inherits `value` and `expression`', () => {
    // An object is inert data — not an operator, not a symbol — so it sits
    // under `value` beside scalars and collections, and under `expression`
    // through it. Without this, an object could not satisfy a `value`- or
    // `expression`-typed parameter or binding, which most library signatures
    // and many annotations use.
    expect(ce.type('object').matches('value')).toBe(true);
    expect(ce.type('object').matches('expression')).toBe(true);
    expect(ce.type('Counter').matches('value')).toBe(true);
    expect(ce.type('Counter').matches('expression')).toBe(true);
  });

  test('inheriting `value` does NOT relate two object types', () => {
    // The single common bound stays bare `object` (ruling B6): sharing a
    // supertype must not become a back door to `Counter <: Gauge`, nor make
    // an object a `record`/`collection`/`scalar`.
    expect(ce.type('Counter').matches('Gauge')).toBe(false);
    expect(ce.type('Counter').matches('record')).toBe(false);
    expect(ce.type('Counter').matches('collection')).toBe(false);
    expect(ce.type('Counter').matches('scalar')).toBe(false);
    expect(ce.type('record').matches('object')).toBe(false);
    // And `value`/`expression` are not subtypes of `object` in return.
    expect(ce.type('value').matches('object')).toBe(false);
    expect(ce.type('expression').matches('object')).toBe(false);
  });
});

describe('OBJECT TYPE — a property read on a bare `object`', () => {
  test('defers statically rather than being an error', () => {
    // Bare `object` promises fields exist without naming them — exactly as
    // bare `record` does — so a field read on it is UNSETTLED, not refuted.
    // Reporting it as settled non-field-bearing made the `Field` type handler
    // answer `error`, even though the evaluate handler reads a real object
    // correctly at runtime.
    ce.declare('q', 'object');
    const read = ce.box(['Field', 'q', { str: 'name' }]);
    expect(read.type.toString()).toBe('unknown');
    // No error value either: it stays symbolic until an object arrives.
    expect(read.evaluate().toString()).toBe('Field(q, "name")');
  });

  test('a real object reached through a bare-`object` binding still reads', () => {
    const { value } = executeEpsil(
      ce,
      [
        'type Person = object{name: string}',
        'let p: object = Person(name: "Alan")',
        'p.name',
      ].join('\n')
    );
    expect(value?.toString()).toBe('"Alan"');
  });
});

describe('OBJECT TYPE — generic declarations (B13)', () => {
  test('a stored-field type variable verifies as `inout`', () => {
    expect(() =>
      ce.declareType('Cell', 'object{value: T}', { typeParams: 'inout T' })
    ).not.toThrow();
  });

  test('`out` on a stored-field variable is rejected', () => {
    expect(() =>
      ce.declareType('Cell', 'object{value: T}', { typeParams: 'out T' })
    ).toThrow(/variance-violation/);
  });

  test('`in` on a stored-field variable is rejected', () => {
    expect(() =>
      ce.declareType('Cell', 'object{value: T}', { typeParams: 'in T' })
    ).toThrow(/variance-violation/);
  });

  test('the DEFAULT (no marker, i.e. `out`) is rejected too', () => {
    expect(() =>
      ce.declareType('Cell', 'object{value: T}', { typeParams: 'T' })
    ).toThrow(/variance-violation/);
  });

  test('the violation message names the read/write position and the fix', () => {
    let message = '';
    try {
      ce.declareType('Cell', 'object{value: T}', { typeParams: 'out T' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('read/write position');
    expect(message).toContain('`value`');
    expect(message).toContain('declare it `inout`');
  });

  test('a generic object type is declarable and constructible in Epsil', () => {
    const engine = new ComputeEngine();
    const { diagnostics, value } = executeEpsil(
      engine,
      'type Ref<inout T> = object{value: T}\nRef(value: 1)'
    );
    expect(diagnostics).toEqual([]);
    expect(isObject(value!)).toBe(true);
    // The APPLIED reference is pinned on the value, not the bare declaration
    // record (which carries no arguments and would match no use of the type).
    expect(value!.type.toString()).toBe('Ref<integer>');
  });

  test('`out` on a stored-field variable is rejected on the Epsil route', () => {
    // A trailing statement is needed for the refusal to be a DIAGNOSTIC: a
    // declaration that ends the program contributes its error VALUE as the
    // program's result instead (pre-existing behavior, shared with every
    // other type declaration).
    expect(epsilCodes('type Cell<out T> = object{value: T}\n1')).toContain(
      'invalid-type-declaration'
    );
  });
});

describe('OBJECT TYPE — the declaration statement', () => {
  test('declares on the box route and mints a constructor', () => {
    ce.declareType('MutableData', 'object{id: string, value: string}');
    const def = ce.lookupDefinition('MutableData');
    expect(def).toBeDefined();
    expect((def as any).operator.signature.toString()).toBe(
      '(id: string, value: string) state -> MutableData'
    );
  });

  test('declares on the Epsil route and mints a constructor', () => {
    const engine = new ComputeEngine();
    const { diagnostics } = executeEpsil(
      engine,
      'type MutableData = object{id: string, value: string}'
    );
    expect(diagnostics).toEqual([]);
    expect(
      (
        engine.lookupDefinition('MutableData') as any
      ).operator.signature.toString()
    ).toBe('(id: string, value: string) state -> MutableData');
  });

  test('declares from a structural Type object (host route)', () => {
    // The host may hand `declareType` a built `Type` instead of a string.
    // A layout as the whole body of a NOMINAL type is the one legal position,
    // and everything downstream is identical to the text route. (The other
    // positions are refused on this route too — see the `object-type-not-inline`
    // tests below, which cover the structural spelling.)
    ce.declareType('P', { kind: 'object', elements: { a: 'integer' } });
    expect(
      (ce.lookupDefinition('P') as any).operator.signature.toString()
    ).toBe('(a: integer) state -> P');
    const p = ce.box(['P', named('a', 1)] as never).evaluate();
    expect(isObject(p)).toBe(true);
    expect(p.type.toString()).toBe('P');
  });

  test('a second declaration in ONE Epsil program is a redefinition', () => {
    // The shipped redefinition discipline covers the object form with no work
    // of its own: `type` is `type`, whatever its body.
    expect(
      epsilCodes('type P = object{a: integer}\ntype P = object{b: integer}\n1')
    ).toContain('type-redefinition');
  });

  test('a re-declaration in a LATER program replaces, as for any type', () => {
    const engine = new ComputeEngine();
    expect(epsilCodes('type P = object{a: integer}', engine)).toEqual([]);
    expect(epsilCodes('type P = object{b: string}', engine)).toEqual([]);
    expect(
      (engine.lookupDefinition('P') as any).operator.signature.toString()
    ).toBe('(b: string) state -> P');
  });

  test('a re-declaration does NOT migrate an object built before it', () => {
    // Invariant 7 of the representation note: layouts never migrate. A
    // re-declaration UPDATES THE REGISTRY RECORD IN PLACE, so an instance that
    // merely POINTED at that record would silently start reporting the new
    // layout while its slots still hold the old one. The pinned type is a
    // detached copy, so the two populations are distinct nominal types that
    // happen to share the name `P`.
    const engine = new ComputeEngine();
    const first = executeEpsil(
      engine,
      'type P = object{a: integer}\nlet p = P(a: 1)\np'
    );
    expect(first.diagnostics).toEqual([]);
    const p = first.value!;
    expect(isObject(p)).toBe(true);
    expect([...(p as any)._slots.keys()]).toEqual(['a']);

    expect(epsilCodes('type P = object{b: string}', engine)).toEqual([]);

    // The instance keeps its slots, its printed type name, AND the layout its
    // pinned type resolves to.
    expect([...(p as any)._slots.keys()]).toEqual(['a']);
    expect(p.type.toString()).toBe('P');
    expect((p.type.type as { def?: unknown }).def).toEqual({
      kind: 'object',
      elements: { a: 'integer' },
    });
    // The registry, meanwhile, has moved on — which is what makes the copy
    // load-bearing rather than incidental.
    expect((engine.type('P').type as { def?: unknown }).def).toEqual({
      kind: 'object',
      elements: { b: 'string' },
    });
  });

  test('the pinned APPLIED reference of a generic object type round-trips', () => {
    // The detached copy of a `Cell<integer>` keeps the non-enumerable `decl`
    // back-pointer to the live declaration record: subtyping refuses two
    // same-named applications whose records differ, so a fully copied record
    // would make the pinned type match no other spelling of itself.
    const engine = new ComputeEngine();
    engine.declareType('Cell', 'object{value: T}', { typeParams: 'inout T' });
    const { diagnostics, value } = executeEpsil(
      engine,
      'let c = Cell(value: 3)\nc'
    );
    expect(diagnostics).toEqual([]);
    expect(value!.type.toString()).toBe('Cell<integer>');
    expect(value!.type.matches('Cell<integer>')).toBe(true);
    expect(value!.type.matches('object')).toBe(true);
    // And an annotated binding of that very type accepts it.
    expect(
      executeEpsil(engine, 'let d: Cell<integer> = c\nd').diagnostics
    ).toEqual([]);
  });

  test('the host `Type` route may not alias an object layout', () => {
    // `allowObjectType` gates the type-STRING parse only, so this route
    // reached the constructor mint with no check at all: a transparent alias
    // to a layout would make two aliases of one shape interchangeable —
    // exactly the subtyping between object types Appendix B rules out.
    expect(() =>
      ce.declareType(
        'P',
        { kind: 'object', elements: { a: 'integer' } },
        { alias: true }
      )
    ).toThrow(/may only be the definition of a named type/);
    // All-or-nothing: neither half of the declaration survives the refusal.
    expect(ce.lookupDefinition('P')).toBeUndefined();
    expect(() => ce.type('P')).toThrow();
  });

  test('the host `Type` route rejects a NESTED layout too', () => {
    expect(() =>
      ce.declareType('T', {
        kind: 'list',
        elements: { kind: 'object', elements: { a: 'integer' } },
      })
    ).toThrow(/may only be the definition of a named type/);
    // A FIELD spelling another layout is inline by the same rule.
    expect(() =>
      ce.declareType('Q', {
        kind: 'object',
        elements: { a: { kind: 'object', elements: { b: 'integer' } } },
      })
    ).toThrow(/may only be the definition of a named type/);
    // A field naming a DECLARED object type is the legal spelling.
    ce.declareType('Inner', { kind: 'object', elements: { b: 'integer' } });
    expect(() =>
      ce.declareType('R', {
        kind: 'object',
        elements: { a: ce.type('Inner').type },
      })
    ).not.toThrow();
  });

  test('`mint: false` does not bypass the layout-position rule', () => {
    // The rule used to be enforced only at the constructor mint site, and
    // `mint: false` — the internal escape hatch for a declaration that must
    // not claim the value name — skips minting, so every structural input
    // went in unchecked by that route.
    const mintless = { mint: false };

    expect(() =>
      ce.declareType(
        'P2',
        { kind: 'object', elements: { a: 'integer' } },
        { ...mintless, alias: true }
      )
    ).toThrow(/may only be the definition of a named type/);
    expect(() =>
      ce.declareType(
        'T2',
        {
          kind: 'list',
          elements: { kind: 'object', elements: { a: 'integer' } },
        },
        mintless
      )
    ).toThrow(/may only be the definition of a named type/);
    expect(() =>
      ce.declareType(
        'Q2',
        {
          kind: 'object',
          elements: { a: { kind: 'object', elements: { b: 'integer' } } },
        },
        mintless
      )
    ).toThrow(/may only be the definition of a named type/);

    // All-or-nothing still holds: nothing was registered.
    expect(() => ce.type('P2')).toThrow();
    expect(() => ce.type('T2')).toThrow();
    expect(() => ce.type('Q2')).toThrow();

    // The legal spelling — a layout that IS the body of a nominal type — is
    // untouched by the check, mint or no mint.
    expect(() =>
      ce.declareType(
        'Ok2',
        { kind: 'object', elements: { a: 'integer' } },
        mintless
      )
    ).not.toThrow();
    expect(ce.type('Ok2').toString()).toBe('Ok2');
  });
});

describe('OBJECT CONSTRUCTOR — argument names are required (B11)', () => {
  beforeEach(() => {
    ce.declareType(
      'Person',
      'object{firstName: string, lastName: string, age: integer}'
    );
  });

  test('a fully NAMED call is accepted, in any order', () => {
    const p = ce.box([
      'Person',
      named('age', 42),
      named('lastName', { str: 'Turing' }),
      named('firstName', { str: 'Alan' }),
    ] as never);
    expect(p.isValid).toBe(true);
    const v = p.evaluate();
    expect(isObject(v)).toBe(true);
    expect(v.toString()).toBe(
      'Person(firstName: "Alan", lastName: "Turing", age: 42)'
    );
  });

  test('a POSITIONAL call is rejected', () => {
    const p = ce.box([
      'Person',
      { str: 'Alan' },
      { str: 'Turing' },
      42,
    ] as never);
    expect(errorCodes(p)).toContain('argument-names-required');
  });

  test('the rejection lists the parameter names, in declaration order', () => {
    const p = ce.box(['Person', { str: 'A' }, { str: 'B' }, 1] as never);
    expect(p.toString()).toContain('`firstName`, `lastName`, `age`');
  });

  test('a MIXED call is rejected too', () => {
    const p = ce.box([
      'Person',
      { str: 'Alan' },
      named('lastName', { str: 'Turing' }),
      named('age', 42),
    ] as never);
    expect(errorCodes(p)).toEqual(['argument-names-required']);
  });

  test('a positional call is rejected on the Epsil route', () => {
    expect(
      epsilCodes('type P = object{a: string, b: string}\nP("x", "y")')
    ).toContain('argument-names-required');
  });
});

describe('OBJECT CONSTRUCTOR — every field is required (B7)', () => {
  beforeEach(() => {
    ce.declareType(
      'Person',
      'object{firstName: string, lastName: string, age: integer}'
    );
  });

  test('a missing field is an error naming it', () => {
    const p = ce.box([
      'Person',
      named('firstName', { str: 'Alan' }),
      named('age', 42),
    ] as never);
    expect(errorCodes(p)).toContain('missing');
    expect(p.toString()).toContain('lastName');
  });

  test('every missing field is named', () => {
    const p = ce.box(['Person', named('age', 42)] as never);
    expect(p.toString()).toContain('firstName');
    expect(p.toString()).toContain('lastName');
  });

  test('an unknown field name is an error naming it, with a did-you-mean', () => {
    const p = ce.box([
      'Person',
      named('firstNam', { str: 'Alan' }),
      named('lastName', { str: 'Turing' }),
      named('age', 42),
    ] as never);
    expect(errorCodes(p)).toContain('argument-name-unknown');
    expect(p.toString()).toContain('did you mean `firstName`?');
  });

  test('each argument is type-checked against its field type', () => {
    const p = ce.box([
      'Person',
      named('firstName', 42),
      named('lastName', { str: 'Turing' }),
      named('age', 42),
    ] as never);
    expect(errorCodes(p)).toContain('incompatible-type');
  });

  test('a superfluous field name is rejected on the Epsil route', () => {
    expect(
      epsilCodes('type P = object{a: string}\nP(a: "x", b: "y")')
    ).toContain('argument-name-unknown');
  });

  test('the evaluate handler DECLINES a call it cannot fill', () => {
    // Validation rejects a short call before the handler runs, so this is the
    // handler's own last line of defence — and it is the one place an object
    // value is minted, so it has to be the place that refuses to mint a
    // malformed one. Pairing 1 operand with 3 fields positionally would put
    // `undefined` in two slots, and every reader of a slot (the `.json` walk,
    // the AsciiMath printer) calls methods on the value it finds there.
    const evaluate = (ce.lookupDefinition('Person') as any).operator.evaluate;
    expect(evaluate([ce.number(1)], { engine: ce })).toBeUndefined();
    expect(
      evaluate(
        [ce.string('Alan'), ce.string('Turing'), ce.number(42), ce.number(1)],
        { engine: ce }
      )
    ).toBeUndefined();
    // The exact-arity call still mints.
    const p = evaluate(
      [ce.string('Alan'), ce.string('Turing'), ce.number(42)],
      { engine: ce }
    );
    expect(isObject(p)).toBe(true);
  });
});

describe('OBJECT CONSTRUCTOR — every construction makes a new object', () => {
  beforeEach(() => {
    ce.declareType('MutableData', 'object{id: string, value: string}');
  });

  /** `MutableData(id: "1", value: "x")`, boxed. */
  function construction(): Expression {
    return ce.box([
      'MutableData',
      named('id', { str: '1' }),
      named('value', { str: 'x' }),
    ] as never);
  }

  test('the application carries `state` and is therefore impure', () => {
    const e = construction();
    expect(e.isPure).toBe(false);
    expect(e.effects).toEqual(['state']);
    // Impure ⇒ not a constant expression, which is the gate every
    // constant-folding and cache-admission path consults.
    expect(e.isConstant).toBe(false);
  });

  test('evaluating ONE application twice yields two distinct objects', () => {
    // The adversarial shape for a memo: the same node, evaluated twice. A
    // cached result would return the identical instance and "two constructor
    // calls make two different objects" would be false.
    const e = construction();
    const a = e.evaluate();
    const b = e.evaluate();
    expect(isObject(a)).toBe(true);
    expect(isObject(b)).toBe(true);
    expect(a === b).toBe(false);
    expect(a.isSame(b)).toBe(false);
    expect(a.isEqual(b)).toBe(false);
  });

  test('two applications with identical arguments compare unequal', () => {
    const a = construction().evaluate();
    const b = construction().evaluate();
    expect(a.isEqual(b)).toBe(false);
    expect(ce.box(['Equal', a, b] as never).evaluate().symbol).toBe('False');
  });

  test('the same object compares EQUAL to itself', () => {
    const a = construction().evaluate();
    expect(a.isEqual(a)).toBe(true);
    expect(ce.box(['Equal', a, a] as never).evaluate().symbol).toBe('True');
  });

  test('two constructions inside one enclosing expression stay distinct', () => {
    // An enclosing operator that re-evaluates its operands (`List` here, but
    // the habit is `Add`/`Multiply`'s too) must not collapse two identical
    // pure-looking operands into one shared value.
    const xs = ce
      .box(['List', construction(), construction()] as never)
      .evaluate();
    expect(xs.ops![0] === xs.ops![1]).toBe(false);
  });

  test('a construction is never served from a compiled constant fold', () => {
    // Compilation of an object construction declines outright (the
    // engine⇄compiled boundary for objects is a later phase), which is the
    // fail-closed answer: an erased construction would produce a value with
    // none of an object's identity semantics.
    const compiled = ce._compile(construction()) as unknown as {
      success: boolean;
      error?: string;
    };
    expect(compiled.success).toBe(false);
  });

  test('the Epsil route makes two distinct objects too', () => {
    const engine = new ComputeEngine();
    const { diagnostics, value } = executeEpsil(
      engine,
      [
        'type MutableData = object{id: string, value: string}',
        'let a = MutableData(id: "1", value: "x")',
        'let b = MutableData(id: "1", value: "x")',
        'a == b',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value!.symbol).toBe('False');
  });

  test('two names for ONE object are the same object', () => {
    const engine = new ComputeEngine();
    const { diagnostics, value } = executeEpsil(
      engine,
      [
        'type MutableData = object{id: string, value: string}',
        'let a = MutableData(id: "1", value: "x")',
        'let c = a',
        'a == c',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value!.symbol).toBe('True');
  });
});

describe('OBJECT CONSTRUCTOR — the stored values', () => {
  test('a slot holds the EVALUATED argument', () => {
    ce.declareType('W', 'object{v: number, s: string}');
    const w = ce
      .box(['W', named('v', ['Add', 2, 3]), named('s', { str: 'x' })] as never)
      .evaluate();
    expect(isObject(w)).toBe(true);
    expect((w as any)._slots.get('v').toString()).toBe('5');
    expect((w as any)._slots.get('s').toString()).toBe('"x"');
  });

  test('an exact argument stays exact — evaluated is not numericized', () => {
    ce.declareType('W', 'object{v: number}');
    const w = ce.box(['W', named('v', ['Sqrt', 2])] as never).evaluate();
    expect((w as any)._slots.get('v').toString()).toBe('sqrt(2)');
  });

  test('the fields are stored in DECLARED order', () => {
    ce.declareType('P', 'object{a: integer, b: integer, c: integer}');
    const p = ce
      .box(['P', named('c', 3), named('a', 1), named('b', 2)] as never)
      .evaluate();
    expect([...(p as any)._slots.keys()]).toEqual(['a', 'b', 'c']);
  });

  test('an object-valued field holds the REFERENCE, not a copy', () => {
    const engine = new ComputeEngine();
    const { diagnostics, value } = executeEpsil(
      engine,
      [
        'type Inner = object{n: integer}',
        'type Outer = object{inner: Inner}',
        'let seed = Inner(n: 1)',
        'let o = Outer(inner: seed)',
        'o',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    const inner = (value as any)._slots.get('inner');
    expect(isObject(inner)).toBe(true);
    expect(inner.type.toString()).toBe('Inner');
  });
});

describe("APPENDIX B's OWN EXAMPLES (construction only — no field access yet)", () => {
  test('the `Person` declaration and construction, verbatim', () => {
    const engine = new ComputeEngine();
    const { diagnostics, value } = executeEpsil(
      engine,
      [
        'type Person = object{',
        '  firstName: string,',
        '  lastName: string,',
        '  age: integer,',
        '  role: string',
        '}',
        'const p = Person(firstName: "Alan", lastName: "Turing",',
        '                 age: 42, role: "scientist")',
        'p',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(isObject(value!)).toBe(true);
    expect(value!.type.toString()).toBe('Person');
    expect(value!.toString()).toBe(
      'Person(firstName: "Alan", lastName: "Turing", age: 42, role: "scientist")'
    );
  });

  test('the `MutableData` declaration and construction, verbatim', () => {
    const engine = new ComputeEngine();
    const { diagnostics, value } = executeEpsil(
      engine,
      [
        'type MutableData = object{id: string, value: string}',
        'let d = MutableData(id: "1234", value: "foo")',
        'd',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(isObject(value!)).toBe(true);
    expect(value!.type.toString()).toBe('MutableData');
  });

  test('a record type is NOT constructible this way — records mint nothing', () => {
    // The appendix's `Data` example is a record: `type Data = record{…}` mints
    // no constructor (a shipped rule, D4b), so the call is flagged rather than
    // silently building something.
    expect(
      epsilCodes(
        'type Data = record{id: string, value: string}\nData(id: "1234", value: "foo")'
      )
    ).toContain('type-not-callable');
  });
});
