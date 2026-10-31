// Shader library definitions and their subset selection, with the rounding and
// integer-power helpers.

import type { Expression, RoundingTies } from '../global-types.js';
import { tryGetConstant, formatFloat } from './constant-folding.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { gpuOperandOnce } from './gpu-draw-order.js';
import { gpuOperandShape } from './gpu-shapes.js';
import { gpuScalarType, gpuVecType } from './gpu-emit.js';

/** One helper function definition, cut out of a multi-function library. */
interface GpuLibraryDefinition {
  /** The declared function name, e.g. `_gpu_hsv_to_rgb`. */
  name: string;
  /** Its whole source, comments above it included, with no final newline. */
  source: string;
  /**
   * The blank lines that separate this definition from the one before it, kept
   * verbatim so that a subset containing EVERY definition reproduces the
   * library string byte for byte.
   */
  lead: string;
  /** Matches this definition's name as a whole word. */
  reference: RegExp;
  /**
   * The indices of the definitions this one CALLS. Computed once, when the
   * library is split, because it is a property of the library text and never
   * of the compilation asking for a subset.
   */
  calls: number[];
}

/**
 * The split of each library string, kept so a library is parsed once per
 * process rather than once per compilation. The key is the library text
 * itself, which is a module constant and never changes.
 */
const GPU_LIBRARY_DEFINITIONS = new Map<string, GpuLibraryDefinition[]>();

/**
 * The head of a top-level function definition, anchored at column 0 — `fn
 * _gpu_x(` in WGSL, `vec3 _gpu_x(` or `float _gpu_x(` in GLSL, with an
 * optional precision qualifier (`highp float _gpu_x(`). Every definition in
 * these library strings starts in column 0 and everything inside a body is
 * indented, so the anchor is what tells a declaration apart from a local
 * variable of the same shape.
 */
const GPU_LIBRARY_DEFINITION_HEAD =
  /^(?:fn[^\S\n]+([A-Za-z_]\w*)|(?:(?:highp|mediump|lowp)[^\S\n]+)?[A-Za-z_]\w*(?:\[\d+\])?[^\S\n]+([A-Za-z_]\w*))[^\S\n]*\(/;

/** Cut a multi-function library string into its individual definitions. */
function gpuLibraryDefinitions(library: string): GpuLibraryDefinition[] {
  const cached = GPU_LIBRARY_DEFINITIONS.get(library);
  if (cached !== undefined) return cached;
  const defs: GpuLibraryDefinition[] = [];
  let lines: string[] = [];
  let lead = '';
  let name: string | undefined;
  let depth = 0;
  for (const line of library.split('\n')) {
    // A blank line between two definitions belongs to neither; it is kept as
    // the next definition's separator.
    if (lines.length === 0 && line.trim() === '') {
      lead += '\n';
      continue;
    }
    lines.push(line);
    // A line comment can hold a brace, and one of these libraries does hold a
    // comment with braces in it, so the depth count reads the code only.
    const code = line.replace(/\/\/.*$/, '');
    if (name === undefined) {
      const head = GPU_LIBRARY_DEFINITION_HEAD.exec(code);
      if (head !== null) name = head[1] ?? head[2];
    }
    for (const c of code) {
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
    }
    if (name !== undefined && depth === 0 && code.includes('}')) {
      defs.push({
        name,
        source: lines.join('\n'),
        lead,
        reference: new RegExp(`(?<![\\w$])${name}(?![\\w$])`),
        calls: [],
      });
      lines = [];
      lead = '';
      name = undefined;
    }
  }
  // A definition can only call one declared BEFORE it: both languages require
  // a declaration to precede its use, so a library string is written in
  // dependency order and the search is over the earlier entries alone.
  for (let i = 0; i < defs.length; i++)
    for (let j = 0; j < i; j++)
      if (defs[j].reference.test(defs[i].source)) defs[i].calls.push(j);
  GPU_LIBRARY_DEFINITIONS.set(library, defs);
  return defs;
}

/**
 * The definitions of `library` that `code` actually needs — the ones it names,
 * plus everything those call, in the library's own order.
 *
 * A shader preamble is compiled by the driver with the shader, once per
 * program, so an unused definition is paid for on every first draw. Before
 * this pass a single `hsv` conversion carried all fourteen colour-space
 * functions (6.1 KB), and a Mandelbrot row carried the Julia iteration.
 * (Measured by the Tycho code-generation audit of 2026-09-08.)
 *
 * The pass runs BACKWARD because a library's source order is already its
 * dependency order: both languages require a function to be declared before
 * it is called, so a definition can only be called by a LATER one. One
 * backward sweep therefore closes the set, and emitting the survivors in
 * source order keeps the declaration-before-use property.
 */
export function gpuLibrarySubset(code: string, library: string): string {
  const defs = gpuLibraryDefinitions(library);
  const keep: boolean[] = defs.map((d) => d.reference.test(code));
  for (let i = defs.length - 1; i >= 0; i--)
    if (keep[i]) for (const j of defs[i].calls) keep[j] = true;
  let preamble = '';
  for (const d of defs.filter((_d, i) => keep[i]))
    preamble += `${preamble === '' ? d.lead || '\n' : d.lead}${d.source}\n`;
  return preamble;
}

/**
 * The shader code of the step form `Floor(x, step)`, `Ceil(x, step)` or
 * `Truncate(x, step)`: `round(q) * k` with `k = |step|` and `q = x / k`,
 * where `round` is `floor`, `ceil` or `trunc`, and `q` is taken to the
 * nearest integer when it is within 4 ulps (of `f32`) of it: the float of a
 * decimal step is not the decimal, and `0.3 / 0.1` is not `3` (the
 * JavaScript runtime's `_SYS.floorStep` does the same).
 *
 * A scalar operand goes through the `_gpu_step_quotient` preamble helper
 * (`GPU_ROUND_PREAMBLE_GLSL`), which writes it once. A `vecN` operand uses
 * the same computation inline, made of componentwise functions only: there
 * `step(d, t)` is `1` when the distance `d` to the nearest integer is at
 * most the tolerance `t`, and `mix` then takes that integer. The inline form
 * splices the operand more than once, so an impure operand (a draw from the
 * `Random` family) is bound to a hoisted temporary (`gpuOperandOnce`), and
 * so is an impure step, which both forms splice twice.
 *
 * A constant step is folded. A constant zero step fails closed: the result
 * is `NaN`, and neither language has a `NaN` literal.
 */
export function gpuRoundToStep(
  round: string | ((q: string, isScalar: boolean) => string),
  x: Expression,
  step: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>,
  unit: 1 | 0.5 = 1
): string {
  const name = typeof round === 'string' ? round : 'Round';
  const apply = (q: string, isScalar: boolean) =>
    typeof round === 'string' ? `${round}(${q})` : round(q, isScalar);
  const c = tryGetConstant(step);
  if (c !== undefined && (c === 0 || !Number.isFinite(c)))
    throw new Error(
      `Could not compile \`${name}\` with a step of ${c}: the result is NaN, ` +
        `and the ${target.language ?? 'GPU'} target has no NaN literal.`
    );
  const k =
    c !== undefined
      ? formatFloat(Math.abs(c), target.language)
      : `abs(${gpuOperandOnce(name, step, compile, target)})`;
  // `unit` is the distance between two jumps of the quotient: 1 for
  // `Floor`, `Ceil` and `Truncate`, 0.5 for `Round`, whose quotient is
  // taken to the nearest half-integer (`_gpu_half_step_quotient`). The
  // tolerance is relative to the quotient only, so a non-zero quotient is
  // never taken to be `0`. A non-zero quotient that underflows to `0` (with
  // a finite step) keeps the sign of `x` as the smallest normal float
  // (`Ceil(1e-30, 1e30)` is `1e30`), and when the quotient overflows (with
  // a non-zero step), `x` is the nearest float to the multiple
  // (`_gpu_step_fix`). A zero step gives `NaN`. The operand is spliced more
  // than once, so an impure one is bound to a hoisted temporary
  // (`gpuOperandOnce`).
  if (gpuOperandShape(x) === 'scalar') {
    const xc = gpuOperandOnce(name, x, compile, target);
    const helper =
      unit === 1 ? '_gpu_step_quotient' : '_gpu_half_step_quotient';
    const m = `${apply(`${helper}(${xc}, ${k})`, true)} * ${k}`;
    return `_gpu_step_fix(${m}, ${xc}, ${k})`;
  }
  const width = gpuOperandShape(x);
  if (typeof width !== 'number')
    throw new Error(
      `Could not compile \`${name}\` with a step: the operand is not a ` +
        `scalar or a vector.`
    );
  // A `vecN` operand: the same computation, componentwise. A choice between
  // two vectors is a SELECTION (`select` in WGSL, `mix` with a boolean
  // vector in GLSL), never the arithmetic `mix(a, b, t)`, which gives `NaN`
  // when the other branch is infinite. Both sides of a comparison are
  // vectors: WGSL has no comparison of a vector with a scalar.
  const isWGSL = target.language === 'wgsl';
  const vt = gpuVecType(width, isWGSL);
  const choose = (
    a: string,
    b: string,
    l: string,
    op: '<=' | '>' | '==',
    r: string
  ): string => {
    if (isWGSL) return `select(${a}, ${b}, ${l} ${op} ${r})`;
    const fn = { '<=': 'lessThanEqual', '>': 'greaterThan', '==': 'equal' }[op];
    return `mix(${a}, ${b}, ${fn}(${l}, ${r}))`;
  };
  // The operand, the step and the quotients are bound to temporaries when
  // the position has a statement before it (`BaseCompiler.canHoist`), so
  // that each is written once; otherwise they are spliced.
  const hoist = BaseCompiler.canHoist(target);
  const bind = (value: string, type: string): string => {
    if (!hoist || /^[A-Za-z_]\w*$/.test(value)) return value;
    const t = BaseCompiler.tempVar(target);
    BaseCompiler.hoistStatement(
      target,
      isWGSL ? `var ${t}: ${type} = ${value};` : `${type} ${t} = ${value};`
    );
    return t;
  };
  const xv = bind(gpuOperandOnce(name, x, compile, target), vt);
  const kv = c !== undefined ? k : bind(k, gpuScalarType(isWGSL));
  const q0 = bind(`(${xv} / ${kv})`, vt);
  // The smallest normal float of the sign of `x`, for a quotient that
  // underflows: `0` for an infinite step, whose quotient is truly `0`.
  const tiny =
    c !== undefined
      ? '1.17549435e-38'
      : isWGSL
        ? `select(0.0, 1.17549435e-38, ${kv} < 3.4e38)`
        : `(${kv} < 3.4e38 ? 1.17549435e-38 : 0.0)`;
  const q = bind(
    choose(q0, `(sign(${xv}) * ${tiny})`, q0, '==', `${vt}(0.0)`),
    vt
  );
  const r = unit === 1 ? `round(${q})` : `(round(${q} * 2.0) * 0.5)`;
  const snapped = bind(
    choose(q, r, `abs(${q} - ${r})`, '<=', `4.8e-7 * abs(${q})`),
    vt
  );
  const m = `(${apply(snapped, false)} * ${kv})`;
  // A zero step makes `abs(q0)·0` `NaN`, which is not `> 3.4e38`: the
  // result stays `NaN`.
  const big = c !== undefined ? `abs(${q0})` : `(abs(${q0}) * sign(${kv}))`;
  // Parenthesized: the outer call does not take the operands of the
  // rounding head one for one, and the operand-shape check
  // (`gpuCheckOperandShapes()`) reads an emission that starts with a call
  // as such a call.
  return `(${choose(m, xv, big, '>', `${vt}(3.4e38)`)})`;
}

/**
 * The shader code that rounds `c` to an integer, with a value halfway between
 * two integers rounded with the rule `ties` (see `RoundingTies`).
 *
 * Neither language's own `round()` can be used for a rule other than
 * `to-even`: both round a tie to the EVEN neighbour (GLSL leaves the choice
 * to the implementation; its `roundEven()` is defined to round to even).
 *
 * A SCALAR operand (`isScalar`) goes through a preamble helper
 * (`GPU_ROUND_PREAMBLE_GLSL`), which writes the operand once. A `vecN`
 * operand uses an inline form made of componentwise functions only. In that
 * form, `ceil(0.5 + 0.5 * sign(d - 0.5))` is `1` when `d ≥ 0.5` and `0`
 * otherwise, and `floor(…)` of the same value is `1` only when `d > 0.5`.
 *
 * The forms do not add `0.5` to the operand: in `f32`, `x + 0.5` is rounded
 * when `|x| ≥ 2²³`, and `floor(8388609.0 + 0.5)` is `8388610.0`. The
 * distance `d` to the floor of the magnitude is exact.
 */
export function gpuRoundToInteger(
  c: string,
  ties: RoundingTies,
  isScalar: boolean,
  isWGSL: boolean
): string {
  if (ties === 'to-even') return isWGSL ? `round(${c})` : `roundEven(${c})`;
  if (isScalar) {
    const helper = {
      'away-from-zero': '_gpu_round',
      'toward-zero': '_gpu_round_tz',
      'toward-positive-infinity': '_gpu_round_up',
      'toward-negative-infinity': '_gpu_round_down',
    }[ties];
    return `${helper}(${c})`;
  }
  const atLeastHalf = (d: string) => `ceil(0.5 + 0.5 * sign(${d} - 0.5))`;
  const overHalf = (d: string) => `floor(0.5 + 0.5 * sign(${d} - 0.5))`;
  // The operand can be an infix expression (`v + w`): it is put in
  // parentheses where it is an operand of `-`.
  const x = /^[\w.]+$/.test(c) ? c : `(${c})`;
  const m = `floor(abs(${c}))`;
  switch (ties) {
    case 'away-from-zero':
      return `(sign(${c}) * (${m} + ${atLeastHalf(`abs(${c}) - ${m}`)}))`;
    case 'toward-zero':
      return `(sign(${c}) * (${m} + ${overHalf(`abs(${c}) - ${m}`)}))`;
    case 'toward-positive-infinity':
      return `(floor(${c}) + ${atLeastHalf(`${x} - floor(${c})`)})`;
    case 'toward-negative-infinity':
      return `(ceil(${c}) - ${atLeastHalf(`ceil(${c}) - ${x}`)})`;
  }
}

/**
 * The sign-preserving integer power over a `vecN` base, componentwise: the
 * `_gpu_powiN` overload family (`_gpu_powi2`, `_gpu_powi3`, `_gpu_powi4`).
 *
 * The scalar `_gpu_powi` is declared with `float`/`f32` parameters, so a
 * vector base has no lowering through it and the operand-shape gate declines
 * the call. The widened bodies are the same computation over the genType:
 * `pow` and `abs` are componentwise in both languages, and the exponent stays
 * a SCALAR at every call site (the operand-shape gate declines a vector
 * exponent), so both `if` conditions remain the scalar `bool` a shader
 * requires. As in the scalar helper, `n` may be NEGATIVE and the parity test
 * is taken on `abs(n)`: GLSL `mod` is floored and WGSL `%` is truncated, so a
 * bare `n` would miss the odd branch on WGSL.
 *
 * The per-component sign is restored by multiplying `r` with `-1` where
 * `x < 0` and with `1` elsewhere, because a vector has no single sign to
 * branch on. This is the scalar body's rule per component. It is not
 * `sign(x) * r`: at `x == 0` with a negative exponent, `r` is `+∞` and
 * `sign(0) * ∞` is `0 · ∞ = NaN`, where the scalar helper answers `+∞`
 * (CE-243).
 *
 * The name carries the width because WGSL has no function overloading; GLSL
 * would accept one name for all four declarations, but one spelling serves
 * both languages.
 */
export function gpuPowiVecPreamble(n: number, isWGSL: boolean): string {
  const v = gpuVecType(n, isWGSL);
  if (isWGSL)
    return `
fn _gpu_powi${n}(x: ${v}, n: f32) -> ${v} {
  if (n == 0.0) { return ${v}(1.0); }
  if (n == 2.0) { return x * x; }
  if (n == 3.0) { return x * x * x; }
  if (n == 4.0) { let s = x * x; return s * s; }
  let r = pow(abs(x), ${v}(n));
  if ((abs(n) % 2.0) == 1.0) { return select(${v}(1.0), ${v}(-1.0), x < ${v}(0.0)) * r; }
  return r;
}
`;
  return `
${v} _gpu_powi${n}(${v} x, float n) {
  if (n == 0.0) return ${v}(1.0);
  if (n == 2.0) return x * x;
  if (n == 3.0) return x * x * x;
  if (n == 4.0) { ${v} s = x * x; return s * s; }
  ${v} r = pow(abs(x), ${v}(n));
  if (mod(abs(n), 2.0) == 1.0) return mix(${v}(1.0), ${v}(-1.0), lessThan(x, ${v}(0.0))) * r;
  return r;
}
`;
}

/**
 * The `_gpu_powi` overloads `code` calls: `'scalar'` for the `float`/`f32`
 * form, and the widths of the `_gpu_powiN` vector forms — deduplicated, so a
 * helper used many times is declared once. Read off the EMITTED source rather
 * than kept in a per-compilation table, like every other `preambleFor` scan.
 *
 * Anchored on a CALL SITE with a name boundary on both ends, the way
 * `gpuAtHelperWidths` is and for the same reason: a user symbol that merely
 * SPELLS a helper name (`_gpu_powi3` as a free variable) must not make the
 * target emit a declaration that then collides with it. The trailing boundary
 * is load-bearing too — without it a plain `/_gpu_powi\s*\(/` test also
 * matches `_gpu_powi3(`, and a compilation that uses only the vector form
 * would get the scalar declaration it never calls.
 *
 * A caller holding only a helper NAME (the operand-shape gate, asking what
 * declaration the helper has) spells a synthetic call site, `${name}(`.
 */
export function gpuPowiHelperForms(code: string): Array<'scalar' | number> {
  const scalar = /(?<![\w$])_gpu_powi\s*\(/.test(code);
  const widths = new Set<number>();
  const re = /(?<![\w$])_gpu_powi([234])\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) widths.add(Number(m[1]));
  return [
    ...(scalar ? (['scalar'] as const) : []),
    ...[...widths].sort((a, b) => a - b),
  ];
}
