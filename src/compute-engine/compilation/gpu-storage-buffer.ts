/**
 * The WGSL text of a `'storage-buffer'` list (the `storage` compile option):
 * the struct and the binding declaration of the buffer, its layout, and the
 * helpers that read it.
 *
 * The buffer of the list `S` holds its logical length and its elements:
 *
 * ```wgsl
 * struct CE_List_f32 { len: u32, data: array<f32> }
 * @group(1) @binding(0) var<storage, read> S: CE_List_f32;
 * ```
 *
 * The struct is named by its element type (`CE_List_f32`, `CE_List_vec2f`,
 * `CE_List_vec3f`, `CE_List_vec4f`), so one name always has the same text,
 * and a host that merges the preambles of several compilations keeps one
 * copy of each struct. The `var` line is declared once per buffer.
 *
 * The host writes the length at byte offset 0 and the elements from the
 * offset of `data`. The buffer can hold more elements than `len`, so a
 * change of length is one 4-byte write, with no new buffer, bind group or
 * compilation. Every helper first tests `S.len <= arrayLength(&S.data)`: a
 * `len` larger than the elements the buffer holds gives NaN, never a read
 * outside the buffer. The length (`storageBufferLength`) is then the number
 * of elements the buffer holds, so that a loop bounded by it stops.
 *
 * The functions of this module produce text only. They read no expression
 * and no compile target, so that each shader compilation route that accepts
 * the `storage` option can use them. The lowering that decides which helper
 * an expression calls is in `gpu-at.ts` (`compileGPUStorageBufferAt`) and
 * `gpu-reduce.ts` (the reductions).
 *
 * Design record: section "Row 462 (CE-572)" of
 * `docs/plans/2026-10-27-tycho-rows-461-463-gpu-design-answers.md`.
 */

import type { StorageBufferBinding, StorageBufferLayout } from './types.js';

/** The reductions over a storage-buffer list that have a helper. */
export type StorageBufferReduction = 'sum' | 'prod' | 'max' | 'min' | 'mean';

/**
 * The layout of a storage-buffer list whose elements have `components` f32
 * components (1 for a number, 2 to 4 for a point), declared as `name` at
 * `binding`.
 *
 * The offsets follow the WGSL memory layout rules: a struct member starts at
 * a multiple of the alignment of its type, and the stride of an array is
 * the size of its element rounded up to the alignment of the element. `f32`
 * has alignment 4 and size 4; `vec2f` alignment 8 and size 8; `vec3f`
 * alignment 16 and size 12; `vec4f` alignment 16 and size 16. So `data`
 * starts at byte 4, 8 or 16 after the 4-byte `len`, and the stride of a
 * `vec3f` is 16 bytes, not 12.
 */
export function storageBufferLayout(
  symbol: string,
  name: string,
  binding: StorageBufferBinding,
  components: number
): StorageBufferLayout {
  const element =
    components === 1
      ? 'f32'
      : (`vec${components}f` as 'vec2f' | 'vec3f' | 'vec4f');
  const align = components === 1 ? 4 : components === 2 ? 8 : 16;
  return {
    symbol,
    name,
    struct: `CE_List_${element}`,
    group: binding.group,
    binding: binding.binding,
    element,
    components,
    lengthOffset: 0,
    dataOffset: align,
    stride: align,
    minBindingSize: 2 * align,
  };
}

/**
 * The WGSL declarations of the buffers of `layouts`: each struct once, then
 * one `var` line per buffer.
 */
export function storageBufferDeclarations(
  layouts: ReadonlyArray<StorageBufferLayout>
): string {
  const structs = new Set<string>();
  let result = '\n';
  for (const layout of layouts) {
    if (structs.has(layout.struct)) continue;
    structs.add(layout.struct);
    result += `struct ${layout.struct} { len: u32, data: array<${layout.element}> }\n`;
  }
  for (const layout of layouts)
    result +=
      `@group(${layout.group}) @binding(${layout.binding}) ` +
      `var<storage, read> ${layout.name}: ${layout.struct};\n`;
  return result;
}

/**
 * The name of the helper that reads element `i` (1-based) of the buffer
 * `name`: `_gpu_sbat_<name>` for a list of numbers, `_gpu_sbatp<M>_<name>`
 * for a list of points of `M` coordinates.
 */
export function storageBufferAtHelper(
  name: string,
  components: number
): string {
  return components === 1
    ? `_gpu_sbat_${name}`
    : `_gpu_sbatp${components}_${name}`;
}

/** The name of the helper of `reduction` over the buffer `name`. */
export function storageBufferReductionHelper(
  reduction: StorageBufferReduction,
  name: string
): string {
  return `_gpu_sb${reduction}_${name}`;
}

/**
 * The WGSL code of the length of the list of the buffer `name`: its `len`
 * header, or the number of elements the buffer holds when `len` is larger.
 * With a `len` that is too large every read gives NaN, and a loop bounded by
 * the length stops after the elements of the buffer, not after `len`
 * passes (a `len` of 2^31 would otherwise run until the GPU times out).
 */
export function storageBufferLength(name: string): string {
  return `f32(min(${name}.len, arrayLength(&${name}.data)))`;
}

/**
 * Does `code` read the buffer `name`? It does when it reads its length or
 * its elements (`name.len`, `name.data`), which every helper and the length
 * do.
 */
export function storageBufferIsRead(code: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${name}\\.(len|data)\\b`).test(code);
}

/**
 * The definitions of the storage-buffer helpers that `code` calls, each
 * once, in first-use order. They are read off the helper names, as the other
 * helper scans of the shader targets read theirs: the name of the buffer is
 * the identifier after the prefix, up to the parenthesis of the call. The
 * helpers call `_gpu_nan()`, `_gpu_isnonfinite` and the NaN-safe `_gpu_max`
 * and `_gpu_min`; the caller adds those from a scan of the returned text.
 */
export function storageBufferHelpers(code: string): string {
  const seen = new Set<string>();
  let result = '';
  const re =
    /(?<![\w$])_gpu_sb(at|atp[234]|sum|prod|max|min|mean)_([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const key = `${m[1]}_${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const op = m[1];
    const name = m[2];
    if (op === 'at') result += storageBufferAtDefinition(name, 1);
    else if (op.startsWith('atp'))
      result += storageBufferAtDefinition(name, Number(op.slice(3)));
    else
      result += storageBufferReductionDefinition(
        op as StorageBufferReduction,
        name
      );
  }
  return result;
}

/**
 * The helper that reads element `i` of the buffer `name`. The index rules
 * are those of `At`: 1-based, a negative index counts from the end, and 0,
 * a non-integer, NaN, an infinity or an index whose absolute value is above
 * `len` gives NaN (a vector of NaN for a point).
 *
 * Two guards are needed. The float guard runs before the integer
 * conversion, which is undefined for NaN and outside the range of `i32`. It
 * tests a non-finite index by its bit pattern (`_gpu_isnonfinite`), because
 * a compiler may assume that no NaN occurs and remove a float comparison
 * that only a NaN fails. The integer guard tests the 0-based slot against
 * `len` after the conversion: `f32(len)` rounds above 2^24 (a `len` of
 * 16777219 gives 16777220.0), so the float guard alone could let the index
 * `len + 1` through. The parameter and the locals have the reserved `_gpu_`
 * prefix, so that a buffer named `i` or `k` is not hidden by them.
 */
function storageBufferAtDefinition(name: string, components: number): string {
  const t = components === 1 ? 'f32' : `vec${components}f`;
  const nan = components === 1 ? '_gpu_nan()' : `${t}(_gpu_nan())`;
  return `
fn ${storageBufferAtHelper(name, components)}(_gpu_i: f32) -> ${t} {
  // 1-based; negative counts from the end; anything else → NaN. The list
  // has ${name}.len elements, and a len above the elements that the buffer
  // holds gives NaN. The float guard runs before the int cast; the int
  // guard catches the rounding of f32(len) above 2^24.
  let _gpu_n = ${name}.len;
  let _gpu_b = f32(_gpu_n);
  if (_gpu_n > arrayLength(&${name}.data) || _gpu_isnonfinite(_gpu_i) || !(_gpu_i >= -_gpu_b && _gpu_i <= _gpu_b) || _gpu_i != floor(_gpu_i) || _gpu_i == 0.0) {
    return ${nan};
  }
  let _gpu_k = i32(_gpu_i);
  let _gpu_j = select(i32(_gpu_n) + _gpu_k, _gpu_k - 1, _gpu_k > 0);
  if (_gpu_j < 0 || u32(_gpu_j) >= _gpu_n) {
    return ${nan};
  }
  return ${name}.data[_gpu_j];
}
`;
}

/**
 * The helper of a reduction over the list of numbers of the buffer `name`.
 * The values of the empty list are those of the `javascript` target: a sum
 * of 0, a product of 1, and NaN for the maximum, the minimum and the mean.
 * The maximum and the minimum use the NaN-safe `_gpu_max` and `_gpu_min`,
 * so a NaN element gives NaN, as on the `javascript` target.
 */
function storageBufferReductionDefinition(
  reduction: StorageBufferReduction,
  name: string
): string {
  const head = `fn ${storageBufferReductionHelper(reduction, name)}() -> f32 {
  // A len above the elements that the buffer holds gives NaN.
  let _gpu_n = ${name}.len;`;
  const loop = (from: string, step: string): string =>
    `  for (var _gpu_k = ${from}; _gpu_k < _gpu_n; _gpu_k++) {\n    ${step}\n  }`;
  const x = `${name}.data[_gpu_k]`;
  const tooLong = `_gpu_n > arrayLength(&${name}.data)`;
  if (reduction === 'max' || reduction === 'min')
    return `
${head}
  if (_gpu_n == 0u || ${tooLong}) {
    return _gpu_nan();
  }
  var _gpu_a = ${name}.data[0];
${loop('1u', `_gpu_a = _gpu_${reduction}(_gpu_a, ${x});`)}
  return _gpu_a;
}
`;
  if (reduction === 'mean')
    return `
${head}
  if (_gpu_n == 0u || ${tooLong}) {
    return _gpu_nan();
  }
  var _gpu_a = 0.0;
${loop('0u', `_gpu_a += ${x};`)}
  return _gpu_a / f32(_gpu_n);
}
`;
  const isSum = reduction === 'sum';
  return `
${head}
  if (${tooLong}) {
    return _gpu_nan();
  }
  var _gpu_a = ${isSum ? '0.0' : '1.0'};
${loop('0u', `_gpu_a ${isSum ? '+=' : '*='} ${x};`)}
  return _gpu_a;
}
`;
}
