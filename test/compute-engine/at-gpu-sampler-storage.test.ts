/**
 * Sampler-backed positional access on the GLSL target: the `storage` compile
 * option and the `_gpu_texatN` texel read.
 *
 * A fixed-length numeric list carried as a FREE engine symbol lowers by
 * default to a uniform-array read (`_gpu_at1600(S, k)`). With the hint
 * `storage: { S: 'sampler2D' }` the same expression reads the value from a
 * single-channel float texture instead (`_gpu_texat1600(S, k)`), which lifts
 * the uniform-storage ceiling. The two forms share ONE index contract
 * (1-based, a negative index counts from the end, everything else reads as
 * NaN, guarded entirely in float space before any integer cast), and this
 * file pins that they cannot drift: the guard text of the two helpers is
 * compared verbatim.
 *
 * The hint is ignored on the non-shader targets — one options bag serves the
 * GLSL, JavaScript and interval lanes — but it is VALIDATED on every target:
 * an unknown storage kind, or a hint naming something that is not a free
 * symbol of the expression, is an option-contract error everywhere, and never
 * an interpreter fallback. That validation is what catches a typo, since off
 * the shader targets the hint leaves no other trace.
 *
 * Design record: `docs/plans/2026-09-05-sampler-backed-positional-access.md`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

const NO_FOLD = { constantFold: false } as const;
const SAMPLER = { storage: { S: 'sampler2D' } } as const;

/** A fresh engine per declaration set — declarations are engine-lifetime. */
function engineWith(decls: Record<string, string>): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(decls)) ce.declare(name, type);
  return ce;
}

/** The consumer's carrier: a counted free symbol read by a runtime index. */
function boardEngine(): ComputeEngine {
  return engineWith({ S: 'list<number^1600>', k: 'integer' });
}

function read(ce: ComputeEngine) {
  return ce.box(['At', 'S', 'k']);
}

function message(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

/** The `if (…)` guard line of the named helper in `preamble`. */
function guardOf(preamble: string, helper: string): string {
  const body = preamble.slice(preamble.indexOf(`float ${helper}(`));
  const m = /\n\s*if \((.*)\)\n/.exec(body);
  return m?.[1] ?? '';
}

// ---------------------------------------------------------------------------
// 1. The texel read.
// ---------------------------------------------------------------------------
describe('GLSL sampler-backed At — the texel read', () => {
  test('a counted free symbol with the hint reads through the texture helper', () => {
    const ce = boardEngine();
    const r = glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_gpu_texat1600(S, k)');
    expect(r.preamble).toContain(
      'float _gpu_texat1600(sampler2D v, float i) {'
    );
    // The host still supplies `S`: the hint says where it lives, not that it
    // is no longer an input.
    expect(r.freeSymbols).toEqual(expect.arrayContaining(['S', 'k']));
  });

  test('the helper body: guard, 0-based slot, run-time width, bare texel fetch', () => {
    const ce = boardEngine();
    const p = glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }).preamble!;
    expect(p).toContain(
      'if (!(i >= -1600.0 && i <= 1600.0) || i != floor(i) || i == 0.0)\n' +
        '    return _gpu_nan();'
    );
    expect(p).toContain('int k = int(i);');
    expect(p).toContain('k = (k > 0) ? k - 1 : 1600 + k;');
    // The width is read from the texture at run time, never baked in: a
    // resize by the host must not force a recompile.
    expect(p).toContain('int w = textureSize(v, 0).x;');
    expect(p).toContain('return texelFetch(v, ivec2(k % w, k / w), 0).r;');
    expect(p).not.toMatch(/textureSize\(v, 0\)\.x\s*==\s*\d/);
  });

  test('the preamble declares `_gpu_nan` AHEAD of the texture helper', () => {
    // The helper body calls `_gpu_nan()`, and GLSL requires a declaration
    // before use — the same order rule `_gpu_atN` is pinned to.
    const ce = boardEngine();
    const p = glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }).preamble!;
    const nan = p.indexOf('float _gpu_nan()');
    const tex = p.indexOf('float _gpu_texat1600(');
    expect(nan).toBeGreaterThanOrEqual(0);
    expect(tex).toBeGreaterThan(nan);
  });

  test('the index contract is SHARED: the guard text of both helpers is identical', () => {
    const ce = boardEngine();
    const array = glsl.compile(read(ce), NO_FOLD).preamble!;
    const texture = glsl.compile(read(ce), {
      ...NO_FOLD,
      ...SAMPLER,
    }).preamble!;
    const arrayGuard = guardOf(array, '_gpu_at1600');
    const textureGuard = guardOf(texture, '_gpu_texat1600');
    expect(arrayGuard).toContain('i != floor(i)');
    expect(textureGuard).toBe(arrayGuard);
  });

  test('one shader carries both lowerings for different lists', () => {
    const ce = engineWith({
      S: 'list<number^1600>',
      T: 'list<number^7>',
      k: 'integer',
    });
    const r = glsl.compile(
      ce.box(['Add', ['At', 'S', 'k'], ['At', 'T', 'k']]),
      { ...NO_FOLD, ...SAMPLER }
    );
    expect(r.code).toBe('_gpu_texat1600(S, k) + _gpu_at7(T, k)');
    expect(r.preamble).toContain('float _gpu_at7(float v[7], float i)');
    expect(r.preamble).toContain('float _gpu_texat1600(sampler2D v, float i)');
  });

  test('a helper used many times is declared once', () => {
    const ce = boardEngine();
    const r = glsl.compile(
      ce.box([
        'Add',
        ['At', 'S', 'k'],
        ['At', 'S', ['Add', 'k', 1]],
        ['At', 'S', ['Subtract', 'k', 1]],
      ]),
      { ...NO_FOLD, ...SAMPLER }
    );
    expect(r.code.match(/_gpu_texat1600\(/g)).toHaveLength(3);
    expect(r.preamble!.match(/float _gpu_texat1600\(/g)).toHaveLength(1);
  });

  test('a `vars` mapping renames the sampler argument', () => {
    const ce = boardEngine();
    const r = glsl.compile(read(ce), {
      ...NO_FOLD,
      ...SAMPLER,
      vars: { S: 'u_board' },
    });
    expect(r.code).toBe('_gpu_texat1600(u_board, k)');
  });

  test('the object spelling `{ kind }` is the same hint', () => {
    const ce = boardEngine();
    const r = glsl.compile(read(ce), {
      ...NO_FOLD,
      storage: { S: { kind: 'sampler2D' } },
    });
    expect(r.code).toBe('_gpu_texat1600(S, k)');
  });

  test('the engine-level `compile()` entry threads the hint to the target', () => {
    const ce = boardEngine();
    const r = ce._compile(read(ce), { to: 'glsl', ...NO_FOLD, ...SAMPLER });
    expect(r.success).toBe(true);
    expect(r.code).toBe('_gpu_texat1600(S, k)');
    expect(r.preamble).toContain('float _gpu_texat1600(sampler2D v, float i)');
  });

  test('the hint is per call: the next call without it reads the array again', () => {
    const ce = boardEngine();
    expect(glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }).code).toBe(
      '_gpu_texat1600(S, k)'
    );
    expect(glsl.compile(read(ce), NO_FOLD).code).toBe('_gpu_at1600(S, k)');
  });

  test('a one-element list is admissible over a texture (no `vec1` question)', () => {
    const ce = engineWith({ S: 'list<number^1>', k: 'integer' });
    expect(() => glsl.compile(read(ce), NO_FOLD)).toThrow(/vec1/);
    expect(glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }).code).toBe(
      '_gpu_texat1(S, k)'
    );
  });

  test('an index typed `number` and an impure index both take the one-call form', () => {
    const ce = engineWith({ S: 'list<number^1600>', x: 'number' });
    expect(
      glsl.compile(ce.box(['At', 'S', 'x']), { ...NO_FOLD, ...SAMPLER }).code
    ).toBe('_gpu_texat1600(S, x)');
    const r = glsl.compile(ce.box(['At', 'S', ['Random']]), {
      ...NO_FOLD,
      ...SAMPLER,
    });
    expect(r.code).toMatch(/^_gpu_texat1600\(S, .+\)$/);
  });

  test('the absence marker as index still folds to NaN without touching the base', () => {
    const ce = boardEngine();
    const r = glsl.compile(ce.box(['At', 'S', 'Missing']), {
      ...NO_FOLD,
      ...SAMPLER,
    });
    expect(r.code).toBe('_gpu_nan()');
  });
});

// ---------------------------------------------------------------------------
// 2. The type of the hinted carrier: unfold a transparent alias, keep a
//    nominal reference folded.
// ---------------------------------------------------------------------------
describe('GLSL sampler-backed At — the carrier type', () => {
  test('a transparent alias of a counted list is read through it', () => {
    const ce = new ComputeEngine();
    ce.declareType('cells', 'list<number^1600>', { alias: true });
    ce.declare('S', 'cells');
    ce.declare('k', 'integer');
    expect(glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }).code).toBe(
      '_gpu_texat1600(S, k)'
    );
  });

  test('a NOMINAL type over the same list never reaches the lowering (control)', () => {
    // A nominal type is deliberately not a subtype of its definition, so `At`
    // refuses the carrier at canonicalization, before any compiler sees it.
    // The engine, not the storage hint, is what refuses here.
    const ce = new ComputeEngine();
    ce.declareType('board', 'list<number^1600>');
    ce.declare('S', 'board');
    ce.declare('k', 'integer');
    expect(read(ce).isValid).toBe(false);
  });

  test('an open-length list declines naming the storage kind and the length', () => {
    const ce = engineWith({ S: 'list<number>', k: 'integer' });
    const m = message(() => glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }));
    expect(m).toMatch(/"S" is sampler2D-backed/);
    expect(m).toMatch(/states no static length/);
  });

  test('an empty list declines', () => {
    const ce = engineWith({ S: 'list<number^0>', k: 'integer' });
    const m = message(() => glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }));
    expect(m).toMatch(/"S" is sampler2D-backed/);
    expect(m).toMatch(/empty list/);
  });

  test('a counted TUPLE carrier declines naming its type: the contract is a list', () => {
    const ce = engineWith({ S: 'tuple<number, number>', k: 'integer' });
    // The array form reads a counted tuple; the texture contract does not.
    expect(glsl.compile(read(ce), NO_FOLD).code).toBe('_gpu_at2(S, k)');
    const m = message(() => glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }));
    expect(m).toMatch(/"S" is sampler2D-backed/);
    expect(m).toMatch(/one-dimensional fixed-length list of numbers/);
    expect(m).toContain('tuple<number, number>');
  });

  test('a scalar carrier never reaches the lowering (control)', () => {
    // `At` over a non-collection is refused at canonicalization; the engine,
    // not the storage hint, is what refuses here.
    const ce = engineWith({ S: 'integer', k: 'integer' });
    expect(read(ce).isValid).toBe(false);
  });

  test('a two-dimensional list is pre-empted by the object-domain absence gate (control)', () => {
    // `At` over a multi-axis list answers a collection element
    // (`missing | vector<4>`), which the §3.F gate refuses ahead of any
    // target lowering — with or without the hint. The lowering's own
    // multi-axis arm is a backstop behind that gate.
    const ce = engineWith({ S: 'list<number^4x4>', k: 'integer' });
    const plain = message(() => glsl.compile(read(ce), NO_FOLD));
    const hinted = message(() =>
      glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER })
    );
    expect(plain).toMatch(/object-domain absent/);
    expect(hinted).toBe(plain);
  });

  test('complex elements decline: a texel holds one float', () => {
    const ce = engineWith({ S: 'list<complex^4>', k: 'integer' });
    const m = message(() => glsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER }));
    expect(m).toMatch(/"S" is sampler2D-backed/);
    expect(m).toMatch(/complex/);
  });
});

// ---------------------------------------------------------------------------
// 3. What a sampler-backed name may NOT do on the shader targets.
// ---------------------------------------------------------------------------
describe('sampler-backed At — the static-index and gather tiers read texels', () => {
  test('a static (literal) index is the same guarded read with a literal index', () => {
    // The array form folds to a subscript; a texture has no compile-time
    // coordinate (its width is read at run time), so the read stays a call.
    const ce = boardEngine();
    expect(glsl.compile(ce.box(['At', 'S', 3]), NO_FOLD).code).toBe('S[2]');
    expect(
      glsl.compile(ce.box(['At', 'S', 3]), { ...NO_FOLD, ...SAMPLER }).code
    ).toBe('_gpu_texat1600(S, 3.0)');
    expect(
      glsl.compile(ce.box(['At', 'S', -1]), { ...NO_FOLD, ...SAMPLER }).code
    ).toBe('_gpu_texat1600(S, -1.0)');
    // An out-of-range or zero literal folds to the NaN spelling, as it does
    // for the array form: the base is a symbol, so nothing is discarded.
    expect(
      glsl.compile(ce.box(['At', 'S', 0]), { ...NO_FOLD, ...SAMPLER }).code
    ).toBe('_gpu_nan()');
    expect(
      glsl.compile(ce.box(['At', 'S', 2000]), { ...NO_FOLD, ...SAMPLER }).code
    ).toBe('_gpu_nan()');
  });

  test('a gather is a vector of one guarded read per slot; a mask likewise', () => {
    const ce = boardEngine();
    expect(
      glsl.compile(ce.box(['At', 'S', ['List', 1, 3]]), {
        ...NO_FOLD,
        ...SAMPLER,
      }).code
    ).toBe('vec2(_gpu_texat1600(S, 1.0), _gpu_texat1600(S, 3.0))');
    // A negative entry counts from the end; the helper takes the 1-based
    // index, so the resolved slot is re-spelled 1-based.
    expect(
      glsl.compile(ce.box(['At', 'S', ['List', 1, -1, 2, 4]]), {
        ...NO_FOLD,
        ...SAMPLER,
      }).code
    ).toBe(
      'vec4(_gpu_texat1600(S, 1.0), _gpu_texat1600(S, 1600.0), ' +
        '_gpu_texat1600(S, 2.0), _gpu_texat1600(S, 4.0))'
    );
    // An out-of-range slot is the NaN component, as in the array form.
    expect(
      glsl.compile(ce.box(['At', 'S', ['List', 1, 3, 5000]]), {
        ...NO_FOLD,
        ...SAMPLER,
      }).code
    ).toBe('vec3(_gpu_texat1600(S, 1.0), _gpu_texat1600(S, 3.0), _gpu_nan())');
    // A gather with a runtime-valued entry keeps the array form's decline:
    // it is a missing tier of the gather, not of the storage kind.
    const m = message(() =>
      glsl.compile(ce.box(['At', 'S', ['List', 'k', 3]]), {
        ...NO_FOLD,
        ...SAMPLER,
      })
    );
    expect(m).toMatch(/DYNAMIC gather/);
    expect(m).not.toMatch(/sampler2D-backed/);
  });

  test('a reference outside a positional read fails closed, naming the kind', () => {
    const ce = boardEngine();
    for (const expr of [
      'S',
      ['Add', 'S', 1],
      ['Sum', 'S'],
      ['Multiply', 2, 'S'],
    ]) {
      const m = message(() =>
        glsl.compile(ce.box(expr), { ...NO_FOLD, ...SAMPLER })
      );
      expect(m).toMatch(/`S` is sampler2D-backed/);
      expect(m).toMatch(/read only through a positional access/);
    }
  });

  test('a `vars`-mapped reference outside a positional read fails closed too', () => {
    // A mapped symbol resolves through the `var` hook, never `mangleId`, so
    // the gate must sit on both.
    const ce = boardEngine();
    const m = message(() =>
      glsl.compile(ce.box(['Add', 'S', 1]), {
        ...NO_FOLD,
        ...SAMPLER,
        vars: { S: 'u_board' },
      })
    );
    expect(m).toMatch(/`S` is sampler2D-backed/);
  });

  test('`compileToSource()` refuses the option: it has no preamble channel', () => {
    const ce = boardEngine();
    expect(glsl.compileToSource(read(ce), NO_FOLD)).toBe('_gpu_at1600(S, k)');
    expect(() =>
      glsl.compileToSource(read(ce), { ...NO_FOLD, ...SAMPLER })
    ).toThrow(/compileToSource\(\) does not support the `storage` option/);
  });
});

describe('WGSL sampler-backed At — the per-binding texel read', () => {
  test('the read is a call of a helper generated per BINDING, not per length', () => {
    const ce = boardEngine();
    expect(wgsl.compile(read(ce), NO_FOLD).code).toBe('_gpu_at1600(S, k)');
    const r = wgsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER });
    expect(r.code).toBe('_gpu_texat_S_1600(k)');
    expect(r.preamble).toContain('fn _gpu_texat_S_1600(_gpu_i: f32) -> f32 {');
  });

  test('the helper body: guard, 0-based slot, run-time width, bare texture load', () => {
    const ce = boardEngine();
    const { preamble } = wgsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER });
    const body = preamble.slice(preamble.indexOf('fn _gpu_texat_S_1600('));
    // The texture is named directly: a WGSL texture cannot be a parameter.
    expect(body).toContain('let _gpu_w = i32(textureDimensions(S, 0).x);');
    expect(body).toContain(
      'return textureLoad(S, vec2i(_gpu_k % _gpu_w, _gpu_k / _gpu_w), 0).r;'
    );
    expect(body).toContain(
      '_gpu_k = select(1600 + _gpu_k, _gpu_k - 1, _gpu_k > 0);'
    );
    expect(body).not.toContain('sampler');
    // Same guard text as the array helper of the same length (one source);
    // only the index variable is spelled with the reserved prefix.
    const array = wgsl.compile(read(ce), NO_FOLD).preamble;
    const guard = (p: string, helper: string) =>
      /\n\s*if \((.*)\) \{\n/.exec(p.slice(p.indexOf(`fn ${helper}(`)))?.[1];
    expect(guard(preamble, '_gpu_texat_S_1600')!.replace(/_gpu_i/g, 'i')).toBe(
      guard(array, '_gpu_at1600')
    );
  });

  test('a binding named like the helper locals is not shadowed', () => {
    // The helper's parameter and locals carry the `_gpu_` prefix, so a
    // binding named `i`, `k` or `w` is still the texture inside the body.
    for (const name of ['i', 'k', 'w']) {
      const ce = boardEngine();
      const r = wgsl.compile(read(ce), {
        ...NO_FOLD,
        ...SAMPLER,
        vars: { S: name, k: 'idx' },
      });
      expect(r.code).toBe(`_gpu_texat_${name}_1600(idx)`);
      expect(r.preamble).toContain(`textureDimensions(${name}, 0)`);
      expect(r.preamble).toContain(`textureLoad(${name}, vec2i(`);
      expect(r.preamble).not.toMatch(new RegExp(`\\b(let|var) ${name}\\b`));
    }
  });

  test('the binding is the `vars`-mapped identifier, and one helper serves every read of it', () => {
    const ce = boardEngine();
    const r = wgsl.compile(ce.box(['Add', ['At', 'S', 'k'], ['At', 'S', 3]]), {
      ...NO_FOLD,
      ...SAMPLER,
      vars: { S: 'u_board' },
    });
    expect(r.code).toBe(
      '_gpu_texat_u_board_1600(3.0) + _gpu_texat_u_board_1600(k)'
    );
    expect(r.preamble.match(/fn _gpu_texat_u_board_1600\(/g)).toHaveLength(1);
    expect(r.preamble).toContain('textureDimensions(u_board, 0)');
  });

  test('a binding whose identifier carries underscores and digits is read back whole', () => {
    const ce = boardEngine();
    const r = wgsl.compile(read(ce), {
      ...NO_FOLD,
      ...SAMPLER,
      vars: { S: 'u_board_2' },
    });
    expect(r.code).toBe('_gpu_texat_u_board_2_1600(k)');
    expect(r.preamble).toContain('fn _gpu_texat_u_board_2_1600(_gpu_i: f32)');
    expect(r.preamble).toContain('textureLoad(u_board_2, ');
  });

  test('two sampler-backed lists get two helpers; an array list keeps its own', () => {
    const ce = engineWith({
      S: 'list<number^1600>',
      T: 'list<number^9>',
      L: 'list<number^5>',
      k: 'integer',
    });
    const r = wgsl.compile(
      ce.box(['Add', ['At', 'S', 'k'], ['At', 'T', 'k'], ['At', 'L', 'k']]),
      { ...NO_FOLD, storage: { S: 'sampler2D', T: 'sampler2D' } }
    );
    expect(r.code).toContain('_gpu_texat_S_1600(k)');
    expect(r.code).toContain('_gpu_texat_T_9(k)');
    expect(r.code).toContain('_gpu_at5(L, k)');
    expect(r.preamble).toContain('fn _gpu_texat_S_1600(');
    expect(r.preamble).toContain('fn _gpu_texat_T_9(');
    expect(r.preamble).toContain('fn _gpu_at5(');
  });

  test('the static-index and gather tiers read texels on WGSL too', () => {
    const ce = boardEngine();
    const O = { ...NO_FOLD, ...SAMPLER };
    expect(wgsl.compile(ce.box(['At', 'S', 3]), O).code).toBe(
      '_gpu_texat_S_1600(3.0)'
    );
    expect(wgsl.compile(ce.box(['At', 'S', ['List', 1, 3]]), O).code).toBe(
      'vec2f(_gpu_texat_S_1600(1.0), _gpu_texat_S_1600(3.0))'
    );
    expect(wgsl.compile(ce.box(['At', 'S', 0]), O).code).toBe(
      'bitcast<f32>(0x7fc00000u)'
    );
  });

  test('a `vars` mapping that is not a plain identifier declines, naming the kind', () => {
    const ce = boardEngine();
    const m = message(() =>
      wgsl.compile(read(ce), { ...NO_FOLD, ...SAMPLER, vars: { S: 'u.board' } })
    );
    expect(m).toMatch(/sampler2D-backed/);
    expect(m).toMatch(/not a plain identifier/);
  });

  test('the whole-value gate applies on WGSL as well', () => {
    const ce = boardEngine();
    expect(
      message(() => wgsl.compile(ce.box('S'), { ...NO_FOLD, ...SAMPLER }))
    ).toMatch(/`S` is sampler2D-backed/);
  });
});

// ---------------------------------------------------------------------------
// 4. Validation — on EVERY target — and the ignore rule off the shader lanes.
// ---------------------------------------------------------------------------
describe('`storage` option — validated everywhere, ignored off the shader targets', () => {
  const ce = boardEngine();
  const js = ce._getCompilationTarget('javascript')!;
  const interval = ce._getCompilationTarget('interval-js')!;
  const python = ce._getCompilationTarget('python')!;

  test('an unknown storage kind is an error on every target', () => {
    const bad = { storage: { S: 'buffer' } } as any;
    for (const target of [glsl, wgsl, js, interval, python]) {
      const m = message(() => target.compile(read(ce), bad));
      expect(m).toMatch(/Invalid compilation option "storage"/);
      expect(m).toMatch(/"buffer", which is not one this version knows/);
      expect(m).toMatch(/the storage kinds are: sampler2D/);
    }
    // The object spelling is checked the same way.
    expect(
      message(() =>
        glsl.compile(read(ce), { storage: { S: { kind: 'buffer' } } } as any)
      )
    ).toMatch(/"buffer", which is not one this version knows/);
  });

  test('a malformed hint value is an error', () => {
    for (const value of [1, null, ['sampler2D'], { type: 'sampler2D' }]) {
      const m = message(() =>
        glsl.compile(read(ce), { storage: { S: value } } as any)
      );
      expect(m).toMatch(/Invalid compilation option "storage"/);
      expect(m).toMatch(/must be a storage kind/);
    }
    expect(
      message(() => glsl.compile(read(ce), { storage: 'sampler2D' } as any))
    ).toMatch(/expected an object mapping symbol names to storage kinds/);
  });

  test('a hint naming something that is not a free symbol is an error on every target', () => {
    // The typo the validation exists for: `s` for `S`.
    const typo = { storage: { s: 'sampler2D' } } as const;
    for (const target of [glsl, wgsl, js, interval, python]) {
      const m = message(() => target.compile(read(ce), typo));
      expect(m).toMatch(/Invalid compilation option "storage"/);
      expect(m).toMatch(/"s" is not a free symbol of the expression/);
      expect(m).toMatch(/the free symbols are: S, k/);
    }
  });

  test('a symbol with an assigned value is folded, so a hint on it is an error', () => {
    const ce2 = engineWith({ k: 'integer' });
    ce2.assign('S', ce2.box(['List', 1, 2, 3, 4]));
    const m = message(() =>
      glsl.compile(ce2.box(['At', 'S', 'k']), { ...NO_FOLD, ...SAMPLER })
    );
    expect(m).toMatch(/"S" is not a free symbol/);
    expect(m).toMatch(/folded into the generated code, not read from storage/);
  });

  test('a symbol read only inside a user-defined function body IS free', () => {
    // `f(x) := At(S, x)`, compiled as `f(k)`: the lowering compiles `f`'s body
    // and reads `S` there, so the hint applies — the analysis must descend
    // into the body the way the compilation does.
    const ce2 = boardEngine();
    ce2.assign('f', ce2.box(['Function', ['At', 'S', 'x'], 'x']));
    const call = ce2.box(['f', 'k']);
    const r = glsl.compile(call, { ...NO_FOLD, ...SAMPLER });
    expect(r.success).toBe(true);
    // The specialized helper retains the free sampler read.
    expect(r.code).toBe('_fn_f(k)');
    expect(r.preamble).toContain('_gpu_texat1600(S, x)');
    expect(r.preamble).toContain('float _gpu_texat1600(sampler2D v, float i)');
    // Ignored, but accepted, on the JavaScript target.
    expect(js.compile(call, { ...NO_FOLD, ...SAMPLER }).success).toBe(true);
  });

  test('a caller-overridden function is never compiled, so its body reads nothing', () => {
    // With `functions: { f: 'texture_f' }` the emitted call is the caller's
    // implementation and `S` inside the engine's `f` is never read — the hint
    // then names nothing, which is the same error a typo raises.
    const ce2 = boardEngine();
    ce2.assign('f', ce2.box(['Function', ['At', 'S', 'x'], 'x']));
    const m = message(() =>
      glsl.compile(ce2.box(['f', 'k']), {
        ...NO_FOLD,
        ...SAMPLER,
        functions: { f: 'texture_f' },
      })
    );
    expect(m).toMatch(/"S" is not a free symbol/);
  });

  test('a DIRECT custom target refuses a non-empty hint set', () => {
    // A raw `createTarget()` target carries neither the reference gate nor
    // the preamble channel; honoring the hint there would emit a bare `S`
    // and an undeclared helper behind a reported success.
    const direct = glsl.createTarget();
    expect(() =>
      ce._compile(read(ce), { target: direct, ...SAMPLER, fallback: false })
    ).toThrow(/`storage` option is not supported on direct custom targets/);
    expect(() =>
      ce._compile(ce.box('S'), { target: direct, ...SAMPLER, fallback: false })
    ).toThrow(/`storage` option is not supported on direct custom targets/);
    // An empty hint set is fine, and the field is cleared on the reused target.
    direct.storage = new Map([['S', 'sampler2D']]);
    const r = ce._compile(read(ce), {
      target: direct,
      storage: {},
      ...NO_FOLD,
      fallback: false,
    });
    expect(r.code).toBe('_gpu_at1600(S, k)');
    expect(direct.storage).toBeUndefined();
  });

  test('a bound variable (a lambda parameter) is not a free symbol either', () => {
    const ce2 = engineWith({ k: 'integer' });
    const lambda = ce2.box(['Function', ['At', 'S', 'k'], 'S']);
    const m = message(() => js.compile(lambda, SAMPLER));
    expect(m).toMatch(/"S" is not a free symbol/);
  });

  test('the error is an option-contract error: `fallback: true` does not swallow it', () => {
    for (const target of [glsl, js, interval]) {
      expect(() =>
        target.compile(read(ce), {
          storage: { s: 'sampler2D' },
          fallback: true,
        })
      ).toThrow(/Invalid compilation option "storage"/);
    }
    // And through the engine-level entry, whose default IS to fall back.
    expect(() =>
      ce._compile(read(ce), { storage: { s: 'sampler2D' } })
    ).toThrow(/Invalid compilation option "storage"/);
    expect(() =>
      ce._compile(read(ce), { to: 'glsl', storage: { S: 'buffer' } } as any)
    ).toThrow(/Invalid compilation option "storage"/);
  });

  test('an empty hint set is not an error', () => {
    expect(glsl.compile(read(ce), { ...NO_FOLD, storage: {} }).code).toBe(
      '_gpu_at1600(S, k)'
    );
  });

  test('a valid hint is IGNORED on the JavaScript, interval and Python targets', () => {
    // One options bag serves every lane: the JavaScript lane receives the
    // same list in its argument bag, and the emitted code is unchanged.
    const plain = js.compile(read(ce), NO_FOLD);
    const hinted = js.compile(read(ce), { ...NO_FOLD, ...SAMPLER });
    expect(hinted.success).toBe(true);
    expect(hinted.code).toBe(plain.code);
    expect(hinted.code).not.toContain('sampler');
    const board = Array.from({ length: 1600 }, (_, i) => i * 10);
    expect(hinted.run!({ S: board, k: 3 })).toBe(20);
    expect(hinted.run!({ S: board, k: -1 })).toBe(15990);

    const iPlain = interval.compile(read(ce), NO_FOLD);
    const iHinted = interval.compile(read(ce), { ...NO_FOLD, ...SAMPLER });
    expect(iHinted.success).toBe(true);
    expect(iHinted.code).toBe(iPlain.code);

    const pPlain = python.compile(read(ce), NO_FOLD);
    const pHinted = python.compile(read(ce), { ...NO_FOLD, ...SAMPLER });
    expect(pHinted.success).toBe(true);
    expect(pHinted.code).toBe(pPlain.code);

    // The engine-level entry too, on its default (JavaScript) target.
    expect(ce._compile(read(ce), { ...NO_FOLD, ...SAMPLER }).code).toBe(
      plain.code
    );
  });
});
