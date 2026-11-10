/**
 * Compiles the GLSL that the engine writes with the WebGL 2 compiler of a
 * headless Chromium (`glsl-driver.ts`). Run it with `npm run test:glsl`.
 *
 * This lane is not part of the Jest suite, because it needs a browser. A run
 * takes about one second.
 *
 * The operator sweep builds `Op()`, `Op(x)`, `Op(x, y)` and `Op(x, y, z)` for
 * each operator of the GPU function tables, with real inputs, and keeps each
 * expression that is valid and has a real type. It compiles each one to a
 * fragment shader that writes the value to a `float` output. A decline of the
 * engine (an error whose message starts with "Could not compile") is counted
 * and is not a failure: this test checks that the code the engine writes
 * compiles, not which expressions it accepts. Any other error of the engine,
 * when it builds or compiles an expression, fails the test.
 *
 * The test of the lowerings draws one pixel with the shader of each
 * expression and compares the value with the value of the interpreter
 * (`GlslDriver.evaluate()`).
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import {
  canCompile,
  compile,
} from '../../src/compute-engine/compilation/compile-expression';
import { GLSL_FRAGMENT_RULES } from '../../src/compute-engine/compilation/glsl-fragment';
import type { GPUShaderTarget } from '../../src/compute-engine/compilation/gpu-shader-target';
import type {
  FragmentPattern,
  FragmentSignature,
} from '../../src/compute-engine/compilation/fragment';
import { GPU_FUNCTIONS } from '../../src/compute-engine/compilation/gpu-functions';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  GlslDriver,
  type GlslEvaluation,
  type GlslResult,
  type GlslShader,
} from './glsl-driver';

/** Gives the names of the GLSL-specific lowerings, which are protected. */
class SweepTarget extends GLSLTarget {
  operators(): string[] {
    return Object.keys(this.getLanguageSpecificFunctions());
  }
}

const glsl = new SweepTarget();
const ce = new ComputeEngine();
const INPUTS = ['x', 'y', 'z'] as const;
for (const name of INPUTS) ce.declare(name, 'real');

/**
 * A fragment shader that writes the value of `expr` to a `float` output, with
 * the real inputs as uniforms. Constant folding is off, so that a fold does
 * not remove the operation under test.
 */
function fragmentShader(expr: Expression): string {
  return glsl.compileShader({
    type: 'fragment',
    uniforms: INPUTS.map((name) => ({ name, type: 'float' })),
    outputs: [{ name: 'result', type: 'float' }],
    body: [{ variable: 'result', expression: expr }],
    constantFold: false,
  });
}

function report(failures: GlslResult[], shaders: GlslShader[]): string {
  const source = new Map(shaders.map((s) => [s.name, s.source]));
  return failures
    .map(
      (f) =>
        `--- ${f.name} (failed at ${f.failedAt})\n${f.log.trim()}\n` +
        `${source.get(f.name)}`
    )
    .join('\n');
}

/**
 * The shaders of the sweep that WebGL 2 refuses today, each with its open
 * issue. The sweep fails when a shader that is not in this list is refused,
 * and also when a shader in this list compiles, so that the list does not keep
 * an entry after its fix.
 */
const KNOWN_FAILURES = new Map<string, string>([
  // `_gpu_polevl` takes `float c[12]`, and the Fresnel helpers pass arrays of
  // other sizes, which GLSL does not convert.
  ['FresnelC(x)', 'CE-1168'],
  ['FresnelS(x)', 'CE-1168'],
]);

/**
 * The sweep fails when it builds fewer shaders than this. Without a minimum,
 * a change that makes most operators decline, or that changes the type of the
 * expressions so that the filter drops them, would leave a sweep that passes
 * with almost no shader. The sweep built 62 shaders on 2026-11-08, after
 * `compile()` and `compileShader()` to GLSL began to refuse the forms outside
 * the GLSL fragment (`Matrix`, `Mean`, `Random`, `WithRandomSeed`, and `Sum`
 * and `Product` of a collection: `docs/plans/2026-11-08-glsl-fragment-spec.md`,
 * section 2); raise the minimum when the count grows.
 */
const MIN_SHADERS = 62;

/**
 * Node's test runner has no default time limit, and a compiler that never
 * returns would stop the lane forever. A run takes about one second.
 */
const TIMEOUT_MS = 60_000;

let driver: GlslDriver;

before(
  async () => {
    driver = await GlslDriver.start();
  },
  { timeout: TIMEOUT_MS }
);

after(async () => {
  await driver?.stop();
});

describe('the GLSL driver', { timeout: TIMEOUT_MS }, () => {
  it('runs on SwiftShader', () => {
    assert.match(driver.renderer, /SwiftShader/i);
  });

  // A control: if the driver accepted every source, each test below would
  // pass with no check.
  it('refuses a shader that does not compile, and one that does not link', async () => {
    const [bad, unlinked] = await driver.compile([
      {
        name: 'type error',
        stage: 'fragment',
        source: `#version 300 es
precision highp float;
out float result;
void main() { result = vec2(1.0); }
`,
      },
      {
        // The input `v` compiles, but the pass-through vertex shader does
        // not write it, so the program does not link.
        name: 'input with no vertex output',
        stage: 'fragment',
        source: `#version 300 es
precision highp float;
in float v;
out float result;
void main() { result = v; }
`,
      },
    ]);
    assert.equal(bad.ok, false);
    assert.equal(bad.failedAt, 'compile');
    assert.notEqual(bad.log, '');
    assert.equal(unlinked.ok, false);
    assert.equal(unlinked.failedAt, 'link');
    assert.notEqual(unlinked.log, '');
  });

  it('accepts a shader that the engine writes', async () => {
    const source = fragmentShader(ce.parse('\\sin(x) + y^2'));
    const [result] = await driver.compile([
      { name: 'sin(x) + y^2', stage: 'fragment', source },
    ]);
    assert.equal(result.ok, true, result.log);
  });
});

describe('the GLSL of each operator of the GPU function tables', () => {
  it('compiles on WebGL 2', { timeout: TIMEOUT_MS }, async () => {
    const operators = [
      ...new Set([...Object.keys(GPU_FUNCTIONS), ...glsl.operators()]),
    ].sort();
    const shaders: GlslShader[] = [];
    const declined: string[] = [];
    for (const op of operators) {
      for (let arity = 0; arity <= INPUTS.length; arity++) {
        const name = `${op}(${INPUTS.slice(0, arity).join(', ')})`;
        const expr = ce.function(op, [...INPUTS.slice(0, arity)]);
        if (!expr.isValid || !expr.type.matches('real')) continue;
        let source: string;
        try {
          source = fragmentShader(expr);
        } catch (e) {
          if (!(e instanceof Error && e.message.startsWith('Could not compile')))
            throw e;
          declined.push(name);
          continue;
        }
        shaders.push({ name, stage: 'fragment', source });
      }
    }
    const results = await driver.compile(shaders);
    const refused = results.filter((r) => !r.ok);
    console.log(
      `${operators.length} operators; ${shaders.length} shaders compiled by ` +
        `WebGL 2, ${refused.length} refused (${KNOWN_FAILURES.size} known); ` +
        `${declined.length} declined by the engine.`
    );
    assert.ok(
      shaders.length >= MIN_SHADERS,
      `the sweep built ${shaders.length} shaders, fewer than ${MIN_SHADERS}`
    );
    const unexpected = refused.filter((r) => !KNOWN_FAILURES.has(r.name));
    assert.equal(unexpected.length, 0, report(unexpected, shaders));
    const fixed = results
      .filter((r) => r.ok && KNOWN_FAILURES.has(r.name))
      .map((r) => `${r.name} (${KNOWN_FAILURES.get(r.name)})`);
    assert.deepEqual(
      fixed,
      [],
      'these shaders compile now: remove them from KNOWN_FAILURES'
    );
  });
});

/**
 * One expression for each rewrite that the GLSL emitter makes after the
 * fragment pass (a trusted lowering, checked by `fragmentReplaceOperands()`
 * in `src/compute-engine/compilation/fragment.ts`). `marker` is a piece of
 * the emitted source that shows that the lowering ran. The pass did not type
 * the nodes that a lowering makes, so this test shows that the value of the
 * code is the interpreter's value.
 */
const LOWERINGS: ReadonlyArray<{
  name: string;
  expr: unknown;
  marker?: RegExp;
}> = [
  {
    // `gpuReduceTrigOffset()`: the constant term is reduced by whole periods.
    name: 'the constant term of a periodic argument',
    expr: ['Sin', ['Add', 'x', 1000000]],
    marker: /sin\(x \+ -?0\.\d+\)|sin\(x - 0\.\d+\)/,
  },
  {
    name: 'the constant term of a scaled periodic argument',
    expr: ['Cos', ['Multiply', 3, ['Add', 'x', 1000]]],
    // 1000 reduced by whole periods 2π/3.
    marker: /3\.0 \* \(x \+ 0\.9735\d*\)/,
  },
  {
    // `gpuPiMultiple()`: `π·u` → `u`, with `u` a product of the other factors.
    name: 'the angle in half-turns of a product',
    expr: ['Sin', ['Multiply', 'Pi', 'x', 'y']],
    marker: /_gpu_sinpi\(/,
  },
  {
    // `gpuPiMultiple()`: `π·u / d` → `u / d`.
    name: 'the angle in half-turns of a quotient',
    expr: ['Cos', ['Divide', ['Multiply', 'Pi', 'x'], 'y']],
    marker: /_gpu_cospi\(/,
  },
  {
    // `gpuPiMultiple()`: `−π·u` → `−u`.
    name: 'the angle in half-turns of a negation',
    expr: ['Tan', ['Negate', ['Multiply', 'Pi', 'x']]],
    marker: /_gpu_tanpi\(/,
  },
  {
    // `gpuImaginaryPiMultiple()`: `i·π·u` → `u`.
    name: 'the imaginary angle in half-turns',
    expr: [
      'Imaginary',
      ['Sinh', ['Multiply', 'ImaginaryUnit', 'Pi', 'x', 'y']],
    ],
    marker: /_gpu_ipi_sinh\(/,
  },
  {
    // The split of the exponent of `e` (`Power`): `a + i·π·u`.
    name: 'the exponent of e in half-turns',
    expr: [
      'Real',
      ['Exp', ['Add', 'x', 'y', ['Multiply', 'ImaginaryUnit', 'Pi', 'z']]],
    ],
    marker: /_gpu_cossinpi\(/,
  },
  {
    // `compileGPUSumProduct()`: a multi-index `Sum` is a nest.
    name: 'the nest of a multi-index sum',
    expr: [
      'Sum',
      ['Multiply', 'i', 'j', 'x'],
      ['Limits', 'i', 1, 3],
      ['Limits', 'j', 1, 4],
    ],
    // The inner sum over `j` is unrolled inside each term of the outer sum.
    marker: /\(\(\(1\.0 \* 1\.0 \* x\) \+ \(1\.0 \* 2\.0 \* x\)/,
  },
  {
    // `compileGPUSumProduct()`: `Element(k, Range(a, b))` → `Limits(k, a, b)`.
    name: 'a Range index set',
    // More terms than the unroll limit, so that the code is a loop over
    // the `Limits` that the lowering makes.
    expr: [
      'Product',
      ['Add', ['Divide', 'k', 100000], ['Divide', 'x', 1000], 1],
      ['Element', 'k', ['Range', 1, 200]],
    ],
    marker: /for \(int k = 1; k <= 200; k\+\+\)/,
  },
  {
    // `First`/`Last` of a list that the shader holds as an array: `At(xs, n)`.
    name: 'the position of Last',
    expr: ['Add', ['Last', 'L'], 'x'],
    marker: /L\[5\]/,
  },
  {
    name: 'the position of First',
    expr: ['Multiply', ['First', 'L'], 'y'],
    marker: /L\[0\]/,
  },
  {
    // `Apply`: the body of the closed form of a derivative.
    name: 'the body of an applied derivative',
    expr: [
      'Apply',
      [
        'Derivative',
        ['Function', ['Add', ['Power', 't', 3], ['Sin', 't']], 't'],
        1,
      ],
      'x',
    ],
    marker: /3\.0 \* \(x \* x\) \+ cos\(x\)/,
  },
  {
    // An applied derivative with a list argument: the interpreter applies
    // the closed form to each element, and the prepare stage writes one body
    // for each element (`gpuApplyDerivatives()`). The value is the norm of
    // `[3x² + cos x, 3y² + cos y]`.
    name: 'an applied derivative over a list argument',
    expr: [
      'Norm',
      [
        'Apply',
        [
          'Derivative',
          ['Function', ['Add', ['Power', 't', 3], ['Sin', 't']], 't'],
          1,
        ],
        ['List', 'x', 'y'],
      ],
    ],
    marker: /length\(vec2\(3\.0 \* \(x \* x\) \+ cos\(x\), 3\.0 \* \(y \* y\)/,
  },
  // `gpuPiMultiple()` and `gpuImaginaryPiMultiple()` make `u` with the
  // canonical constructors, which distribute a negation over a sum and box
  // a denominator again: the check accepts these forms.
  {
    name: 'a negated multiple of π of a difference (sin)',
    expr: ['Sin', ['Negate', ['Multiply', 'Pi', ['Subtract', 'x', 1]]]],
    marker: /_gpu_sinpi\(/,
  },
  {
    name: 'a negated multiple of π of a difference (cos)',
    expr: ['Cos', ['Negate', ['Multiply', 'Pi', ['Subtract', 'x', 1]]]],
    marker: /_gpu_cospi\(/,
  },
  {
    name: 'a multiple of π over a square root',
    expr: ['Sin', ['Divide', ['Multiply', 'Pi', 'x'], ['Sqrt', ['Abs', 'y']]]],
    marker: /_gpu_sinpi\(/,
  },
  {
    name: 'a negated imaginary multiple of π of a sum',
    expr: [
      'Imaginary',
      [
        'Sinh',
        ['Negate', ['Multiply', 'ImaginaryUnit', 'Pi', ['Add', 'x', 1]]],
      ],
    ],
    marker: /_gpu_ipi_sinh\(/,
  },
  {
    name: 'a negated multiple of π of a sum with a large constant',
    expr: ['Sin', ['Negate', ['Multiply', 'Pi', ['Add', 'x', 1000]]]],
    marker: /_gpu_sinpi\(/,
  },
  {
    name: 'a negated multiple of π of a sum of inputs',
    expr: ['Sin', ['Negate', ['Multiply', 'Pi', ['Add', 'x', 'y']]]],
    marker: /_gpu_sinpi\(/,
  },
  {
    name: 'a negated quotient of a multiple of π of a sum',
    expr: [
      'Sin',
      ['Negate', ['Divide', ['Multiply', 'Pi', ['Add', 'x', 1]], 'y']],
    ],
    marker: /_gpu_sinpi\(/,
  },
  {
    // `desugarPatternAssign()` in `compileStatementList()`: a tuple
    // assignment of locals that is the whole body of a loop. Each value is
    // computed into a temporary before any local is written, so `b` reads the
    // old value of `a`. The value is `3x + 5y`.
    name: 'a tuple assignment of locals as a loop body',
    expr: [
      'Block',
      ['Assign', 'a', 'x'],
      ['Assign', 'b', 'y'],
      [
        'Loop',
        ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', ['Add', 'a', 'b']]],
        ['Element', 'k', ['Range', 1, 5]],
      ],
      'a',
    ],
    marker: /_tv\d+ = a \+ b;/,
  },
  {
    // `inlineReservedParameterCalls()`: a function whose parameter is named
    // `discard`, a reserved word of GLSL, cannot be emitted as a shader
    // function, so the prepare stage writes its body in place of the call.
    // The argument `sin(x)` is read three times in the body.
    name: 'a call of a function with a reserved parameter name',
    expr: ['discardPoly', ['Sin', 'x']],
    marker: /^(?![\s\S]*discard)[\s\S]*sin\(x\)/,
  },
];
ce.assign(
  'discardPoly',
  ce.box([
    'Function',
    [
      'Add',
      ['Multiply', 'discard', 'discard'],
      ['Multiply', 2, 'discard'],
      ['Cos', 'discard'],
    ],
    'discard',
  ])
);

/** A list input of six reals, held as a `float[6]` uniform array. */
ce.declare('L', 'list<real^6>');
const LIST = [0.5, -1.25, 2, 3.5, -0.75, 1.5];

/**
 * The shader of a lowering: the code that `compile()` writes for `expr`, in
 * a function `_value()` whose value the shader writes to its `float` output.
 * The inputs `x`, `y`, `z` are `float` uniforms, and `L` a `float[6]`
 * uniform. `compileShader()` is not used: its declarations admit no array.
 */
function loweringShader(expr: Expression): string {
  const r = compile(expr, { to: 'glsl', constantFold: false });
  if (!r.success)
    throw new Error(`${expr.toString()} does not compile to GLSL`);
  const body = /\breturn\b/.test(r.code) ? r.code : `return ${r.code};`;
  return (
    `#version 300 es\nprecision highp float;\nprecision highp int;\n` +
    `out float result;\nuniform float x;\nuniform float y;\n` +
    `uniform float z;\nuniform float L[6];\n${r.preamble ?? ''}\n` +
    `float _value() {\n${body}\n}\n` +
    `void main() {\n  result = _value();\n}\n`
  );
}

/** The values of the inputs `x`, `y`, `z` at which each lowering is drawn;
 *  `L` is `LIST` times the index of the point plus one. */
const POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.25, 1.5, -0.75],
  [1.75, -0.5, 2.25],
  [-2.5, 0.75, 0.5],
];

describe('the lowerings of GLSL emission', () => {
  it('give the value of the interpreter', { timeout: TIMEOUT_MS }, async () => {
    const items: GlslEvaluation[] = [];
    const expected: number[] = [];
    const problems: string[] = [];
    for (const { name, expr, marker } of LOWERINGS) {
      const e = ce.box(expr as any);
      assert.ok(e.isValid, `${name}: ${e.toString()} is not valid`);
      const source = loweringShader(e);
      if (marker !== undefined && !marker.test(source))
        problems.push(
          `${name}: the source does not match ${marker}\n${source}`
        );
      for (const [k, [x, y, z]] of POINTS.entries()) {
        const list = LIST.map((v) => v * (k + 1));
        const value = e
          .subs({
            x: ce.number(x),
            y: ce.number(y),
            z: ce.number(z),
            L: ce.function(
              'List',
              list.map((v) => ce.number(v))
            ),
          })
          .N();
        expected.push(value.re);
        // Only the inputs that the expression reads: `evaluate()` refuses a
        // value for a uniform that the program does not read.
        const all: Record<string, number | number[]> = { x, y, z, L: list };
        items.push({
          name: `${name} #${k}`,
          source,
          uniforms: Object.fromEntries(
            Object.entries(all).filter(([u]) => e.symbols.includes(u))
          ),
        });
      }
    }
    const values = await driver.evaluate(items);
    for (const [i, result] of values.entries()) {
      if (!result.ok) {
        problems.push(`${result.name}: ${result.log}\n${items[i].source}`);
        continue;
      }
      const want = expected[i];
      // float32 arithmetic, and built-in functions whose precision GLSL ES
      // does not state: `sin` of SwiftShader is off by up to 2e-4 near 1.4.
      const tolerance = 1e-3 * Math.max(1, Math.abs(want));
      if (
        result.value !== want &&
        !(Math.abs(result.value - want) <= tolerance)
      )
        problems.push(
          `${result.name}: GLSL ${result.value}, interpreter ${want}\n` +
            items[i].source
        );
    }
    assert.deepEqual(problems, []);
  });
});

describe('GlslDriver.evaluate()', () => {
  it(
    'keeps NaN, the infinities and -0, and refuses a missing uniform, and lists an inactive key',
    { timeout: TIMEOUT_MS },
    async () => {
      const shader = (expr: string, uniforms: string): string =>
        `#version 300 es\nprecision highp float;\nout float result;\n` +
        `${uniforms}void main() {\n  result = ${expr};\n}\n`;
      const scalar = shader('a', 'uniform float a;\n');
      const values = [NaN, Infinity, -Infinity, -0, 1.5];
      const items: GlslEvaluation[] = [
        ...values.map((a) => ({
          name: `a = ${Object.is(a, -0) ? '-0' : a}`,
          source: scalar,
          uniforms: { a },
        })),
        {
          name: 'b[0]',
          source: shader('b[0]', 'uniform float b[2];\n'),
          uniforms: { b: [NaN, -0] },
        },
        {
          name: 'b[1]',
          source: shader('b[1]', 'uniform float b[2];\n'),
          uniforms: { b: [1, -0] },
        },
        { name: 'missing', source: scalar, uniforms: {} },
        { name: 'unknown', source: scalar, uniforms: { a: 1, c: 2 } },
      ];
      const results = await driver.evaluate(items);
      const got = results.map((r) =>
        r.ok ? (Object.is(r.value, -0) ? '-0' : String(r.value)) : r.log
      );
      assert.deepEqual(got, [
        'NaN',
        'Infinity',
        '-Infinity',
        '-0',
        '1.5',
        'NaN',
        '-0',
        'uniforms with no value: [a]',
        '1',
      ]);
      const last = results[results.length - 1];
      assert.ok(last.ok);
      assert.deepEqual(last.ok && last.inactive, ['c']);
    }
  );
});

/**
 * The calls of user functions with a list argument (the spec
 * `docs/plans/2026-11-08-glsl-fragment-spec.md`, decision 19), reduced from
 * the Tycho documents `neyret/0et6fx01id`, `neyret/pqflulcixs`,
 * `neyret/9pal1xuvqq` and `neyret/ra1p9naofs`. A function whose parameters
 * are all scalar is applied to each element of a list argument (`bf`, `bg`);
 * a function with a parameter that is not scalar reads the list whole
 * (`bd2`, `bR`, `bC`, `bl` and the functions that call them). The constant
 * 0.3 is the slider `T` of `neyret/ra1p9naofs`.
 */
const BROADCAST_FUNCTIONS: ReadonlyArray<[string, unknown, ...string[]]> = [
  ['bf', ['Mod', 'u', 1], 'u'],
  [
    'bd2',
    [
      'Add',
      ['Multiply', ['At', 'a', 1], ['At', 'b', 1]],
      ['Multiply', ['At', 'a', 2], ['At', 'b', 2]],
    ],
    'a',
    'b',
  ],
  [
    'bR',
    [
      'List',
      ['Sum', ['Multiply', 'V', ['List', ['Cos', 't'], ['Negate', ['Sin', 't']]]]],
      ['Sum', ['Multiply', 'V', ['List', ['Sin', 't'], ['Cos', 't']]]],
    ],
    'V',
    't',
  ],
  [
    'bC',
    [
      'Subtract',
      [
        'Add',
        ['Power', ['Subtract', 'p', ['At', 'c', 1]], 2],
        ['Power', ['Subtract', 'q', ['At', 'c', 2]], 2],
      ],
      ['Power', ['At', 'c', 3], 2],
    ],
    'c',
    'p',
    'q',
  ],
  ['bl', ['Sqrt', ['Add', ['Power', ['At', 'p', 1], 2], ['Power', ['At', 'p', 2], 2]]], 'p'],
  ['bg', ['Subtract', ['Mod', 'p', 1], 0.5], 'p'],
  [
    'br',
    [
      'Multiply',
      ['Add', 0.3, ['Floor', ['At', 'p', 1]]],
      ['Max', 0, ['Subtract', 0.5, ['bl', ['bg', 'p']]]],
    ],
    'p',
  ],
  [
    'bA',
    [
      'List',
      ['Add', ['Divide', ['Arctan2', ['At', 'p', 2], ['At', 'p', 1]], ['Multiply', 2, 'Pi']], 0.5],
      ['bl', 'p'],
    ],
    'p',
  ],
  [
    'bB',
    [
      'List',
      [
        'Subtract',
        ['Multiply', 2.6, ['Power', ['Add', ['At', 'p', 1], ['Floor', ['Subtract', ['At', 'p', 2], ['At', 'p', 1]]]], 2]],
        0.3,
      ],
      ['Subtract', ['At', 'p', 2], ['At', 'p', 1]],
    ],
    'p',
  ],
  [
    'bd',
    [
      'Add',
      ['Multiply', ['bg', ['At', 'p', 1]], ['Sin', ['br', 'p']]],
      ['Multiply', ['bg', ['At', 'p', 2]], ['Cos', ['br', 'p']]],
    ],
    'p',
  ],
];
for (const [name, body, ...params] of BROADCAST_FUNCTIONS)
  ce.assign(name, ce.box(['Function', body, ...params] as any));

const BROADCAST_CALLS: ReadonlyArray<{ name: string; expr: unknown; marker: RegExp }> = [
  {
    name: 'a scalar function applied to each element, then read whole',
    expr: ['bd2', ['bf', ['List', 'x', 'y']], ['List', 1, 2]],
    marker: /vec2 _fn_bf_each2_1\(vec2 a0\)/,
  },
  {
    name: 'a negated scalar function of a negated list',
    expr: ['bd2', ['List', 1, 2], ['Negate', ['bf', ['List', ['Negate', 'x'], ['Negate', 'y']]]]],
    marker: /float _fn_bf\(float u\)/,
  },
  {
    name: 'a rotation that reads its list whole',
    expr: [
      'Sum',
      ['Power', ['Divide', ['bR', ['Subtract', ['List', 'x', 'y'], ['List', 'z', 1]], 0.5], ['List', 2, 1]], 2],
    ],
    marker: /vec2 _fn_bR\w*\(vec2 V, float t\)/,
  },
  {
    name: 'a function of a list of three reals and two reals',
    expr: ['Multiply', ['bC', ['List', 'y', 'z', 0.5], 'x', 'y'], ['bC', ['List', 'z', 'x', 1], 'x', 'y']],
    marker: /float _fn_bC\w*\(vec3 c, float p, float q\)/,
  },
  {
    name: 'a chain of functions of a list, with a scalar function of a list inside',
    expr: ['bd', ['bB', ['bA', ['List', 'x', 'y']]]],
    marker: /vec2 _fn_bg_each2_1\(vec2 a0\)/,
  },
];

describe('the calls of user functions with a list argument', () => {
  it('give the value of the interpreter', { timeout: TIMEOUT_MS }, async () => {
    const items: GlslEvaluation[] = [];
    const expected: number[] = [];
    const problems: string[] = [];
    for (const { name, expr, marker } of BROADCAST_CALLS) {
      const e = ce.box(expr as any);
      assert.ok(e.isValid, `${name}: ${e.toString()} is not valid`);
      assert.deepEqual(canCompile(e, { to: 'glsl' }), { ok: true }, name);
      const source = loweringShader(e);
      if (!marker.test(source))
        problems.push(`${name}: the source does not match ${marker}\n${source}`);
      for (const [k, [x, y, z]] of POINTS.entries()) {
        expected.push(
          e.subs({ x: ce.number(x), y: ce.number(y), z: ce.number(z) }).N().re
        );
        // A key with no active uniform is skipped (`GlslEvaluation`).
        items.push({ name: `${name} #${k}`, source, uniforms: { x, y, z } });
      }
    }
    const values = await driver.evaluate(items);
    for (const [i, result] of values.entries()) {
      if (!result.ok) {
        problems.push(`${result.name}: ${result.log}\n${items[i].source}`);
        continue;
      }
      const want = expected[i];
      assert.ok(Number.isFinite(want), `${result.name}: interpreter ${want}`);
      const tolerance = 1e-3 * Math.max(1, Math.abs(want));
      if (!(Math.abs(result.value - want) <= tolerance))
        problems.push(
          `${result.name}: GLSL ${result.value}, interpreter ${want}\n` +
            items[i].source
        );
    }
    assert.deepEqual(problems, []);
  });
});

/**
 * The operand types of the generated test of the signatures: the engine
 * type of a declared input of each kind, and its GLSL type.
 */
const KINDS: Record<string, { type: string; glsl: string }> = {
  real: { type: 'real', glsl: 'float' },
  integer: { type: 'integer', glsl: 'float' },
  complex: { type: 'complex', glsl: 'vec2' },
  point2: { type: 'tuple<real, real>', glsl: 'vec2' },
  point3: { type: 'tuple<real, real, real>', glsl: 'vec3' },
  point4: { type: 'tuple<real, real, real, real>', glsl: 'vec4' },
  list2: { type: 'list<real^2>', glsl: 'vec2' },
  list3: { type: 'list<real^3>', glsl: 'vec3' },
  list4: { type: 'list<real^4>', glsl: 'vec4' },
  color: { type: 'color', glsl: 'vec3' },
  boolean: { type: 'boolean', glsl: 'bool' },
};

/** The kinds of the operands of a node of three operands or more (all the
 *  kinds would give 1,331 combinations for each such head). */
const KINDS_OF_THREE = [
  'real',
  'complex',
  'point3',
  'list3',
  'color',
  'boolean',
];

/** The GLSL types that a value can have, tried in turn as the return type
 *  of the function that holds the code. */
const VALUE_TYPES = ['float', 'vec2', 'vec3', 'vec4', 'bool'];

/** The combinations of `n` kinds of `kinds`, in each order. */
function combinations(kinds: readonly string[], n: number): string[][] {
  if (n === 0) return [[]];
  return combinations(kinds, n - 1).flatMap((c) => kinds.map((k) => [...c, k]));
}

/** The fragment type of an input of each kind of `KINDS`: the kind, and the
 *  size of a point or of a list. */
function kindType(kind: string): { kind: string; size?: number } {
  const m = /^(point|list)(\d)$/.exec(kind);
  return m === null ? { kind } : { kind: m[1], size: Number(m[2]) };
}

/**
 * Whether one signature of `signatures` takes inputs of the kinds `kinds`,
 * by the meaning of the patterns that `FragmentPattern` and
 * `FragmentSignature` in `fragment.ts` state. It is written here again, and
 * not taken from the pass, so that the test compares the pass with the
 * table. An input is a symbol, never a literal: a `color` place takes a
 * colour only, and a `name` place takes nothing. A signature with `when`
 * applies to `node` only when `when()` is true for it in the root scope,
 * where the pass reads the root.
 */
function signatureAdmits(
  signatures: readonly FragmentSignature[],
  kinds: readonly string[],
  node: Expression
): boolean {
  const scalar = (k: string): boolean => k === 'real' || k === 'integer';
  const root = { bindings: new Map(), facts: new Map(), inner: new Map() };
  return signatures.some((s) => {
    if (s.when !== undefined && !s.when(node, root)) return false;
    const fixed = s.operands.length;
    if (kinds.length < fixed) return false;
    if (kinds.length > fixed && s.rest === undefined) return false;
    const patterns: FragmentPattern[] = kinds.map((_, i) =>
      i < fixed ? s.operands[i] : s.rest!
    );
    const usesPoint =
      patterns.includes('point') ||
      patterns.includes('tuple') ||
      s.result === 'point';
    const sizes = usesPoint ? (s.sizes ?? [2, 3, 4]) : [0];
    return sizes.some((size) => {
      // The vector kinds of the operands, and the positions of a broadcast
      // scalar.
      const vectors = new Set<string>();
      const broadcast: number[] = [];
      const ok = kinds.every((k, i) => {
        const t = kindType(k);
        switch (patterns[i]) {
          case 'real':
          case 'index':
            return scalar(k);
          case 'integer':
          case 'boolean':
          case 'color':
            return k === patterns[i];
          case 'complex':
            return k === 'complex' || scalar(k);
          case 'name':
            return false;
          case 'real-list':
            return t.kind === 'list';
          case 'real-or-list':
            return t.kind === 'list' || scalar(k);
          case 'tuple':
            if (t.kind !== 'point' || t.size !== size) return false;
            vectors.add('point');
            return true;
          case 'point':
            if ((t.kind === 'point' || t.kind === 'list') && t.size === size) {
              vectors.add(t.kind);
              return true;
            }
            if (
              s.broadcast === true &&
              scalar(k) &&
              (s.scalarSlots === undefined || s.scalarSlots.includes(i))
            ) {
              broadcast.push(i);
              return true;
            }
            return false;
        }
      });
      if (!ok) return false;
      // A point and a list do not mix in a componentwise operation.
      if (s.broadcast === true && vectors.size > 1) return false;
      if (
        s.pointScalarSlots !== undefined &&
        vectors.has('point') &&
        broadcast.some((i) => !s.pointScalarSlots!.includes(i))
      )
        return false;
      // A `point` signature needs a point or a list among the operands.
      if (
        patterns.includes('point') &&
        !patterns.includes('tuple') &&
        vectors.size === 0
      )
        return false;
      return true;
    });
  });
}

/**
 * For each head of `GLSL_FRAGMENT_RULES` that has signatures, and each
 * number of operands that a signature takes (one more for a signature with
 * `rest`), an expression whose operands are declared inputs of each kind,
 * in each order, compiled with `constantFold: false`. `canCompile()` gives
 * `ok: true` exactly when a signature of the table takes the operand types
 * (`signatureAdmits()`), and otherwise refuses with the code
 * `outside-fragment`. When it gives `ok: true`, `compile()` must succeed,
 * the code must compile on WebGL 2 with exactly one return type, and that
 * type must be the GLSL representation of the root in the annotation of the
 * typing pass (`_fragmentAnnotationForTest()`).
 */
describe('the signatures of the GLSL fragment', () => {
  it(
    'compile on WebGL 2 when canCompile() accepts them',
    { timeout: 10 * TIMEOUT_MS },
    async () => {
      const ce2 = new ComputeEngine();
      const names = (kinds: readonly string[]): string[] =>
        kinds.map((k, i) => `${k}_${i}`);
      const kindOf = new Map<string, string>();
      for (const k of Object.keys(KINDS))
        for (let i = 0; i < 3; i++) {
          ce2.declare(`${k}_${i}`, KINDS[k].type);
          kindOf.set(`${k}_${i}`, k);
        }
      const glslTarget = ce2._getCompilationTarget(
        'glsl'
      ) as unknown as GPUShaderTarget;
      const problems: string[] = [];
      const candidates: { name: string; source: string; type: string }[] = [];
      /** The GLSL representation of the root of each accepted expression in
       *  the annotation of the typing pass. */
      const representations = new Map<string, string>();
      let generated = 0;
      let unchecked = 0;
      let accepted = 0;
      let compiled = 0;
      for (const [head, rule] of Object.entries(GLSL_FRAGMENT_RULES)) {
        if (!('signatures' in rule)) continue;
        const arities = new Set<number>();
        for (const sig of rule.signatures) {
          arities.add(sig.operands.length);
          if (sig.rest !== undefined) arities.add(sig.operands.length + 1);
        }
        for (const n of arities) {
          const kinds = n >= 3 ? KINDS_OF_THREE : Object.keys(KINDS);
          for (const combo of combinations(kinds, n)) {
            const operands = names(combo);
            const expr = ce2.function(head, operands);
            if (!expr.isValid) continue;
            generated += 1;
            const options = { to: 'glsl', constantFold: false } as const;
            const label = `${head}(${combo.join(', ')})`;
            const verdict = canCompile(expr, options);
            // (a) `canCompile()` accepts exactly when a signature of the
            // table takes the operands. The canonical form can change the
            // head or the operands (`Square(x)` is `Power(x, 2)`, `Exp(x)`
            // is `Power(ExponentialE, x)`): the check then reads the
            // canonical head and operands, a real constant as an operand of
            // kind `integer` or `real`, and it is skipped when an operand
            // is something else or the head has no signatures.
            const canonicalRule = GLSL_FRAGMENT_RULES[expr.operator];
            const canonicalKinds = expr.ops?.map((op) => {
              if (op.symbol !== undefined && kindOf.has(op.symbol))
                return kindOf.get(op.symbol);
              if (!op.isConstant || !op.type.matches('real')) return undefined;
              return op.type.matches('integer') ? 'integer' : 'real';
            });
            if (
              canonicalRule === undefined ||
              !('signatures' in canonicalRule) ||
              canonicalKinds === undefined ||
              canonicalKinds.some((k) => k === undefined)
            )
              unchecked += 1;
            else {
              const admits = signatureAdmits(
                canonicalRule.signatures,
                canonicalKinds as string[],
                expr
              );
              if (admits && !verdict.ok)
                problems.push(
                  `${label}: a signature takes ${expr.toString()}, ` +
                    `canCompile() refuses: ${verdict.diagnostic.message}`
                );
              else if (!admits && verdict.ok)
                problems.push(
                  `${label}: no signature takes ${expr.toString()}, ` +
                    `canCompile() accepts`
                );
              else if (
                !verdict.ok &&
                verdict.diagnostic.code !== 'outside-fragment'
              )
                problems.push(
                  `${label}: canCompile() refuses with the code ` +
                    `${verdict.diagnostic.code}`
                );
            }
            if (!verdict.ok) continue;
            accepted += 1;
            // (b) The GLSL representation of the root in the annotation,
            // compared below with the return type that the code compiles
            // with on WebGL 2.
            const annotation = glslTarget._fragmentAnnotationForTest(
              expr,
              options
            );
            const facts = annotation.scope.facts.get(annotation.root);
            if (facts === undefined || !('representation' in facts)) {
              problems.push(`${label}: the annotation has no facts of the root`);
              continue;
            }
            representations.set(label, facts.representation);
            let r;
            try {
              r = compile(expr, options);
            } catch (e) {
              problems.push(
                `${label}: compile() throws ${(e as Error).message}`
              );
              continue;
            }
            if (!r.success) {
              problems.push(
                `${label}: canCompile() accepts, compile() declines`
              );
              continue;
            }
            const uniforms = combo
              .map((k, i) => `uniform ${KINDS[k].glsl} ${operands[i]};\n`)
              .join('');
            const body = /\breturn\b/.test(r.code)
              ? r.code
              : `return ${r.code};`;
            compiled += 1;
            for (const type of VALUE_TYPES)
              candidates.push({
                name: label,
                type,
                source:
                  `#version 300 es\nprecision highp float;\nprecision highp int;\n` +
                  `out vec4 fragColor;\n${uniforms}${r.preamble ?? ''}\n` +
                  `${type} _value() {\n${body}\n}\n` +
                  `void main() {\n  ${type} v = _value();\n  fragColor = vec4(0.0);\n}\n`,
              });
          }
        }
      }
      const results = await driver.compile(
        candidates.map((c) => ({
          name: `${c.name} as ${c.type}`,
          stage: 'fragment' as const,
          source: c.source,
        }))
      );
      const types = new Map<string, string[]>();
      const logs = new Map<string, string>();
      for (const [i, result] of results.entries()) {
        const c = candidates[i];
        if (!types.has(c.name)) types.set(c.name, []);
        if (result.ok) types.get(c.name)!.push(c.type);
        else if (c.type === 'float') logs.set(c.name, result.log);
      }
      // `_gpu_polevl` takes `float c[12]`, and the Fresnel helpers pass
      // arrays of other sizes, which GLSL does not convert (CE-1168).
      const known = new Set([
        'FresnelC(real)',
        'FresnelC(integer)',
        'FresnelS(real)',
        'FresnelS(integer)',
      ]);
      for (const name of known)
        if (!types.has(name))
          problems.push(
            `${name} is no longer accepted by canCompile() or compile(): ` +
              `remove it from the known list`
          );
        else if (types.get(name)!.length === 1)
          problems.push(`${name} compiles now: remove it from the known list`);
      for (const [name, found] of types)
        if (found.length !== 1 && !known.has(name))
          problems.push(
            `${name}: the GLSL code compiles with ${found.length} return ` +
              `types (${found.join(', ')}) ${found.length === 0 ? logs.get(name) : ''}`
          );
        // (b) The one return type that the code compiles with is the GLSL
        // type of the value that `compile()` writes. The annotation gives
        // the root the same representation.
        else if (found.length === 1 && representations.get(name) !== found[0])
          problems.push(
            `${name}: the annotation gives the root the representation ` +
              `${representations.get(name)}, the code has the type ${found[0]}`
          );
      console.log(
        `signatures: ${generated} expressions generated, ${unchecked} not ` +
          `compared with the table, ${accepted} accepted by canCompile(), ` +
          `${problems.length} disagreements.`
      );
      assert.deepEqual(problems, []);
      // The test is not vacuous: a change that makes no expression, or
      // that makes `canCompile()` refuse most of them, fails here. On
      // 2026-11-08, 953 expressions were accepted. Each accepted
      // expression that compiled has its WebGL check, one per value type.
      assert.ok(generated > 5000, `only ${generated} expressions generated`);
      // On 2026-11-09, 9 expressions were not compared with the table: a
      // `Multiply` of one operand, whose canonical form is the operand.
      assert.ok(unchecked <= 20, `${unchecked} not compared with the table`);
      assert.ok(accepted >= 940, `only ${accepted} expressions accepted`);
      assert.equal(compiled, accepted);
      assert.equal(results.length, compiled * VALUE_TYPES.length);
      assert.equal(types.size, compiled);
    }
  );
});
