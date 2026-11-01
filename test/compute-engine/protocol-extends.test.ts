/**
 * PROTOCOL EXTENSION — `protocol A extends B, C { … }`.
 *
 * A protocol may extend other protocols: it has every requirement of its
 * parents plus its own, and a type that conforms to it conforms to each of
 * its ancestors. The engine keeps that invariant with ordinary conformance
 * edges: a conformance registers one edge on every protocol of the closure
 * of the protocol it names that the target does not already conform to, so
 * `conformsTo`, dispatch and the `where T is P` oracle read flat edge lists.
 *
 * The protocols of this file are declared through the host API
 * (`ce.declareProtocol(name, members, { extends })`) or the MathJSON box
 * route (`["DeclareProtocol", name, members, ["List", parent, …]]`).
 * Conformances use Epsil statements (`executeEpsil`, one batch per call, the
 * notebook model) or the host API. The Epsil spelling `protocol A extends B`
 * is tested in `test/epsil/protocol-extends.test.ts`.
 *
 * The main fixture is the hierarchy of issue #491: `FloorRing` extends
 * `LinearOrder` (a marker), `Ring` and `FloorOrder`, and the three extend
 * `PartialOrder`.
 *
 * Source: `docs/plans/2026-10-31-protocol-refinement.md`, rules R1–R10.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { protocolClosure } from '../../src/compute-engine/engine-protocols';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../src/compute-engine/types-expression';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

// ── Harness ──────────────────────────────────────────────────────────────────

const SELF2 = '(self: Self, other: Self)';

/** Declare a protocol with FUNCTION members through the box route, and return
 * the value of the statement (`Nothing`, or an error value). */
function boxProtocol(
  name: string,
  members: Record<string, string>,
  parents?: string[],
  engine = ce
): Expression {
  const dict = [
    'Dictionary',
    ...Object.entries(members).map(([m, sig]) => [
      'KeyValuePair',
      { str: m },
      ['Pair', { str: 'function' }, { str: sig }],
    ]),
  ];
  const json =
    parents === undefined
      ? ['DeclareProtocol', { str: name }, dict]
      : ['DeclareProtocol', { str: name }, dict, ['List', ...parents]];
  return engine.box(json as never).evaluate();
}

/** The error code of a box-route statement value, or `null` on success. */
function errorCode(value: Expression): string | null {
  const json = value.json;
  if (!Array.isArray(json) || json[0] !== 'Error') return null;
  const code = json[1];
  const raw =
    Array.isArray(code) && code[0] === 'ErrorCode'
      ? ((code[1] as { str?: string })?.str ?? code[1])
      : ((code as { str?: string })?.str ?? code);
  // A string operand serializes with its quotes.
  return String(raw).replace(/^'(.*)'$/, '$1');
}

/** Run an Epsil batch and return its final value as a string. */
function run(source: string, engine = ce): string {
  return String(executeEpsil(engine, source).value);
}

/** The error codes of a batch's diagnostics, in order. A runtime error value
 * rides as `["runtime-error", message, frames, code]`, so the code is the
 * last element there and the first otherwise. */
function codes(source: string, engine = ce): string[] {
  return executeEpsil(engine, source).diagnostics.map((d) => {
    const parts = Array.isArray(d.message) ? d.message : [d.message];
    return parts[0] === 'runtime-error'
      ? String(parts[parts.length - 1])
      : String(parts[0]);
  });
}

/** Every diagnostic of a batch, flattened to text, for message checks. */
function messages(source: string, engine = ce): string[] {
  return executeEpsil(engine, source).diagnostics.map((d) =>
    (Array.isArray(d.message) ? d.message : [d.message]).map(String).join(' | ')
  );
}

/** One line per edge of `protocol`: target key, pending flag, `_via`, and
 * whether the edge carries an authored block. */
function edges(protocol: string, engine = ce): string[] {
  const record = engine._protocolRegistry[protocol];
  if (record === undefined) return [];
  return record.conformances.map(
    (c) =>
      `${c.targetKey}${c.pending ? ' pending' : ''}${c._via ? ` via ${c._via}` : ''}${c._authored ? ' authored' : ''}`
  );
}

/** The reporter's hierarchy, through the box route. */
function declareHierarchy(engine = ce): void {
  boxProtocol('PartialOrder', { compare: `${SELF2} -> integer` }, undefined, engine);
  boxProtocol('LinearOrder', {}, ['PartialOrder'], engine);
  boxProtocol(
    'Ring',
    { add: `${SELF2} -> Self`, mul: `${SELF2} -> Self` },
    ['PartialOrder'],
    engine
  );
  boxProtocol('FloorOrder', { floor: '(self: Self) -> integer' }, ['PartialOrder'], engine);
  boxProtocol('FloorRing', {}, ['LinearOrder', 'Ring', 'FloorOrder'], engine);
}

const MONEY = 'type Money = tuple<cents: integer>';
const COMPARE =
  'function compare(self: Money, other: Money) -> integer { self.cents - other.cents }';
const ADD =
  'function add(self: Money, other: Money) -> Money { Money(self.cents + other.cents) }';
const MUL =
  'function mul(self: Money, other: Money) -> Money { Money(self.cents * other.cents) }';
const FLOOR = 'function floor(self: Money) -> integer { self.cents }';

/** `type Money is FloorRing { … }` with the given members. */
const floorRingBlock = (...members: string[]) =>
  `type Money is FloorRing {\n  ${members.join('\n  ')}\n}`;

// ── R1, R2: spelling, validation, closure order ──────────────────────────────

describe('declaring a protocol that extends others', () => {
  test('the box route stores the parent list, the closure is in post-order', () => {
    declareHierarchy();
    expect(ce._protocolRegistry['FloorRing']!.extends).toEqual([
      'LinearOrder',
      'Ring',
      'FloorOrder',
    ]);
    expect(ce._protocolRegistry['PartialOrder']!.extends).toEqual([]);
    expect(protocolClosure(ce, 'FloorRing')).toEqual([
      'PartialOrder',
      'LinearOrder',
      'Ring',
      'FloorOrder',
      'FloorRing',
    ]);
  });

  test('the host API takes an `extends` option', () => {
    ce.declareProtocol('PartialOrder', {
      functions: { compare: `${SELF2} -> integer` },
    });
    ce.declareProtocol('LinearOrder', {}, { extends: ['PartialOrder'] });
    expect(protocolClosure(ce, 'LinearOrder')).toEqual([
      'PartialOrder',
      'LinearOrder',
    ]);
  });

  test('a diamond is harmless: a parent may already extend another parent', () => {
    declareHierarchy();
    expect(
      errorCode(boxProtocol('Both', {}, ['LinearOrder', 'PartialOrder']))
    ).toBeNull();
    expect(protocolClosure(ce, 'Both')).toEqual([
      'PartialOrder',
      'LinearOrder',
      'Both',
    ]);
  });

  test('R1: a malformed host option, a repeated parent, a type as a parent', () => {
    ce.declareProtocol('P', {});
    expect(() =>
      ce.declareProtocol('Q', {}, { extends: 'P' as never })
    ).toThrow(/^invalid-protocol-declaration: .*must be an array/);
    expect(() =>
      ce.declareProtocol('Q', {}, { extends: [1] as never })
    ).toThrow(/^invalid-protocol-declaration/);
    expect(() =>
      ce.declareProtocol('Q', {}, { extends: ['P', 'P'] })
    ).toThrow('invalid-protocol-declaration: `P` is listed twice');
    expect(() => ce.declareProtocol('Q', {}, { extends: ['integer'] })).toThrow(
      'protocol-unknown: `integer` is a type, not a protocol'
    );
    // Nothing was registered by the refused declarations.
    expect(ce._protocolRegistry['Q']).toBeUndefined();
  });

  test('R1 on the box route: the same codes, as error values', () => {
    boxProtocol('P', {});
    expect(errorCode(boxProtocol('Q', {}, ['P', 'P']))).toBe(
      'invalid-protocol-declaration'
    );
    expect(errorCode(boxProtocol('Q', {}, ['integer']))).toBe(
      'protocol-unknown'
    );
    expect(
      errorCode(
        ce.box([
          'DeclareProtocol',
          { str: 'Q' },
          ['Dictionary'],
          { str: 'P' },
        ] as never).evaluate()
      )
    ).toBe('invalid-protocol-declaration');
  });

  test('R2: a parent must already be declared', () => {
    expect(() => ce.declareProtocol('Q', {}, { extends: ['Later'] })).toThrow(
      /^protocol-unknown: the protocol `Later` is unknown/
    );
    expect(errorCode(boxProtocol('Q', {}, ['Later']))).toBe('protocol-unknown');
    expect(errorCode(boxProtocol('Q', {}, ['Q']))).toBe('protocol-unknown');
  });

  test('R2: a replacement that forms a cycle is refused, the record unchanged', () => {
    boxProtocol('P', {});
    boxProtocol('Q', {}, ['P']);
    // A later statement replaces `P`; making it extend `Q` would be a cycle.
    const value = boxProtocol('P', {}, ['Q']);
    expect(errorCode(value)).toBe('protocol-extends-cycle');
    expect(value.toString()).toContain('which already extends `P`');
    expect(ce._protocolRegistry['P']!.extends).toEqual([]);
    expect(errorCode(boxProtocol('P', {}, ['P']))).toBe(
      'protocol-extends-cycle'
    );
  });

  test('R3: a protocol may not declare a member of an ancestor', () => {
    declareHierarchy();
    const value = boxProtocol(
      'LinearOrder2',
      { compare: `${SELF2} -> integer` },
      ['PartialOrder']
    );
    expect(errorCode(value)).toBe('protocol-member-inherited');
    expect(value.toString()).toContain(
      '`compare` is already a member of `PartialOrder`, which `LinearOrder2` extends'
    );
  });

  test('R3: two parents whose closures declare one member name', () => {
    boxProtocol('A', { m: '(self: Self) -> integer' });
    boxProtocol('B', { m: '(self: Self) -> integer' });
    const value = boxProtocol('C', {}, ['A', 'B']);
    expect(errorCode(value)).toBe('protocol-extends-member-conflict');
    expect(value.toString()).toContain('`m` is declared by both `A` and `B`');
    expect(() => ce.declareProtocol('D', {}, { extends: ['A', 'B'] })).toThrow(
      /^protocol-extends-member-conflict/
    );
    // Two UNRELATED protocols may still share a member name.
    expect(errorCode(boxProtocol('E', { m: '(self: Self) -> integer' }))).toBeNull();
  });
});

// ── R4, R5: the expansion of a conformance ───────────────────────────────────

describe('a conformance to an extending protocol', () => {
  beforeEach(() => declareHierarchy());

  test('one block registers an edge on every protocol of the closure', () => {
    expect(codes(`${MONEY}\n${floorRingBlock(COMPARE, ADD, MUL, FLOOR)}`)).toEqual(
      []
    );
    expect(edges('PartialOrder')).toEqual(['Money via FloorRing authored']);
    // `LinearOrder` is a marker: its part is empty, its block-less edge is
    // settled at once by the marker rule.
    expect(edges('LinearOrder')).toEqual(['Money via FloorRing']);
    expect(edges('Ring')).toEqual(['Money via FloorRing authored']);
    expect(edges('FloorOrder')).toEqual(['Money via FloorRing authored']);
    expect(edges('FloorRing')).toEqual(['Money authored']);
    for (const p of ['PartialOrder', 'LinearOrder', 'Ring', 'FloorOrder', 'FloorRing'])
      expect(ce.conformsTo('Money', p)).toBe(true);
    // Dispatch reaches each member through the edge of the protocol that
    // declares it.
    expect(run('compare(Money(3), Money(5))')).toBe('-2');
    expect(run('floor(add(Money(3), Money(5)))')).toBe('8');
  });

  test('R5: a missing ancestor member refuses the whole statement', () => {
    run(MONEY);
    // A final statement's error stays a value, so a statement follows it.
    const out = messages(`${floorRingBlock(ADD, MUL, FLOOR)}\n1`);
    expect(out.join('\n')).toContain('protocol-implementation-missing');
    expect(out.join('\n')).toContain(
      'the `PartialOrder` protocol, which `FloorRing` extends, expects a definition of `compare`'
    );
    for (const p of ['PartialOrder', 'LinearOrder', 'Ring', 'FloorOrder', 'FloorRing'])
      expect(edges(p)).toEqual([]);
  });

  test('a member no protocol of the closure declares, with a suggestion', () => {
    run(MONEY);
    const out = messages(
      floorRingBlock(
        COMPARE,
        ADD,
        MUL,
        'function flor(self: Money) -> integer { self.cents }'
      ) + '\n1'
    ).join('\n');
    expect(out).toContain('protocol-member-unknown');
    expect(out).toContain(
      'is not a member of the `FloorRing` protocol or of the protocols it extends. Did you mean `floor`?'
    );
  });

  test('a block-less conformance registers the closure, pending per protocol', () => {
    run(MONEY);
    const pending = executeEpsil(ce, 'type Money is FloorRing').diagnostics
      .filter((d) => (d.message as unknown[])[0] === 'protocol-implementation-pending')
      .map((d) => (d.message as unknown[])[2]);
    // One warning per protocol that has requirements; the markers are never
    // pending. No `_via` stamp on a block-less conformance.
    expect(pending.sort()).toEqual(['FloorOrder', 'PartialOrder', 'Ring']);
    expect(edges('LinearOrder')).toEqual(['Money']);
    expect(edges('PartialOrder')).toEqual(['Money pending']);
    // A later batch implements the ancestors one by one.
    expect(codes(`type Money is PartialOrder { ${COMPARE} }`)).toEqual([
      'protocol-implementation-pending',
      'protocol-implementation-pending',
    ]);
  });

  test('R4(b): an ancestor already conformed to is not registered again', () => {
    run(`${MONEY}\ntype Money is PartialOrder { ${COMPARE} }`);
    expect(codes(floorRingBlock(ADD, MUL, FLOOR))).toEqual([]);
    expect(edges('PartialOrder')).toEqual(['Money authored']);
    expect(run('compare(Money(1), Money(4))')).toBe('-3');
  });

  test('R4(b): an ancestor conformed to through a supertype', () => {
    run(
      'protocol Named { function label(self: Self) -> string }\n' +
        'type number is Named { function label(self: number) -> string { "n" } }'
    );
    boxProtocol('Tagged', {}, ['Named']);
    expect(codes('type integer is Tagged')).toEqual([]);
    expect(edges('Named')).toEqual(['number authored']);
    expect(edges('Tagged')).toEqual(['integer']);
    expect(ce.conformsTo('integer', 'Named')).toBe(true);
  });

  test('R4(b): a non-empty part specializes a supertype implementation', () => {
    run(
      'protocol Named { function label(self: Self) -> string }\n' +
        'type number is Named { function label(self: number) -> string { "n" } }'
    );
    boxProtocol('Tagged', {}, ['Named']);
    expect(
      codes(
        'type integer is Tagged { function label(self: integer) -> string { "i" } }'
      )
    ).toEqual([]);
    expect(edges('Named')).toEqual([
      'number authored',
      'integer via Tagged authored',
    ]);
    expect(run('label(3)')).toBe('"i"');
    expect(run('label(3.5)')).toBe('"n"');
  });

  test('R4(c): a block-less derived edge is filled later in the same batch', () => {
    // The block-less statement derives a pending `PartialOrder` edge with no
    // batch stamp, so the implementation that follows is not a duplicate.
    expect(
      codes(
        `${MONEY}\ntype Money is LinearOrder\ntype Money is PartialOrder { ${COMPARE} }`
      )
    ).toEqual([]);
    expect(edges('PartialOrder')).toEqual(['Money authored']);
  });

  test('R5 state 4: a forward-declared ancestor stays pending, not refused', () => {
    run(`${MONEY}\ntype Money is PartialOrder`);
    // The `FloorRing` block does not implement `compare`, and the author
    // declared that conformance ahead of its implementation: it stays pending.
    const out = codes(floorRingBlock(ADD, MUL, FLOOR));
    expect(out).toEqual(['protocol-implementation-pending']);
    expect(edges('PartialOrder')).toEqual(['Money pending']);
    expect(edges('FloorRing')).toEqual(['Money authored']);
  });

  test('R5 state 3: a field-backed property settles a derived edge', () => {
    ce.declareProtocol('HasId', { readonly: { id: 'integer' } });
    ce.declareProtocol('Entity', {}, { extends: ['HasId'] });
    expect(
      codes('type User = object{id: integer}\ntype User is Entity { }')
    ).toEqual([]);
    expect(edges('HasId')).toEqual(['User via Entity']);
    expect(run('let u = User(id: 7)\nu.id')).toBe('7');
  });

  test('an object-only ancestor refuses a value-type conformer', () => {
    ce.declareProtocol('Named', { readwrite: { name: 'string' } });
    boxProtocol('Person', {}, ['Named']);
    expect(codes(`${MONEY}\ntype Money is Person\n1`)).toEqual([
      'protocol-requires-object',
    ]);
    expect(edges('Person')).toEqual([]);
    expect(edges('Named')).toEqual([]);
  });

  test('R10: a qualified name names only a member the protocol declares', () => {
    run(`${MONEY}\n${floorRingBlock(COMPARE, ADD, MUL, FLOOR)}`);
    const out = messages('FloorRing.compare(Money(1), Money(2))\n1').join('\n');
    expect(out).toContain('protocol-member-unknown');
    expect(out).toContain(
      '`compare` is a member of `PartialOrder`, which `FloorRing` extends; write `PartialOrder.compare`'
    );
    expect(run('PartialOrder.compare(Money(1), Money(2))')).toBe('-1');
  });
});

// ── R4(b) with conditional conformances ──────────────────────────────────────

describe('coverage by a conditional conformance', () => {
  beforeEach(() => declareHierarchy());

  const LIST_PARTIAL_ORDER =
    'type list<T> is PartialOrder where T is PartialOrder {\n' +
    '  function compare(self: Self, other: Self) -> integer { 0 }\n}';

  test('a ground target whose arguments satisfy an existing clause', () => {
    run(
      `type integer is PartialOrder { function compare(self: integer, other: integer) -> integer { self - other } }\n${LIST_PARTIAL_ORDER}`
    );
    // Without the coverage test, a `list<integer>` edge on `PartialOrder`
    // would collide with the conditional edge on the same head.
    expect(codes('type list<integer> is LinearOrder')).toEqual([]);
    expect(edges('PartialOrder')).toEqual([
      'integer authored',
      'list<T> where T is PartialOrder authored',
    ]);
    expect(edges('LinearOrder')).toEqual(['list<integer>']);
  });

  test('a conditional target covered by an unconditional `list<any>` edge', () => {
    run(
      'type list<any> is PartialOrder {\n  function compare(self: Self, other: Self) -> integer { 0 }\n}'
    );
    expect(
      codes(
        'type list<T> is FloorRing where T is FloorRing {\n' +
          '  function add(self: Self, other: Self) -> Self { self }\n' +
          '  function mul(self: Self, other: Self) -> Self { self }\n' +
          '  function floor(self: Self) -> integer { 0 }\n}'
      )
    ).toEqual([]);
    expect(edges('PartialOrder')).toEqual(['list<any> authored']);
    expect(edges('Ring')).toEqual([
      'list<T> where T is FloorRing via FloorRing authored',
    ]);
  });
});

// ── R7: conditional conformance to an extending protocol ─────────────────────

describe('conditional conformance and clause implication', () => {
  beforeEach(() => declareHierarchy());

  const LIST_PARTIAL_ORDER =
    'type list<T> is PartialOrder where T is PartialOrder {\n' +
    '  function compare(self: Self, other: Self) -> integer { 0 }\n}';

  test('an implied clause covers the ancestor: no second edge on the head', () => {
    run(LIST_PARTIAL_ORDER);
    // `T is LinearOrder` implies `T is PartialOrder`.
    expect(codes('type list<T> is LinearOrder where T is LinearOrder')).toEqual(
      []
    );
    expect(edges('PartialOrder')).toEqual([
      'list<T> where T is PartialOrder authored',
    ]);
    // The same up to a renaming of the variable.
    expect(codes('type list<U> is Ring where U is Ring')).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(edges('PartialOrder')).toHaveLength(1);
  });

  test('a clause that does not imply the existing one: one per head', () => {
    run(
      'type list<T> is PartialOrder where T is Ring {\n' +
        '  function compare(self: Self, other: Self) -> integer { 0 }\n}\n1'
    );
    // `T is LinearOrder` does not imply `T is Ring`.
    const out = codes('type list<T> is LinearOrder where T is LinearOrder\n1');
    expect(out).toEqual(['protocol-conformance-overlap']);
    expect(edges('LinearOrder')).toEqual([]);
  });

  test('heads that differ in structure are decided by the one-per-head rule', () => {
    run(LIST_PARTIAL_ORDER);
    expect(
      codes('type list<list<U>> is LinearOrder where U is LinearOrder\n1')
    ).toEqual(['protocol-conformance-overlap']);
  });

  test('a non-empty part under an implied clause cannot replace the implementation', () => {
    run(LIST_PARTIAL_ORDER);
    const out = messages(
      'type list<T> is FloorRing where T is FloorRing {\n' +
        '  function compare(self: Self, other: Self) -> integer { 1 }\n' +
        '  function add(self: Self, other: Self) -> Self { self }\n' +
        '  function mul(self: Self, other: Self) -> Self { self }\n' +
        '  function floor(self: Self) -> integer { 0 }\n}\n1'
    ).join('\n');
    expect(out).toContain('protocol-conformance-overlap');
    expect(out).toContain(
      '`list<T> where T is PartialOrder` already conforms to `PartialOrder`; its implementation of `compare` cannot be replaced from a conformance to `FloorRing` under the narrower clause `T is FloorRing`'
    );
  });

  test('the wider conformance first, then the narrower one', () => {
    run(LIST_PARTIAL_ORDER);
    expect(
      codes(
        'type list<T> is FloorRing where T is FloorRing {\n' +
          '  function add(self: Self, other: Self) -> Self { self }\n' +
          '  function mul(self: Self, other: Self) -> Self { self }\n' +
          '  function floor(self: Self) -> integer { 0 }\n}'
      )
    ).toEqual([]);
    expect(edges('PartialOrder')).toEqual([
      'list<T> where T is PartialOrder authored',
    ]);
  });

  test('the narrower conformance first: a block-less derived edge is replaced', () => {
    boxProtocol('Mark', {});
    boxProtocol('Sub', { m: '(self: Self) -> integer' }, ['Mark']);
    run(
      'type list<T> is Sub where T is Sub { function m(self: Self) -> integer { 1 } }'
    );
    expect(edges('Mark')).toEqual(['list<T> where T is Sub via Sub']);
    // The wider clause admits every argument the narrower one did.
    expect(codes('type list<T> is Mark where T is Mark { }')).toEqual([]);
    expect(edges('Mark')).toEqual(['list<T> where T is Mark authored']);
  });

  test('the narrower conformance first, without a block: the derived edge is replaced', () => {
    // A block-less conformance does not stamp `_via`: the replacement reads
    // the `_derived` flag of the edge it registered for `PartialOrder`.
    run('type list<T> is FloorRing where T is FloorRing');
    expect(edges('PartialOrder')).toEqual([
      'list<T> where T is FloorRing pending',
    ]);
    // Not refused as an overlap. The block-less `Ring` and `FloorOrder` edges
    // of the first statement are still pending and are reported again.
    expect(codes(LIST_PARTIAL_ORDER)).not.toContain(
      'protocol-conformance-overlap'
    );
    expect(edges('PartialOrder')).toEqual([
      'list<T> where T is PartialOrder authored',
    ]);
    run(
      'type X = tuple<v: integer>\n' +
        'type X is PartialOrder {\n' +
        '  function compare(self: X, other: X) -> integer { 0 }\n}'
    );
    expect(ce.conformsTo('X', 'PartialOrder')).toBe(true);
    expect(ce.conformsTo('X', 'FloorRing')).toBe(false);
    expect(ce.conformsTo('list<X>', 'PartialOrder')).toBe(true);
  });

  test('the narrower conformance first, with an implementation: refused', () => {
    run(
      'type list<T> is FloorRing where T is FloorRing {\n' +
        '  function compare(self: Self, other: Self) -> integer { 1 }\n' +
        '  function add(self: Self, other: Self) -> Self { self }\n' +
        '  function mul(self: Self, other: Self) -> Self { self }\n' +
        '  function floor(self: Self) -> integer { 0 }\n}'
    );
    const out = messages(`${LIST_PARTIAL_ORDER}\n1`).join('\n');
    expect(out).toContain('protocol-conformance-overlap');
    expect(out).toContain(
      'must be declared before the conformance to `FloorRing`'
    );
  });

  test('a derived edge that a written block fills is hand-written: one per head', () => {
    run('type list<T> is FloorRing where T is FloorRing');
    // The author now writes the `PartialOrder` edge: it is no longer derived.
    const all = messages(
      'type list<T> is PartialOrder where T is FloorRing {\n' +
        '  function compare(self: Self, other: Self) -> integer { 0 }\n}\n1'
    );
    const out = messages(`${LIST_PARTIAL_ORDER}\n1`);
    all.push(...out);
    expect(out.join('\n')).toContain('protocol-conformance-overlap');
    expect(out.join('\n')).toContain('v1 allows at most one conformance per head');
    for (const m of all) expect(m).not.toContain('undefined');
    expect(edges('PartialOrder')).toEqual([
      'list<T> where T is FloorRing authored',
    ]);
  });

  test('a derived edge that a block-less statement restates is hand-written: one per head', () => {
    run('type list<T> is FloorRing where T is FloorRing');
    const all = messages('type list<T> is PartialOrder where T is FloorRing\n1');
    const out = messages(`${LIST_PARTIAL_ORDER}\n1`);
    all.push(...out);
    expect(out.join('\n')).toContain('protocol-conformance-overlap');
    expect(out.join('\n')).toContain('v1 allows at most one conformance per head');
    for (const m of all) expect(m).not.toContain('undefined');
    expect(edges('PartialOrder')).toEqual([
      'list<T> where T is FloorRing pending',
    ]);
  });
});

// ── R4(e): re-running an edited cell ─────────────────────────────────────────

describe('a later batch re-runs a conformance with a block', () => {
  beforeEach(() => {
    declareHierarchy();
    run(`${MONEY}\n${floorRingBlock(COMPARE, ADD, MUL, FLOOR)}`);
  });

  test('an edited cell that drops an inherited member is refused', () => {
    const out = messages(`${floorRingBlock(ADD, MUL, FLOOR)}\n1`).join('\n');
    expect(out).toContain('protocol-implementation-missing');
    expect(out).toContain(
      'the `PartialOrder` protocol, which `FloorRing` extends, expects a definition of `compare`'
    );
    // Nothing changed: `compare` still dispatches.
    expect(run('compare(Money(2), Money(1))')).toBe('1');
  });

  test('an unchanged cell re-runs without a diagnostic', () => {
    expect(codes(floorRingBlock(COMPARE, ADD, MUL, FLOOR))).toEqual([]);
    expect(edges('PartialOrder')).toEqual(['Money via FloorRing authored']);
  });

  test('a block-less re-declaration changes nothing', () => {
    expect(codes('type Money is FloorRing')).toEqual([]);
    expect(edges('PartialOrder')).toEqual(['Money via FloorRing authored']);
    expect(edges('LinearOrder')).toEqual(['Money via FloorRing']);
  });

  test('moving a member into its own statement clears the stamp', () => {
    // The statement of the edge's own protocol comes first: it replaces the
    // implementation and deletes `_via`, and the `FloorRing` statement then
    // reads the edge as an existing conformance.
    expect(
      codes(
        `type Money is PartialOrder { function compare(self: Money, other: Money) -> integer { 10 } }\n${floorRingBlock(ADD, MUL, FLOOR)}`
      )
    ).toEqual([]);
    expect(edges('PartialOrder')).toEqual(['Money authored']);
    expect(run('compare(Money(2), Money(1))')).toBe('10');
  });

  test('an edge stamped by another statement protocol is coverage', () => {
    const engine = new ComputeEngine();
    declareHierarchy(engine);
    run(
      `${MONEY}\ntype Money is Ring {\n  ${COMPARE}\n  ${ADD}\n  ${MUL}\n}`,
      engine
    );
    expect(edges('PartialOrder', engine)).toEqual(['Money via Ring authored']);
    // The `FloorRing` block does not implement `compare`; the edge stamped
    // `Ring` is not its own to replace.
    expect(codes(floorRingBlock(ADD, MUL, FLOOR), engine)).toEqual([]);
    expect(edges('PartialOrder', engine)).toEqual(['Money via Ring authored']);
    expect(edges('Ring', engine)).toEqual(['Money via FloorRing authored']);
  });

  test('two blocks for the same ancestor in one batch are a duplicate', () => {
    const engine = new ComputeEngine();
    declareHierarchy(engine);
    expect(
      codes(
        `${MONEY}\ntype Money is PartialOrder { ${COMPARE} }\n${floorRingBlock(COMPARE, ADD, MUL, FLOOR)}\n1`,
        engine
      )
      // The static pre-pass sees the collision too (`static-type-error`).
    ).toContain('protocol-implementation-duplicate');
  });
});

// ── R6: the host route ───────────────────────────────────────────────────────

describe('the host route', () => {
  beforeEach(() => {
    declareHierarchy();
    run(MONEY);
  });

  const host = () => 0;

  test("the reporter's ancestor-first calls keep working", () => {
    ce.declareProtocolImplementation('Money', 'PartialOrder', {
      functions: { compare: host },
    });
    ce.declareProtocolImplementation('Money', 'LinearOrder', {});
    ce.declareProtocolImplementation('Money', 'Ring', {
      functions: { add: host, mul: host },
    });
    ce.declareProtocolImplementation('Money', 'FloorOrder', {
      functions: { floor: host },
    });
    ce.declareProtocolImplementation('Money', 'FloorRing', {});
    for (const p of ['PartialOrder', 'LinearOrder', 'Ring', 'FloorOrder', 'FloorRing'])
      expect(edges(p)).toEqual(['Money authored']);
  });

  test('one call implements the whole closure', () => {
    ce.declareProtocolImplementation('Money', 'FloorRing', {
      functions: { compare: host, add: host, mul: host, floor: host },
    });
    expect(edges('PartialOrder')).toEqual(['Money via FloorRing authored']);
    expect(edges('LinearOrder')).toEqual(['Money via FloorRing']);
    expect(ce.conformsTo('Money', 'PartialOrder')).toBe(true);
  });

  test('an ancestor already implemented by the host is a duplicate', () => {
    ce.declareProtocolImplementation('Money', 'PartialOrder', {
      functions: { compare: host },
    });
    expect(() =>
      ce.declareProtocolImplementation('Money', 'FloorRing', {
        functions: { compare: host, add: host, mul: host, floor: host },
      })
    ).toThrow(
      'protocol-implementation-duplicate: the type `Money` already has an implementation of the `PartialOrder` protocol'
    );
    expect(edges('FloorRing')).toEqual([]);
  });

  test('a missing ancestor member throws, and registers nothing', () => {
    expect(() =>
      ce.declareProtocolImplementation('Money', 'FloorRing', {
        functions: { add: host, mul: host, floor: host },
      })
    ).toThrow(
      'protocol-implementation-missing: the `PartialOrder` protocol, which `FloorRing` extends, expects a definition of `compare`'
    );
    expect(edges('Ring')).toEqual([]);
  });
});

// ── R8: sum types ────────────────────────────────────────────────────────────

describe('a sum type conforms to an extending protocol', () => {
  const SHAPE = 'type shape = circle(r: number) | square(s: number)';
  const SHAPE3 =
    'type shape = circle(r: number) | square(s: number) | triangle(b: number)';
  const BLOCK = `type shape is Area {
  function area(self: Self) -> number { 1 }
  function sides(self: Self) -> integer { 0 }
}`;

  test('a grown sum restated in the same batch is not a duplicate', () => {
    boxProtocol('Figure', { sides: '(self: Self) -> integer' });
    boxProtocol('Area', { area: '(self: Self) -> number' }, ['Figure']);
    expect(codes(`${SHAPE}\n${BLOCK}`)).toEqual([]);
    expect(edges('Figure')).toEqual([
      'circle via Area authored',
      'square via Area authored',
    ]);
    expect(codes(`${SHAPE3}\n${BLOCK}`)).toEqual([]);
    expect(edges('Figure')).toEqual([
      'circle via Area authored',
      'square via Area authored',
      'triangle via Area authored',
    ]);
    expect(run('sides(triangle(2))')).toBe('0');
  });

  test('a variant gained after a replacement added an ancestor', () => {
    run(`protocol Area { function area(self: Self) -> number }\n${SHAPE}\n${BLOCK.replace(/\n  function sides[^\n]*/, '')}`);
    boxProtocol('Figure', {});
    // The replacement of `Area` gives each variant a `Figure` edge.
    expect(errorCode(boxProtocol('Area', { area: '(self: Self) -> number' }, ['Figure']))).toBeNull();
    expect(edges('Figure')).toEqual(['circle via Area', 'square via Area']);
    // The variant the sum gains later gets it too: the remembered block is
    // re-applied through the closure as it stands now.
    expect(codes(SHAPE3)).toEqual([]);
    expect(edges('Figure')).toEqual([
      'circle via Area',
      'square via Area',
      'triangle via Area',
    ]);
  });
});

// ── R9: a replacement that adds a parent ─────────────────────────────────────

describe('a protocol replacement adds a parent', () => {
  const M = { m: '(self: Self) -> integer' };

  beforeEach(() => {
    boxProtocol('P', M);
    boxProtocol('Q', {});
  });

  test('every conformer of the replaced protocol conforms to the new parent', () => {
    run(
      `${MONEY}\ntype Money is Q\n` +
        'type number is P { function m(self: number) -> integer { 1 } }\n' +
        'type integer is Q\n' +
        'type list<T> is Q where T is Q'
    );
    expect(errorCode(boxProtocol('Q', {}, ['P']))).toBeNull();
    expect(edges('P')).toEqual([
      'number authored',
      'Money pending via Q',
      // `integer` already conforms through `number`.
      'list<T> where T is Q pending via Q',
    ]);
    expect(ce.conformsTo('integer', 'P')).toBe(true);
    const pending = messages('1').filter((m) =>
      m.startsWith('protocol-implementation-pending')
    );
    expect(pending).toContain(
      'protocol-implementation-pending | Money | P | `Money` conforms to `Q`, which now extends `P`'
    );
  });

  test('a stamped block-less edge settled by inheritance: an unchanged re-run', () => {
    run('type integer is Q { }');
    boxProtocol('Q', {}, ['P']);
    expect(edges('P')).toEqual(['integer pending via Q']);
    run('type number is P { function m(self: number) -> integer { 1 } }');
    expect(edges('P')).toEqual(['integer via Q', 'number authored']);
    expect(codes('type integer is Q { }')).toEqual([]);
    expect(edges('P')).toEqual(['integer via Q', 'number authored']);
  });

  test('a removed parent is refused', () => {
    boxProtocol('Q', {}, ['P']);
    const value = boxProtocol('Q', {});
    expect(errorCode(value)).toBe('protocol-extends-removal');
    expect(value.toString()).toContain(
      '`Q` extended `P`; an extension cannot be removed. Start a new engine to drop it'
    );
    expect(ce._protocolRegistry['Q']!.extends).toEqual(['P']);
  });

  test('a derived edge refused by the one-per-head rule refuses the replacement', () => {
    run(
      'type list<integer> is P { function m(self: list<integer>) -> integer { 1 } }\n' +
        'type list<T> is Q where T is Q'
    );
    const before = edges('P');
    const value = boxProtocol('Q', {}, ['P']);
    expect(errorCode(value)).toBe('protocol-conformance-overlap');
    expect(ce._protocolRegistry['Q']!.extends).toEqual([]);
    expect(edges('P')).toEqual(before);
  });

  test('a derived edge refused by the overlap rule refuses the replacement', () => {
    run(
      'type integer<1..10> is P { function m(self: integer<1..10>) -> integer { 1 } }\n' +
        'type integer<5..20> is Q'
    );
    const value = boxProtocol('Q', {}, ['P']);
    expect(errorCode(value)).toBe('protocol-conformance-overlap');
    expect(value.toString()).toContain('`integer<5..20>` overlaps `integer<1..10>`');
    expect(ce._protocolRegistry['Q']!.extends).toEqual([]);
    expect(edges('P')).toEqual(['integer<1..10> authored']);
  });

  test('an object-only parent leaves a value-type conformer pending', () => {
    ce.declareProtocol('Named', { readwrite: { name: 'string' } });
    run(`${MONEY}\ntype Money is Q`);
    expect(errorCode(boxProtocol('Q', {}, ['Named']))).toBeNull();
    expect(edges('Named')).toEqual(['Money pending via Q']);
    expect(
      ce._protocolRegistry['Named']!.conformances[0]!._pendingReason
    ).toContain('settable properties');
  });
});

// ── R3 after a replacement: the end-of-batch report ──────────────────────────

describe('a replacement that gives a descendant a member conflict', () => {
  const M = { m: '(self: Self) -> integer' };

  test('the conflict is reported at the end of the batch, until resolved', () => {
    boxProtocol('P', {});
    boxProtocol('Q', M, ['P']);
    // The edited cell moves `m` into `P` but does not re-declare `Q`.
    const out = messages(
      'protocol P { function m(self: Self) -> integer }'
    ).filter((m) => m.startsWith('protocol-extends-member-conflict'));
    expect(out).toEqual([
      'protocol-extends-member-conflict | Q | `m` is declared by `Q` and by `P`, which `Q` extends; a member name can be declared by only one protocol of a closure. Remove `m` from one of the two protocols',
    ]);
    // A conformance to `Q` meanwhile has no well-defined split.
    expect(
      codes('type integer is Q { function m(self: integer) -> integer { 1 } }\n1')
    ).toContain('protocol-extends-member-conflict');
    // The next batch still reports it; re-declaring `Q` resolves it.
    boxProtocol('Q', {}, ['P']);
    expect(codes('1')).toEqual([]);
    expect(ce._protocolExtendsConflicts.size).toBe(0);
  });

  test('moving a member from the descendant to the parent converges in one pass', () => {
    boxProtocol('P', {});
    boxProtocol('Q', M, ['P']);
    // The natural order of the edited program: `P` first, then `Q`.
    expect(errorCode(boxProtocol('P', M))).toBeNull();
    expect(errorCode(boxProtocol('Q', {}, ['P']))).toBeNull();
    expect(codes('1')).toEqual([]);
    // On a new engine the same program runs in the same order.
    const fresh = new ComputeEngine();
    expect(errorCode(boxProtocol('P', M, undefined, fresh))).toBeNull();
    expect(errorCode(boxProtocol('Q', {}, ['P'], fresh))).toBeNull();
  });

  test('a diamond: the conflict names the declaring protocols in closure order', () => {
    boxProtocol('X', {});
    boxProtocol('A', M, ['X']);
    boxProtocol('B', { n: '(self: Self) -> integer' }, ['X']);
    boxProtocol('C', {}, ['A', 'B']);
    // `B` is replaced with `m`: `C` now reaches `m` through `A` and `B`.
    expect(errorCode(boxProtocol('B', M, ['X']))).toBeNull();
    expect(messages('1').join('\n')).toContain(
      '`m` is declared by both `A` and `B`, and `C` extends both'
    );
  });
});

// ── Readers of the registry: dispatch, constraints, compilation, R10 ─────────

describe('the readers of the registry see the derived edges', () => {
  test('a `where T is P` constraint is satisfied through a derived edge', () => {
    declareHierarchy();
    run(`${MONEY}\n${floorRingBlock(COMPARE, ADD, MUL, FLOOR)}`);
    expect(
      run(
        'function cmp(a: T, b: T) -> integer where T is PartialOrder { compare(a, b) }\ncmp(Money(1), Money(4))'
      )
    ).toBe('-3');
    expect(
      run(
        'function fl(a: T) -> integer where T is FloorRing { floor(a) }\nfl(Money(6))'
      )
    ).toBe('6');
  });

  test('a compiled dispatch through a derived edge', () => {
    boxProtocol('Describable', { describe: '(self: Self) -> string' });
    boxProtocol('Labelled', {}, ['Describable']);
    run(
      'type integer is Labelled {\n  function describe(self: Self) -> string { "an integer" }\n}'
    );
    const result = compile(ce.box(['describe', 42] as never));
    expect(result.success).toBe(true);
    expect(result.run?.()).toBe('an integer');
    expect(ce.box(['describe', 42] as never).evaluate().toString()).toBe(
      '"an integer"'
    );
  });

  test('R10: a qualified property names only a property the protocol declares', () => {
    ce.declareProtocol('HasId', { readonly: { id: 'integer' } });
    ce.declareProtocol('Entity', {}, { extends: ['HasId'] });
    run('type User = object{id: integer}\ntype User is Entity { }');
    const out = messages('let u = User(id: 7)\nu.(Entity.id)\n1').join('\n');
    expect(out).toContain('protocol-member-unknown');
    expect(out).toContain('write `HasId.id`');
    expect(run('let v = User(id: 8)\nv.(HasId.id)')).toBe('8');
  });
});
