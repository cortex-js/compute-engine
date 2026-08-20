import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A value whose static type is `unknown` — typically a call to a function the
// engine has no signature for — states nothing about itself, so a declared
// type has nothing to refute and admits it, leaving the verdict to run time.
//
// This is the whole-type mirror of the placeholder rules in
// `effects-inference.ts`: a declared `unknown` slot is refined by the value,
// and an `unknown` VALUE is admitted by the declaration. It also aligns the
// declaration boundary with the argument-position boundary, which already
// admitted (and narrowed on) an `unknown`-typed argument.
//
// `any` is the opposite case throughout: a stated contract, still checked.
//

describe('a declared type admits a value of unknown type', () => {
  const runs = (source: string) => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, source);
    return {
      value: r.value.toString(),
      codes: r.diagnostics.map((d) => d.code),
      typeOf: (name: string) => ce.box(name).type.toString(),
    };
  };

  test('assignment of an untypeable call, split spelling', () => {
    const r = runs('let xs: list\nxs = f(0)');
    expect(r.codes).toEqual([]);
    // The declared contract is what the symbol reports: the value brought no
    // element evidence, so the placeholder slot stays open (`list` is
    // `list<unknown>`).
    expect(r.typeOf('xs')).toBe('list');
  });

  test('assignment of an untypeable call, declare-with-initializer', () => {
    const r = runs('let xs: list = f(0)');
    expect(r.codes).toEqual([]);
    expect(r.typeOf('xs')).toBe('list');
  });

  test('the rule is not collection-specific', () => {
    for (const t of ['number', 'string', 'boolean', 'list<number>']) {
      const r = runs(`let v: ${t}\nv = f(0)`);
      expect(r.codes).toEqual([]);
      expect(r.typeOf('v')).toBe(t);
    }
  });

  test('a value the engine CAN type is still held to the contract', () => {
    const r = runs('let xs: list\nxs = 42');
    expect(r.value).toContain('ErrorCode("incompatible-type", "list"');
  });

  test('an admitted unknown value does not harden the placeholder slot', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let xs: list\nxs = f(0)');
    expect(ce.box('xs').type.toString()).toBe('list');
    // A later assignment still refines the element slot from real evidence.
    executeEpsil(ce, 'xs = [1, 2, 3]');
    expect(ce.box('xs').type.toString()).toBe('list<finite_integer>');
  });

  test('a call with a known return type refines as usual', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f: (number) -> list<number>\nlet xs: list\nxs = f(0)');
    expect(ce.box('xs').type.toString()).toBe('list<number>');
  });

  test('host route: ce.assign matches the Epsil route', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list');
    expect(() => ce.assign('xs', ce.box(['f', 0]))).not.toThrow();
    expect(() => ce.assign('xs', ce.box(42))).toThrow();
  });

  test('a bare UNDECLARED symbol is an unknown value too', () => {
    // The held operand of an `Assign` is a symbol nothing has typed, so the
    // same rule applies — and a symbol that DOES carry a type is still
    // checked against the contract.
    const ce = new ComputeEngine();
    ce.declare('c', 'character');
    expect(ce.box(['Assign', 'c', 'untyped']).evaluate().operator).not.toBe(
      'Error'
    );
    ce.declare('s', 'string');
    ce.assign('s', ce.string('a'));
    expect(ce.box(['Assign', 'c', 's']).evaluate().operator).toBe('Error');
  });

  test('a `const` initializer is admitted, and gets no later re-check', () => {
    // A `const` has no second assignment, so an admitted `unknown` initializer
    // is trusted for the name's whole lifetime. That follows from the rule
    // rather than being a separate decision, but it is the widest case, so it
    // is pinned explicitly.
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'const c: list = f(0)\nc');
    expect(r.diagnostics.map((d) => d.code)).toEqual([]);
    expect(ce.box('c').type.toString()).toBe('list');
  });
});

describe('a declared FUNCTION SIGNATURE still refuses an unknown value', () => {
  // Admitting an unchecked value at a signature slot would give up arity, the
  // effects contract and polymorphic instantiation in one step, and install a
  // definition that is CALLABLE under a contract nothing proved. These
  // declarations are held to the same verdict they gave before the
  // unknown-value rule existed.

  const declareWithValue = (ce: ComputeEngine, type: string) =>
    ce.declare('g', { type, value: ce.box(['h', 0]) } as any);

  test.each([
    ['(number) pure -> number'],
    ['(number) -> number'],
    ['(T) -> T where T'],
  ])('%s refuses an unknown-typed value', (type) => {
    const ce = new ComputeEngine();
    expect(() => declareWithValue(ce, type)).toThrow(/incompatible-type|not compatible/);
  });

  test('a non-signature declared type on the same route is admitted', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare('v', { type: 'list', value: ce.box(['h', 0]) } as any)
    ).not.toThrow();
  });
});
