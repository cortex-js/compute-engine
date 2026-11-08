import { ComputeEngine } from '../../src/compute-engine';
import {
  isLibraryOperator,
  sameOperator,
  shadowsLibraryName,
} from '../../src/compute-engine/library-shadowing';

//
// A canonical call denotes its definition (`operatorDefinition`), not its
// name. `isLibraryOperator()` compares the definition of the node with the
// definition of its name in the system scope, so it answers for the scope
// where the node was bound. `shadowsLibraryName()` answers for the current
// scope. `sameOperator()` compares the definitions of two nodes.
// (`docs/SCOPING-MODEL.md`, "Symbol identity".)
//

/** Declare a user function `name` in the current scope: `x ↦ x + 100`. */
function defineUser(ce: ComputeEngine, name: string): void {
  ce.box([
    'DefineFunction',
    name,
    ['Function', ['Add', 'x', 100], 'x'],
  ]).evaluate();
}

describe('isLibraryOperator', () => {
  test('a canonical library call is a library call', () => {
    const ce = new ComputeEngine();
    const node = ce.box(['Sqrt', 'x']);
    expect(node.operator).toBe('Sqrt');
    expect(isLibraryOperator(node)).toBe(true);
    expect(isLibraryOperator(node, 'Sqrt')).toBe(true);
  });

  test('a node with another operator is not a call of the name', () => {
    const ce = new ComputeEngine();
    expect(isLibraryOperator(ce.box(['Sqrt', 'x']), 'Sin')).toBe(false);
  });

  test('a call bound to a user function of the same name is not', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    defineUser(ce, 'Sqrt');
    const node = ce.box(['Sqrt', 'x']);
    expect(node.operator).toBe('Sqrt');
    // A function defined with `DefineFunction` is a value definition (a
    // variable whose value is a function literal).
    expect(node.operatorDefinition).toBeUndefined();
    expect(node.valueDefinition).toBeDefined();
    expect(isLibraryOperator(node)).toBe(false);
    expect(isLibraryOperator(node, 'Sqrt')).toBe(false);
    // After the scope of the declaration is popped, the node is still bound
    // to the user function; the scope-based guard now says "not shadowed".
    ce.popScope();
    expect(shadowsLibraryName(ce, 'Sqrt')).toBe(false);
    expect(isLibraryOperator(node, 'Sqrt')).toBe(false);
  });

  test('a library call made before a shadowing declaration stays one', () => {
    const ce = new ComputeEngine();
    const before = ce.box(['Sqrt', 'x']);
    ce.pushScope();
    defineUser(ce, 'Sqrt');
    // The scope-based guard answers for the current scope.
    expect(shadowsLibraryName(ce, 'Sqrt')).toBe(true);
    // The node was bound to the library operator.
    expect(isLibraryOperator(before, 'Sqrt')).toBe(true);
    // A node made now is bound to the user function.
    expect(isLibraryOperator(ce.box(['Sqrt', 'x']), 'Sqrt')).toBe(false);
    ce.popScope();
  });

  test('a call bound to a user operator definition is not', () => {
    const ce = new ComputeEngine();
    const before = ce.box(['Sqrt', 'x']);
    ce.pushScope();
    ce.declare('Sqrt', {
      signature: '(number) -> number',
      evaluate: ([x]: any[]) => x.add(100),
    });
    const node = ce.box(['Sqrt', 'x']);
    expect(node.operatorDefinition).toBeDefined();
    expect(isLibraryOperator(node, 'Sqrt')).toBe(false);
    expect(isLibraryOperator(before, 'Sqrt')).toBe(true);
    ce.popScope();
    expect(shadowsLibraryName(ce, 'Sqrt')).toBe(false);
    expect(isLibraryOperator(node, 'Sqrt')).toBe(false);
  });

  test('an extension that keeps the handlers is a library call', () => {
    const ce = new ComputeEngine();
    ce.declare('Sin', { description: 'my sine' }, { extend: true });
    expect(shadowsLibraryName(ce, 'Sin')).toBe(false);
    const node = ce.box(['Sin', 'x']);
    expect(node.operatorDefinition).not.toBe(
      ce._evalContextStack[0].lexicalScope.bindings.get('Sin')?.['operator']
    );
    expect(isLibraryOperator(node, 'Sin')).toBe(true);
  });

  test('an extension that replaces `evaluate` is not', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'Sin',
      { evaluate: ([x]: any[]) => x.engine.number(100) },
      { extend: true }
    );
    expect(isLibraryOperator(ce.box(['Sin', 'x']), 'Sin')).toBe(false);
  });

  test('a copy that keeps the handlers is a library call', () => {
    const ce = new ComputeEngine();
    const def = ce.lookupDefinition('Sqrt') as any;
    ce.declare('Sqrt', { ...def.operator, description: 'my sqrt' });
    const node = ce.box(['Sqrt', 'x']);
    expect(node.operatorDefinition).not.toBe(def.operator);
    expect(isLibraryOperator(node, 'Sqrt')).toBe(true);
  });

  test('a copy that replaces `evaluate` is not', () => {
    const ce = new ComputeEngine();
    const def = ce.lookupDefinition('Sqrt') as any;
    ce.declare('Sqrt', {
      ...def.operator,
      evaluate: ([x]: any[]) => x.engine.number(100),
    });
    expect(isLibraryOperator(ce.box(['Sqrt', 'x']), 'Sqrt')).toBe(false);
  });

  // A caller library cannot redefine a name of the standard library (the
  // engine reports a duplicate operator definition), so the name here is a
  // new one. It is installed in the system scope, like the standard library.
  test('a name defined by a caller library is not, unless customLibrary: false', () => {
    const ce = new ComputeEngine({
      libraries: [
        ...ComputeEngine.getStandardLibrary(),
        {
          name: 'mine',
          definitions: {
            Foo: {
              signature: '(number) -> number',
              evaluate: ([x]: any[]) => x.add(100),
            },
          },
        },
      ],
    });
    const node = ce.box(['Foo', 'x']);
    expect(node.operator).toBe('Foo');
    expect(shadowsLibraryName(ce, 'Foo')).toBe(true);
    expect(isLibraryOperator(node, 'Foo')).toBe(false);
    expect(shadowsLibraryName(ce, 'Foo', { customLibrary: false })).toBe(
      false
    );
    expect(isLibraryOperator(node, 'Foo', { customLibrary: false })).toBe(
      true
    );
  });

  test('a non-canonical node falls back to the scope-based guard', () => {
    const ce = new ComputeEngine();
    const raw = ce.box(['Sqrt', 'x'], { canonical: false });
    expect(raw.operatorDefinition).toBeUndefined();
    expect(isLibraryOperator(raw, 'Sqrt')).toBe(true);
    ce.pushScope();
    defineUser(ce, 'Sqrt');
    // The raw node has no binding: it reads the name in the current scope.
    expect(isLibraryOperator(raw, 'Sqrt')).toBe(false);
    ce.popScope();
    expect(isLibraryOperator(raw, 'Sqrt')).toBe(true);
  });

  test('a name the library does not define is not a library call', () => {
    const ce = new ComputeEngine();
    const node = ce.box(['Tick', 'x']);
    expect(node.operator).toBe('Tick');
    expect(isLibraryOperator(node)).toBe(false);
    expect(isLibraryOperator(node, 'Tick')).toBe(false);
    const raw = ce.box(['Tick', 'x'], { canonical: false });
    expect(isLibraryOperator(raw, 'Tick')).toBe(false);
  });

  test('a symbol named like a library operator is not a call of it', () => {
    const ce = new ComputeEngine();
    expect(isLibraryOperator(ce.box('Sqrt'), 'Sqrt')).toBe(false);
  });
});

describe('sameOperator', () => {
  test('two library calls of the same operator', () => {
    const ce = new ComputeEngine();
    expect(sameOperator(ce.box(['Sqrt', 'x']), ce.box(['Sqrt', 'y']))).toBe(
      true
    );
    expect(sameOperator(ce.box(['Sqrt', 'x']), ce.box(['Sin', 'x']))).toBe(
      false
    );
  });

  test('a library call and a user call of the same name', () => {
    const ce = new ComputeEngine();
    const library = ce.box(['Sqrt', 'x']);
    ce.pushScope();
    defineUser(ce, 'Sqrt');
    const user = ce.box(['Sqrt', 'x']);
    expect(user.operator).toBe('Sqrt');
    expect(sameOperator(library, user)).toBe(false);
    expect(sameOperator(user, ce.box(['Sqrt', 'y']))).toBe(true);
    ce.popScope();
  });

  test('a library call and a call of a user operator definition', () => {
    const ce = new ComputeEngine();
    const library = ce.box(['Sqrt', 'x']);
    ce.pushScope();
    ce.declare('Sqrt', {
      signature: '(number) -> number',
      evaluate: ([x]: any[]) => x.add(100),
    });
    const user = ce.box(['Sqrt', 'x']);
    expect(sameOperator(library, user)).toBe(false);
    expect(sameOperator(user, ce.box(['Sqrt', 'y']))).toBe(true);
    ce.popScope();
  });

  test('a raw node is compared by its name', () => {
    const ce = new ComputeEngine();
    const raw = ce.box(['Sqrt', 'x'], { canonical: false });
    const library = ce.box(['Sqrt', 'x']);
    expect(sameOperator(raw, library)).toBe(true);
    expect(sameOperator(library, raw)).toBe(true);
    expect(sameOperator(raw, ce.box(['Sin', 'x'], { canonical: false }))).toBe(
      false
    );
    ce.pushScope();
    defineUser(ce, 'Sqrt');
    expect(sameOperator(raw, ce.box(['Sqrt', 'x']))).toBe(true);
    ce.popScope();
  });
});
