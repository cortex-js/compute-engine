/**
 * Unit pins for the operand-descriptor constructors (`describe`,
 * `describeType` in `boxed-expression/operand-descriptor.ts`) — the input a
 * `type` handler receives when its definition declares
 * operand descriptors. Each block pins the FACTS a descriptor derives
 * from a concrete operand or type, and the structural view where one exists.
 *
 * Facts are pinned three-valued: `true`/`false` only where the source
 * (type, literal value, capability read) proves the answer, `undefined`
 * everywhere else — an `undefined` here is a contract, not a gap: every
 * consumer must take the conservative branch on it.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { typeToString } from '../../src/common/type/serialize';
import {
  describe as describeOperand,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('describe() on literals', () => {
  test('a finite real literal', () => {
    const d = describeOperand(ce.box(2.5));
    expect(d.facts.finite).toBe(true);
    expect(d.facts.sgn).toBe('positive');
    expect(d.facts.closed).toBe(true);
    expect(d.facts.collection).toBe(false);
    expect(d.facts.indexed).toBe(false);
    expect(d.structureOf?.()).toEqual({ kind: 'number' });
  });

  test("an error operand's validity is a TYPE read — its type is 'error'", () => {
    // There is deliberately no `valid` fact: the type channel carries it.
    const d = describeOperand(ce.box(['Error', { str: 'missing' }]));
    expect(d.type).toBe('error');
  });

  test('the literals 0 and 1 carry their structural tag', () => {
    expect(describeOperand(ce.box(0)).structureOf?.()).toEqual({
      kind: 'number',
      literal: 0,
      rational: [0n, 1n],
    });
    expect(describeOperand(ce.box(1)).structureOf?.()).toEqual({
      kind: 'number',
      literal: 1,
      rational: [1n, 1n],
    });
  });

  test('a rational literal carries its exact reduced terms', () => {
    // The handler-visible type of a rational no double represents exactly is
    // an outward-rounded range; the structure node keeps the exact terms.
    const s = describeOperand(ce.box(['Rational', 6, 4])).structureOf?.();
    expect(s?.kind).toBe('number');
    if (s?.kind === 'number') expect(s.rational).toEqual([3n, 2n]);
    // A float, a radical and a non-finite literal carry none.
    for (const x of [2.5, ['Sqrt', 2], { num: 'NaN' }]) {
      const n = describeOperand(ce.box(x as any)).structureOf?.();
      if (n?.kind === 'number') expect(n.rational).toBeUndefined();
    }
  });

  test('non-finite literals', () => {
    expect(describeOperand(ce.box(Infinity)).facts.finite).toBe(false);
    expect(describeOperand(ce.box(NaN)).facts.finite).toBe(false);
  });

  test('a symbol holding a non-finite value answers finite from the value', () => {
    // `number` admits `±∞`, so the type alone cannot decide; the held
    // value — a pure source — can.
    ce.declare('w', 'number');
    ce.assign('w', ce.box(Infinity));
    expect(describeOperand(ce.box('w')).facts.finite).toBe(false);
    ce.declare('w2', 'number');
    ce.assign('w2', ce.box(7));
    expect(describeOperand(ce.box('w2')).facts.finite).toBe(true);
  });

  test('a string literal', () => {
    const d = describeOperand(ce.string('abc'));
    // In the type lattice `string <: collection<any>` (a string enumerates
    // its characters), so the collection fact is TRUE for strings — the
    // broadcast policy of excluding text atoms lives in the derivation
    // steps, never in the facts.
    expect(d.facts.collection).toBe(true);
    expect(d.facts.finite).toBeUndefined();
    expect(d.facts.sgn).toBeUndefined();
    expect(d.structureOf?.()).toEqual({ kind: 'string', text: 'abc' });
  });
});

describe('describe() on symbols', () => {
  test('a symbol with a ranged declaration proves its sign', () => {
    ce.declare('p', 'real<0..> & !0');
    const d = describeOperand(ce.box('p'));
    expect(d.facts.sgn).toBe('positive');
    expect(d.facts.collection).toBe(false);
    expect(d.structureOf?.()).toEqual({ kind: 'symbol', name: 'p' });
  });

  test('a valueless collection-typed symbol is a collection by SHAPE', () => {
    ce.declare('L', 'list<integer>');
    const d = describeOperand(ce.box('L'));
    expect(d.facts.collection).toBe(true);
    expect(d.facts.indexed).toBe(true);
    // No value, no dimensions in the type: cardinality unknown.
    expect(d.facts.finiteCollection).toBeUndefined();
  });

  test('an evidence-inferred symbol carries `inferred` on its structure node', () => {
    // A numeric use of a valueless symbol infers its type (evidence
    // inference); the structure node records that the recorded type is
    // subject to revision. A DECLARED symbol's node carries no such mark
    // (see the ranged-declaration test above, whose node is bare).
    expect(ce.box(['Add', 'zz', 1]).type).toBeDefined();
    expect(describeOperand(ce.box('zz')).structureOf?.()).toEqual({
      kind: 'symbol',
      name: 'zz',
      inferred: true,
    });
  });

  test('an undeclared (unknown-typed) symbol decides nothing', () => {
    const d = describeOperand(ce.box('mystery'));
    expect(d.facts.collection).toBeUndefined();
    expect(d.facts.finite).toBeUndefined();
    expect(d.facts.sgn).toBeUndefined();
  });
});

describe('describe() on compound operands', () => {
  test('an application', () => {
    ce.declare('x', 'integer');
    const d = describeOperand(ce.box(['Add', 'x', 1]));
    // "Is this an application?" is a structural question, answered by the
    // structure view's kind — there is no separate fact for it.
    const s = d.structureOf?.();
    expect(s?.kind).toBe('application');
    if (s?.kind === 'application') {
      expect(s.head).toBe('Add');
      expect(s.children).toHaveLength(2);
    }
  });

  test('a list literal: capability facts and nested shape', () => {
    const d = describeOperand(ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(d.facts.collection).toBe(true);
    expect(d.facts.indexed).toBe(true);
    expect(d.facts.finiteCollection).toBe(true);
    const s = d.structureOf?.();
    expect(s?.kind).toBe('list-literal');
    if (s?.kind === 'list-literal') {
      expect(s.shape).toEqual([2, 2]);
      // One descriptor per top-level row, each a list literal itself.
      expect(s.elements).toHaveLength(2);
      expect(s.elements[0].structureOf?.()?.kind).toBe('list-literal');
    }
  });

  test('a ragged list stops its shape at the uniform depth', () => {
    const d = describeOperand(ce.box(['List', ['List', 1, 2], ['List', 3]]));
    const s = d.structureOf?.();
    expect(s?.kind).toBe('list-literal');
    if (s?.kind === 'list-literal') expect(s.shape).toEqual([2]);
  });

  test('a tuple literal', () => {
    const d = describeOperand(ce.box(['Tuple', 1, { str: 'two' }, 3]));
    const s = d.structureOf?.();
    expect(s?.kind).toBe('tuple');
    if (s?.kind === 'tuple') {
      expect(s.arity).toBe(3);
      // One descriptor per component, carrying the component's
      // handler-visible type (a literal's value-carrying type included).
      expect(s.elements.map((e) => typeToString(e.type))).toEqual([
        '1',
        'string',
        '3',
      ]);
    }
  });

  test('a collection application carries the element type its handler proves', () => {
    // `Range(1, 5)` has integer endpoints, so its own collection handler
    // proves `integer` elements where the static type says only `real`.
    const d = describeOperand(ce.box(['Range', 1, 5]));
    expect(d.facts.elementType).toBe('integer');
    // A symbol is no application, so there is no per-instance handler
    // answer: a consumer reads the element type from the type alone.
    ce.declare('Lint', 'list<integer>');
    const l = describeOperand(ce.box('Lint'));
    expect(l.facts.elementType).toBeUndefined();
  });

  test('a function literal: parameters, annotations, body', () => {
    const fn = ce.box(['Function', ['Add', 'n', 1], 'n']);
    const s = describeOperand(fn).structureOf?.();
    expect(s?.kind).toBe('function-literal');
    if (s?.kind === 'function-literal') {
      expect(s.parameters).toHaveLength(1);
      expect(s.parameters[0].name).toBe('n');
      expect(s.body.kind).toBe('application');
    }
  });

  test('a RAW held operand is read as written', () => {
    // `Hold` is lazy with no canonical handler, so through `ce.box` its
    // operand arrives unbound; the descriptor must read that raw form
    // without binding or canonicalizing it.
    const held = ce.box(['Hold', ['Add', 'q', 1]]);
    const inner = held.ops[0];
    const s = describeOperand(inner).structureOf?.();
    expect(s?.kind).toBe('application');
    if (s?.kind === 'application') expect(s.head).toBe('Add');
  });
});

describe('describeType()', () => {
  test('a finite numeric type', () => {
    const d = describeType('integer');
    expect(d.facts.finite).toBe(true);
    expect(d.facts.collection).toBe(false);
    // Facts a type alone cannot decide stay undefined.
    expect(d.facts.closed).toBeUndefined();
  });

  test('a dimensioned list type carries its shape', () => {
    const t = ce.type('list<integer^2x3>').type;
    const d = describeType(t);
    expect(d.facts.collection).toBe(true);
    expect(d.facts.finiteCollection).toBe(true);
    expect(d.facts.shape).toEqual([2, 3]);
  });

  test('top types decide nothing', () => {
    for (const t of ['unknown', 'any'] as const) {
      const d = describeType(t);
      expect(d.facts.collection).toBeUndefined();
      expect(d.facts.finite).toBeUndefined();
    }
  });

  test('broadcastable<T> is possibly a collection', () => {
    const t = ce.type('broadcastable<number>').type;
    expect(describeType(t).facts.collection).toBeUndefined();
  });

  test('a ranged type proves a sign', () => {
    const t = ce.type('real<0..> & !0').type;
    expect(describeType(t).facts.sgn).toBe('positive');
  });
});
