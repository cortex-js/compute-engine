/**
 * CE-1131: a function literal boxed before a declaration, and declared or
 * assigned with a signature over a value kind (`(residue) -> residue`) in a
 * scope that declares again a name of its body, read the variable of that
 * scope, not the variable of the scope where the literal was boxed.
 *
 * The declaration types the parameter from the signature and canonicalizes
 * the literal again from its written form, so that its body keeps `x/x`
 * (`declarationTypedFunctionLiteral()`, `function-utils.ts`). That
 * canonicalization now runs in the scope where the literal was boxed when a
 * name of the body binds in another way in the current scope, as for a
 * callback (CE-1078), so a free name keeps the binding of the boxed literal,
 * as `Apply` of the boxed literal does.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

function call(engine: ComputeEngine, name: string): string {
  return JSON.stringify(
    engine.box([name, ['ResidueClass', 2, 5]]).evaluate().json
  );
}

function applied(engine: ComputeEngine, f: Expression): string {
  return JSON.stringify(
    engine.box(['Apply', f, ['ResidueClass', 2, 5]]).evaluate().json
  );
}

/** An engine with `k = 1`, the literal `x ↦ k·x` (or `body`) boxed in the
 * global scope, and an inner scope that declares `k = 2`. */
function shadowed(body: unknown = ['Multiply', 'k', 'x']): {
  engine: ComputeEngine;
  f: Expression;
} {
  const engine = new ComputeEngine();
  engine.declare('k', 'integer');
  engine.assign('k', 1);
  const f = engine.box(['Function', body as any, 'x']);
  engine.pushScope();
  engine.declare('k', 'integer');
  engine.assign('k', 2);
  return { engine, f };
}

describe('A LITERAL BOXED BEFORE A DECLARATION OVER KIND VALUES (CE-1131)', () => {
  test('a declaration with a body in an inner scope reads the outer variable', () => {
    const { engine, f } = shadowed();
    engine.declare('g', { signature: '(residue) -> residue', evaluate: f });
    expect(call(engine, 'g')).toBe('["ResidueClass",2,5]');
    expect(applied(engine, f)).toBe('["ResidueClass",2,5]');
  });

  test('an assignment in an inner scope reads the outer variable', () => {
    const { engine, f } = shadowed();
    engine.declare('h', '(residue) -> residue');
    engine.assign('h', f);
    expect(call(engine, 'h')).toBe('["ResidueClass",2,5]');
  });

  test('the body keeps `x/x` in the inner scope', () => {
    // A body canonicalized with `x` read as a possible number folds `x/x`
    // to the integer `1`; over residue classes it is the class of 1.
    const { engine, f } = shadowed(['Multiply', 'k', ['Divide', 'x', 'x']]);
    engine.declare('g', { signature: '(residue) -> residue', evaluate: f });
    expect(call(engine, 'g')).toBe('["ResidueClass",1,5]');
  });

  test('an assignment of a literal that calls itself keeps `x/x` and reads the outer variable', () => {
    // `assign()` boxes again a canonical literal that calls the function it
    // is assigned to; it must not box again the literal canonicalized in the
    // scope where it was boxed, because the copy loses the type of `x`.
    const engine = new ComputeEngine();
    engine.declare('k', 'integer');
    engine.assign('k', 1);
    engine.declare('h', '(residue) -> residue');
    const f = engine.box([
      'Function',
      [
        'If',
        ['Equal', 'x', ['ResidueClass', 0, 5]],
        ['h', ['ResidueClass', 1, 5]],
        ['Multiply', 'k', ['Divide', 'x', 'x']],
      ],
      'x',
    ]);
    engine.pushScope();
    engine.declare('k', 'integer');
    engine.assign('k', 2);
    engine.assign('h', f);
    expect(call(engine, 'h')).toBe('["ResidueClass",1,5]');
  });

  test('a declaration in the scope where the literal was boxed reads its variable', () => {
    const engine = new ComputeEngine();
    engine.declare('k', 'integer');
    engine.assign('k', 3);
    const f = engine.box(['Function', ['Multiply', 'k', 'x'], 'x']);
    engine.declare('g', { signature: '(residue) -> residue', evaluate: f });
    // 3·2 = 6 = 1 (mod 5).
    expect(call(engine, 'g')).toBe('["ResidueClass",1,5]');
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
    engine.declare('g', { signature: '(residue) -> residue', evaluate: f });
    engine.declare('h', '(residue) -> residue');
    engine.assign('h', f);
    // 3·2 = 6 = 1 (mod 5); the outer k = 1 would give 2.
    expect(call(engine, 'g')).toBe('["ResidueClass",1,5]');
    expect(call(engine, 'h')).toBe('["ResidueClass",1,5]');
  });
});
