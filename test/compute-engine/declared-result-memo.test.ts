/**
 * The signature of a function declared `(T, …) -> unknown` reports the result
 * its body has under the declared parameter types
 * (`resultUnderDeclaredParameters`, `boxed-expression/declared-parameter-result.ts`).
 * Computing it boxes the function literal, which declares its parameters.
 * The memo of that result was keyed on the cache generation, which every
 * declaration moves, so it never hit: each read re-boxed the body, and the
 * bodies of the declared functions it calls, in turn. A Tycho document with
 * three nested declared functions (a Voronoï pattern) spent 75 s registering
 * its definitions in 0.137.0; assigning the third function did not finish in
 * 100 s in plain CE.
 */

import { ComputeEngine } from '../../src/compute-engine';

const T = 'real | signed_infinity | nan';

function voronoi(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('H', `(${T}) -> unknown`);
  ce.assign(
    'H',
    ce.parse('x \\mapsto \\operatorname{mod}(10^4\\sin(10^4 x), 1)')
  );
  ce.declare('S', `(${T}, ${T}, ${T}) -> unknown`);
  ce.assign(
    'S',
    ce.parse(
      '(x,y,s) \\mapsto H(\\lfloor 4x\\rfloor + 4\\lfloor 4y \\rfloor + s)'
    )
  );
  ce.declare('P', `(${T}, ${T}) -> unknown`);
  ce.assign(
    'P',
    ce.parse(
      '(x,y) \\mapsto \\frac{1}{4}(\\lfloor 4x\\rfloor, \\lfloor 4y\\rfloor) + \\frac14 (S(x,y,0), S(x,y,0.5))'
    )
  );
  return ce;
}

describe('THE RESULT UNDER DECLARED PARAMETER TYPES IS MEMOIZED', () => {
  test('nested declared functions register without re-deriving each other', () => {
    const ce = voronoi();
    ce.declare('V', `(${T}, ${T}) -> unknown`);
    ce.assign('V', ce.parse('(x,y) \\mapsto [P(x-1,y), P(x,y), P(x+1,y)]'));
    const v = ce.box('V');
    expect(v.type.toString()).toMatch(/^\(/);
    // A second read of the signatures boxes nothing: every memo hits. (The
    // count is deterministic, unlike a time budget.)
    const engine = ce as unknown as { box: (...args: unknown[]) => unknown };
    const box = engine.box.bind(ce);
    let boxed = 0;
    engine.box = (...args: unknown[]) => {
      boxed += 1;
      return box(...args);
    };
    try {
      for (const name of ['V', 'P', 'S', 'H'])
        void ce.lookupDefinition(name)!.value!.type;
    } finally {
      engine.box = box;
    }
    expect(boxed).toBe(0);
  });

  test('reading a signature does not move the cache generation', () => {
    const ce = voronoi() as unknown as {
      box: (x: string) => { type: unknown };
      _cacheGeneration: () => number;
    };
    ce.box('P').type;
    const before = ce._cacheGeneration();
    ce.box('P').type;
    ce.box('S').type;
    expect(ce._cacheGeneration()).toBe(before);
  });

  test('the result still follows a change of a function the body calls', () => {
    const ce = new ComputeEngine();
    ce.declare('g', `(${T}) -> unknown`);
    ce.assign('g', ce.parse('x \\mapsto x + 1'));
    ce.declare('f', `(${T}) -> unknown`);
    ce.assign('f', ce.parse('x \\mapsto g(x)'));
    expect(ce.box('f').type.toString()).toBe(
      '(nan | real | signed_infinity) -> nan | real | signed_infinity'
    );
    ce.assign('g', ce.parse('x \\mapsto \\sqrt{x}'));
    expect(ce.box('f').type.toString()).not.toBe(
      '(nan | real | signed_infinity) -> nan | real | signed_infinity'
    );
  });
  test('the result follows a new declaration of a name the body reads', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> unknown');
    ce.assign('f', ce.parse('x \\mapsto b + x'));
    expect(ce.box('f').type.toString()).toBe('(integer) -> number');
    // `b` was not declared: assigning it declares it in the global scope.
    ce.assign('b', 1.5);
    expect(ce.box('f').type.toString()).toBe('(integer) -> real');
  });

  test('a recursive declared function has a signature', () => {
    // The body reads the signature it is computing. That read answers the
    // declared signature; before, each level boxed the body again, without
    // end.
    const ce = new ComputeEngine();
    ce.declare('f', `(${T}) -> unknown`);
    ce.assign('f', ce.parse('n \\mapsto n + f(n-1)'));
    expect(ce.box('f').type.toString()).toMatch(
      /^\(nan \| real \| signed_infinity\) -> /
    );
  });

  test("the result does not depend on the reader's scope", () => {
    // `g`'s body reads the global `c`; `h` has a parameter named `c`. Read
    // from inside `h`'s body, `g`'s body must still resolve `c` globally.
    const ce = new ComputeEngine();
    ce.declare('c', 'integer');
    ce.declare('g', '(integer) -> unknown');
    ce.assign('g', ce.parse('x \\mapsto c'));
    ce.declare('h', '(complex) -> unknown');
    ce.assign('h', ce.parse('c \\mapsto g(1)'));
    expect(ce.box('g').type.toString()).toBe('(integer) -> integer');
    expect(ce.box('h').type.toString()).toBe('(complex) -> integer');
  });
});
