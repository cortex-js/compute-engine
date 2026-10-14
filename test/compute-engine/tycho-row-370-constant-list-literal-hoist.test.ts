/**
 * A constant list literal in a compiled body is emitted ONCE as a preamble
 * local the runner evaluates once per artifact, instead of being built again
 * on every call (Tycho ledger row 370).
 *
 * A plotting consumer substitutes a resolved document list by value into a
 * row before compiling it, so `T[⌊Nx⌋ + N⌊Ny⌋] < k` compiled with `T`'s
 * 9 801 numbers as a literal, and the `javascript` target wrote the 49 KB
 * array literal into the per-call code: a region fill that sampled the kernel
 * 1.2 million times spent the whole of its paint building the literal. The
 * same list assigned to a symbol was already hoisted (`const _val_T = …` in
 * `preambleOnce`), 40× to 660× faster per call. `List` literals whose
 * elements are all finite real number literals, or such lists nested, now
 * get the same treatment (`BaseCompiler.hoistConstantListLiteral`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function js(ce: ComputeEngine, json: any, options: Record<string, unknown> = {}) {
  const r = compile(ce.box(json), {
    to: 'javascript',
    fallback: false,
    ...options,
  } as any);
  expect(r.success).toBe(true);
  return r;
}

describe('Tycho row 370: a constant list literal is hoisted out of the per-call code', () => {
  const ce = new ComputeEngine();
  ce.declare('i', 'integer');
  ce.declare('j', 'integer');
  ce.declare('x', 'real');

  test('the literal lands in `preambleOnce` and the site reads the name', () => {
    const r = js(ce, [
      'Add',
      ['At', ['List', 1, 2, 3, 4, 5, 6, 7, 8], ['Floor', ['Multiply', 8, 'x']]],
      -3,
    ]);
    expect(r.preambleOnce).toBe('const _lit_1 = [1, 2, 3, 4, 5, 6, 7, 8];\n');
    expect(r.code).toBe('_SYS.at(_lit_1, Math.floor(8 * _.x)) + -3');
    expect(r.preamble).toContain('const _lit_1 = [1, 2, 3, 4, 5, 6, 7, 8];');
    expect(r.run!({ x: 0.3 })).toBe(-1);
    expect(r.run!({ x: 0.99 })).toBe(4);
  });

  test('the literal is hoisted as the same list assigned to a symbol is', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.assign('T', engine.box(['List', 1, 2, 3, 4, 5, 6, 7, 8]));
    const bound = js(engine, [
      'Add',
      ['At', 'T', ['Floor', ['Multiply', 8, 'x']]],
      -3,
    ]);
    const literal = js(engine, [
      'Add',
      ['At', ['List', 1, 2, 3, 4, 5, 6, 7, 8], ['Floor', ['Multiply', 8, 'x']]],
      -3,
    ]);
    expect(bound.preambleOnce).toBe('const _val_T = [1, 2, 3, 4, 5, 6, 7, 8];\n');
    expect(literal.preambleOnce).toBe(
      'const _lit_1 = [1, 2, 3, 4, 5, 6, 7, 8];\n'
    );
    expect(literal.code).toBe(bound.code!.replace('_val_T', '_lit_1'));
  });

  test('a nested literal (a matrix) is hoisted whole', () => {
    const r = js(ce, [
      'At',
      ['At', ['List', ['List', 1, 2, 3], ['List', 4, 5, 6], ['List', 7, 8, 9]], 'i'],
      'j',
    ]);
    expect(r.preambleOnce).toBe(
      'const _lit_1 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];\n'
    );
    expect(r.code).toContain('_SYS.at(_lit_1, _.i)');
    expect(r.code).not.toContain('[1, 2, 3]');
    expect(r.run!({ i: 2, j: 3 })).toBe(6);
  });

  test('two occurrences of the same literal read one local', () => {
    const r = js(ce, [
      'Add',
      ['At', ['List', 1, 2, 3], 'i'],
      ['At', ['List', 1, 2, 3], 'j'],
    ]);
    expect(r.preambleOnce).toBe('const _lit_1 = [1, 2, 3];\n');
    expect(r.code).toBe('_SYS.at(_lit_1, _.i) + _SYS.at(_lit_1, _.j)');
    expect(r.run!({ i: 1, j: 3 })).toBe(4);
  });

  test('two different literals read two locals', () => {
    const r = js(ce, [
      'Add',
      ['At', ['List', 1, 2, 3], 'i'],
      ['At', ['List', 4, 5, 6], 'j'],
    ]);
    expect(r.preambleOnce).toBe(
      'const _lit_1 = [1, 2, 3];\nconst _lit_2 = [4, 5, 6];\n'
    );
    expect(r.code).toBe('_SYS.at(_lit_1, _.i) + _SYS.at(_lit_2, _.j)');
  });

  test('a literal with a non-literal element stays inline', () => {
    const r = js(ce, ['At', ['List', 1, 'x', 3], 'i']);
    expect(r.preambleOnce).toBeUndefined();
    expect(r.code).toContain('[1, _.x, 3]');
  });

  test('a literal with fewer than three numbers stays inline', () => {
    const r = js(ce, ['At', ['List', 1, 2], 'i']);
    expect(r.preambleOnce).toBeUndefined();
    expect(r.code).toBe('_SYS.at([1, 2], _.i)');
  });

  test('the threshold counts the numbers of every nesting level', () => {
    // Two rows of two numbers: four numbers, hoisted whole, not row by row.
    const r = js(ce, [
      'At',
      ['At', ['List', ['List', 1, 2], ['List', 3, 4]], 'i'],
      'j',
    ]);
    expect(r.preambleOnce).toBe('const _lit_1 = [[1, 2], [3, 4]];\n');
    expect(r.run!({ i: 2, j: 1 })).toBe(3);
  });

  test('a parameter named like the local does not collide with it', () => {
    const r = js(ce, [
      'Function',
      ['At', ['List', 10, 20, 30], '_lit_1'],
      '_lit_1',
    ]);
    expect(r.preambleOnce).toBe('const _lit_1_2 = [10, 20, 30];\n');
    // A top-level `Function` compiles on the function-literal route: `run`
    // is the lambda itself.
    expect((r.run as unknown as (k: number) => number)(2)).toBe(20);
  });

  test('a function the kernel returns answers the shared local, read-only by contract', () => {
    const r = js(ce, ['Function', ['Function', ['List', 1, 2, 3], 'y'], 'x']);
    // `run` is the outer lambda; it answers the inner one, which answers
    // the literal. A result of compiled code is read-only by contract (the
    // runner makes no defensive copy), so the inner function answers the
    // one local every time, and a caller that wrote to it would change what
    // the next call answers.
    const inner = (r.run as unknown as (x: number) => (y: number) => number[])(0);
    const first = inner(0);
    expect(first).toEqual([1, 2, 3]);
    expect(inner(0)).toBe(first);
  });

  test('a literal with a complex or non-finite element stays inline', () => {
    const complex = js(ce, ['List', 1, ['Complex', 1, 2], 3]);
    expect(complex.preambleOnce).toBeUndefined();
    expect(complex.code).toBe('[1, ({ re: 1, im: 2 }), 3]');
    const infinite = js(ce, ['List', 1, 'PositiveInfinity', 3]);
    expect(infinite.preambleOnce).toBeUndefined();
    expect(infinite.code).toBe('[1, Infinity, 3]');
  });

  test('a literal handed to a caller-supplied function stays inline', () => {
    // Such a function receives the array itself and may keep or mutate it,
    // so every call must hand it a fresh array.
    const r = js(ce, ['Foo', ['List', 1, 2, 3]], {
      functions: { Foo: (l: unknown) => l },
    });
    expect(r.preambleOnce).toBeUndefined();
    expect(r.code).toBe('Foo([1, 2, 3])');
  });

  test('the value a call returns is the shared local itself, read-only by contract', () => {
    const r = js(ce, ['List', 1, 2, 3]);
    expect(r.code).toBe('_lit_1');
    const first = r.run!({}) as number[];
    expect(first).toEqual([1, 2, 3]);
    // No defensive copy: the same array on every call. A caller that needs
    // to change it copies it first (`compile-run-contract.test.ts`).
    expect(r.run!({})).toBe(first);
  });

  test('a local no read reaches any more is not emitted', () => {
    // The unrolled sum folds `[1,2,3][k]` at each literal `k` to the cell.
    const r = compile(ce.parse('\\sum_{k=1}^{3} [1,2,3][k] x'), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('((_.x) + (_.x * 2) + (_.x * 3))');
    expect(r.preambleOnce).toBeUndefined();
  });

  test('a component fan-out still reads the numbers from the literal', () => {
    // `[1, 2, 3] + [x, x, x]` is written component by component with the
    // numbers in place, as before the hoist; the local is then unread and
    // not emitted.
    const r = js(ce, ['Add', ['List', 1, 2, 3], ['List', 'x', 'x', 'x']]);
    expect(r.code).toBe('[(_.x + 1), (_.x + 2), (_.x + 3)]');
    expect(r.preambleOnce).toBeUndefined();
  });

  test('a broadcast over a long literal reads the local', () => {
    const r = js(ce, ['Add', ['List', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'x']);
    expect(r.preambleOnce).toBe(
      'const _lit_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];\n'
    );
    expect(r.code).toContain('_lit_1');
    expect(r.run!({ x: 1 })).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test('a literal inside a user function body is hoisted too', () => {
    const engine = new ComputeEngine();
    engine.declare('i', 'integer');
    engine.declare('f', { signature: '(integer) -> real' });
    engine.assign('f', engine.parse('n \\mapsto [10,20,30][n] + 1'));
    const r = compile(engine.parse('f(i) + f(2)'), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.preambleOnce).toBe('const _lit_1 = [10, 20, 30];\n');
    expect(r.preamblePerCall).toBe(
      'const _fn_f = (n) => _SYS.at(_lit_1, n) + 1;\n'
    );
    expect(r.run!({ i: 1 })).toBe(32);
  });

  test('on the function-literal route the local is hoisted out of the lambda', () => {
    const r = compile(ce.parse('n \\mapsto [1,2,3][n]'), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.preambleOnce).toBe('const _lit_1 = [1, 2, 3];\n');
    expect((r.run as any)(2)).toBe(2);
  });

  test('the interval target is unchanged: the list is already a constant there', () => {
    const r = compile(
      ce.box([
        'Add',
        ['At', ['List', 1, 2, 3, 4, 5, 6, 7, 8], ['Floor', ['Multiply', 8, 'x']]],
        -3,
      ]),
      { to: 'interval-js', fallback: false } as any
    );
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('[1, 2, 3');
    expect(r.code).toMatch(/_IA\.at\(_k\d+, /);
  });
});
