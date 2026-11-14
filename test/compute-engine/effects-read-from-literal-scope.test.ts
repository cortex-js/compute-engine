/**
 * The effects of a function literal, and the purity of a node, are read
 * from the scope that the literal or the node was boxed in, not from the
 * scope that is current when they are read (`docs/EFFECTS-MODEL.md`,
 * "Inference"; rule 1 of `docs/plans/2026-11-11-bound-once-spec.md`). A
 * head with no definition has the effects `any`, and a later definition of
 * it is read.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** The first node of `expr` for which `test` is true. */
function find(
  expr: Expression,
  test: (e: Expression) => boolean
): Expression | undefined {
  if (test(expr)) return expr;
  for (const op of expr.ops ?? []) {
    const found = find(op, test);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('effects read from the scope of the literal', () => {
  test('a literal that calls a block local: the same answer inside the run and after it', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'list<string>');
    ce.assign('S', ce.box(['List', { str: 'ab' }, { str: 'c' }]));
    const reads: string[] = [];
    let literal: Expression | undefined;
    let map: Expression | undefined;
    ce.declare('ReadEffects', {
      signature: '() -> boolean',
      evaluate: () => {
        reads.push(`${literal!.type.toString()} ${map!.isPure}`);
        return ce.True;
      },
    });
    const block = ce.box([
      'Block',
      ['Declare', 'g', { str: 'unknown' }, ['Function', ['Length', 's'], 's']],
      ['ReadEffects'],
      ['Map', ['Function', ['Add', ['g', 'x'], 1], 'x'], 'S'],
    ]);
    map = find(block, (e) => e.operator === 'Map');
    literal = map!.ops[0];
    expect(block.evaluate().toString()).toBe('[3,2]');
    reads.push(`${literal.type.toString()} ${map!.isPure}`);
    expect(reads).toHaveLength(2);
    expect(reads[0]).toBe(reads[1]);
    // The block declares `g` once, with a literal, and writes it nowhere
    // else: the call `g(x)` has the effects of that literal, none.
    expect(literal.type.toString()).not.toMatch(/\bany ->/);
    expect(map!.isPure).toBe(true);
  });

  test('a head with no definition is `any`, and a later definition is read', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    const literal = ce.box(['Function', ['Add', ['h', 'x'], 1], 'x']);
    const map = ce.box([
      'Map',
      ['Function', ['Add', ['h', 'x'], 1], 'x'],
      'L',
    ]);
    const call = ce.box(['Add', ['h', 2], 1]);
    expect(literal.type.toString()).toMatch(/^\(x: unknown\) any -> /);
    expect(map.isPure).toBe(false);
    expect(call.effects).toBe('any');

    ce.assign('h', ce.box(['Function', ['Multiply', 't', 2], 't']));
    expect(literal.type.toString()).toBe('(x: unknown) -> number');
    expect(map.isPure).toBe(true);
    expect(call.isPure).toBe(true);

    ce.assign('h', ce.box(['Function', ['Multiply', 't', ['Random']], 't']));
    expect(literal.type.toString()).toBe('(x: unknown) random -> number');
    expect(map.isPure).toBe(false);
    expect(call.effects).toEqual(['random']);
  });

  test('a pushed scope that declares another function of the name does not change the answer', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<real>');
    ce.assign('h', ce.box(['Function', ['Multiply', 't', 2], 't']));
    const literal = ce.box(['Function', ['Add', ['h', 'x'], 1], 'x']);
    const map = ce.box([
      'Map',
      ['Function', ['Add', ['h', 'x'], 1], 'x'],
      'L',
    ]);
    const call = ce.box(['Add', ['h', 2], 1]);
    expect(literal.type.toString()).toBe('(x: unknown) -> number');

    ce.pushScope();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Multiply', 't', ['Random']], 't']));
    // Read in the pushed scope: the answer of the scope of each node.
    expect(literal.type.toString()).toBe('(x: unknown) -> number');
    expect(map.isPure).toBe(true);
    expect(call.isPure).toBe(true);
    // A literal boxed in the pushed scope reads the `h` of that scope.
    const inner = ce.box(['Function', ['Add', ['h', 'x'], 1], 'x']);
    expect(inner.type.toString()).toBe('(x: unknown) random -> number');
    ce.popScope();

    // After the pop, each literal still reads its own scope.
    expect(literal.type.toString()).toBe('(x: unknown) -> number');
    expect(inner.type.toString()).toBe('(x: unknown) random -> number');
  });

  test('a block local is read from the literal of its block when it is written once', () => {
    // `g` is a local of the program's block, declared once with a literal:
    // the call `g()` in the body of `h` has the effects of that literal.
    const src = 'function g() { Random() }\nfunction h(x) { g() + x }\nh(1)';
    const [program] = parseEpsil(src);
    const ce = new ComputeEngine();
    const expr = ce.box(resolveLibraryNames(program, src, ce));
    const h = find(
      expr,
      (e) => e.operator === 'DefineFunction' && e.op1.symbol === 'h'
    );
    expect(h!.op2.type.toString()).toMatch(/^\(x: unknown\) random -> /);

    // A local that another statement of the block writes is unresolved.
    const twice = new ComputeEngine();
    twice.declare('S', 'list<string>');
    const block = twice.box([
      'Block',
      ['Declare', 'g', { str: 'unknown' }, ['Function', ['Length', 's'], 's']],
      ['Assign', 'g', ['Function', ['Random'], 's']],
      ['Map', ['Function', ['Add', ['g', 'x'], 1], 'x'], 'S'],
    ]);
    const written = find(
      block,
      (e) => e.operator === 'Function' && e.toString().includes('g(')
    );
    expect(written!.type.toString()).toMatch(/^\(x: string\) any -> /);

    // A host declaration with no value keeps the optimistic reading.
    const host = new ComputeEngine();
    host.declare('k', 'function');
    const literal = host.box(['Function', ['Add', ['k', 'x'], 1], 'x']);
    expect(literal.type.toString()).not.toMatch(/\bany ->/);
  });

  test('a call whose head had no definition when it was boxed: effects and evaluation read one definition', () => {
    const ce = new ComputeEngine();
    // `h` has no definition: a free call head, whose home is the top scope.
    const call = ce.box(['Add', ['h', 2], 1]);
    ce.assign('h', ce.box(['Function', ['Multiply', 't', 10], 't']));
    ce.pushScope();
    try {
      // A pushed scope declares another `h`, which draws. It is not on the
      // home chain of the call: the call reads the `h` of the top scope.
      ce.declare('h', 'function');
      ce.assign('h', ce.box(['Function', ['Multiply', 't', ['Random']], 't']));
      expect(call.isPure).toBe(true);
      expect(call.evaluate().toString()).toBe('21');
      expect(call.evaluate().toString()).toBe('21');
    } finally {
      ce.popScope();
    }
  });

  test('the compiled code of such a call calls the definition of its home chain', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const call = ce.box(['Add', ['h', 'x'], 1]);
    ce.assign('h', ce.box(['Function', ['Multiply', 't', 10], 't']));
    ce.pushScope();
    try {
      ce.declare('h', 'function');
      ce.assign('h', ce.box(['Function', ['Add', 't', 1000], 't']));
      const result = compile(call, { to: 'javascript' }) as any;
      expect(result.success).toBe(true);
      expect(result.run({ x: 2 })).toBe(21);
    } finally {
      ce.popScope();
    }
  });

  test('a literal nested in the literal of a block local reads the scope of the block', () => {
    // `h` maps a callback that calls the block local `g`, which draws. A
    // host function `g` of the top scope does not change what the
    // callback calls, and `f`, which calls `h`, draws too.
    const src =
      'function g() { Random() }\nfunction h(s) { [1, 2].map((y) => g()) }\nfunction f(x) { h(x) + 1 }\nf(1)';
    for (const hostG of [false, true]) {
      const ce = new ComputeEngine();
      if (hostG) ce.assign('g', ce.box(['Function', 1]));
      const [program] = parseEpsil(src);
      const expr = ce.box(resolveLibraryNames(program, src, ce));
      const signature = (name: string) =>
        find(
          expr,
          (e) => e.operator === 'DefineFunction' && e.op1.symbol === name
        )!.op2.type.toString();
      expect(signature('h')).toMatch(/^\(s: unknown\) random -> /);
      expect(signature('f')).toMatch(/^\(x: unknown\) random -> /);
    }
  });

  test('a literal that calls a block local whose literal maps a callback carries its draw', () => {
    // A pure `q` at the top; a block local `q` that draws; a local `g`
    // that maps a callback calling `q`; a literal that calls `g`.
    const ce = new ComputeEngine();
    ce.assign('q', ce.box(['Function', ['Multiply', 't', 2], 't']));
    const block = ce.box([
      'Block',
      [
        'Declare',
        'q',
        { str: 'unknown' },
        ['Function', ['Multiply', 't', ['Random']], 't'],
      ],
      [
        'Declare',
        'g',
        { str: 'unknown' },
        ['Function', ['Map', ['Function', ['q', 't'], 't'], ['List', 'x']], 'x'],
      ],
      ['Function', ['g', 'z'], 'z'],
    ]);
    const literal = block.ops[2];
    expect(literal.type.toString()).toMatch(/^\(z: unknown\) random -> /);
    block.evaluate();
    expect(literal.type.toString()).toMatch(/^\(z: unknown\) random -> /);
  });

  test('two calls that read two functions of one name decline', () => {
    // Each call is boxed in its own scope before that scope defines `h`.
    // The compiler looks a head up by its name, and no scope gives both
    // functions: the compilation declines, and the fallback evaluates.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const boxedIn = (body: string) => {
      ce.pushScope();
      try {
        const call = ce.box(['h', 'x']);
        ce.declare('h', 'function');
        ce.parse(`h(t) := ${body}`).evaluate();
        return call;
      } finally {
        ce.popScope();
      }
    };
    const a = boxedIn('10t');
    const b = boxedIn('100t');
    const sum = ce.function('Add', [a, b]);
    const result = compile(sum, { to: 'javascript' }) as any;
    expect(result.success).toBe(false);
    expect(result.diagnostic?.binding).toBe('h');
    expect(result.run({ x: 2 })).toBe(220);
  });

  describe('a compiled call whose head was defined after boxing calls the function of its home chain', () => {
    // `h(x)` is boxed with no `h`; `h(t) := 10t` is defined at the top; a
    // pushed scope declares another `h(t) := t + 1000`. The evaluation reads
    // the `h` of the top scope (20 at x = 2), and so does the compiled code.
    const setup = (declareX: boolean) => {
      const ce = new ComputeEngine();
      if (declareX) ce.declare('x', 'real');
      const call = ce.box(['h', 'x']);
      ce.parse('h(t) := 10t').evaluate();
      ce.pushScope();
      ce.declare('h', 'function');
      ce.parse('h(t) := t + 1000').evaluate();
      return { ce, call };
    };
    test.each([
      ['symbolic', { symbolic: ['x'] }, true],
      ['inputs', { inputs: { x: 'real' } }, false],
      ['no option', {}, true],
    ])('javascript, %s', (_label, options, declareX) => {
      const { ce, call } = setup(declareX as boolean);
      try {
        const result = compile(call, {
          to: 'javascript',
          ...(options as object),
        }) as any;
        expect(result.success).toBe(true);
        expect(result.run({ x: 2 })).toBe(20);
      } finally {
        ce.popScope();
      }
    });
    test('glsl', () => {
      const { ce, call } = setup(true);
      try {
        const result = compile(call, { to: 'glsl' }) as any;
        expect(result.success).toBe(true);
        const code = `${result.preamble ?? ''}\n${result.code}`;
        expect(code).toMatch(/10\.0 \* t/);
        expect(code).not.toMatch(/1000/);
      } finally {
        ce.popScope();
      }
    });
  });

  test('a renamed call of a pure value copy stays shared in the compiled GLSL', () => {
    // `Gamma` shadows the library function: the compiler renames it to a
    // private copy, which holds a value only after the renamed tree is
    // built (`installCopy()`, `shadowing-calls.ts`). The two calls are
    // pure, so they are computed once.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('Gamma', 'function');
    ce.assign('Gamma', ce.parse('t\\mapsto t^2+100'));
    const result = compile(ce.box(['Add', ['Gamma', 'x'], ['Gamma', 'x']]), {
      to: 'glsl',
    }) as any;
    expect(result.success).toBe(true);
    expect(result.code.match(/_fn_Gamma_tmp1\(/g) ?? []).toHaveLength(1);
  });

  describe('a value copy of a function that shadows a library name keeps its declared type', () => {
    // The sequence of Tycho's showcase row rainbow-refraction: `N` (the name
    // of a library function), `b` and `u` are declared with a signature and
    // assigned literals with bare parameters, twice. The compiler copies
    // them (`N_tmp1`); each copy is matched with its declared signature as
    // `ce.declare(name, { type, value })` matches it, so `b` stays real and
    // the GLSL point has real components.
    const setup = () => {
      const ce = new ComputeEngine();
      const signature = '(real | signed_infinity | nan) -> unknown';
      ce.pushScope();
      ce.declare('y_0', 'real');
      ce.declare('a', 'unknown');
      for (const name of ['N', 'b', 'u']) ce.declare(name, { signature });
      for (let k = 0; k < 2; k++) {
        ce.assign('N', [
          'Function',
          ['Block', ['Add', ['Multiply', 0.04, 'ceArg_0'], 1.32]],
          'ceArg_0',
        ]);
        ce.assign('b', [
          'Function',
          ['Block', ['Arcsin', ['Divide', 'y_0', ['N', 'ceArg_0']]]],
          'ceArg_0',
        ]);
        ce.assign('u', [
          'Function',
          ['Block', ['Add', ['Negate', 'a'], ['Multiply', 2, ['b', 'ceArg_0']]]],
          'ceArg_0',
        ]);
      }
      ce.pushScope();
      ce.declare('t', 'real<-0.05..1.05>');
      ce.pushScope();
      ce.declare('a', { type: 'real' });
      ce.declare('t', { type: 'real<-0.05..1.05>' });
      ce.declare('y_0', { type: 'real<-10..10>' });
      const twoAMinusTwoB = ['Add', ['Multiply', 2, 'a'], ['Multiply', -2, ['b', 0.5]]];
      const row = ce.box([
        'Tuple',
        ['Add', ['Multiply', 3, 't', ['Cos', twoAMinusTwoB]], ['Cos', ['u', 0.5]]],
        ['Add', ['Multiply', -3, 't', ['Sin', twoAMinusTwoB]], ['Sin', ['u', 0.5]]],
      ] as any);
      const options = {
        vars: { a: 'a' },
        symbolic: ['t', 'x', 'y', 'y_0', 'v'],
      };
      return { row, options };
    };
    test('glsl', () => {
      const { row, options } = setup();
      const result = compile(row, { to: 'glsl', ...options } as any) as any;
      expect(result.success).toBe(true);
    });
    test('javascript', () => {
      const { row, options } = setup();
      const result = compile(row, {
        to: 'javascript',
        ...options,
        vars: { a: '_.a' },
      } as any) as any;
      expect(result.success).toBe(true);
      const [a, t, y0] = [0.3, 0.5, 0.5];
      const b = Math.asin(y0 / 1.34);
      const u = -a + 2 * b;
      const value = result.run({ a, t, y_0: y0 });
      const [x, y] = Array.from(value as Iterable<number>);
      expect(x).toBeCloseTo(3 * t * Math.cos(2 * a - 2 * b) + Math.cos(u), 10);
      expect(y).toBeCloseTo(Math.sin(u) - 3 * t * Math.sin(2 * a - 2 * b), 10);
    });
  });
});
