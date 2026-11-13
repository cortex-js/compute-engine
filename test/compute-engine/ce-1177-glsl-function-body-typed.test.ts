/**
 * The GLSL emitter writes the body of a user function that the typing pass
 * typed: the body of the entry of the function in the fragment annotation
 * (`FragmentAnnotation.functions`). Each node of that body that the emitter
 * writes has facts in the annotation, or is a statement that the pass
 * checked (`fragmentNodeIsTyped()` in `fragment.ts`).
 *
 * The check records each node that `compile()` writes in a function body
 * (`CompilerState._emitProbe`). A node that is not a node of the typed body
 * (`FragmentTargetFields.fragmentBody`) is a node that emission made: a
 * folded constant, an unrolled term, a temporary of a destructuring. Those
 * are counted apart, and they are not checked here.
 *
 * Before this check, the `define` hook of `gpu-shader-target.ts` prepared a
 * second copy of the body, and none of its nodes had facts. Two rewrites of
 * the definition then differed from the body that the pass typed: the copy
 * of a function typed by the arguments of its call (`(v, j) := step(j)`,
 * where the call of a tuple-valued `step` is replaced by its body only in the
 * typed copy), and a call that stays a call in that copy (`theta_0(x, y)`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { CompilerState } from '../../src/compute-engine/compilation/compiler-state';
import {
  fragmentNodeIsTyped,
  type FragmentTargetFields,
} from '../../src/compute-engine/compilation/fragment';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

type EmitRecord = {
  /** Nodes of a typed body that the emitter wrote. */
  bodyNodes: number;
  /** Nodes of a typed body written without facts. */
  untyped: string[];
  /** Nodes written in a function body that are not of the typed body. */
  made: number;
};

/** Compile `expr` to GLSL and record each node written in a typed body. */
function compileRecorded(
  expr: Expression,
  options: { [key: string]: unknown } = {}
): { result: ReturnType<typeof compile>; record: EmitRecord } {
  const record: EmitRecord = { bodyNodes: 0, untyped: [], made: 0 };
  const nodesOf = new WeakMap<Expression, Set<Expression>>();
  const nodes = (body: Expression): Set<Expression> => {
    let set = nodesOf.get(body);
    if (set === undefined) {
      set = new Set();
      const walk = (e: Expression): void => {
        set!.add(e);
        if (isFunction(e)) for (const op of e.ops) walk(op);
      };
      walk(body);
      nodesOf.set(body, set);
    }
    return set;
  };
  CompilerState._emitProbe = (node, target) => {
    const { fragmentScope: scope, fragmentBody: body } =
      target as FragmentTargetFields<unknown>;
    if (scope === undefined || body === undefined) return;
    if (!nodes(body).has(node)) {
      record.made += 1;
      return;
    }
    record.bodyNodes += 1;
    if (!fragmentNodeIsTyped(scope, node)) record.untyped.push(node.toString());
  };
  try {
    return { result: compile(expr, { to: 'glsl', ...options }), record };
  } finally {
    CompilerState._emitProbe = undefined;
  }
}

function engineWith(definitions: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  executeEpsil(ce, definitions);
  return ce;
}

describe('CE-1177: the GLSL emitter writes the body that the pass typed', () => {
  test.each([
    [
      'a counted loop with `break` (the escape-time loop of burning-ship)',
      [
        'function B(x: real, y: real) -> real {',
        '  let a = 0',
        '  let b = 0',
        '  let n = 0',
        '  for k in 1..128 {',
        '    const t = a*a - b*b + x',
        '    b = 2*abs(a*b) + y',
        '    a = t',
        '    n = k',
        '    if a*a + b*b > 65536 { break }',
        '  }',
        '  if n < 128 { n } else { 0 }',
        '}',
      ].join('\n'),
      ['B', 'x', 'y'],
    ],
    [
      'a `parallel for` with a scalar accumulator',
      [
        'function S(x: real) -> real {',
        '  let s = 0',
        '  parallel for k in 1..10 { s += k * x }',
        '  s',
        '}',
      ].join('\n'),
      ['S', 'x'],
    ],
    [
      'locals declared inside a branch',
      [
        'function C(x: real, y: real) -> real {',
        '  if x < 0 {',
        '    const u = x * 2',
        '    const v = u + y',
        '    v',
        '  } else {',
        '    y',
        '  }',
        '}',
      ].join('\n'),
      ['C', 'x', 'y'],
    ],
    [
      'a function with no declared parameter types, called with reals',
      'h(u) = sin(u * u + 1) * cos(u * u + 1) + u',
      ['h', 'x'],
    ],
  ])('%s', (_, definitions, json) => {
    const ce = engineWith(definitions);
    const { result, record } = compileRecorded(
      ce.box(json as [string, ...string[]])
    );
    expect(result.success).toBe(true);
    expect(record.bodyNodes).toBeGreaterThan(0);
    expect(record.untyped).toEqual([]);
  });

  test('a local declared by a Declare statement', () => {
    // The `Declare` of a local is a statement of the block. The pass checks
    // it in the walk of the block, and records it as a statement.
    const ce = new ComputeEngine();
    ce.declare('a', { signature: '(number) scope -> number' });
    ce.assign(
      'a',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'w', "'unknown'", ['Multiply', 2, 't']],
          ['Add', 'w', 1],
        ],
        't',
      ])
    );
    ce.declare('u', 'real');
    const { result, record } = compileRecorded(ce.box(['a', 'u']));
    expect(result.success).toBe(true);
    expect(record.bodyNodes).toBeGreaterThan(0);
    expect(record.untyped).toEqual([]);
  });

  test('a repeated subexpression of a typed body is shared', () => {
    // The common-subexpression harvest of a function body is opened on the
    // tree that the emitter writes: a harvest of another copy of the body
    // finds no node of the written tree, and shares nothing.
    const ce = engineWith('h(u) = sin(u * u + 1) * cos(u * u + 1) + u');
    const { result, record } = compileRecorded(ce.box(['h', 'x']));
    expect(result.success).toBe(true);
    expect(record.untyped).toEqual([]);
    expect(result.preamble).toMatch(/float _cse\d+ = u \* u;/);
  });

  test('a repeated subexpression is shared in a copy that has no entry', () => {
    // A call with a complex argument is emitted from the complex copy of
    // the function, under a key of its own (`f#complex`). The pass has no
    // entry under that key, so the `define` hook compiles the stored body,
    // and opens the harvest on that body.
    const ce = new ComputeEngine();
    ce.declare('w', 'complex');
    executeEpsil(ce, 'f(u) = exp(u * u + 1) * (u * u + 1) + u');
    const { result } = compileRecorded(ce.box(['f', 'w']));
    expect(result.success).toBe(true);
    expect(result.preamble).toMatch(
      /vec2 _fn_f_complex\(vec2 u\) \{\n {2}vec2 _cse\d+ = _gpu_cmul\(u, u\);/
    );
  });

  test('a call of a tuple-valued function in a loop, destructured', () => {
    // `g` is called with a number, so the emitter writes the copy of `g`
    // whose parameter is typed `number`. In that copy the local `j` is a
    // number, and the call `step(j)` is replaced by the body of `step`. The
    // pass prepares its body from the same copy.
    const ce = engineWith(
      [
        'step(i) = (i + 1, i * 2)',
        'function g(k) {',
        '  let v = 0',
        '  let j = k',
        '  for n in 1..3 {',
        '    (v, j) := step(j)',
        '  }',
        '  100*v + j',
        '}',
      ].join('\n')
    );
    const { result, record } = compileRecorded(ce.box(['g', 1]), {
      constantFold: false,
    });
    expect(result.success).toBe(true);
    expect(result.preamble).not.toContain('_fn_step');
    expect(record.bodyNodes).toBeGreaterThan(0);
    expect(record.untyped).toEqual([]);
  });

  test('a scalar call that stays a call in the copy typed by the arguments', () => {
    // `p` is called with reals, so the emitter writes the copy of `p` whose
    // parameters are typed `number`. There the call `theta_0(x, y)` is a
    // number and stays a call; in the definition, whose parameters have no
    // type, it would be replaced by its body.
    const ce = new ComputeEngine();
    ce.declare('theta_0', {
      signature: '(unknown, unknown) -> broadcastable<number>',
    });
    ce.assign('theta_0', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
    ce.declare('p', {
      signature:
        '(unknown, unknown) -> tuple<broadcastable<number>, broadcastable<number>>',
    });
    ce.assign(
      'p',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'theta', "'unknown'", ['theta_0', 'x', 'y']],
          ['Tuple', ['Cos', 'theta'], ['Sin', 'theta']],
        ],
        'x',
        'y',
      ])
    );
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const { result, record } = compileRecorded(ce.box(['p', 'x', 'y']));
    expect(result.success).toBe(true);
    expect(result.preamble).toMatch(/theta = _fn_theta_0\(x, y\)/);
    expect(record.bodyNodes).toBeGreaterThan(0);
    expect(record.untyped).toEqual([]);
  });

  test('a list parameter bound to a list input in a texture', () => {
    // The call reaches the variant of `g` with no parameter for `H`
    // (`g#bind…`): its body reads `H` by name.
    const ce = engineWith(
      'function g(H: list<integer>, x: real) -> real { H[1600] * x }'
    );
    ce.declare('H', 'list<real^1600>');
    const { result, record } = compileRecorded(ce.box(['g', 'H', 'x']), {
      storage: { H: 'sampler2D' },
    });
    expect(result.success).toBe(true);
    expect(record.bodyNodes).toBeGreaterThan(0);
    expect(record.untyped).toEqual([]);
  });
});
