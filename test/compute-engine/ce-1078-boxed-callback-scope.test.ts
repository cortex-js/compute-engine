/**
 * CE-1078: a function literal boxed before a call, and mapped over the
 * values of a value kind (residue classes) in a scope that declares again a
 * name of its body, read the variable of that scope, not the variable of the
 * scope where the literal was boxed.
 *
 * Over the values of a kind, the literal is canonicalized again from its
 * written form, with its parameter typed by the element type, so that its
 * body keeps `x/x` (`annotateCallbacksFromContextualSolve()`,
 * `boxed-expression/box.ts`). That canonicalization now runs in the scope
 * where the literal was boxed, so a free name of the body keeps the binding
 * of the boxed literal, as `Apply` of the boxed literal does.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const SRC = ['List', ['ResidueClass', 2, 5], ['ResidueClass', 3, 5]] as const;

function mapped(engine: ComputeEngine, f: Expression): string {
  const call = engine.function('Map', [f, engine.box(SRC as any)]);
  return JSON.stringify(engine.box(['ListFrom', call]).evaluate().json);
}

function applied(engine: ComputeEngine, f: Expression): string {
  return JSON.stringify(
    engine.box(['Apply', f, ['ResidueClass', 2, 5]]).evaluate().json
  );
}

describe('A LITERAL BOXED BEFORE A CALL OVER KIND VALUES (CE-1078)', () => {
  test('an inner scope that declares the name again does not change the value', () => {
    const engine = new ComputeEngine();
    engine.declare('k', 'integer');
    engine.assign('k', 1);
    const f = engine.box(['Function', ['Multiply', 'k', 'x'], 'x']);
    expect(mapped(engine, f)).toBe(
      '["List",["ResidueClass",2,5],["ResidueClass",3,5]]'
    );
    engine.pushScope();
    try {
      engine.declare('k', 'integer');
      engine.assign('k', 2);
      expect(mapped(engine, f)).toBe(
        '["List",["ResidueClass",2,5],["ResidueClass",3,5]]'
      );
      expect(applied(engine, f)).toBe('["ResidueClass",2,5]');
    } finally {
      engine.popScope();
    }
  });

  test('a literal boxed in a scope that has ended reads the variable of that scope', () => {
    const engine = new ComputeEngine();
    engine.declare('k', 'integer');
    engine.assign('k', 1);
    engine.pushScope();
    let f: Expression;
    try {
      engine.declare('k', 'integer');
      engine.assign('k', 3);
      f = engine.box(['Function', ['Multiply', 'k', 'x'], 'x']);
    } finally {
      engine.popScope();
    }
    // 2·3 = 6 = 1 (mod 5) and 3·3 = 9 = 4 (mod 5).
    expect(mapped(engine, f)).toBe(
      '["List",["ResidueClass",1,5],["ResidueClass",4,5]]'
    );
    expect(applied(engine, f)).toBe('["ResidueClass",1,5]');
  });

  test('a fold in an inner scope reads the variable of the scope where the literal was boxed', () => {
    const engine = new ComputeEngine();
    engine.declare('k', 'integer');
    engine.assign('k', 1);
    const f = engine.box([
      'Function',
      ['Add', 'a', ['Multiply', 'k', 'x']],
      'a',
      'x',
    ]);
    const src = ['List', ['ResidueClass', 2, 5], ['ResidueClass', 4, 5]];
    engine.pushScope();
    try {
      engine.declare('k', 'integer');
      engine.assign('k', 2);
      // 2 + 1·4 = 6 = 1 (mod 5); the inner k = 2 would give 0.
      const call = engine.function('Reduce', [engine.box(src as any), f]);
      expect(JSON.stringify(call.evaluate().json)).toBe('["ResidueClass",1,5]');
    } finally {
      engine.popScope();
    }
  });

  test('a fold that builds a list in an inner scope gives the value of the outer variable', () => {
    // The literal is canonicalized before the fold, in the scope where it
    // was boxed, so the fold does not refine the type of `a`: the type is
    // `collection<any>`, not `list<residue>`.
    const engine = new ComputeEngine();
    engine.declare('k', 'integer');
    engine.assign('k', 1);
    const f = engine.box([
      'Function',
      ['Join', 'a', ['List', ['Multiply', 'k', 'x']]],
      'a',
      'x',
    ]);
    const src = ['List', ['ResidueClass', 2, 5], ['ResidueClass', 4, 5]];
    engine.pushScope();
    try {
      engine.declare('k', 'integer');
      engine.assign('k', 2);
      const call = engine.function('Reduce', [
        engine.box(src as any),
        f,
        engine.box(['List']),
      ]);
      expect(call.type.toString()).toBe('collection<any>');
      expect(JSON.stringify(call.evaluate().json)).toBe(
        '["List",["ResidueClass",2,5],["ResidueClass",4,5]]'
      );
    } finally {
      engine.popScope();
    }
  });

  test('a fold over lists keeps the type of its accumulator', () => {
    // The literal is passed raw to the fold when its names bind the same in
    // the scope of the call, so the fold refines the type of `a`.
    const engine = new ComputeEngine();
    const f = engine.box(['Function', ['Join', 'a', 'x'], 'a', 'x']);
    const call = engine.function('Reduce', [
      engine.box(['List', ['List', 1], ['List', 2]]),
      f,
    ]);
    expect(call.type.toString()).toBe('list<integer>');
  });

  test('the body keeps `x/x` in the inner scope', () => {
    // A body canonicalized with `x` read as a possible number folds `x/x`
    // to the integer `1`; over residue classes it is the class of 1.
    const engine = new ComputeEngine();
    engine.declare('k', 'integer');
    engine.assign('k', 1);
    const f = engine.box([
      'Function',
      ['Multiply', 'k', ['Divide', 'x', 'x']],
      'x',
    ]);
    engine.pushScope();
    try {
      engine.declare('k', 'integer');
      engine.assign('k', 2);
      expect(mapped(engine, f)).toBe(
        '["List",["ResidueClass",1,5],["ResidueClass",1,5]]'
      );
    } finally {
      engine.popScope();
    }
  });
});
