/**
 * CE-1037: a fold over the rows of a matrix, with a function literal that
 * was boxed before the call (`ce.function('Scan', [m, f, 0])`), was typed
 * as a list of numbers, although its values are rows.
 *
 * A function literal boxed before the call has a canonical body that reads
 * each untyped parameter as a possible number, so `(a, t) ↦ a + t` has the
 * result type `number`. The fold types its result from that result type:
 * `Scan(m, f, 0)` was `vector<2>` and `Reduce(m, f, 0)` was `number`. The
 * same literal written inline in the call takes the element type of the
 * collection at its element parameter (`t: vector<integer^2>`), and the
 * fold is typed `matrix<2x2>` and `vector<2>`.
 *
 * The literal is now canonicalized again from its written form when a
 * parameter takes a type that is not a number type, as the literal of a
 * value kind already was (`annotateCallbacksFromContextualSolve()`,
 * `boxed-expression/box.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

const M = ['List', ['List', 1, 2], ['List', 3, 4]] as const;
const SUM = ['Function', ['Add', 'a', 't'], 'a', 't'] as const;

function boxedBefore(op: string, ...rest: unknown[]): Expression {
  return ce.function(op, [
    ce.box(M as any),
    ce.box(SUM as any),
    ...rest.map((x) => ce.box(x as any)),
  ]);
}

function inline(op: string, ...rest: unknown[]): Expression {
  return ce.box([op, M, SUM, ...rest] as any);
}

describe('A FOLD OVER ROWS WITH A LITERAL BOXED BEFORE THE CALL (CE-1037)', () => {
  test.each([
    ['Scan', [0], 'matrix<2x2>'],
    ['Scan', [], 'matrix<2x2>'],
    ['Reduce', [0], 'vector<2>'],
    ['Reduce', [], 'vector<2>'],
  ] as const)('%s with seed %j', (op, seed, expected) => {
    const a = boxedBefore(op, ...seed);
    const b = inline(op, ...seed);
    expect(a.type.toString()).toBe(expected);
    expect(b.type.toString()).toBe(expected);
  });

  test('the values are the same on both routes', () => {
    expect(JSON.stringify(boxedBefore('Reduce', 0).evaluate().json)).toBe(
      '["List",4,6]'
    );
    expect(
      JSON.stringify(ce.box(['ListFrom', boxedBefore('Scan', 0)]).evaluate().json)
    ).toBe(
      JSON.stringify(ce.box(['ListFrom', inline('Scan', 0)]).evaluate().json)
    );
  });

  test('the element parameter takes the type of a row', () => {
    const call = boxedBefore('Scan', 0);
    expect(call.op2.type.toString()).toBe(
      '(a: unknown, t: vector<integer^2>) -> vector<2>'
    );
  });

  test('a body that a number reading folds gives the value of the inline literal', () => {
    // `x/x` is folded to `1` when `x` is read as a possible number.
    const f = ce.box(['Function', ['Divide', 'x', 'x'], 'x']);
    const call = ce.function('Map', [f, ce.box(M as any)]);
    expect(call.type.toString()).toBe('matrix<2x2>');
    expect(JSON.stringify(ce.box(['ListFrom', call]).evaluate().json)).toBe(
      '["List",["List",1,1],["List",1,1]]'
    );
  });

  test('a name of the scope where the literal was boxed keeps its binding', () => {
    const engine = new ComputeEngine();
    engine.declare('offset', 'integer');
    engine.assign('offset', 10);
    const f = engine.box([
      'Function',
      ['Add', 'offset', ['At', 'row', 1]],
      'row',
    ]);
    // In the same scope, the literal takes the type of a row.
    const same = engine.function('Map', [f, engine.box(M as any)]);
    expect(same.op1.type.toString()).toBe(
      '(row: vector<integer^2>) -> integer'
    );
    engine.pushScope();
    try {
      engine.declare('offset', 'integer');
      engine.assign('offset', 20);
      const call = engine.function('Map', [f, engine.box(M as any)]);
      expect(call.op1).toBe(f);
      expect(
        JSON.stringify(engine.box(['ListFrom', call]).evaluate().json)
      ).toBe('["List",11,13]');
    } finally {
      engine.popScope();
    }
  });

  test('a call boxed again for a new source type keeps the binding', () => {
    // The type of `L` changes when it is assigned again, so the call is
    // boxed again when it is read; by then the inner scope declares
    // another `offset`.
    const engine = new ComputeEngine();
    engine.declare('offset', 'integer');
    engine.assign('offset', 10);
    engine.declare('L', 'list');
    engine.assign('L', engine.box(M as any));
    const f = engine.box([
      'Function',
      ['Add', 'offset', ['At', 'row', 1]],
      'row',
    ]);
    engine.pushScope();
    try {
      const call = engine.function('Map', [f, engine.box('L')]);
      expect(
        JSON.stringify(engine.box(['ListFrom', call]).evaluate().json)
      ).toBe('["List",11,13]');
      engine.declare('offset', 'integer');
      engine.assign('offset', 20);
      engine.assign(
        'L',
        engine.box(['List', ['List', 1.5, 2], ['List', 3.5, 4]])
      );
      expect(
        JSON.stringify(engine.box(['ListFrom', call]).evaluate().json)
      ).toBe('["List",11.5,13.5]');
    } finally {
      engine.popScope();
    }
  });

  test('an operator that canonicalization removed keeps its binding', () => {
    // `Subtract(row, 1)` is canonical as `Add(row, -1)`: the name `Subtract`
    // is only in the written form.
    const engine = new ComputeEngine();
    const f = engine.box(['Function', ['Subtract', 'row', 1], 'row']);
    const same = engine.function('Map', [f, engine.box(M as any)]);
    expect(same.op1.type.toString()).toBe(
      '(row: vector<integer^2>) -> vector<integer^2>'
    );
    engine.pushScope();
    try {
      engine.declare('Subtract', {
        signature: '(any, any) -> any',
        evaluate: () => engine.box(99),
      });
      const call = engine.function('Map', [f, engine.box(M as any)]);
      expect(call.op1).toBe(f);
      expect(
        JSON.stringify(engine.box(['ListFrom', call]).evaluate().json)
      ).toBe('["List",["List",0,1],["List",2,3]]');
    } finally {
      engine.popScope();
    }
  });

  test('a literal over numbers is kept as it was boxed', () => {
    const f = ce.box(SUM as any);
    const call = ce.function('Scan', [
      ce.box(['List', 1, 2, 3]),
      f,
      ce.box(0),
    ]);
    expect(call.op2).toBe(f);
  });
});
