import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { sameSyntactic } from '../../src/compute-engine/boxed-expression/compare';

//
// A canonical call denotes the definition that its head is bound to, not its
// name. `isSame()` compares the binding of the head of two calls with the
// same name, as it compares the binding of two symbols with the same name.
// The matcher reads a pattern head that is a library name as the library
// function: it admits a subject call only when the subject is a call of the
// library operator. A repeated wildcard compares its two captures with
// `isSame()`. The structural form of a call keeps the binding of the call.
// (`docs/plans/2026-11-07-ce1109-4-match-and-same-spec.md`.)
//

/** Declare a user function `name` in the current scope: `x ↦ x + 100`. It
 * is a value definition (`ce.declare(name, 'function')`, then
 * `ce.assign()`). */
function declareUser(ce: ComputeEngine, name: string): void {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(['Function', ['Add', 'x', 100], 'x']));
}

/** The system-scope operator definition of `name`. */
function libraryDef(ce: ComputeEngine, name: string): unknown {
  return (
    ce._evalContextStack[0].lexicalScope.bindings.get(name) as
      | { operator?: unknown }
      | undefined
  )?.operator;
}

/** `L` is `Sqrt(y)` boxed before a user function `Sqrt` is declared in a
 * pushed scope (a call of the library function); `U` is `Sqrt(y)` boxed in
 * that scope (a call of the user function). The scope is popped. */
function libraryAndUserSqrt(): {
  ce: ComputeEngine;
  L: Expression;
  U: Expression;
} {
  const ce = new ComputeEngine();
  const L = ce.box(['Sqrt', 'y']);
  ce.pushScope();
  declareUser(ce, 'Sqrt');
  const U = ce.box(['Sqrt', 'y']);
  ce.popScope();
  return { ce, L, U };
}

describe('isSame compares the definition of a call', () => {
  test('a library call and a user call of the same name are different', () => {
    const { ce, L, U } = libraryAndUserSqrt();
    expect(L.operatorDefinition === libraryDef(ce, 'Sqrt')).toBe(true);
    expect(U.operatorDefinition).toBeUndefined();
    expect(U.valueDefinition).toBeDefined();
    expect(L.isSame(U)).toBe(false);
    expect(U.isSame(L)).toBe(false);
    expect(L.isSame(ce.box(['Sqrt', 'y']))).toBe(true);
    // The hash is by name: two calls that are not the same can have the
    // same hash.
    expect(L.hash).toBe(U.hash);
  });

  test('a sum of a library call and a user call keeps two terms', () => {
    const { ce, L, U } = libraryAndUserSqrt();
    for (const sum of [
      ce.function('Add', [L, U]).simplify(),
      ce.function('Add', [L, U]),
    ]) {
      expect(sum.operator).toBe('Add');
      expect(sum.nops).toBe(2);
      const defs = sum.ops!.map(
        (x) => x.operatorDefinition ?? x.valueDefinition
      );
      expect(defs).toContain(L.operatorDefinition);
      expect(defs).toContain(U.valueDefinition);
    }
  });

  test('a raw head and a bound head are different', () => {
    const ce = new ComputeEngine();
    const held = ce.box(['Hold', ['Sqrt', 'y']]).op1;
    expect(held.operator).toBe('Sqrt');
    expect(held.isCanonical).toBe(false);
    expect(held.isSame(ce.box(['Sqrt', 'y']))).toBe(false);
  });

  test('two raw calls compare by name', () => {
    const ce = new ComputeEngine();
    const a = ce.box(['Sin', 1], { form: 'raw' });
    const b = ce.box(['Sin', 1], { form: 'raw' });
    expect(a).not.toBe(b);
    expect(a.isSame(b)).toBe(true);
  });

  test('a call before and after an extension that keeps the handlers', () => {
    const ce = new ComputeEngine();
    const before = ce.box(['Sin', 'x']);
    ce.declare('Sin', { description: 'my sine' }, { extend: true });
    const after = ce.box(['Sin', 'x']);
    expect(after.operatorDefinition).not.toBe(before.operatorDefinition);
    expect(before.isSame(after)).toBe(true);
    expect(after.isSame(before)).toBe(true);
  });

  test('a call before and after an extension that replaces `evaluate`', () => {
    const ce = new ComputeEngine();
    const before = ce.box(['Sin', 'x']);
    ce.declare(
      'Sin',
      { evaluate: ([x]: any[]) => x.engine.number(100) },
      { extend: true }
    );
    expect(before.isSame(ce.box(['Sin', 'x']))).toBe(false);
  });

  test('a call of a copy of the library definition that keeps the handlers', () => {
    const ce = new ComputeEngine();
    const before = ce.box(['Sqrt', 'x']);
    const def = ce.lookupDefinition('Sqrt') as any;
    ce.pushScope();
    ce.declare('Sqrt', { ...def.operator, description: 'my sqrt' });
    const copy = ce.box(['Sqrt', 'x']);
    ce.popScope();
    expect(copy.operatorDefinition).not.toBe(before.operatorDefinition);
    expect(before.isSame(copy)).toBe(true);
  });

  test('a call of a library function in two engines', () => {
    const a = new ComputeEngine().box(['Sin', 1]);
    const b = new ComputeEngine().box(['Sin', 1]);
    expect(a.operatorDefinition).not.toBe(b.operatorDefinition);
    expect(a.isSame(b)).toBe(true);
  });

  test('a call of a user function declared in each of two engines', () => {
    const calls = [new ComputeEngine(), new ComputeEngine()].map((ce) => {
      declareUser(ce, 'k');
      return ce.box(['k', 1]);
    });
    expect(calls[0].valueDefinition).toBeDefined();
    expect(calls[0].isSame(calls[1])).toBe(false);
    // As a user symbol `k` of two engines already is.
    expect(
      calls[0].engine.symbol('k').isSame(calls[1].engine.symbol('k'))
    ).toBe(false);
  });

  test('a name that a caller library adds, in two engines', () => {
    const engine = (offset: number) =>
      new ComputeEngine({
        libraries: [
          ...ComputeEngine.getStandardLibrary(),
          {
            name: 'mine',
            definitions: {
              Foo: {
                signature: '(number) -> number',
                evaluate: ([x]: any[]) => x.add(offset),
              },
            },
          },
        ],
      });
    const a = engine(100).box(['Foo', 'x']);
    const b = engine(200).box(['Foo', 'x']);
    expect(a.operator).toBe('Foo');
    expect(a.isSame(b)).toBe(false);
    expect(a.isSame(a.engine.box(['Foo', 'x']))).toBe(true);
  });

  test('a parameter called in the body of a function literal', () => {
    const ce = new ComputeEngine();
    const a = ce.box(['Function', ['f', 'x'], 'f']);
    const b = ce.box(['Function', ['f', 'x'], 'f']);
    expect(a.isSame(b)).toBe(true);
  });

  test('a call before and after a reassignment of the function', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    // A value definition.
    declareUser(ce, 'g');
    const g1 = ce.box(['g', 1]);
    ce.assign('g', ce.box(['Function', ['Multiply', 'x', 2], 'x']));
    const g2 = ce.box(['g', 1]);
    expect(g1.valueDefinition).toBe(g2.valueDefinition);
    expect(g1.isSame(g2)).toBe(true);
    // An operator definition: `ce.assign()` on a new name.
    ce.assign('h', ce.box(['Function', ['Add', 'x', 1], 'x']));
    const h1 = ce.box(['h', 1]);
    ce.assign('h', ce.box(['Function', ['Add', 'x', 2], 'x']));
    const h2 = ce.box(['h', 1]);
    expect(h1.operatorDefinition).toBeDefined();
    expect(h1.operatorDefinition).toBe(h2.operatorDefinition);
    expect(h1.isSame(h2)).toBe(true);
    ce.popScope();
  });

  test('the syntactic comparison does not read the binding of a head', () => {
    const { L, U } = libraryAndUserSqrt();
    expect(sameSyntactic(L, U)).toBe(true);
  });
});

describe('the matcher reads a library name in a pattern as the library function', () => {
  /**
   * Box `subject` before and inside a pushed scope where a user function
   * `name` is declared, pop the scope, and match both against `pattern`.
   */
  function matchBoth(
    name: string,
    subject: any,
    pattern: any,
    options?: Parameters<Expression['match']>[1]
  ) {
    const ce = new ComputeEngine();
    const lib = ce.box(subject);
    ce.pushScope();
    declareUser(ce, name);
    const user = ce.box(subject);
    const inScope = user.match(pattern, options);
    ce.popScope();
    // A canonical `Subtract(a, b)` is `Add(a, Negate(b))`.
    if (lib.operator === name)
      expect(lib.operatorDefinition === libraryDef(ce, name)).toBe(true);
    expect(user.operator).toBe(name);
    expect(user.valueDefinition).toBeDefined();
    return {
      lib: lib.match(pattern, options),
      user: user.match(pattern, options),
      inScope,
      userExpr: user,
    };
  }

  test('the function branch: a user call does not match a library head', () => {
    const r = matchBoth('Sqrt', ['Sqrt', 'y'], ['Sqrt', '_x']);
    expect(r.lib?._x.symbol).toBe('y');
    expect(r.user).toBeNull();
    expect(r.inScope).toBeNull();
  });

  test('a library call matches in a scope that shadows the name', () => {
    const ce = new ComputeEngine();
    const L = ce.box(['Sqrt', 'y']);
    ce.pushScope();
    declareUser(ce, 'Sqrt');
    expect(L.match(['Sqrt', '_x'])?._x.symbol).toBe('y');
    ce.popScope();
  });

  test('`Multiply` read as `Divide`', () => {
    const r = matchBoth(
      'Multiply',
      ['Multiply', 'x', ['Rational', 1, 2]],
      ['Divide', '_a', '_b']
    );
    expect(r.lib?._b.re).toBe(2);
    expect(r.user).toBeNull();
  });

  test('`Divide` read as `Power`', () => {
    const r = matchBoth('Divide', ['Divide', 1, 'x'], ['Power', '_a', '_b']);
    expect(r.lib?._b.re).toBe(-1);
    expect(r.user).toBeNull();
  });

  test('`Root` read as `Power`', () => {
    const r = matchBoth('Root', ['Root', 'x', 3], ['Power', '_a', '_b']);
    expect(r.lib?._a.symbol).toBe('x');
    expect(r.user).toBeNull();
  });

  test('the variant `a - b` read as `a + (-b)`', () => {
    const r = matchBoth(
      'Subtract',
      ['Subtract', 'a', 'b'],
      ['Add', 'a', ['Negate', '_b']],
      { useVariations: true }
    );
    expect(r.lib?._b.symbol).toBe('b');
    expect(r.user).toBeNull();
  });

  test('the variant `-a` read as `0 - a`', () => {
    const r = matchBoth('Negate', ['Negate', 'a'], ['Subtract', 0, '_y'], {
      useVariations: true,
    });
    expect(r.lib?._y.symbol).toBe('a');
    expect(r.user).toBeNull();
  });

  test('the variant `-x` read as `-1 · x`', () => {
    const r = matchBoth('Negate', ['Negate', 'a'], ['Multiply', -1, '_y'], {
      useVariations: true,
    });
    expect(r.lib?._y.symbol).toBe('a');
    expect(r.user).toBeNull();
  });

  test('the variant `x / a` read as `(1/a) · x`', () => {
    const r = matchBoth(
      'Divide',
      ['Divide', 'a', 'b'],
      ['Multiply', 'a', ['Divide', 1, '_y']],
      { useVariations: true }
    );
    expect(r.lib?._y.symbol).toBe('b');
    expect(r.user).toBeNull();
  });

  test('the variant `e^z` read as `Exp(z)`', () => {
    const r = matchBoth(
      'Power',
      ['Power', 'ExponentialE', 'z'],
      ['Exp', '_z'],
      { useVariations: true }
    );
    expect(r.lib?._z.symbol).toBe('z');
    expect(r.user).toBeNull();
  });

  test('missing terms', () => {
    const r = matchBoth(
      'Add',
      ['Add', ['Multiply', 3, ['Power', 'x', 2]], 5],
      [
        'Add',
        ['Multiply', '_a', ['Power', 'x', 2]],
        ['Multiply', '_b', 'x'],
        '_c',
      ],
      { matchMissingTerms: true }
    );
    expect(r.lib?._a.re).toBe(3);
    expect(r.lib?._b.re).toBe(0);
    expect(r.user).toBeNull();
  });

  test('the anchor test of `Add`', () => {
    const { ce, L, U } = libraryAndUserSqrt();
    const z = ce.symbol('z');
    const pattern = ['Add', ['Sqrt', 'y'], '__r'];
    expect(ce.function('Add', [L, z]).match(pattern)?.__r.symbol).toBe('z');
    expect(ce.function('Add', [U, z]).match(pattern)).toBeNull();
    // Four anchors and six operands: the anchors are found by hash.
    const many = ['a', 'b', 'c', 'd'].map((s) => ce.symbol(s));
    const pattern4 = ['Add', ['Sqrt', 'y'], 'a', 'b', 'c', '__r'];
    expect(ce.function('Add', [L, z, ...many]).match(pattern4)).not.toBeNull();
    expect(ce.function('Add', [U, z, ...many]).match(pattern4)).toBeNull();
  });

  test('a literal sub-pattern', () => {
    const { ce, L, U } = libraryAndUserSqrt();
    const pattern = ['Tuple', ['Sqrt', 'y'], '_b'];
    expect(ce.function('Tuple', [L, ce.One]).match(pattern)?._b.re).toBe(1);
    expect(ce.function('Tuple', [U, ce.One]).match(pattern)).toBeNull();
  });

  test('`commutativeMatch` is read from the library definition', () => {
    // The pattern is boxed in a scope where `Add` is a user function, which
    // is not commutative. The flag is read from the library `Add`.
    const ce = new ComputeEngine();
    const sum = ce.box(['Add', 'x', 1]);
    ce.pushScope();
    declareUser(ce, 'Add');
    expect(sum.match(['Add', 1, '_a'])?._a.symbol).toBe('x');
    ce.popScope();
  });

  test('a head that is not a library name matches by name', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    declareUser(ce, 'h');
    const call = ce.box(['h', 'y']);
    ce.popScope();
    expect(call.match(['h', '_x'])?._x.symbol).toBe('y');
  });

  test('a wildcard head captures the operator name', () => {
    const { U } = libraryAndUserSqrt();
    expect(U.match(['_f', '_x'])?._x.symbol).toBe('y');
  });
});

describe('a repeated wildcard compares its captures with isSame', () => {
  test('a library call and a user call are two values', () => {
    const { ce, L, U } = libraryAndUserSqrt();
    const pattern = ['Tuple', '_x', '_x'];
    expect(ce.function('Tuple', [L, U]).match(pattern)).toBeNull();
    expect(ce.function('Tuple', [U, L]).match(pattern)).toBeNull();
    expect(ce.function('Tuple', [L, L]).match(pattern)).not.toBeNull();
    expect(ce.function('Tuple', [U, U]).match(pattern)).not.toBeNull();
  });

  test('a variable bound by a scoped part of the subject', () => {
    // In the canonical `Integrate`, the parameter `x` of the `Function` and
    // the `x` of `Limits` have different definitions. The symbols of two
    // captures are compared by name.
    const ce = new ComputeEngine();
    const integral = ce.parse('\\int_0^1 x^2 dx');
    expect(integral.json).toEqual([
      'Integrate',
      ['Function', ['Block', ['Power', 'x', 2]], 'x'],
      ['Limits', 'x', 0, 1],
    ]);
    const m = integral.match([
      'Integrate',
      ['Function', ['Block', ['Power', '_x', '_n']], '_x'],
      ['Limits', '_x', '_a', '_b'],
    ]);
    expect(m?._x.symbol).toBe('x');
    expect(m?._n.re).toBe(2);
    expect(m?._b.re).toBe(1);
  });
});

describe('a finite Range and the List of its integers', () => {
  test('the relation is transitive', () => {
    const ce = new ComputeEngine();
    const range = ce.box(['Range', 1, 3]);
    const list = ce.box(['List', 1, 2, 3]);
    const rawList = ce.box(['List', 1, 2, 3], { form: 'raw' });
    const rawRange = ce.box(['Range', 1, 3], { form: 'raw' });
    // Two classes: the library calls, and the raw calls.
    expect(range.isSame(list)).toBe(true);
    expect(list.isSame(range)).toBe(true);
    expect(rawRange.isSame(rawList)).toBe(true);
    expect(rawList.isSame(rawRange)).toBe(true);
    for (const [a, b] of [
      [range, rawList],
      [list, rawList],
      [range, rawRange],
      [list, rawRange],
    ]) {
      expect(a.isSame(b)).toBe(false);
      expect(b.isSame(a)).toBe(false);
    }
    // The hash is not changed.
    expect(range.hash).toBe(list.hash);
  });

  test('two ranges of two engines', () => {
    const a = new ComputeEngine().box(['Range', 1, 3]);
    const b = new ComputeEngine().box(['Range', 1, 3]);
    expect(a.isSame(b)).toBe(true);
    expect(a.isSame(b.engine.box(['List', 1, 2, 3]))).toBe(true);
  });

  test('a user function named `Range` or `List`', () => {
    const ce = new ComputeEngine();
    const range = ce.box(['Range', 1, 3]);
    const list = ce.box(['List', 1, 2, 3]);
    ce.pushScope();
    ce.declare('Range', 'function');
    ce.assign('Range', ce.box(['Function', ['List', 'a', 'b'], 'a', 'b']));
    const userRange = ce.box(['Range', 1, 3]);
    ce.popScope();
    ce.pushScope();
    ce.declare('List', 'function');
    ce.assign('List', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    const userList = ce.box(['List', 1, 2, 3]);
    ce.popScope();
    expect(userRange.operator).toBe('Range');
    expect(userRange.valueDefinition).toBeDefined();
    expect(userList.operator).toBe('List');
    expect(userList.valueDefinition).toBeDefined();
    for (const [a, b] of [
      [userRange, range],
      [userRange, list],
      [userList, range],
    ]) {
      expect(a.isSame(b)).toBe(false);
      expect(b.isSame(a)).toBe(false);
    }
  });

  test('the syntactic comparison does not read the heads', () => {
    const ce = new ComputeEngine();
    const range = ce.box(['Range', 1, 3]);
    const rawList = ce.box(['List', 1, 2, 3], { form: 'raw' });
    expect(sameSyntactic(range, rawList)).toBe(true);
  });
});

describe('the structural form of a call keeps its binding', () => {
  test('a user call read after its scope', () => {
    const { U } = libraryAndUserSqrt();
    const s = U.structural;
    expect(s.operator).toBe('Sqrt');
    expect(s.valueDefinition === U.valueDefinition).toBe(true);
    expect(s.operatorDefinition).toBeUndefined();
    // The matcher reads the structural form: no library rule applies.
    expect(U.match(['Sqrt', '_x'])).toBeNull();
  });

  test('a library call read in a scope that shadows the name', () => {
    const ce = new ComputeEngine();
    const L = ce.box(['Sqrt', 'y']);
    ce.pushScope();
    declareUser(ce, 'Sqrt');
    expect(L.structural.operatorDefinition === libraryDef(ce, 'Sqrt')).toBe(
      true
    );
    ce.popScope();
  });
});
