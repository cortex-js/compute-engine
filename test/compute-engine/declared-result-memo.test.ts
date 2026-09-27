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
  // `ce.assign` used to reconcile the literal's return against the result it
  // had just DERIVED under the declared parameter types, as if the host had
  // declared it, and wrote it into the stored literal as `Typed(a,
  // 'integer')`. The signature then kept that result after a retype of `a`.
  test.each([
    [
      'its definition',
      (ce: ComputeEngine) => {
        (ce.lookupDefinition('a') as { value: { type: unknown } }).value.type =
          'real';
      },
    ],
    [
      'a boxed symbol',
      (ce: ComputeEngine) => {
        (ce.box('a') as unknown as { type: unknown }).type = 'real';
      },
    ],
  ])(
    'the result follows a retype of a symbol the body reads, through %s',
    (_, retype) => {
      const ce = new ComputeEngine();
      ce.declare('a', 'integer');
      ce.declare('f', '(integer) -> unknown');
      ce.assign('f', ce.parse('x \\mapsto a'));
      const stored = (
        ce.lookupDefinition('f') as { value: { value: { json: unknown } } }
      ).value.value;
      expect(JSON.stringify(stored.json)).not.toContain('Typed');
      expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
      retype(ce);
      expect(ce.box('f').type.toString()).toBe('(integer) -> real');
    }
  );
  // The same reconciliation runs on the two other routes that install a
  // literal under a declared signature.
  test.each([
    [
      'a declaration with a value',
      (ce: ComputeEngine) =>
        ce.declare('f', {
          type: '(integer) -> unknown',
          value: ce.parse('x \\mapsto a'),
        } as never),
    ],
    [
      'an operator signature, then an assignment',
      (ce: ComputeEngine) => {
        ce.declare('f', { signature: '(integer) -> unknown' } as never);
        ce.assign('f', ce.parse('x \\mapsto a'));
      },
    ],
  ])('the result follows a retype after %s', (_, define) => {
    const ce = new ComputeEngine();
    ce.declare('a', 'integer');
    define(ce);
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    (ce.lookupDefinition('a') as { value: { type: unknown } }).value.type =
      'real';
    expect(ce.box('f').type.toString()).toBe('(integer) -> real');
  });
  test('functions with an `unknown` parameter do not invalidate each other', () => {
    // An `unknown` parameter may hold a function, so declaring it moves the
    // engine's `callable` axis. When that axis was part of the memo key,
    // re-boxing `k` invalidated `w`'s memo and re-boxing `w` invalidated
    // `k`'s, and every enclosing operator read them again: Tycho's
    // `plasma-effect` document took more than 5 s to register `s`.
    const ce = new ComputeEngine();
    ce.declare('t', T);
    ce.assign('t', 1);
    ce.declare('k', `(unknown, ${T}) -> unknown`);
    ce.assign('k', ce.parse('(x,y) \\mapsto \\cos(y+0.3t)+2.4t'));
    ce.declare('w', `(${T}, unknown) -> unknown`);
    ce.assign('w', ce.parse('(x,y) \\mapsto \\sin(x+0.3t)-0.7t'));
    const engine = ce as unknown as { box: (...args: unknown[]) => unknown };
    const box = engine.box.bind(ce);
    let boxed = 0;
    engine.box = (...args: unknown[]) => {
      boxed += 1;
      return box(...args);
    };
    try {
      const e = ce.parse('\\sin(\\cos(k(x,y)+w(x,y)))');
      expect(e.type.toString()).toBe('nan | real');
    } finally {
      engine.box = box;
    }
    // Measured: 6 calls of `box` (the parse, and each signature derived
    // once); 0.137.1 made 11 274.
    expect(boxed).toBeLessThanOrEqual(20);
  });
  test('a declaration that shadows a function moves the definition counter', () => {
    // A cached result follows this counter; a parameter declaration that
    // merely MAY hold a function (an `unknown` parameter) does not move it.
    const ce = new ComputeEngine();
    const engine = ce as unknown as { _definitionVersion: number };
    ce.declare('h', 'function');
    ce.assign('h', ce.parse('t \\mapsto t'));
    let before = engine._definitionVersion;
    ce.parse('(x) \\mapsto x').type.toString();
    expect(engine._definitionVersion).toBe(before);
    before = engine._definitionVersion;
    ce.pushScope();
    ce.declare('h', 'integer');
    expect(engine._definitionVersion).toBeGreaterThan(before);
    ce.popScope();
  });
});
