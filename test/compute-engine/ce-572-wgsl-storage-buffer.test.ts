/**
 * CE-572. A list in a WGSL storage buffer, whose contents and length the host
 * changes with no new compilation (Tycho ledger row 462: a game-of-life
 * board).
 *
 * The hint `storage: { S: { kind: 'storage-buffer', group, binding } }` makes
 * the compilation declare
 *
 *   struct CE_List_f32 { len: u32, data: array<f32> }
 *   @group(G) @binding(B) var<storage, read> S: CE_List_f32;
 *
 * in its preamble. `len` is the logical length that the host writes; the
 * buffer can hold more elements. `At(S, i)`, `Length(S)`, `Sum`, `Product`,
 * `Max`, `Min`, `Mean` of `S`, and a `Sum` whose bound is `Length(S)` read the
 * buffer. A `len` above the elements that the buffer holds gives NaN.
 *
 * jest runs no shader, so the emitted WGSL is translated to JavaScript
 * (`runWGSL`): the helpers use a small part of WGSL (`let`, `var`, `if`,
 * `for`, `select`, `floor`, `f32()`, `i32()`, the `len` and `data` members,
 * `arrayLength`). The CPU evaluator of the other shader tests
 * (`gpu-shader-f32-eval.ts`) has no arrays, structs or loops, so it cannot
 * run these helpers. Each read of the buffer fails the test when it is out of
 * range: the guards must make such a read unreachable. The values are
 * compared with the `javascript` target, given the list of the first `len`
 * elements.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const wgsl = new WGSLTarget();
const glsl = new GLSLTarget();

const SB = {
  storage: { S: { kind: 'storage-buffer', group: 1, binding: 0 } },
} as const;

function engineWith(decls: Record<string, string>): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(decls)) ce.declare(name, type);
  return ce;
}

function message(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

/** A storage buffer as the helpers read it: a length and a capacity. */
type Buffer = { len: number; data: number[] };

/**
 * Translate the WGSL `code` (an expression, or statements that end in a
 * `return`) and its `preamble` to a JavaScript function of the buffer `S`
 * and of the scalar inputs `names`. The NaN helper and the NaN-safe
 * `_gpu_max`/`_gpu_min` are given in JavaScript, with their documented
 * behavior (`gpuNaNSafeLibrary`, `gpu-target.ts`); the struct and binding
 * declarations are dropped.
 */
function runWGSL(
  code: string,
  preamble: string,
  names: string[]
): (S: Buffer, ...args: number[]) => number {
  const skip = new Set([
    '_gpu_nan',
    '_gpu_isnan',
    '_gpu_isnonfinite',
    '_gpu_max',
    '_gpu_min',
  ]);
  const fns: string[] = [];
  const re = /^fn (\w+)\(([^)]*)\) -> [\w<>]+ \{\n([\s\S]*?)\n\}\n/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(preamble)) !== null) {
    if (skip.has(m[1])) continue;
    const params = [...m[2].matchAll(/(\w+):/g)].map((p) => p[1]);
    fns.push(`function ${m[1]}(${params.join(', ')}) {\n${m[3]}\n}`);
  }
  const body = /\breturn\b/.test(code) ? code : `return ${code};`;
  const js = [...fns, body]
    .join('\n')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\b(let|var) (\w+): [\w<>]+/g, 'let $2')
    .replace(/\bvar (\w+)/g, 'let $1')
    .replace(/\b(\d+)u\b/g, '$1')
    .replace(/arrayLength\(&S\.data\)/g, 'S.data.length')
    .replace(/\bS\.data\[/g, 'read(S, ')
    .replace(/\]/g, ')')
    .replace(/\bf32\(/g, 'Math.fround(')
    .replace(/\bu32\(/g, '(')
    .replace(/(?<![\w.])min\(/g, 'Math.min(')
    .replace(/\bi32\(/g, 'Math.trunc(')
    .replace(/\bfloor\(/g, 'Math.floor(')
    .replace(/select\(([^,]+), ([^,]+), ([^,)]+)\)/g, '(($3) ? ($2) : ($1))');
  const read = (S: Buffer, k: number): number => {
    if (!(Number.isInteger(k) && k >= 0 && k < S.data.length))
      throw new Error(`slot ${k} is out of range for ${S.data.length} elements`);
    return S.data[k];
  };
  const nanSafe = (f: (a: number, b: number) => number) => (a: number, b: number) =>
    Number.isNaN(a) ? a : Number.isNaN(b) ? b : f(a, b);
  const fn = new Function(
    'read',
    '_gpu_nan',
    '_gpu_isnonfinite',
    '_gpu_max',
    '_gpu_min',
    '_gpu_pow2',
    'S',
    ...names,
    `"use strict";\n${js}`
  );
  return (S, ...args) =>
    fn(
      read,
      () => NaN,
      (x: number) => !Number.isFinite(x),
      nanSafe(Math.max),
      nanSafe(Math.min),
      (x: number) => x * x,
      S,
      ...args
    );
}

/** The value of the `javascript` target of `expr` over the list `list`. */
function jsValue(
  expr: ReturnType<ComputeEngine['box']>,
  list: number[],
  vars: Record<string, number> = {}
): number {
  const js = compile(expr, { to: 'javascript' });
  expect(js.success).toBe(true);
  const run = js.run as (vars: Record<string, unknown>) => unknown;
  return run({ S: list, ...vars }) as number;
}

/** A buffer of `capacity` elements holding `list` and a length `len`. */
function bufferOf(list: number[], capacity: number, len = list.length): Buffer {
  const data = Array.from({ length: capacity }, (_, k) => list[k] ?? 999);
  return { len, data };
}

function expectSame(got: number, want: number): void {
  if (Number.isNaN(want)) expect(got).toBeNaN();
  else expect(got).toBe(Math.fround(want));
}

const LISTS: Record<string, number[]> = {
  empty: [],
  'one element': [5],
  'three elements': [2, -1, 7],
  '22 500 elements': Array.from({ length: 22500 }, (_, k) => (k % 7) - 3),
};

describe('CE-572: the declarations and the layout', () => {
  test('At(S, i): the struct, the binding and one helper call', () => {
    const ce = engineWith({ S: 'list<real>', i: 'real' });
    const r = wgsl.compile(ce.box(['At', 'S', 'i']), SB);
    expect(r.success).toBe(true);
    expect(r.code).toBe('_gpu_sbat_S(i)');
    expect(r.preamble).toContain(
      'struct CE_List_f32 { len: u32, data: array<f32> }\n' +
        '@group(1) @binding(0) var<storage, read> S: CE_List_f32;'
    );
    expect(r.preamble).toContain('fn _gpu_sbat_S(_gpu_i: f32) -> f32 {');
    expect(r.preamble).toContain('_gpu_n > arrayLength(&S.data)');
    expect(r.storageBuffers).toEqual([
      {
        symbol: 'S',
        name: 'S',
        struct: 'CE_List_f32',
        group: 1,
        binding: 0,
        element: 'f32',
        components: 1,
        lengthOffset: 0,
        dataOffset: 4,
        stride: 4,
        minBindingSize: 8,
      },
    ]);
    expect(r.freeSymbolTypes?.S.lowered).toBe('CE_List_f32');
    // No copy of the list anywhere.
    expect(r.preamble).not.toMatch(/var _gpu_\w+ = S\b/);
  });

  test('Length(S) is the len header, bounded by the buffer', () => {
    const ce = engineWith({ S: 'list<real>' });
    const r = wgsl.compile(ce.box(['Length', 'S']), SB);
    expect(r.code).toBe('f32(min(S.len, arrayLength(&S.data)))');
    expect(r.storageBuffers?.map((b) => b.name)).toEqual(['S']);
  });

  test('a list of points: array<vecNf>, with the WGSL stride of vecNf', () => {
    for (const [m, offset] of [
      [2, 8],
      [3, 16],
      [4, 16],
    ] as const) {
      const coords = Array(m).fill('real').join(', ');
      const ce = engineWith({ P: `list<tuple<${coords}>>`, i: 'real' });
      const r = wgsl.compile(ce.box(['At', 'P', 'i']), {
        storage: { P: { kind: 'storage-buffer', group: 0, binding: 3 } },
      });
      expect(r.code).toBe(`_gpu_sbatp${m}_P(i)`);
      expect(r.preamble).toContain(
        `struct CE_List_vec${m}f { len: u32, data: array<vec${m}f> }`
      );
      expect(r.preamble).toContain(
        `@group(0) @binding(3) var<storage, read> P: CE_List_vec${m}f;`
      );
      expect(r.preamble).toContain(`    return vec${m}f(_gpu_nan());`);
      const layout = r.storageBuffers![0];
      expect(layout.element).toBe(`vec${m}f`);
      expect(layout.dataOffset).toBe(offset);
      expect(layout.stride).toBe(offset);
      expect(layout.minBindingSize).toBe(2 * offset);
    }
  });

  test('a `vars` mapping names the buffer', () => {
    const ce = engineWith({ S: 'list<real>', i: 'real' });
    const r = wgsl.compile(ce.box(['At', 'S', 'i']), {
      ...SB,
      vars: { S: 'board' },
    });
    expect(r.code).toBe('_gpu_sbat_board(i)');
    expect(r.preamble).toContain('var<storage, read> board: CE_List_f32;');
    expect(r.storageBuffers![0]).toMatchObject({ symbol: 'S', name: 'board' });
  });

  test('a declared length is accepted; the length is still the len header', () => {
    const ce = engineWith({ S: 'list<real^22500>', i: 'real' });
    expect(wgsl.compile(ce.box(['At', 'S', 'i']), SB).code).toBe(
      '_gpu_sbat_S(i)'
    );
    expect(wgsl.compile(ce.box(['Length', 'S']), SB).code).toBe(
      'f32(min(S.len, arrayLength(&S.data)))'
    );
  });

  test('a length change gives the same compiled text', () => {
    // The length is not in the code: two engines that hold lists of
    // different lengths compile to the same text.
    const texts = ['list<real>', 'list<real^9>', 'list<real^22500>'].map(
      (t) => {
        const ce = engineWith({ S: t });
        const r = wgsl.compile(
          ce.parse('\\sum_{k=1}^{\\operatorname{Length}(S)} S_k^2'),
          SB
        );
        return `${r.code}\n${r.preamble}`;
      }
    );
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
  });
});

describe('CE-572: values against the javascript target', () => {
  for (const [label, list] of Object.entries(LISTS)) {
    test(`At(S, i), ${label}: positive, negative and out-of-range indices`, () => {
      const ce = engineWith({ S: 'list<real>', i: 'real' });
      const expr = ce.box(['At', 'S', 'i']);
      const r = wgsl.compile(expr, SB);
      const at = runWGSL(r.code, r.preamble!, ['i']);
      const n = list.length;
      // The buffer holds 3 more elements than the list.
      const S = bufferOf(list, n + 3);
      const indices = [
        1, 2, n, n - 1, -1, -2, -n, 0, n + 1, n + 3, -n - 1, 1.5, -0.5, NaN,
        Infinity, -Infinity, 1e30, Math.floor(n / 2),
      ];
      for (const i of indices) expectSame(at(S, i), jsValue(expr, list, { i }));
    });

    test(`Length and the reductions, ${label}`, () => {
      const ce = engineWith({ S: 'list<real>' });
      for (const head of ['Length', 'Sum', 'Product', 'Max', 'Min', 'Mean']) {
        const expr = ce.box([head, 'S']);
        const r = wgsl.compile(expr, SB);
        expect(r.success).toBe(true);
        const f = runWGSL(r.code, r.preamble ?? '', []);
        const got = f(bufferOf(list, list.length + 2));
        const want = jsValue(expr, list);
        if (head === 'Mean' && !Number.isNaN(want))
          expect(got).toBeCloseTo(want, 5);
        else expectSame(got, want);
      }
    });

    test(`the sum of S_k^2 for k up to Length(S), ${label}`, () => {
      const ce = engineWith({ S: 'list<real>' });
      const expr = ce.parse('\\sum_{k=1}^{\\operatorname{Length}(S)} S_k^2');
      const r = wgsl.compile(expr, SB);
      expect(r.success).toBe(true);
      const f = runWGSL(r.code, r.preamble!, []);
      expectSame(f(bufferOf(list, list.length + 1)), jsValue(expr, list));
    });
  }

  test('the empty list: sum 0, product 1, and NaN for max, min and mean', () => {
    // The values of the javascript target, pinned.
    const ce = engineWith({ S: 'list<real>' });
    const values = ['Sum', 'Product', 'Max', 'Min', 'Mean', 'Length'].map(
      (head) => {
        const r = wgsl.compile(ce.box([head, 'S']), SB);
        return runWGSL(r.code, r.preamble ?? '', [])(bufferOf([], 1, 0));
      }
    );
    expect(values).toEqual([0, 1, NaN, NaN, NaN, 0]);
    expect(
      ['Sum', 'Product', 'Max', 'Min', 'Mean'].map((h) =>
        jsValue(ce.box([h, 'S']), [])
      )
    ).toEqual([0, 1, NaN, NaN, NaN]);
  });

  test('a NaN element gives NaN for Max and Min, as on javascript', () => {
    const ce = engineWith({ S: 'list<real>' });
    for (const head of ['Max', 'Min']) {
      const expr = ce.box([head, 'S']);
      const r = wgsl.compile(expr, SB);
      const list = [1, NaN, 3];
      expect(runWGSL(r.code, r.preamble!, [])(bufferOf(list, 3))).toBeNaN();
      expect(jsValue(expr, list)).toBeNaN();
    }
  });

  test('a length change: the same code reads each length', () => {
    const ce = engineWith({ S: 'list<real>', i: 'real' });
    const sum = wgsl.compile(ce.box(['Sum', 'S']), SB);
    const at = wgsl.compile(ce.box(['At', 'S', 'i']), SB);
    const fSum = runWGSL(sum.code, sum.preamble!, []);
    const fAt = runWGSL(at.code, at.preamble!, ['i']);
    const data = Array.from({ length: 100 }, (_, k) => k + 1);
    for (const len of [0, 1, 50, 100]) {
      const S = { len, data };
      expect(fSum(S)).toBe((len * (len + 1)) / 2);
      expectSame(fAt(S, -1), len === 0 ? NaN : len);
      expectSame(fAt(S, len + 1), NaN);
    }
  });

  test('a len above the elements of the buffer gives NaN, with no read outside it', () => {
    const ce = engineWith({ S: 'list<real>', i: 'real' });
    const S = { len: 11, data: Array.from({ length: 10 }, (_, k) => k) };
    for (const [expr, names, args] of [
      [['At', 'S', 'i'], ['i'], [1]],
      [['At', 'S', 'i'], ['i'], [-1]],
      [['Length', 'S'], [], []],
      [['Sum', 'S'], [], []],
      [['Product', 'S'], [], []],
      [['Max', 'S'], [], []],
      [['Min', 'S'], [], []],
      [['Mean', 'S'], [], []],
    ] as const) {
      const r = wgsl.compile(ce.box(expr as any), SB);
      const got = runWGSL(r.code, r.preamble ?? '', [...names])(S, ...args);
      // The length is the number of elements that the buffer holds.
      if (expr[0] === 'Length') expect(got).toBe(10);
      else expect(got).toBeNaN();
    }
    const loop = wgsl.compile(
      ce.parse('\\sum_{k=1}^{\\operatorname{Length}(S)} S_k'),
      SB
    );
    expect(runWGSL(loop.code, loop.preamble!, [])(S)).toBeNaN();
  });
});

describe('CE-572: the review fixes', () => {
  test('the index guard holds above 2^24, where f32(len) rounds up', () => {
    // f32(16777219) is 16777220, so the float guard lets the index
    // 16777220 through; the integer guard refuses its slot.
    const ce = engineWith({ S: 'list<real>', i: 'real' });
    const r = wgsl.compile(ce.box(['At', 'S', 'i']), SB);
    expect(r.preamble).toContain('_gpu_isnonfinite(_gpu_i)');
    expect(r.preamble).toContain('if (_gpu_j < 0 || u32(_gpu_j) >= _gpu_n) {');
    const at = runWGSL(r.code, r.preamble!, ['i']);
    const len = 16777219;
    const S = { len, data: { length: len } as unknown as number[] };
    expect(at(S, Math.fround(16777220))).toBeNaN();
    expect(at(S, -Math.fround(16777220))).toBeNaN();
  });

  test('a literal index is checked as written, before the f32 rounding', () => {
    // `1.0000000001` is written `1.0` in f32, which would read element 1.
    // 16777217 is written 16777216.0. Both give NaN, as on the array form.
    const ce = engineWith({ S: 'list<real>', P: 'list<tuple<real, real>>' });
    for (const i of [1.0000000001, 2.5, 16777217]) {
      expect(wgsl.compile(ce.box(['At', 'S', i]), SB).code).toBe('_gpu_nan()');
      expect(
        wgsl.compile(ce.box(['At', 'P', i]), {
          storage: { P: { kind: 'storage-buffer', group: 0, binding: 0 } },
        }).code
      ).toBe('vec2f(_gpu_nan())');
    }
    expect(jsValue(ce.box(['At', 'S', 1.0000000001]), [10, 20])).toBeNaN();
    expect(wgsl.compile(ce.box(['At', 'S', 2]), SB).code).toBe(
      '_gpu_sbat_S(2.0)'
    );
  });

  test('a buffer name with the prefix of the struct names declines', () => {
    const ce = engineWith({ S: 'list<real>' });
    for (const name of ['CE_List_f32', 'CE_List_vec3f'])
      expect(
        message(() =>
          wgsl.compile(ce.box(['At', 'S', 1]), { ...SB, vars: { S: name } })
        )
      ).toMatch(/starts with `CE_List_`/);
  });

  test('the point reader has the same two guards', () => {
    const ce = engineWith({ P: 'list<tuple<real, real>>', i: 'real' });
    const r = wgsl.compile(ce.box(['At', 'P', 'i']), {
      storage: { P: { kind: 'storage-buffer', group: 0, binding: 0 } },
    });
    expect(r.preamble).toContain('_gpu_isnonfinite(_gpu_i)');
    expect(r.preamble).toContain('if (_gpu_j < 0 || u32(_gpu_j) >= _gpu_n) {');
    expect(r.preamble).toContain('fn _gpu_isnonfinite(');
  });

  test('a loop bounded by Length(S) stops with a len of 2^31', () => {
    const ce = engineWith({ S: 'list<real>' });
    const r = wgsl.compile(
      ce.parse('\\sum_{k=1}^{\\operatorname{Length}(S)} S_k'),
      SB
    );
    const S = { len: 2 ** 31, data: Array.from({ length: 10 }, () => 1) };
    expect(runWGSL(r.code, r.preamble!, [])(S)).toBeNaN();
  });

  test('the layout comes from the compiled read, not from the current scope', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.pushScope();
    ce.declare('Q', 'list<tuple<real, real, real>>');
    const expr = ce.box(['At', 'Q', 'x']);
    ce.popScope();
    const r = wgsl.compile(expr, {
      storage: { Q: { kind: 'storage-buffer', group: 0, binding: 0 } },
    });
    expect(r.code).toBe('_gpu_sbatp3_Q(x)');
    expect(r.preamble).toContain('var<storage, read> Q: CE_List_vec3f;');
    expect(r.storageBuffers?.[0]).toMatchObject({
      element: 'vec3f',
      dataOffset: 16,
    });
  });

  test('two lists that map to one WGSL name decline', () => {
    const ce = engineWith({ S: 'list<real>', T: 'list<real>' });
    expect(
      message(() =>
        wgsl.compile(ce.box(['Add', ['At', 'S', 1], ['At', 'T', 1]]), {
          storage: {
            S: { kind: 'storage-buffer', group: 0, binding: 0 },
            T: { kind: 'storage-buffer', group: 0, binding: 1 },
          },
          vars: { S: 'board', T: 'board' },
        })
      )
    ).toMatch(/"S" and "T" .* both map to `board`/);
  });

  test('two buffers of one element type share one struct', () => {
    const ce = engineWith({ S: 'list<real>', T: 'list<real>', x: 'real' });
    const r = wgsl.compile(ce.box(['Add', ['At', 'S', 1], ['At', 'T', 'x']]), {
      storage: {
        S: { kind: 'storage-buffer', group: 0, binding: 0 },
        T: { kind: 'storage-buffer', group: 0, binding: 1 },
      },
    });
    expect(r.preamble!.match(/struct CE_List_f32 /g)).toHaveLength(1);
    expect(r.preamble).toContain(
      '@group(0) @binding(0) var<storage, read> S: CE_List_f32;\n' +
        '@group(0) @binding(1) var<storage, read> T: CE_List_f32;'
    );
  });

  test('a local with the name of a hinted symbol is not read as the buffer', () => {
    const ce = engineWith({ S: 'list<real>', x: 'real' });
    const msg = message(() =>
      wgsl.compile(
        ce.box([
          'Add',
          ['At', 'S', 1],
          [
            'Block',
            ['Declare', 'S', "'list<real^5>'"],
            ['Assign', 'S', ['List', 1, 2, 3, 4, 5]],
            ['At', 'S', 'x'],
          ],
        ]),
        SB
      )
    );
    // It is not lowered as a storage-buffer read: the local declines as for
    // any storage hint.
    expect(msg).not.toMatch(/local or bound name/);
    expect(msg).toMatch(/must be a free symbol/);
  });
});

describe('CE-572: the declines', () => {
  test('GLSL declines the storage kind: WebGL2 has no storage buffers', () => {
    const ce = engineWith({ S: 'list<real>', i: 'real' });
    const msg = message(() => glsl.compile(ce.box(['At', 'S', 'i']), SB));
    expect(msg).toMatch(/'storage-buffer'.*not supported on the glsl target/);
    expect(msg).toContain('WebGL2 has no storage buffers');
    // With the interpreter fallback it is a decline, not an option error.
    const r = glsl.compile(ce.box(['At', 'S', 'i']), {
      ...SB,
      fallback: true,
    });
    expect(r.success).toBe(false);
  });

  test.each([
    ['list<list<real>>', /object-domain|no storage-buffer layout|nested/],
    ['list<boolean>', /object-domain|no storage-buffer layout/],
    ['list<complex>', /no storage-buffer layout/],
    ['list<string>', /object-domain|no storage-buffer layout/],
    ['list<tuple<real, real, real, real, real>>', /object-domain|points of 2 to 4/],
  ])('a list of %s declines', (type, pattern) => {
    const ce = engineWith({ S: type, i: 'real' });
    expect(message(() => wgsl.compile(ce.box(['At', 'S', 'i']), SB))).toMatch(
      pattern
    );
    expect(message(() => wgsl.compile(ce.box(['Length', 'S']), SB))).not.toBe(
      ''
    );
  });

  test.each([
    ['S + 1', ['Add', 'S', 1]],
    ['2S', ['Multiply', 2, 'S']],
    ['Map over S', ['Map', ['Function', ['Add', 'x', 1], 'x'], 'S']],
    ['Max(S, 3)', ['Max', 'S', 3]],
    ['Norm(S)', ['Norm', 'S']],
  ])('%s builds or reads a whole list of run-time length: declines', (_, e) => {
    const ce = engineWith({ S: 'list<real>' });
    // `Map` has no lowering on the shader targets for any list.
    expect(message(() => wgsl.compile(ce.box(e as any), SB))).toMatch(
      /storage buffer|`Map`: the operator is known to the engine but target 'wgsl' has no lowering/
    );
  });

  test('a reduction over a list of points declines', () => {
    const ce = engineWith({ P: 'list<tuple<real, real>>' });
    expect(
      message(() =>
        wgsl.compile(ce.box(['Sum', 'P']), {
          storage: { P: { kind: 'storage-buffer', group: 0, binding: 0 } },
        })
      )
    ).toMatch(/holds points/);
  });

  test('the option is validated: group and binding are required and distinct', () => {
    const ce = engineWith({ S: 'list<real>', T: 'list<real>', i: 'real' });
    const expr = ce.box(['Add', ['At', 'S', 'i'], ['At', 'T', 'i']]);
    expect(() =>
      wgsl.compile(expr, { storage: { S: 'storage-buffer' } } as any)
    ).toThrow(/needs a group and a binding/);
    expect(() =>
      wgsl.compile(expr, {
        storage: { S: { kind: 'storage-buffer', group: 0 } },
      } as any)
    ).toThrow(/`binding`/);
    expect(() =>
      wgsl.compile(expr, {
        storage: {
          S: { kind: 'storage-buffer', group: 0, binding: 1 },
          T: { kind: 'storage-buffer', group: 0, binding: 1 },
        },
      })
    ).toThrow(/both name group 0 and binding 1/);
    // The validation runs on every target, as for 'sampler2D'.
    expect(() =>
      compile(expr, {
        to: 'javascript',
        storage: { S: { kind: 'storage-buffer', group: -1, binding: 0 } },
      } as any)
    ).toThrow(/`group`/);
    // Two buffers at two bindings compile.
    const r = wgsl.compile(expr, {
      storage: {
        S: { kind: 'storage-buffer', group: 0, binding: 1 },
        T: { kind: 'storage-buffer', group: 0, binding: 2 },
      },
    });
    expect(r.storageBuffers?.map((b) => [b.name, b.binding])).toEqual([
      ['S', 1],
      ['T', 2],
    ]);
  });

  test('a mapping that is not a plain identifier declines', () => {
    const ce = engineWith({ S: 'list<real>', i: 'real' });
    expect(
      message(() =>
        wgsl.compile(ce.box(['At', 'S', 'i']), { ...SB, vars: { S: 'u.S' } })
      )
    ).toMatch(/not a plain identifier/);
  });
});
