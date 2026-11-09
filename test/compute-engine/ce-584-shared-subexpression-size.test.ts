/**
 * CE-584: the shader targets wrote a node that several paths reach once for
 * each path when the common-subexpression pass did not bind it, and the code
 * grew exponentially with the depth of the expression.
 *
 * The witness is `e_{k+1} = e_k + sin(e_k)` with `e_0 = x + c`: 2k + 2
 * distinct nodes, 2^k paths to `e_0`. A `vars` entry can map a parameter
 * to a field of a struct (`vars: { c: 'p.c' }`), and the pass did not share
 * a node that reads a `vars` source other than a bare identifier, so at
 * depth 20 the shader code had 24 MB and took 25 seconds.
 *
 * Two changes:
 * - on the shader targets, a `vars` source that is a read path (an
 *   identifier with field accesses and literal indexes: `ce_params.c`,
 *   `u.x`, `v[0]`) is a plain read, which the pass shares
 *   (`isOpaqueVarsSource()`, `cse.ts`). Other source (`f()`) stays opaque,
 *   and so does every string source on the JavaScript targets, where a
 *   property can be a getter;
 * - the shader targets refuse an expression whose code would have more than
 *   50,000 nodes (`gpuWrittenSize()`, `gpu-written-size.ts`), before they
 *   write it.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { gpuWrittenSize } from '../../src/compute-engine/compilation/gpu-written-size';
import { cseRecordingRules } from '../../src/compute-engine/compilation/cse';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('c', 'real');
  return ce;
}

/** `e_depth`, with `e_0 = x + c` and `e_{k+1} = e_k + sin(e_k)`. */
function dag(ce: ComputeEngine, depth: number): Expression {
  let e = ce.function('Add', [ce.symbol('x'), ce.symbol('c')]);
  for (let i = 0; i < depth; i++)
    e = ce.function('Add', [e, ce.function('Sin', [e])]);
  return e;
}

/** `e_{k+1} = If(x > k, e_k, sin(e_k))`: the two branches read `e_k`. */
function branchDag(ce: ComputeEngine, depth: number): Expression {
  let e = ce.function('Add', [ce.symbol('x'), ce.symbol('c')]);
  for (let i = 0; i < depth; i++)
    e = ce.function('If', [
      ce.function('Greater', [ce.symbol('x'), ce.number(i)]),
      e,
      ce.function('Sin', [e]),
    ]);
  return e;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function timed<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
}

const LIMIT_MESSAGE =
  /Could not compile: the GLSL code for this expression would have more than 50,000 nodes/;

describe('CE-584: a vars source that is a read path is shared', () => {
  test.each(['glsl'] as const)(
    '%s: compile() with vars { c: "p.c" } at depth 20',
    (to) => {
      const ce = engine();
      const e = dag(ce, 20);
      const [r, ms] = timed(() => compile(e, { to, vars: { c: 'p.c' } }));
      expect(r.success).toBe(true);
      expect(r.code.length).toBeLessThan(10_000);
      expect(ms).toBeLessThan(5_000);
      expect(count(r.code, 'p.c')).toBe(21);
    }
  );

  test.each(['glsl'] as const)('%s: a literal index is a read path', (to) => {
    const ce = engine();
    const r = compile(dag(ce, 6), { to, vars: { c: 'v[0]' } });
    expect(r.success).toBe(true);
    expect(count(r.code, 'v[0]')).toBe(7);
  });

  // Other source stays opaque: the code writes it once for each path. At
  // depth 6, `e_0` is reached by 2^6 = 64 paths.
  test.each(['glsl'] as const)(
    '%s: a call or an expression stays opaque',
    (to) => {
      const ce = engine();
      for (const source of ['f()', 'p.c + 1', 'v[i]']) {
        const r = compile(dag(ce, 6), { to, vars: { c: source } });
        expect(r.success).toBe(true);
        expect(count(r.code, source)).toBe(64);
      }
    }
  );

  // On the JavaScript target a property read can be a getter, so a read
  // path stays opaque there.
  test('javascript: a read path stays opaque', () => {
    const ce = engine();
    const r = compile(dag(ce, 6), { to: 'javascript', vars: { c: 'p.c' } });
    expect(r.success).toBe(true);
    expect(count(r.code, 'p.c')).toBe(64);
  });

  // The read path `k.x` reads the variable `k`, which the code declares:
  // the shader would read the local, not the uniform the host meant.
  test.each(['glsl'] as const)(
    '%s: a read path whose variable the code declares is refused',
    (to) => {
      const ce = engine();
      ce.declare('a', 'real');
      const block = ce.box([
        'Block',
        ['Declare', 'k', "'real'", ['Add', 'x', 1]],
        ['Add', 'a', 'k'],
      ] as never);
      const r = compile(block, { to, vars: { a: 'k.x' }, fallback: true });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /the `vars` entry for `a` reads the uniform `k`, but the compiled code declares or writes the symbol `k`/
      );
      const other = compile(block, { to, vars: { a: 'u.x' } });
      expect(other.success).toBe(true);
    }
  );
});

describe('CE-584: the size limit of the shader code', () => {
  test.each(['glsl'] as const)(
    '%s: a graph through an opaque source declines',
    (to) => {
      const ce = engine();
      // Depth 12 writes 81,907 characters and is under the limit.
      expect(compile(dag(ce, 12), { to, vars: { c: 'f()' } }).success).toBe(
        true
      );
      const [r, ms] = timed(() =>
        compile(dag(ce, 20), { to, vars: { c: 'f()' }, fallback: true })
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(LIMIT_MESSAGE);
      expect(ms).toBeLessThan(5_000);
    }
  );

  test.each(['glsl'] as const)(
    '%s: a graph through the branches of an If declines',
    (to) => {
      const ce = engine();
      expect(compile(branchDag(ce, 8), { to }).success).toBe(true);
      const [r, ms] = timed(() =>
        compile(branchDag(ce, 30), { to, fallback: true })
      );
      expect(r.success).toBe(false);
      expect(r.error).toMatch(LIMIT_MESSAGE);
      expect(ms).toBeLessThan(5_000);
    }
  );

  test('glsl: with cse: false, a shared graph declines', () => {
    const ce = engine();
    const r = compile(dag(ce, 20), { to: 'glsl', cse: false, fallback: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(LIMIT_MESSAGE);
    expect(compile(dag(ce, 20), { to: 'glsl' }).success).toBe(true);
  });

  // `compileShader()` has no common-subexpression pass: each path is
  // written. Depth 16 wrote 1.5 MB of shader code in 0.9 s.
  test('glsl: compileShader() declines a body above the limit', () => {
    const ce = engine();
    const shader = (depth: number) =>
      new GLSLTarget().compileShader({
        type: 'fragment',
        inputs: [{ name: 'x', type: 'float' }],
        uniforms: [{ name: 'c', type: 'float' }],
        outputs: [{ name: 'o', type: 'float' }],
        body: [{ variable: 'o', expression: dag(ce, depth) }],
      });
    expect(shader(8)).toContain('void main');
    expect(() => shader(16)).toThrow(
      /Could not compile `compileShader\(\)`: the GLSL code of the body statements would have more than 50,000 nodes/
    );
  });

  // The body of a user-defined function is checked too, as a definition
  // (with its own common-subexpression pass) and as a body substituted at a
  // call site (with none). The depths are small because the canonical form
  // of a function literal unfolds a graph into a tree: at depth 20 the
  // assignment of `h` alone runs out of memory, before any compilation.
  function engineWithH(body: (ce: ComputeEngine, t: Expression) => Expression) {
    const ce = engine();
    const t = ce.symbol('t');
    ce.declare('h', '(real) -> real');
    ce.assign('h', ce.function('Function', [body(ce, t), t]));
    return ce;
  }
  function chain(
    ce: ComputeEngine,
    t: Expression,
    depth: number,
    branches: boolean
  ): Expression {
    let e = ce.function('Add', [t, ce.symbol('c')]);
    for (let i = 0; i < depth; i++)
      e = branches
        ? ce.function('If', [
            ce.function('Greater', [t, ce.number(i)]),
            e,
            ce.function('Sin', [e]),
          ])
        : ce.function('Add', [e, ce.function('Sin', [e])]);
    return e;
  }
  const FUNCTION_LIMIT_MESSAGE =
    /Could not compile: the GLSL code of the user-defined functions that the expression calls would have more than 50,000 nodes/;

  test('glsl: a user function whose body is a graph is shared', () => {
    const ce = engineWithH((ce, t) => chain(ce, t, 14, false));
    const [r, ms] = timed(() => compile(ce.parse('h(x)'), { to: 'glsl' }));
    expect(r.success).toBe(true);
    expect(r.code).toBe('_fn_h(x)');
    expect(r.preamble!.length).toBeLessThan(10_000);
    expect(ms).toBeLessThan(10_000);
  });

  test('glsl: a user function whose body is an If chain declines', () => {
    const ce = engineWithH((ce, t) => chain(ce, t, 14, true));
    const r = compile(ce.parse('h(x)'), { to: 'glsl', fallback: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(FUNCTION_LIMIT_MESSAGE);
  });

  test('glsl: a user function whose body reads an opaque source declines', () => {
    const ce = engineWithH((ce, t) => chain(ce, t, 14, false));
    const r = compile(ce.parse('h(x)'), {
      to: 'glsl',
      vars: { c: 'f()' },
      fallback: true,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(FUNCTION_LIMIT_MESSAGE);
  });

  // A node that holds an operator the caller replaces (the `functions`
  // option) is not shared: the caller's code receives its operands as text.
  // `g` has a pure definition, so the node is pure, and the estimate must
  // read the option. At depth 14 the code has 16,383 calls of `myG` (213 KB),
  // and the estimate is 49,154 nodes.
  test('glsl: a graph through an operator the caller replaces declines', () => {
    const ce = engine();
    ce.declare('g', '(real) -> real');
    ce.assign('g', ce.box(['Function', ['Square', 't'], 't'] as never));
    const graph = (depth: number) => {
      let e = ce.function('Add', [ce.symbol('x'), ce.symbol('c')]);
      for (let i = 0; i < depth; i++)
        e = ce.function('Add', [e, ce.function('g', [e])]);
      return e;
    };
    const small = compile(graph(10), { to: 'glsl', functions: { g: 'myG' } });
    expect(small.success).toBe(true);
    expect(count(small.code, 'myG(')).toBe(2 ** 10 - 1);
    const r = compile(graph(16), {
      to: 'glsl',
      functions: { g: 'myG' },
      fallback: true,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(LIMIT_MESSAGE);
  });

  // An operator that the caller declares with a compile handler is not in
  // the GLSL fragment, so a small graph declines with the fragment message.
  // The size limit is checked first, when the tree is prepared, so a large
  // graph declines with the limit message. (The `functions` option, in the
  // test above, is the way to give a shader function for a head.)
  test('glsl: a graph through an operator with a compile handler declines', () => {
    const ce = engine();
    ce.declare('G', {
      signature: '(number) -> number',
      pure: true,
      compile: (args, compile) => `sin(${compile(args[0])})`,
    } as never);
    const graph = (depth: number) => {
      let e = ce.function('Add', [ce.symbol('x'), ce.symbol('c')]);
      for (let i = 0; i < depth; i++)
        e = ce.function('Add', [e, ce.function('G', [e])]);
      return e;
    };
    const small = compile(graph(8), { to: 'glsl', fallback: true });
    expect(small.success).toBe(false);
    expect(small.diagnostic?.code).toBe('outside-fragment');
    expect(small.error).toBe('The head `G` is outside the GLSL fragment.');
    const r = compile(graph(16), { to: 'glsl', fallback: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(LIMIT_MESSAGE);
  });

  // `e_{k+1} = Arctan2(e_k, If(x > k, e_k, 0))`: the first operand writes
  // `e_k`, and the branch of the `If` reads its temporary, so the code is
  // linear in the depth. An estimate that counted `e_k` again in each
  // branch passed the limit at depth 14 (57,339 nodes). The compilation is
  // checked at depth 10: the harvest of the common-subexpression pass takes
  // a time exponential in the depth for this graph (1.6 s at depth 12,
  // 36 s at depth 14), which is a separate defect.
  test('glsl: a node written before a branch is not counted again in it', () => {
    const ce = engine();
    const graph = (depth: number) => {
      let e = ce.function('Sin', [ce.symbol('x')]);
      for (let i = 0; i < depth; i++)
        e = ce.function('Arctan2', [
          e,
          ce.function('If', [
            ce.function('Greater', [ce.symbol('x'), ce.number(i)]),
            e,
            ce.number(0),
          ]),
        ]);
      return e;
    };
    for (const depth of [14, 20, 40]) {
      const e = graph(depth);
      expect(gpuWrittenSize(e, cseRecordingRules(e))).toBeLessThan(20 * depth);
    }
    const r = compile(graph(10), { to: 'glsl' });
    expect(r.success).toBe(true);
    expect(r.code.length).toBeLessThan(2_000);
    expect(count(r.code, 'sin(')).toBe(1);
  });

  // `If(condition, value)` writes its condition first, so in
  // `e_{k+1} = If(e_k > k, sin(e_k))` the condition writes `e_k` and the
  // value reads its temporary. An estimate that walked the operands in
  // their index order counted `e_k` again in the value and refused depth
  // 16. The compilation is checked at depth 8: as for `Arctan2` above, the
  // harvest of the pass takes a time exponential in the depth.
  test('glsl: the condition of a When is written before its value', () => {
    const ce = engine();
    const graph = (depth: number) => {
      let e = ce.function('Sin', [ce.symbol('x')]);
      for (let i = 0; i < depth; i++)
        e = ce.function('If', [
          ce.function('Greater', [e, ce.number(i)]),
          ce.function('Sin', [e]),
        ]);
      return e;
    };
    for (const depth of [16, 30]) {
      const e = graph(depth);
      expect(gpuWrittenSize(e, cseRecordingRules(e))).toBeLessThan(20 * depth);
    }
    // The GLSL fragment refuses an `If` that is a value and has one branch.
    const r = compile(graph(8), { to: 'glsl' });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('outside-fragment');
  });

  // Below an operator that the caller replaces, the pass shares nothing:
  // the caller's code receives the operand as text. The graph of depth 20
  // is small on its own, and written as a tree inside `myCos(…)`.
  test('glsl: a graph below an operator the caller replaces declines', () => {
    const ce = engine();
    const wrapped = (depth: number) => ce.function('Cos', [dag(ce, depth)]);
    const small = compile(wrapped(6), {
      to: 'glsl',
      functions: { Cos: 'myCos' },
    });
    expect(small.success).toBe(true);
    expect(small.code).toContain('myCos(');
    const r = compile(wrapped(20), {
      to: 'glsl',
      functions: { Cos: 'myCos' },
      fallback: true,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(LIMIT_MESSAGE);
    // Without the replacement, the same graph is shared and compiles.
    expect(compile(wrapped(20), { to: 'glsl' }).success).toBe(true);
  });

  // The pass shares no node between the bodies of two binders, and the
  // body of a binder does not read a temporary of the code around it: in
  // `e_{k+1} = Sum(j·e_k, j, 1, N) + Sum(j + e_k, j, 1, N)` each body
  // writes `e_k` again, and the code grows by 4 every two levels (59,391
  // characters at depth 8). A single `Sum` whose body is a shared graph
  // binds the graph inside its body.
  test('glsl: nested binders over one subtree decline', () => {
    const ce = engine();
    ce.declare('N', 'integer');
    const sum = (body: Expression, j: string) =>
      ce.function('Sum', [
        body,
        ce.function('Limits', [ce.symbol(j), ce.number(1), ce.symbol('N')]),
      ]);
    const nested = (depth: number) => {
      let e = ce.function('Add', [ce.symbol('x'), ce.symbol('c')]);
      for (let i = 0; i < depth; i++) {
        const j = `j${i}`;
        e = ce.function('Add', [
          sum(ce.function('Multiply', [ce.symbol(j), e]), j),
          sum(ce.function('Add', [ce.symbol(j), e]), j),
        ]);
      }
      return e;
    };
    expect(compile(nested(4), { to: 'glsl' }).success).toBe(true);
    const r = compile(nested(12), { to: 'glsl', fallback: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(LIMIT_MESSAGE);

    const single = compile(
      sum(ce.function('Multiply', [ce.symbol('j'), dag(ce, 20)]), 'j'),
      { to: 'glsl' }
    );
    expect(single.success).toBe(true);
    expect(single.code.length).toBeLessThan(10_000);
  });

  // The shader targets write every operand of a restriction, also when its
  // condition is `False`: no form leaves an operand out of the count. So the
  // graph below `If(False, value)` is counted as a tree, and the compile
  // declines at the size limit (a decline falls back to the interpreter).
  test('glsl: every operand of a decided restriction is counted', () => {
    const ce = engine();
    const e = ce.function('If', [ce.False, dag(ce, 20)]);
    const r = compile(e, { to: 'glsl', cse: false, fallback: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(LIMIT_MESSAGE);
    expect(gpuWrittenSize(e, undefined)).toBeGreaterThan(50_000);
    // A restriction that the caller replaces also receives all its operands.
    const replaced = compile(e, {
      to: 'glsl',
      cse: false,
      functions: { If: 'myWhen' },
      fallback: true,
    });
    expect(replaced.success).toBe(false);
    expect(replaced.error).toMatch(LIMIT_MESSAGE);
  });

  // Each read of a node written before costs one node. `Max` of 1,000
  // copies of `x` is written once in each branch of a chain of ten `If`
  // (1,024 copies), with 1,000 reads of `x` in each.
  test('glsl: the reads of a node written before are counted', () => {
    const ce = engine();
    const x = ce.symbol('x');
    const chain = (depth: number) => {
      let e = ce.function(
        'Max',
        Array.from({ length: 1_000 }, () => x)
      );
      for (let i = 0; i < depth; i++)
        e = ce.function('If', [
          ce.function('Greater', [x, ce.number(i)]),
          e,
          ce.function('Sin', [e]),
        ]);
      return e;
    };
    expect(compile(chain(2), { to: 'glsl' }).success).toBe(true);
    const r = compile(chain(10), { to: 'glsl', fallback: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(LIMIT_MESSAGE);
  });

  // The argument `p`, a pair of booleans, has no type in the GLSL fragment,
  // so the expression declines before the size limit applies.
  test('glsl: the bodies written at many call sites decline together', () => {
    const ce = engine();
    ce.declare('p', 'tuple<boolean, boolean>');
    const t = ce.symbol('t');
    let body = t;
    for (let i = 0; i < 8; i++)
      body = ce.function('Add', [body, ce.function('Sin', [body])]);
    ce.declare('h', '(tuple<boolean,boolean>, real) -> real');
    ce.assign('h', ce.function('Function', [body, ce.symbol('b'), t]));
    const sites = (n: number) =>
      ce.function(
        'Add',
        Array.from({ length: n }, (_, i) =>
          ce.function('h', [
            ce.symbol('p'),
            ce.function('Add', [ce.symbol('c'), ce.number(i + 1)]),
          ])
        )
      );
    for (const n of [10, 60]) {
      const r = compile(sites(n), {
        to: 'glsl',
        vars: { c: 'f()' },
        fallback: true,
      });
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('outside-fragment');
      expect(r.error).toMatch(
        /The symbol `p` has the type `tuple<boolean, boolean>`, which has no type in the GLSL fragment/
      );
    }
  });

  test('the estimate follows the code size', () => {
    const ce = engine();
    const e = dag(ce, 20);
    // The number of nodes of the tree that the graph unfolds to.
    const sizes = new Map<Expression, number>();
    const treeSize = (node: Expression): number => {
      let size = sizes.get(node);
      if (size === undefined) {
        size = 1;
        for (const op of node.ops ?? []) size += treeSize(op);
        sizes.set(node, size);
      }
      return size;
    };
    expect(treeSize(e)).toBeGreaterThan(1_000_000);
    // Each `e_k` and `sin(e_k)` is bound and written once.
    expect(gpuWrittenSize(e, cseRecordingRules(e))).toBeLessThan(500);
    // Every node reads `c`, or the pass is off: nothing is bound, and the
    // estimate is the size of the tree.
    const opaqueC = cseRecordingRules(e, {
      isStringVar: (name) => name === 'c',
    });
    expect(gpuWrittenSize(e, opaqueC)).toBe(treeSize(e));
    expect(gpuWrittenSize(e, undefined)).toBe(treeSize(e));
  });
});
