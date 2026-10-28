/**
 * CE-574. A WGSL positional read of a long list does not copy the list.
 *
 * The WGSL index helper `_gpu_atN(v: array<f32, N>, i)` takes the list as a
 * value parameter and copies it to a function-scope `var` (`var a = v;`)
 * before it indexes it. WGSL guarantees only 8192 bytes of function-scope
 * variables per function, so a list of more than 2048 numbers can fail, and
 * a list of 22 500 numbers (a 150 x 150 board) needs 90 KB. A `Sum` over
 * the list with a proven index copied the list on each pass of the loop
 * (`var _tv2 = S;` in the loop body).
 *
 * WGSL lets an expression index a module-scope declaration by its name with
 * a run-time index. So a read of a free list symbol whose copy would need
 * more than 8192 bytes names the declaration: `_gpu_at_S_N(i)`, a helper
 * generated per binding whose body indexes `S` directly, or `S[k - 1]` for
 * a proven index. The host must then declare the list at module scope. A
 * list whose copy fits keeps the copying helper, which is also valid when
 * the host declares the list as a parameter or a local of its own function.
 * A read that would copy more than 8192 bytes and cannot be read in place
 * (a `vars` mapping to a struct field) declines and names the storage kind
 * `'storage-buffer'`. The index rules do not change: 1-based, a negative
 * index counts from the end, and 0, a non-integer, a non-finite value or an
 * index out of range reads as NaN. The GLSL output does not change.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const wgsl = new WGSLTarget();
const glsl = new GLSLTarget();

function engineWith(decls: Record<string, string>): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(decls)) ce.declare(name, type);
  return ce;
}

/** The text of the WGSL function `name` in `preamble`, up to its last `}`. */
function helperText(preamble: string, name: string): string {
  const start = preamble.indexOf(`fn ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = preamble.indexOf('\n}\n', start);
  return preamble.slice(start, end + 2);
}

/**
 * Run the WGSL index helper `name` of `preamble` in JavaScript. The helpers
 * use a small part of WGSL (an `if` with a guard, `let`, `var`, `i32()`,
 * `floor()`, `select()` and one array index), so a text translation is
 * enough. Each array read goes through `read`, which fails the test when
 * the slot is out of range: the guard must make such a read unreachable.
 */
function runHelper(
  preamble: string,
  name: string,
  arrays: Record<string, number[]>
): (...args: number[]) => number {
  const text = helperText(preamble, name);
  const header = /^fn \w+\(([^)]*)\) -> \w+ \{\n/.exec(text)!;
  // A parameter type can hold a comma (`array<f32, 7>`): read the names.
  const params = [...header[1].matchAll(/(\w+):/g)].map((m) => m[1]);
  const body = text
    .slice(header[0].length, -2)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/_gpu_nan\(\)/g, 'NaN')
    .replace(/\bfloor\(/g, 'Math.floor(')
    .replace(/\bi32\(/g, 'Math.trunc(')
    .replace(/\bvar (\w+) = (\w+);/g, 'let $1 = $2;')
    .replace(
      /select\(([^,]+), ([^,]+), ([^,\]]+)\)/g,
      '(($3) ? ($2) : ($1))'
    )
    .replace(/\b(\w+)\[/g, 'read($1, ')
    .replace(/\];/g, ');');
  const read = (a: number[], k: number): number => {
    if (!(Number.isInteger(k) && k >= 0 && k < a.length))
      throw new Error(`slot ${k} is out of range for ${a.length} elements`);
    return a[k];
  };
  const names = Object.keys(arrays);
  const fn = new Function('read', ...names, ...params, body);
  return (...args) => fn(read, ...names.map((n) => arrays[n]), ...args);
}

/** The indices every index-rule check reads, for a list of `n` elements. */
function probeIndices(n: number): number[] {
  return [
    1,
    2,
    Math.floor(n / 2),
    n - 1,
    n,
    -1,
    -2,
    -n,
    0,
    n + 1,
    -n - 1,
    1.5,
    -0.5,
    NaN,
    Infinity,
    -Infinity,
    1e30,
  ];
}

describe('CE-574: a list whose copy fits keeps the copying helper', () => {
  for (const n of [7, 2048]) {
    test(`At(S, i), ${n} elements: the copying helper, as before`, () => {
      const ce = engineWith({ S: `list<number^${n}>`, i: 'real' });
      const r = wgsl.compile(ce.box(['At', 'S', 'i']));
      expect(r.code).toBe(`_gpu_at${n}(S, i)`);
      expect(r.preamble).toContain(
        `fn _gpu_at${n}(v: array<f32, ${n}>, i: f32) -> f32 {`
      );
      expect(r.preamble).not.toContain('_gpu_at_S_');
    });
  }

  test('a proven index over 10 elements reads a hoisted copy, as before', () => {
    const ce = engineWith({ S: 'list<number^10>' });
    const r = wgsl.compile(
      ce.box(['Sum', ['At', 'S', 'k'], ['Limits', 'k', 1, 10]]),
      { constantFold: false }
    );
    expect(r.code).toMatch(/var _tv\d+ = S;/);
  });
});

describe('CE-574: a WGSL read of a long free list symbol indexes it in place', () => {
  for (const n of [2049, 22500]) {
    test(`At(S, i), ${n} elements: one call of a per-binding helper, no copy`, () => {
      const ce = engineWith({ S: `list<number^${n}>`, i: 'real' });
      const r = wgsl.compile(ce.box(['At', 'S', 'i']));
      expect(r.success).toBe(true);
      expect(r.code).toBe(`_gpu_at_S_${n}(i)`);
      const helper = helperText(r.preamble!, `_gpu_at_S_${n}`);
      expect(helper).toContain(`fn _gpu_at_S_${n}(_gpu_i: f32) -> f32 {`);
      expect(helper).toContain(
        `  return S[select(${n} + _gpu_k, _gpu_k - 1, _gpu_k > 0)];`
      );
      // No function-scope copy of the list anywhere.
      expect(r.preamble).not.toMatch(/\bvar\b/);
      expect(r.preamble).not.toContain(`array<f32, ${n}>`);
    });

    test(`a Sum over S_k, ${n} elements: no copy in the loop`, () => {
      const ce = engineWith({ S: `list<number^${n}>` });
      const r = wgsl.compile(ce.parse(`\\sum_{k=1}^{${n}} S_k`));
      expect(r.success).toBe(true);
      expect(r.code).not.toMatch(/var _tv\d+ = S;/);
      expect(r.code).toContain('S[k - 1]');
    });
  }

  test('a loop with an unproven index calls the helper, with no copy', () => {
    const ce = engineWith({ S: 'list<number^22500>', n: 'real' });
    const r = wgsl.compile(
      ce.box(['Sum', ['At', 'S', 'k'], ['Limits', 'k', 1, 'n']])
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('_gpu_at_S_22500(f32(k))');
    expect(r.code).not.toMatch(/\bvar _tv\d+ = S\b/);
    expect(r.preamble).not.toMatch(/\bvar\b/);
  });

  test('one helper serves every read of the same list', () => {
    const ce = engineWith({ S: 'list<number^3000>', i: 'real', j: 'real' });
    const r = wgsl.compile(
      ce.box(['Add', ['At', 'S', 'i'], ['At', 'S', 'j']])
    );
    expect(r.code).toBe('_gpu_at_S_3000(i) + _gpu_at_S_3000(j)');
    expect(r.preamble!.match(/fn _gpu_at_S_3000\(/g)).toHaveLength(1);
  });

  test('the binding is the `vars`-mapped identifier, and is not shadowed', () => {
    // The helper's parameter and local have the `_gpu_` prefix, so a binding
    // named `i` or `k` is still the list inside the body.
    for (const name of ['i', 'k', 'u_board_2']) {
      const ce = engineWith({ S: 'list<number^3000>', j: 'real' });
      const r = wgsl.compile(ce.box(['At', 'S', 'j']), {
        vars: { S: name },
      });
      expect(r.code).toBe(`_gpu_at_${name}_3000(j)`);
      expect(r.preamble).toContain(`fn _gpu_at_${name}_3000(_gpu_i: f32)`);
      expect(r.preamble).toContain(`  return ${name}[select(3000 + _gpu_k,`);
      expect(r.preamble).not.toMatch(new RegExp(`\\b(let|var) ${name}\\b`));
    }
  });

  test('a binding with the reserved prefix `_gpu_` is not read in place', () => {
    // The in-place helpers name their parameter `_gpu_i` and their local
    // `_gpu_k`, which would hide a binding of the same name. Such a binding
    // takes the copying helper, and above 8192 bytes it declines.
    for (const name of ['_gpu_k', '_gpu_i']) {
      const small = engineWith({ S: 'list<number^9>', j: 'real' });
      expect(
        wgsl.compile(small.box(['At', 'S', 'j']), { vars: { S: name } }).code
      ).toBe(`_gpu_at9(${name}, j)`);
      const large = engineWith({ S: 'list<number^3000>', j: 'real' });
      expect(() =>
        wgsl.compile(large.box(['At', 'S', 'j']), { vars: { S: name } })
      ).toThrow(/'storage-buffer'/);
      const smallP = engineWith({ P: 'list<tuple<real, real>^9>', j: 'real' });
      expect(
        wgsl.compile(smallP.box(['At', 'P', 'j']), { vars: { P: name } }).code
      ).toBe(`_gpu_atp2_9(${name}, j)`);
      const largeP = engineWith({
        P: 'list<tuple<real, real>^3000>',
        j: 'real',
      });
      expect(() =>
        wgsl.compile(largeP.box(['At', 'P', 'j']), { vars: { P: name } })
      ).toThrow(/'storage-buffer'/);
    }
  });

  test('a list of points is read in place when its copy needs more than 8192 bytes', () => {
    // A `vec2f` takes 8 bytes in an array: 1024 points fit, 1025 do not.
    const fits = engineWith({ P: 'list<tuple<real, real>^1024>', i: 'real' });
    expect(wgsl.compile(fits.box(['At', 'P', 'i'])).code).toBe(
      '_gpu_atp2_1024(P, i)'
    );
    const large = engineWith({ P: 'list<tuple<real, real>^1025>', i: 'real' });
    expect(wgsl.compile(large.box(['At', 'P', 'i'])).code).toBe(
      '_gpu_atp_P_2_1025(i)'
    );
  });

  test('a list of points is indexed in place too', () => {
    const ce = engineWith({ P: 'list<tuple<real, real>^3000>', i: 'real' });
    const r = wgsl.compile(ce.box(['At', 'P', 'i']));
    expect(r.success).toBe(true);
    expect(r.code).toBe('_gpu_atp_P_2_3000(i)');
    const helper = helperText(r.preamble!, '_gpu_atp_P_2_3000');
    expect(helper).toContain('fn _gpu_atp_P_2_3000(_gpu_i: f32) -> vec2f {');
    expect(helper).toContain('    return vec2f(_gpu_nan());');
    expect(helper).toContain(
      '  return P[select(3000 + _gpu_k, _gpu_k - 1, _gpu_k > 0)];'
    );
    expect(r.preamble).not.toMatch(/\bvar\b/);
  });
});

describe('CE-574: the index rules do not change', () => {
  for (const n of [2049, 22500]) {
    test(`the in-place helper agrees with the JavaScript target, ${n} elements`, () => {
      const ce = engineWith({ S: `list<number^${n}>`, i: 'real' });
      const expr = ce.box(['At', 'S', 'i']);
      const S = Array.from({ length: n }, (_, k) => 10 * (k + 1));
      const js = compile(expr, { to: 'javascript' });
      expect(js.success).toBe(true);
      const shader = wgsl.compile(expr);
      const at = runHelper(shader.preamble!, `_gpu_at_S_${n}`, { S });
      for (const i of probeIndices(n)) {
        const run = js.run as (vars: Record<string, unknown>) => unknown;
        const want = run({ S, i }) as number;
        const got = at(i);
        if (Number.isNaN(want)) expect(got).toBeNaN();
        else expect(got).toBe(want);
      }
    });
  }

  test('the in-place helper and the copying helper have the same guard', () => {
    const ce = engineWith({
      S: 'list<number^2049>',
      T: 'list<number^2048>',
      i: 'real',
    });
    const inPlace = wgsl.compile(ce.box(['At', 'S', 'i'])).preamble!;
    const copying = wgsl.compile(ce.box(['At', 'T', 'i'])).preamble!;
    const guard = (p: string, name: string) =>
      /\n\s*if \((.*)\) \{\n/.exec(helperText(p, name))![1];
    expect(
      guard(inPlace, '_gpu_at_S_2049')
        .replace(/_gpu_i/g, 'i')
        .replace(/2049\.0/g, '2048.0')
    ).toBe(guard(copying, '_gpu_at2048'));
    // The values of the in-place helper are checked against the
    // JavaScript target above.
  });
});

describe('CE-574: the bases that keep the copying helper', () => {
  test('a literal list (at most 256 elements on a shader target)', () => {
    const ce = engineWith({ i: 'real' });
    const r = wgsl.compile(
      ce.box(['At', ['List', 1, 2, 3, 4, 5, 6, 7], 'i']),
      { constantFold: false }
    );
    expect(r.code).toBe(
      '_gpu_at7(array<f32, 7>(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0), i)'
    );
    expect(r.preamble).toContain('  var a = v;');
  });

  test('a Block local: a function-scope name a module-scope helper cannot see', () => {
    const ce = engineWith({ S: 'list<number^10>', i: 'real' });
    const r = wgsl.compile(
      ce.box([
        'Block',
        ['Declare', 'T', "'list<number^10>'"],
        ['Assign', 'T', 'S'],
        ['At', 'T', 'i'],
      ])
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('_gpu_at10(T, i)');
    expect(r.code).not.toContain('_gpu_at_T_');
  });

  test('a free list that the body writes: it is read from a local copy', () => {
    // The body writes `S`, so the code reads and writes a function-scope
    // copy of it (`_tv1`). A helper at module scope cannot name that copy.
    const ce = engineWith({
      S: 'list<number^10>',
      T: 'list<number^10>',
      i: 'real',
    });
    const r = wgsl.compile(
      ce.box(['Block', ['Assign', 'S', 'T'], ['At', 'S', 'i']])
    );
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/_gpu_at10\(_tv\d+, i\)/);
    expect(r.code).not.toContain('_gpu_at__tv');
    expect(r.preamble).not.toContain('_gpu_at__tv');
  });

  test('a `vars` mapping to a struct field: a path, not a name', () => {
    const ce = engineWith({ S: 'list<number^10>', i: 'real' });
    const r = wgsl.compile(ce.box(['At', 'S', 'i']), { vars: { S: 'u.S' } });
    expect(r.code).toBe('_gpu_at10(u.S, i)');
  });

  test('a copy above 8192 bytes declines and names the storage buffer', () => {
    // A path has no name that a module-scope helper can carry, so a list of
    // more than 2048 numbers mapped to a struct field cannot be read in
    // place, and its copy may not compile.
    const ce = engineWith({ S: 'list<number^3000>', i: 'real' });
    for (const expr of [
      ['At', 'S', 'i'],
      ['Sum', ['At', 'S', 'k'], ['Limits', 'k', 1, 3000]],
    ])
      expect(() =>
        wgsl.compile(ce.box(expr), { vars: { S: 'u.S' } })
      ).toThrow(
        /copies "S" \(3000 elements, 12000 bytes\).*storage: \{ S: \{ kind: 'storage-buffer'/
      );
  });

  test('an assigned list is compiled once: one random draw, as on javascript', () => {
    // The in-place test compiled the base to read its emission and then
    // compiled it again for the copying helper, so a draw in it ran twice.
    const ce = engineWith({ i: 'real' });
    ce.assign('L', ce.box(['List', ['Cot', ['Random']], 2, 3, 4, 5, 6, 7]));
    const expr = ce.box(['WithRandomSeed', 7, ['At', 'L', 'i']]);
    const js = compile(expr, { to: 'javascript' });
    expect(js.code.match(/drawNextRandomNumber\(/g)).toHaveLength(1);
    const r = wgsl.compile(expr);
    expect(r.success).toBe(true);
    expect(r.code.match(/_gpu_rnd_draw\(/g)).toHaveLength(1);
  });

  test('a Block local above 8192 bytes declines on WGSL only', () => {
    // A block local is a function-scope variable: 3000 numbers do not fit
    // the 8192 bytes that WGSL guarantees, 2048 do.
    const block = (n: number, src: string) => [
      'Block',
      ['Declare', 'U', `'list<real^${n}>'`],
      ['Assign', 'U', src],
      ['At', 'U', 'x'],
    ];
    const ce = engineWith({
      B: 'list<real^3000>',
      C: 'list<real^2048>',
      x: 'real',
    });
    expect(() => wgsl.compile(ce.box(block(3000, 'B')))).toThrow(
      /the local "U" \(`array<f32, 3000>`, 12000 bytes\).*'storage-buffer'/
    );
    expect(wgsl.compile(ce.box(block(2048, 'C'))).code).toContain(
      'var U: array<f32, 2048>;'
    );
    expect(glsl.compile(ce.box(block(3000, 'B'))).code).toContain(
      'float[3000] U;'
    );
  });

  test('a written input whose local copy is above 8192 bytes declines', () => {
    // The body writes `B`, so it reads and writes a function-scope copy of
    // it, which cannot hold 3000 numbers.
    const ce = engineWith({ B: 'list<real^3000>' });
    expect(() =>
      wgsl.compile(
        ce.box([
          'Block',
          ['Assign', 'B', 'B'],
          ['Sum', ['At', 'B', 'k'], ['Limits', 'k', 1, 3000]],
        ])
      )
    ).toThrow(/copy \(`array<f32, 3000>`, 12000 bytes\).*'storage-buffer'/);
  });

  test('a written input read with a proven index is not copied again', () => {
    // The body writes `S`, so it reads a function-scope copy `_tv1`, which
    // WGSL indexes as it is.
    const ce = engineWith({ S: 'list<number^10>', T: 'list<number^10>' });
    const r = wgsl.compile(
      ce.box([
        'Block',
        ['Assign', 'S', 'T'],
        ['Sum', ['At', 'S', 'k'], ['Limits', 'k', 1, 10]],
      ]),
      { constantFold: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('_tv1[1 - 1]');
    expect(r.code).toContain('_tv1[10 - 1]');
    expect(r.code).not.toMatch(/var _tv\d+ = _tv1;/);
  });

  test('a sampler-backed list keeps its texel helper', () => {
    const ce = engineWith({ S: 'list<number^1600>', k: 'integer' });
    const r = wgsl.compile(ce.box(['At', 'S', 'k']), {
      storage: { S: 'sampler2D' },
    });
    expect(r.code).toBe('_gpu_texat_S_1600(k)');
    expect(r.preamble).not.toContain('_gpu_at_S_');
  });

  test('a vector of 2 to 4 elements indexes its parameter, as before', () => {
    const ce = engineWith({ v: 'vector<3>', i: 'real' });
    expect(wgsl.compile(ce.box(['At', 'v', 'i'])).code).toBe(
      '_gpu_at3(v, i)'
    );
  });
});

describe('CE-574: the GLSL output does not change', () => {
  test('At(S, i) over 22 500 elements', () => {
    const ce = engineWith({ S: 'list<number^22500>', i: 'real' });
    const r = glsl.compile(ce.box(['At', 'S', 'i']));
    expect(r.code).toBe('_gpu_at22500(S, i)');
    expect(r.preamble).toContain(
      'float _gpu_at22500(float v[22500], float i) {'
    );
  });

  test('a Sum over S_k', () => {
    const ce = engineWith({ S: 'list<number^22500>' });
    const r = glsl.compile(ce.parse('\\sum_{k=1}^{22500} S_k'));
    expect(r.code).toContain('_tv1 += S[k - 1];');
  });
});
