/**
 * `WGSLTarget.compileKernel()`: a compute shader that runs one pass of an
 * Epsil `parallel for` loop or parallel comprehension in each invocation
 * (CE-1075, `docs/plans/2026-11-07-ce1093-parallel-for.md` §6).
 *
 * Jest runs no shader, so the tests pin the emitted text, the bindings and
 * the range of the kernel, and each decline. The witness, the `step` of the
 * Buddhabrot picture, was run on WebGPU through Playwright and Chromium
 * with the Metal adapter, and its counts were compared with a JavaScript
 * copy of the step in `f32` arithmetic (`Math.fround`): the record is in
 * the commit message of this change.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const wgsl = new WGSLTarget();

/** The boxed expression of an Epsil statement. */
function epsil(ce: ComputeEngine, source: string): Expression {
  const [ast, diagnostics] = parseEpsil(source);
  expect(diagnostics).toEqual([]);
  return ce.box(resolveLibraryNames(ast as never, source, ce) as never);
}

/** The first `ParallelLoop` or `ParallelComprehension` node of `expr`. */
function parallelNode(expr: Expression): Expression {
  const found = (e: Expression): Expression | undefined => {
    if (!isFunction(e)) return undefined;
    if (
      e.operator === 'ParallelLoop' ||
      e.operator === 'ParallelComprehension'
    )
      return e;
    for (const op of e.ops) {
      const f = found(op);
      if (f !== undefined) return f;
    }
    return undefined;
  };
  const node = found(expr);
  if (node === undefined) throw new Error('no parallel loop in the program');
  return node;
}

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<integer^10>');
  ce.declare('R', 'list<real^10>');
  ce.declare('n', 'integer');
  ce.declare('x', 'real');
  ce.declare('s', 'integer');
  return ce;
}

/** The message of the decline of `source`, or `''` when it compiles. */
function declineOf(
  ce: ComputeEngine,
  source: string,
  options?: Parameters<WGSLTarget['compileKernel']>[1]
): string {
  const r = wgsl.compileKernel(epsil(ce, source), options);
  return r.success ? '' : (r.diagnostic?.message ?? 'no message');
}

describe('a parallel loop that adds to a list', () => {
  const ce = engine();
  const r = wgsl.compileKernel(
    epsil(ce, 'parallel for k in 1..n { L[k % 10 + 1] += 1; if x > 0.5 { L[1] += 2 } }')
  );

  test('compiles to a compute entry point that runs one pass per invocation', () => {
    expect(r.success).toBe(true);
    expect(r.entryPoint).toBe('main');
    expect(r.workgroupSize).toBe(64);
    expect(r.code).toContain(
      '@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) _gpu_gid: vec3u) {\n' +
        '  let k: i32 = 1 + i32(_gpu_gid.x);\n' +
        '  if (k <= i32(ce_params.n)) {\n'
    );
  });

  test('each `+=` is an atomic addition through the helper of the accumulator', () => {
    expect(r.code).toContain('_gpu_kadd_L(_gpu_fmod(f32(k), 10.0) + 1.0, 1.0);');
    // A `+=` in an else-less `if` is a statement of the branch.
    expect(r.code).toContain('if (0.5 < ce_params.x) {\n      _gpu_kadd_L(1.0, 2.0);\n    }');
    expect(r.code).toContain('fn _gpu_kadd_L(_gpu_i: f32, _gpu_v: f32) {');
    expect(r.code).toContain('atomicAdd(&L.data[_gpu_j], i32(_gpu_v));');
    // The guards of the index rules of `At`, and the helper they call.
    expect(r.code).toContain('_gpu_isnonfinite(_gpu_i)');
    expect(r.code).toContain('fn _gpu_isnonfinite(x: f32) -> bool');
  });

  test('declares the accumulator as a read-write storage buffer of atomics', () => {
    expect(r.code).toContain(
      'struct CE_List_atomic_i32 { len: u32, data: array<atomic<i32>> }\n' +
        '@group(0) @binding(1) var<storage, read_write> L: CE_List_atomic_i32;'
    );
    expect(r.code).toContain(
      'struct CEParams {\n  n: f32,\n  x: f32,\n}\n@group(0) @binding(0) var<uniform> ce_params: CEParams;'
    );
  });

  test('reports the bindings, the range and the parameters', () => {
    expect(r.bindings).toEqual([
      {
        kind: 'parameters',
        symbol: 'ce_params',
        name: 'ce_params',
        group: 0,
        binding: 0,
        wgslType: 'CEParams',
        minBindingSize: 16,
      },
      {
        kind: 'accumulator',
        symbol: 'L',
        name: 'L',
        group: 0,
        binding: 1,
        wgslType: 'CE_List_atomic_i32',
        ceType: 'vector<integer^10>',
        dataOffset: 4,
        stride: 4,
        length: 10,
        minBindingSize: 8,
      },
    ]);
    expect(r.range).toEqual({ lower: 1, upper: 'n' });
    expect(r.params).toEqual([
      { name: 'n', ceType: 'integer', wgslType: 'f32', offset: 0, size: 4 },
      { name: 'x', ceType: 'real', wgslType: 'f32', offset: 4, size: 4 },
    ]);
    expect(r.paramsSize).toBe(16);
    expect(r.paramsStructSource).toBe('struct CEParams {\n  n: f32,\n  x: f32,\n}\n');
  });
});

describe('the other forms of a kernel', () => {
  test('an integer accumulator is one atomic', () => {
    const r = wgsl.compileKernel(
      epsil(engine(), 'parallel for k in 1..n { if k > 3 { s += k } }')
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('@group(0) @binding(1) var<storage, read_write> s: atomic<i32>;');
    expect(r.code).toContain('if (3.0 < f32(k)) {\n      atomicAdd(&s, i32(f32(k)));\n    }');
    expect(r.bindings[1]).toEqual({
      kind: 'accumulator',
      symbol: 's',
      name: 's',
      group: 0,
      binding: 1,
      wgslType: 'atomic<i32>',
      ceType: 'integer',
      minBindingSize: 4,
    });
  });

  test('a parallel comprehension writes the element of its pass to the result buffer', () => {
    const r = wgsl.compileKernel(epsil(engine(), '[k^2 + x parallel for k in 1..n]'));
    expect(r.success).toBe(true);
    expect(r.code).toContain(
      'struct CE_List_f32 { len: u32, data: array<f32> }\n' +
        '@group(0) @binding(1) var<storage, read_write> ce_result: CE_List_f32;'
    );
    expect(r.code).toContain(
      '  if (k <= i32(ce_params.n)) {\n    ce_result.data[_gpu_gid.x] = _gpu_pow2(f32(k)) + ce_params.x;\n  }'
    );
    expect(r.bindings[1]).toEqual({
      kind: 'result',
      symbol: 'ce_result',
      name: 'ce_result',
      group: 0,
      binding: 1,
      wgslType: 'CE_List_f32',
      ceType: 'list<real>',
      dataOffset: 4,
      stride: 4,
      minBindingSize: 8,
    });
  });

  test('a list that the passes read is a storage buffer of a hint, and the kernel takes the other bindings', () => {
    const r = wgsl.compileKernel(
      epsil(engine(), 'parallel for k in 1..n { s += floor(R[k]) }'),
      { storage: { R: { kind: 'storage-buffer', group: 0, binding: 0 } } }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('@group(0) @binding(0) var<storage, read> R: CE_List_f32;');
    expect(r.code).toContain('@group(0) @binding(1) var<uniform> ce_params: CEParams;');
    expect(r.code).toContain('@group(0) @binding(2) var<storage, read_write> s: atomic<i32>;');
    expect(r.code).toContain('atomicAdd(&s, i32(floor(_gpu_sbat_R(f32(k)))));');
    expect(r.bindings.map((b) => [b.kind, b.binding])).toEqual([
      ['parameters', 1],
      ['accumulator', 2],
      ['list', 0],
    ]);
  });

  test('a guard of the loop clause is a test of the pass', () => {
    const ce = engine();
    const r = wgsl.compileKernel(
      ce.box([
        'ParallelLoop',
        ['Block', ['AddTo', 's', 'k']],
        ['Element', 'k', ['Range', 1, 'n'], ['Greater', 'k', 2]],
      ] as never)
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain(
      '  if (k <= i32(ce_params.n)) {\n    if (2.0 < f32(k)) {\n      atomicAdd(&s, i32(f32(k)));\n    }\n  }'
    );
  });

  test('integer literal bounds, the entry point name, the workgroup size and the group are options', () => {
    const r = wgsl.compileKernel(epsil(engine(), 'parallel for k in 3..12 { s += k }'), {
      name: 'count',
      workgroupSize: 256,
      group: 2,
    });
    expect(r.success).toBe(true);
    expect(r.range).toEqual({ lower: 3, upper: 12 });
    expect(r.code).toContain('@compute @workgroup_size(256)\nfn count(');
    expect(r.code).toContain('let k: i32 = 3 + i32(_gpu_gid.x);\n  if (k <= 12) {');
    expect(r.code).toContain('@group(2) @binding(0) var<storage, read_write> s: atomic<i32>;');
    // No parameter: no struct.
    expect(r.params).toEqual([]);
    expect(r.paramsStructSource).toBe('');
    expect(r.code).not.toContain('CEParams');
  });
});

describe('the declines of a kernel', () => {
  test('a read of an accumulator in a pass', () => {
    expect(declineOf(engine(), 'parallel for k in 1..n { L[k] += L[1] }')).toContain(
      'a pass reads the accumulator "L"'
    );
  });

  test('an accumulator that is not a list of integers or an integer', () => {
    expect(declineOf(engine(), 'parallel for k in 1..n { R[k] += 1 }')).toContain(
      'the body adds to "R" with `+=`, and "R" has the type `vector<real^10>`'
    );
  });

  test('a `+=` of a non-integer amount', () => {
    expect(declineOf(engine(), 'parallel for k in 1..n { s += x }')).toContain(
      'the amount `x` of `+=` has the type `real`'
    );
  });

  test('a bound that is not an integer literal or an integer parameter', () => {
    expect(declineOf(engine(), 'parallel for k in 1..x { s += k }')).toContain(
      'the upper bound "x" of the range has the type `real`'
    );
    expect(declineOf(engine(), 'parallel for k in 1..(2*n) { s += k }')).toContain(
      'the upper bound of the range is `2n`'
    );
  });

  test('a list that the passes read with no storage hint', () => {
    expect(declineOf(engine(), 'parallel for k in 1..n { s += floor(R[k]) }')).toContain(
      "`storage: { R: { kind: 'storage-buffer', group, binding } }`"
    );
  });

  test('a pass that draws a random value', () => {
    expect(declineOf(engine(), 'parallel for k in 1..n { L[k] += randomInteger(1, 3) }')).toContain(
      'a pass draws a random value'
    );
  });

  test('a comprehension with a guard, a domain that is not a range, a step, two clauses', () => {
    expect(declineOf(engine(), '[k parallel for k in 1..n if k > 2]')).toContain(
      'the comprehension has the guard `2 < k`'
    );
    const overList = wgsl.compileKernel(
      engine().box([
        'ParallelLoop',
        ['Block', ['AddTo', 's', 'k']],
        ['Element', 'k', 'L'],
      ] as never)
    );
    expect(overList.diagnostic?.message).toContain('the domain is `L`');
    const stepped = wgsl.compileKernel(
      engine().box([
        'ParallelLoop',
        ['Block', ['AddTo', 's', 'k']],
        ['Element', 'k', ['Range', 1, 'n', 2]],
      ] as never)
    );
    expect(stepped.diagnostic?.message).toContain('a range with no step');
    const twoClauses = wgsl.compileKernel(
      engine().box([
        'ParallelLoop',
        ['Block', ['AddTo', 's', ['Multiply', 'k', 'j']]],
        ['Element', 'k', ['Range', 1, 'n']],
        ['Element', 'j', ['Range', 1, 3]],
      ] as never)
    );
    expect(twoClauses.diagnostic?.message).toContain('has 2 clauses, and a kernel has one');
  });

  test('an expression that is not a parallel loop, and a parallel loop inside the pass', () => {
    expect(declineOf(engine(), 'for k in 1..n { s += k }')).toContain(
      'the expression is a `Loop`'
    );
    expect(
      declineOf(engine(), 'parallel for k in 1..n { parallel for j in 1..3 { s += k * j } }')
    ).toContain('a `parallel for` loop or comprehension inside the pass is not compiled');
  });

  test('a `Return` that leaves the pass, and a comprehension whose element is not a number', () => {
    const ce = engine();
    const returning = wgsl.compileKernel(
      ce.box([
        'ParallelLoop',
        ['Block', ['Return', 1], ['AddTo', 's', 'k']],
        ['Element', 'k', ['Range', 1, 'n']],
      ] as never)
    );
    expect(returning.diagnostic?.message).toContain('a `Return` leaves the pass');
    // A text element declines in `compile()` itself (the shader languages
    // have no text type); a boolean element reaches the check of the kernel.
    expect(declineOf(ce, '[k > 2 parallel for k in 1..n]')).toContain(
      'the element of the comprehension has the WGSL type `bool`'
    );
  });

  test('an accumulator or a parameter whose name the module declares, or a predeclared WGSL name', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.declare('max', 'integer');
    ce.declare('main', 'integer');
    expect(declineOf(ce, 'parallel for k in 1..n { max += k }')).toContain(
      '"max" is the name of a predeclared function or type of WGSL'
    );
    expect(declineOf(ce, 'parallel for k in 1..n { main += k }')).toContain(
      '"main" is the name of a predeclared function'
    );
  });

  test('an index named like a predeclared WGSL function, and a guard that is not a boolean', () => {
    const ce = engine();
    expect(declineOf(ce, 'parallel for length in 1..n { s += length }')).toContain(
      'the index "length" cannot be the name of a WGSL variable'
    );
    const guarded = wgsl.compileKernel(
      ce.box([
        'ParallelLoop',
        ['Block', ['AddTo', 's', 'k']],
        ['Element', 'k', ['Range', 1, 'n'], 'k'],
      ] as never)
    );
    expect(guarded.diagnostic?.message).toContain('of the loop is not a boolean');
  });

  test('a bound that is a symbol with an integer value is written as that value', () => {
    const ce = engine();
    ce.assign('N', 12);
    const r = wgsl.compileKernel(epsil(ce, 'parallel for k in 1..N { s += k }'));
    expect(r.success).toBe(true);
    expect(r.range).toEqual({ lower: 1, upper: 12 });
    expect(r.code).toContain('if (k <= 12) {');
  });

  test('a storage hint that is not a storage buffer throws', () => {
    const ce = engine();
    expect(() =>
      wgsl.compileKernel(epsil(ce, 'parallel for k in 1..n { s += floor(R[k]) }'), {
        storage: { R: 'sampler2D' },
      })
    ).toThrow("a kernel reads a list from a `'storage-buffer'` hint only");
  });

  test('a wrong option throws', () => {
    const ce = engine();
    const expr = epsil(ce, 'parallel for k in 1..n { s += k }');
    expect(() => wgsl.compileKernel(expr, { workgroupSize: 0 })).toThrow(
      '`workgroupSize` must be an integer from 1 to 256'
    );
    expect(() => wgsl.compileKernel(expr, { name: 'sin' })).toThrow(
      'a predeclared function or type of WGSL'
    );
    expect(() => wgsl.compileKernel(expr, { paramsVariable: 'ce_params', resultVariable: 'ce_params' })).toThrow(
      'used for two of the declared names'
    );
  });
});

describe('the shader statement forms that a kernel body needs', () => {
  // These forms compile on both shader targets, inside and outside a kernel.
  test.each(['glsl', 'wgsl'] as const)(
    '%s: an else-less if whose branch holds a loop with a break is an if statement',
    (to) => {
      const ce = new ComputeEngine();
      const r = compile(
        epsil(
          ce,
          'do { let e = 3; let s = 0.0; if e > 0 { for m in 1..5 { if m > e { break }; s = s + m } }; s }'
        ),
        { to, fallback: false }
      );
      expect(r.success).toBe(true);
      expect(r.code).toContain('if (0.0 < e) {');
      expect(r.code).toContain('break;');
    }
  );
});

describe('the witness: the step of the Buddhabrot picture', () => {
  const PROGRAM = `
function step(H: list<integer>, n: integer) -> list<integer> {
  let L = H
  const r = H[90001]
  parallel for k in 1..n {
    const p = 3 * fract(0.7548776662 * (r + k)) - 2
    const q = 3 * fract(0.5698402910 * (r + k)) - 1.5
    const x = p - 0.25
    const t = x^2 + q^2
    if t * (t + x) > q^2 / 4 && (p + 1)^2 + q^2 > 1/16 {
      let a = 0.0
      let b = 0.0
      let e = 0
      let sa = 0.0
      let sb = 0.0
      let s = 2
      for m in 1..5000 {
        (a, b) := (a^2 - b^2 + p, 2*a*b + q)
        if a^2 + b^2 > 4 { e = m; break }
        if abs(a - sa) < 1e-12 && abs(b - sb) < 1e-12 { break }
        if m == s { sa = a; sb = b; s = 2*s }
      }
      if e > 0 {
        a = 0.0
        b = 0.0
        for m in 1..e {
          (a, b) := (a^2 - b^2 + p, 2*a*b + q)
          if a^2 + b^2 > 4 { break }
          const i = floor((b + 1.125) / 2.25 * 150)
          const j = floor((1 - a) / 3 * 200)
          if i >= 0 && i < 150 && j >= 0 && j < 200 {
            const c = 1 + i + 150*j
            const d = 150 - i + 150*j
            L[c] += 1
            L[d] += 1
            if e <= 500 {
              L[c + 30000] += 1
              L[d + 30000] += 1
            }
            if e <= 50 {
              L[c + 60000] += 1
              L[d + 60000] += 1
            }
          }
        }
      }
    }
  }
  L[90001] += n
  L
}
`;

  test('the parallel loop of the function body compiles, with the locals of the function as inputs', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, PROGRAM);
    const loop = parallelNode(epsil(ce, PROGRAM));
    const r = wgsl.compileKernel(loop);
    expect(r.success).toBe(true);
    expect(r.range).toEqual({ lower: 1, upper: 'n' });
    expect(r.params.map((p) => p.name)).toEqual(['n', 'r']);
    expect(r.bindings.map((b) => [b.kind, b.symbol, b.binding])).toEqual([
      ['parameters', 'ce_params', 0],
      ['accumulator', 'L', 1],
    ]);
    // The inner loop over `1..e` reads its bound at run time.
    expect(r.code).toContain('let _tv3: i32 = i32(e);\n        for (var m: i32 = 1; m <= _tv3; m++) {');
    // The writes of the cells, also inside the else-less ifs of the planes.
    expect(r.code).toContain('_gpu_kadd_L(c, 1.0);\n            _gpu_kadd_L(d, 1.0);');
    expect(r.code).toContain('if (e <= 50.0) {\n              _gpu_kadd_L(c + 60000.0, 1.0);');
    // The destructuring assignment and the breaks of the orbit loop.
    expect(r.code).toContain('a = _tv1;\n        b = _tv2;');
    expect(r.code).toContain('e = f32(m);\n          break;');
  });
});
