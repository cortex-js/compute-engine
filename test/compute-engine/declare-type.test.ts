import { ComputeEngine } from '../../src/compute-engine';

//
// `DeclareType` — the engine form behind a Cortex `type` declaration.
//
// `["DeclareType", name, type, attributes?]` registers a type in the current
// lexical scope: nominal by default, a structural alias with an
// `alias -> True` attribute. The name and type operands are held raw
// (canonicalizing them would auto-declare the names as variables). The
// registration happens both at canonicalization time (so later statements in
// the same `Block` see the type) and at evaluation time; the two are
// idempotent.
//
// A type declaration mutates the engine's scope, so every block below uses a
// fresh `ComputeEngine`.
//

const ALIAS = ['Dictionary', ['KeyValuePair', 'alias', 'True']] as any;

/** True when `ce.type(name)` resolves. */
const resolves = (ce: ComputeEngine, name: string): boolean => {
  try {
    ce.type(name);
    return true;
  } catch {
    return false;
  }
};

describe('DeclareType nominal (box route)', () => {
  const ce = new ComputeEngine();

  test('evaluates to Nothing and registers the type', () => {
    const r = ce
      .box(['DeclareType', 'point', { str: 'tuple<x: integer, y: integer>' }])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(ce.type('point').toString()).toBe('point');
  });

  test('is nominal: a structurally identical type does not match', () => {
    expect(
      ce.type('tuple<x: integer, y: integer>').matches(ce.type('point'))
    ).toBe(false);
  });
});

describe('DeclareType alias (box route)', () => {
  const ce = new ComputeEngine();

  test('`alias -> True` declares a structural alias', () => {
    const r = ce
      .box([
        'DeclareType',
        'point',
        { str: 'tuple<x: integer, y: integer>' },
        ALIAS,
      ])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(
      ce.type('tuple<x: integer, y: integer>').matches(ce.type('point'))
    ).toBe(true);
  });
});

describe('DeclareType route parity', () => {
  test('`ce.function()` matches the box route', () => {
    const ce = new ComputeEngine();
    const r = ce
      .function('DeclareType', [
        ce.symbol('point'),
        ce.string('tuple<integer, integer>'),
      ])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(ce.type('point').toString()).toBe('point');
    // Nominal by default on this route too.
    expect(ce.type('tuple<integer, integer>').matches(ce.type('point'))).toBe(
      false
    );
  });

  test('a string name operand works like a symbol name', () => {
    const ce = new ComputeEngine();
    ce.box(['DeclareType', { str: 'point' }, { str: 'tuple<integer, integer>' }, ALIAS])
      .evaluate();
    expect(ce.type('tuple<integer, integer>').matches(ce.type('point'))).toBe(
      true
    );
  });
});

describe('DeclareType with Declare', () => {
  test('a declared type can annotate a `Declare`', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      'point',
      { str: 'tuple<integer, integer>' },
      ALIAS,
    ]).evaluate();
    const r = ce
      .box(['Declare', 'p', { str: 'point' }, ['Tuple', 1, 2]])
      .evaluate();
    expect(r.toString()).toBe('(1, 2)');
    expect(ce.box('p').type.toString()).toBe('point');
  });

  test('regression: a host-declared type resolves on the box route', () => {
    // `Declare`'s evaluate handler used to call `parseType()` without the
    // engine's type resolver, so a user type name always failed to parse.
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<integer, integer>', { alias: true });
    const r = ce
      .box(['Declare', 'p', { str: 'point' }, ['Tuple', 1, 2]])
      .evaluate();
    expect(r.toString()).toBe('(1, 2)');
    expect(ce.box('p').type.toString()).toBe('point');
  });
});

describe('DeclareType redeclaration', () => {
  test('a second statement for the same name replaces the first', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      'r',
      { str: 'tuple<integer, integer>' },
      ALIAS,
    ]).evaluate();
    expect(ce.type('tuple<integer, integer>').matches(ce.type('r'))).toBe(true);

    ce.box([
      'DeclareType',
      'r',
      { str: 'tuple<string, string, string>' },
      ALIAS,
    ]).evaluate();
    expect(ce.type('tuple<integer, integer>').matches(ce.type('r'))).toBe(
      false
    );
    expect(
      ce.type('tuple<string, string, string>').matches(ce.type('r'))
    ).toBe(true);
  });

  test('a host-declared type is not replaced: error value, definition intact', () => {
    const ce = new ComputeEngine();
    ce.declareType('q', 'tuple<integer, integer>', { alias: true });
    const r = ce
      .box(['DeclareType', 'q', { str: 'tuple<string, string>' }, ALIAS])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('invalid-type-declaration');
    // The host definition is untouched.
    expect(ce.type('tuple<integer, integer>').matches(ce.type('q'))).toBe(true);
    expect(ce.type('tuple<string, string>').matches(ce.type('q'))).toBe(false);
  });
});

describe('DeclareType scoping', () => {
  test('a type declared in a Block does not leak out', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        ['DeclareType', 'localpt', { str: 'tuple<integer, integer>' }, ALIAS],
        42,
      ])
      .evaluate();
    expect(r.isSame(42)).toBe(true);
    expect(resolves(ce, 'localpt')).toBe(false);
  });
});

describe('DeclareType recursive body', () => {
  test('a self-referential type registers', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareType',
        'tree',
        {
          str: 'tuple<value: integer, left: type tree | nothing, right: type tree | nothing>',
        },
      ])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(ce.type('tree').toString()).toBe('tree');
  });
});

describe('DeclareType errors', () => {
  test('an invalid type name is an error value and registers nothing', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['DeclareType', { str: 'bad name' }, { str: 'integer' }])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('invalid-type-declaration');
    expect(resolves(ce, 'bad name')).toBe(false);
  });

  test('a malformed type expression is an error value and registers nothing', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['DeclareType', 'oops', { str: 'tuple<<>' }]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('invalid-type-declaration');
    // No dangling placeholder record is left behind.
    expect(resolves(ce, 'oops')).toBe(false);
  });

  test('a failed redeclaration leaves the previous definition intact', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      'r',
      { str: 'tuple<integer, integer>' },
      ALIAS,
    ]).evaluate();
    const r = ce.box(['DeclareType', 'r', { str: 'tuple<<>' }]).evaluate();
    expect(r.operator).toBe('Error');
    expect(ce.type('tuple<integer, integer>').matches(ce.type('r'))).toBe(true);
  });
});
