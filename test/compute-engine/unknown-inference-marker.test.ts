import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  isSubtype,
  joinUnresolvedArm,
  narrow,
  provablyAdmits,
  widen,
} from '../../src/common/type/subtype';
import { reduceType } from '../../src/common/type/reduce';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import type { MathJsonExpression } from '../../src/math-json';

// `unknown` is an inference marker: a type still to be inferred, not a
// content contract (`docs/plans/2026-10-21-unknown-inference-marker.md`,
// user decisions D1 to D4, 2026-10-21).
//
// D1  every type is a subtype of `unknown`; `unknown` proves no contract.
// D2  an explicit `<unknown>` element requests inference, like the bare name.
// D3  bare `tuple` and `record` refine their slots from an assignment.
// D4  a join keeps the unresolved arm.
// R7  a transparent alias carries the instruction of its definition.

const s = (t: unknown): string => typeToString(t as any);

describe('D1: the subtype relation reads unknown as unrestricted', () => {
  test('every type, the markers and any included, is a subtype of unknown', () => {
    for (const t of [
      'integer',
      'string',
      'expression',
      'value',
      'missing',
      'nothing',
      'error',
      'any',
      'never',
      'integer | missing',
      'list<integer | missing>',
      '!integer',
      'broadcastable<any>',
    ])
      expect(isSubtype(t, 'unknown')).toBe(true);
  });

  test('unknown proves no contract', () => {
    for (const t of ['integer', 'expression', 'value', 'missing', 'nothing'])
      expect(isSubtype('unknown', t)).toBe(false);
    expect(isSubtype('unknown', 'any')).toBe(true);
    expect(isSubtype('unknown', 'unknown | integer')).toBe(true);
  });

  test('the three spellings of an unrestricted list are one set of values', () => {
    const ce = new ComputeEngine();
    for (const [a, b] of [
      ['list', 'list<unknown>'],
      ['list<unknown>', 'list'],
      ['list<any>', 'list<unknown>'],
      ['list<unknown>', 'list<any>'],
    ])
      expect(ce.type(a).matches(b)).toBe(true);
    expect(ce.type('list<integer | missing>').matches('list<unknown>')).toBe(
      true
    );
    expect(ce.type('tuple<unknown, missing>').matches('indexed_collection<unknown>')).toBe(
      true
    );
    // The content contracts stay restrictive.
    expect(ce.type('list<unknown>').matches('list<expression>')).toBe(false);
    expect(ce.type('list<integer | missing>').matches('list<expression>')).toBe(
      false
    );
  });

  test('a meet resolves unknown; couldMatch sees overlap with the markers', () => {
    const ce = new ComputeEngine();
    expect(s(narrow('unknown', 'integer'))).toBe('integer');
    expect(s(narrow('unknown', 'missing'))).toBe('missing');
    expect(s(narrow('missing', 'unknown'))).toBe('missing');
    expect(ce.type('unknown').couldMatch('missing')).toBe(true);
    expect(ce.type('unknown').couldMatch('nothing')).toBe(true);
    expect(ce.type('unknown').couldMatch('integer')).toBe(true);
  });

  test('provablyAdmits reads evidence, not the possibility an unknown admits', () => {
    expect(provablyAdmits('nothing', 'unknown')).toBe(false);
    expect(provablyAdmits('missing', 'integer | unknown')).toBe(false);
    expect(provablyAdmits('nothing', 'integer | nothing')).toBe(true);
    expect(provablyAdmits('missing', 'missing | unknown')).toBe(true);
    expect(provablyAdmits('nothing', 'any')).toBe(true);
    expect(provablyAdmits('error', 'unknown')).toBe(false);
  });
});

describe('D4: a value-derived join keeps the unresolved arm', () => {
  test('the inference join is neutral in unknown; the value-derived join keeps the arm', () => {
    // `widen` reads `unknown` as "no information yet" (a recursion seed, an
    // unresolved call), so it drops it; `joinUnresolvedArm` reads it as a
    // cell whose contents are not resolved and keeps it.
    expect(s(widen('unknown', 'integer'))).toBe('integer');
    expect(s(joinUnresolvedArm(['unknown', 'integer']))).toBe(
      'integer | unknown'
    );
    expect(s(joinUnresolvedArm(['unknown', 'missing']))).toBe(
      'missing | unknown'
    );
    expect(s(joinUnresolvedArm(['unknown', 'any']))).toBe('any');
    expect(s(joinUnresolvedArm(['unknown', 'never']))).toBe('unknown');
    // Beside markers only: a free symbol in a point stays a value slot.
    expect(s(joinUnresolvedArm(['unknown', 'integer'], true))).toBe('integer');
    expect(s(joinUnresolvedArm(['unknown', 'missing'], true))).toBe(
      'missing | unknown'
    );
  });

  test('the reducer absorbs a value arm into unknown and keeps a marker arm', () => {
    const ce = new ComputeEngine();
    expect(s(reduceType(parseType('integer | unknown')))).toBe('unknown');
    expect(s(reduceType(parseType('missing | unknown')))).toBe(
      'missing | unknown'
    );
    expect(s(reduceType(parseType('nothing | unknown')))).toBe(
      'nothing | unknown'
    );
    expect(s(reduceType(parseType('never | unknown')))).toBe('unknown');
    expect(s(reduceType(parseType('any | unknown')))).toBe('any');
    expect(ce.type('missing | unknown').toString()).toBe('missing | unknown');
  });

  test('the type of a collection result holds its value (the ROADMAP defects)', () => {
    const ce = new ComputeEngine();
    ce.declare('fs', 'list<unknown>');
    // The element of `fs` is unresolved: the join is unresolved too, and a
    // value such as `[Error(…), 2]` is in `list<unknown>` (it was typed
    // `list<integer>`).
    const join = ce.box(['ListJoin', 'fs', ['List', 2]]);
    expect(join.type.toString()).toBe('list<unknown>');
    ce.declare('tu', 'tuple<unknown, missing>');
    ce.assign('tu', ce.box(['Tuple', 1, 'Missing']));
    const filtered = ce.box([
      'Filter',
      'tu',
      ['Function', ['Greater', '_', 0], '_'],
    ]);
    expect(filtered.type.toString()).toBe('list<missing | unknown>');
    expect(filtered.evaluate().toString()).toBe('[1]');
    // `Sort(tu)` goes through the generic solver, which drops a nested
    // `unknown` bound when another slot says something, and is still typed
    // `list<missing>` for the value `[1, Missing]` (ROADMAP).
  });

  test('a comparator whose parameters are not inferred yet is no evidence for the element variable', () => {
    // The lambda `(a, b) ↦ b - a` is typed `(unknown, unknown) -> number`;
    // under D1 it fits the ground `(any, any) -> number | boolean` arm of
    // the comparator slot of `Sort`, which must not solve the element
    // variable to `never` (Rule U of the solver).
    const ce = new ComputeEngine();
    const cmp: MathJsonExpression = [
      'Function',
      ['Subtract', 'b', 'a'],
      'a',
      'b',
    ];
    const e = ce.box(['Sort', 'zs', cmp]);
    expect(e.type.toString()).toBe('list<any> | string');
    expect(ce.box('zs').type.toString()).toBe('indexed_collection<any>');
    const ce2 = new ComputeEngine();
    const r = executeEpsil(
      ce2,
      'function h(xs) { sort(xs, (a, b) => b - a) }\nh([1, 2, 3])'
    );
    expect(r.value?.toString()).toBe('[3,2,1]');
    expect(ce2.symbol('h').type.toString()).toBe(
      '(indexed_collection<any>) -> list<any> | string'
    );
  });

  test('an unresolved callback result is not evidence of an omission', () => {
    const ce = new ComputeEngine();
    const IDENTITY: MathJsonExpression = ['Function', 'x', 'x'];
    expect(
      ce.box(['Map', IDENTITY, ['List', 1, 'Missing']]).type.toString()
    ).toBe('list<integer | missing^2>');
    expect(ce.box(['Tuple', 1, 'Undefined']).type.toString()).toBe(
      'tuple<integer, missing>'
    );
  });
});

describe('D2, D3, R7: a declaration with contents left to inference refines from each assignment', () => {
  const declareAssign = (
    type: string,
    value: MathJsonExpression,
    name = 'v'
  ): string => {
    const ce = new ComputeEngine();
    ce.declare(name, type);
    ce.assign(name, ce.box(value));
    return ce.box(name).type.toString();
  };

  test('an explicit <unknown> element refines like the bare name', () => {
    expect(declareAssign('list<unknown>', ['List', 1, 2])).toBe(
      'list<integer>'
    );
    expect(declareAssign('list<unknown>', ['List', 1, 'Missing'])).toBe(
      'list<integer | missing>'
    );
    expect(declareAssign('set<unknown>', ['Set', 1, 2])).toBe('set<integer>');
    expect(
      declareAssign('dictionary<unknown>', [
        'Dictionary',
        ['Tuple', { str: 'a' }, 1],
      ])
    ).toBe('dictionary<integer>');
    expect(declareAssign('collection<unknown>', ['List', 1, 2])).toBe(
      'collection<integer>'
    );
    expect(declareAssign('indexed_collection<unknown>', ['List', 1, 2])).toBe(
      'indexed_collection<integer>'
    );
  });

  test('a content contract never moves', () => {
    expect(declareAssign('list<any>', ['List', 1, 2])).toBe('list<any>');
    expect(declareAssign('list<expression>', ['List', 1, 2])).toBe(
      'list<expression>'
    );
    expect(declareAssign('list<integer>', ['List', 1, 2])).toBe(
      'list<integer>'
    );
    expect(declareAssign('list<unknown^2>', ['List', 1, 2])).toBe(
      'list<unknown^2>'
    );
    const ce = new ComputeEngine();
    ce.declare('e', 'list<expression>');
    expect(() =>
      ce.assign('e', ce.box(['List', ['Error', { str: 'x' }], 2]))
    ).toThrow();
  });

  test('bare tuple and record refine their slots and fields', () => {
    expect(declareAssign('tuple', ['Tuple', 1, 'Missing'])).toBe(
      'tuple<integer, missing>'
    );
    expect(declareAssign('tuple', ['Tuple', 1, { str: 'a' }, 3])).toBe(
      'tuple<integer, string, integer>'
    );
    expect(
      declareAssign('record', ['Dictionary', ['Tuple', { str: 'a' }, 1]])
    ).toBe('record{a: integer}');
    // The contract stays the kind: an explicit tuple type never moves.
    expect(declareAssign('tuple<any, any>', ['Tuple', 1, 2])).toBe(
      'tuple<any, any>'
    );
  });

  test('re-assignment re-refines, another arity included', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'tuple');
    ce.assign('t', ce.box(['Tuple', 1, 2]));
    expect(ce.box('t').type.toString()).toBe('tuple<integer, integer>');
    ce.assign('t', ce.box(['Tuple', { str: 'a' }]));
    expect(ce.box('t').type.toString()).toBe('tuple<string>');
    expect(() => ce.assign('t', ce.box(['List', 1]))).toThrow();
    ce.declare('u', 'list<unknown>');
    ce.assign('u', ce.box(['List', 1]));
    ce.assign('u', ce.box(['List', { str: 'a' }]));
    expect(ce.box('u').type.toString()).toBe('list<string>');
    expect(() => ce.assign('u', 42)).toThrow();
  });

  test('a transparent alias carries the instruction of its definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('L', 'list', { alias: true });
    ce.declareType('LU', 'list<unknown>', { alias: true });
    ce.declareType('LA', 'list<any>', { alias: true });
    ce.declareType('TU', 'tuple', { alias: true });
    for (const [name, type, expected] of [
      ['a', 'L', 'list<integer>'],
      ['b', 'LU', 'list<integer>'],
      ['c', 'LA', 'LA'],
    ]) {
      ce.declare(name, type);
      ce.assign(name, ce.box(['List', 1, 2]));
      expect(ce.box(name).type.toString()).toBe(expected);
    }
    ce.declare('t', 'TU');
    ce.assign('t', ce.box(['Tuple', 1, { str: 'x' }]));
    expect(ce.box('t').type.toString()).toBe('tuple<integer, string>');
  });

  test('the Epsil let route and the MathJSON Declare route agree with ce.declare', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      ['let a: list<unknown> = [1, 2]', 'let t: tuple = (1, "a")'].join('\n')
    );
    expect(ce.symbol('a').type.toString()).toBe('list<integer>');
    expect(ce.symbol('t').type.toString()).toBe('tuple<integer, string>');
    const ce2 = new ComputeEngine();
    ce2.box(['Declare', 'q', { str: 'list<unknown>' }]).evaluate();
    ce2.box(['Assign', 'q', ['List', 1, 2]]).evaluate();
    expect(ce2.box('q').type.toString()).toBe('list<integer>');
  });

  test('a declaration serializes as written: the instruction survives a round trip', () => {
    const ce = new ComputeEngine();
    for (const spelling of ['list', 'list<unknown>', 'list<any>', 'tuple'])
      expect(ce.type(spelling).toString()).toBe(spelling);
    expect(ce.box(['Declare', 'q', { str: 'list<unknown>' }]).json).toEqual([
      'Declare',
      'q',
      "'list<unknown>'",
    ]);
  });

  test('review: a recursive transparent alias ends the evidence walk', () => {
    const ce = new ComputeEngine();
    ce.declareType('cyc', 'cyc | list<integer>', { alias: true });
    ce.declareType('cyz', 'cyz | 0', { alias: true });
    expect(provablyAdmits('missing', ce.type('cyc').type)).toBe(false);
    expect(provablyAdmits('nothing', ce.type('cyz').type)).toBe(false);
    ce.declareType('cym', 'cym | missing', { alias: true });
    expect(provablyAdmits('missing', ce.type('cym').type)).toBe(true);
  });

  test('review: the reducer reads aliases of the markers and is order-independent', () => {
    const ce = new ComputeEngine();
    ce.declareType('U', 'unknown', { alias: true });
    ce.declareType('M', 'missing', { alias: true });
    expect(s(reduceType(ce.type('missing | U').type))).toBe('U | missing');
    expect(s(reduceType(ce.type('M | unknown').type))).toBe('M | unknown');
    expect(s(reduceType({ kind: 'union', types: ['unknown', 'any'] }))).toBe(
      'any'
    );
    expect(s(reduceType({ kind: 'union', types: ['any', 'unknown'] }))).toBe(
      'any'
    );
    // An `error` arm is the reducer's standing rule: the union is `error`.
    expect(s(reduceType(parseType('error | unknown')))).toBe('error');
  });

  test('review: the unresolved-parameter rule reaches aliases and unknown arms', () => {
    const ce = new ComputeEngine();
    ce.declareType('U', 'unknown', { alias: true });
    expect(ce.type('(U) -> number').matches('(any) -> number')).toBe(false);
    expect(
      ce.type('(unknown | missing) -> number').matches('(any) -> number')
    ).toBe(false);
    expect(
      ce.type('(unknown | missing) -> number').matches('(missing) -> number')
    ).toBe(true);
    expect(ce.type('(unknown) -> number').matches('(integer) -> number')).toBe(
      true
    );
    expect(ce.type('(unknown*) -> unknown').matches('(unknown*) -> unknown')).toBe(
      true
    );
  });

  test('D5: a diagnostic shows an unbound type variable by its name', () => {
    const ce = new ComputeEngine();
    ce.declare('idc', '(indexed_collection<T>) -> T where T');
    expect(ce.box(['idc', 5]).toString()).toBe(
      'idc(Error(ErrorCode("incompatible-type", "indexed_collection<T>", "5"), 5))'
    );
    ce.declare('ov', '((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)');
    expect(ce.box(['ov', 5]).toString()).toContain('indexed_collection<T>');
  });

  test('a whole-symbol unknown still promotes the assigned literal', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'unknown');
    ce.assign('x', 5);
    expect(ce.box('x').type.toString()).toBe('integer');
  });
});
