# Tycho rows 461, 462 and 463: CE design answers for the WebGPU lane

Date: 2026-10-27. Status: design answers, not implemented. CE ROADMAP entries
CE-571 (row 461), CE-572 (row 462), CE-573 (row 463); Tycho ledger
`~/dev/tycho/docs/COMPUTE_ENGINE.md`.

Terms:

- **WGSL**: the WebGPU Shading Language, CE target `wgsl`
  (`src/compute-engine/compilation/wgsl-target.ts` holds the WGSL spelling;
  the shared shader code generator is `compilation/gpu-target.ts`).
- **Host**: the program that calls CE and runs the shader (here, Tycho).
- **Uniform**: a value that is the same for all shader invocations. The host
  changes it by writing a buffer; the shader is not recompiled.
- **Storage buffer**: a GPU buffer that a shader reads as an array. Its last
  member can be an array whose length is known only at run time.
- **Decline**: CE refuses to compile and returns `success: false` with a
  `diagnostic` (`{ code, kind, message }`, `compilation/types.ts`).
- **f32**: the 32-bit float, the only usable float type of WGSL (about 7
  decimal digits; integers are exact up to 2^24 = 16,777,216).
- **ulp**: one unit in the last place, the gap between a float and the next.

All code below was produced on 2026-10-27 with `npx tsx` from CE main (after
0.171.0), with `x`, `y`, `z`, `c` declared `real`.

## Row 461 (CE-571): a field function for a compute job over a 3-D grid

### What CE supplies today

Three entry points emit WGSL (read in `wgsl-target.ts` and run):

1. `compile(expr, { to: 'wgsl', vars, storage, … })` returns `code` (one
   expression, or several lines that end with `return …;`), a separate
   `preamble` with the helpers, and `freeSymbolTypes` (the CE type and the
   WGSL type of each free symbol). Gyroid, `vars: { x: 'x', y: 'y', z: 'z',
   c: 'c' }`:

   ```wgsl
   -c + sin(z) * cos(x) + sin(x) * cos(y) + sin(y) * cos(z)
   ```

   The built-in `sin`/`cos` are used because each operand is a declared
   finite real mapped to its own name (CE-526). With `vars` that map to
   struct fields (`{ x: 'p.x', …, c: 'params.c' }`) the code is
   `-params.c + _gpu_sin(p.z) * _gpu_cos(p.x) + …`, and the preamble declares
   `_gpu_isnonfinite`, `_gpu_sin`, `_gpu_cos` (NaN for a non-finite operand).

2. `WGSLTarget.compileFunction(expr, name, returnType, parameters, options?)`
   returns one WGSL function with its helpers in front:

   ```wgsl
   fn _gpu_isnonfinite(x: f32) -> bool { … }  // tests the exponent bits
   fn _gpu_sin(x: f32) -> f32 {
     let bits = 0x7fc00000u;
     return select(sin(x), bitcast<f32>(bits), _gpu_isnonfinite(x));
   }
   fn _gpu_cos(x: f32) -> f32 { … }
   fn field(x: f32, y: f32, z: f32, c: f32) -> f32 {
     return -c + _gpu_sin(z) * _gpu_cos(x) + _gpu_sin(x) * _gpu_cos(y) + _gpu_sin(y) * _gpu_cos(z);
   }
   ```

   `options` accepts only `constantFold` (no `vars`, no `storage`). A decline
   throws; there is no diagnostic object.

3. `WGSLTarget.compileShader({ type: 'compute', workgroupSize, inputs,
   uniforms, body })` returns a whole module with `@compute
   @workgroup_size(…) fn main(…)`. Each uniform gets its own
   `@group(g) @binding(b) var<uniform>`. There is no storage-buffer output.

So the gyroid already compiles to a function that a host compute entry point
can call, and a change of `c` is a uniform write. The metaballs witness (ten
centers in `P: list<number^30>`) also compiles; each read is
`_gpu_at30(P, k)`.

### What is missing

1. **No one call gives the function, its helpers and its parameter layout.**
   `compile()` gives a fragment of two possible shapes that the host must
   wrap; `compileFunction()` wraps it but takes no `vars`/`storage` and
   gives no diagnostic.
2. **Helpers collide when two fields share one module.** `compileFunction()`
   prepends the full preamble, so two fields that use `sin` declare
   `_gpu_sin` twice, which is a WGSL error. The `_gpu_*` names encode their
   variant (`_gpu_at30`), but user functions are named from user names
   (`_fn_h`), so two documents can emit different bodies under one name.
3. **No parameter layout.** One `var<uniform>` per parameter uses one binding
   each; WebGPU guarantees only 12 uniform buffers per stage
   (`maxUniformBuffersPerShaderStage`). A list cannot be a plain
   `var<uniform> P: array<f32, 30>`: the uniform address space requires an
   array stride that is a multiple of 16 bytes, unless the host checks for
   the newer language extension `uniform_buffer_standard_layout`.
4. **A list is copied on each read.** `_gpu_atN(v: array<f32, N>, i)` takes
   the list by value and copies it (`var a = v;`). See finding F1.

### Recommendation for 461

Add one method, `WGSLTarget.compileFieldFunction()`, and document it with a
recipe. CE does not write the entry point, the dispatch or the mesher.

```ts
compileFieldFunction(expr: Expression, options: {
  name: string;                    // WGSL name of the field function
  coordinates: string[];           // ['x', 'y', 'z'], passed as f32 arguments
  paramsStruct?: string;           // default 'CEParams'
  paramsVariable?: string;         // default 'ce_params'; the host declares it
  storage?: Record<string, StorageHint>;   // as compile(); see row 462
  constantFold?: boolean;
}): {
  success: boolean;
  diagnostic?: CompileDiagnostic;  // on a decline, as compile()
  warnings?: CompileDiagnostic[];
  function: string;                // fn <name>(x: f32, y: f32, z: f32) -> f32 { … }
  helpers: Record<string, string>; // helper name -> WGSL source
  paramsStructSource: string;      // struct CEParams { c: f32, … }
  params: Array<{ name: string; ceType: string; wgslType: string;
                  offset: number; size: number }>;
  paramsSize: number;              // bytes, a multiple of 16
};
```

Contract:

- The free symbols in `coordinates` are `f32` arguments. Every other free
  symbol is a **parameter**, read as `ce_params.<name>` from one uniform
  struct. The host declares `@group(G) @binding(B) var<uniform> ce_params:
  CEParams;` and writes the values at the `params` offsets. A parameter change
  is a buffer write: no recompile, no new pipeline. As implemented
  (2026-10-27, after the review): a symbol with a value in the engine is a
  parameter too, unless it is a constant (`Pi`, or declared constant) or its
  value is a function. The field function does not read that value, nor any
  fact it gives (the sign of `a := 5` does not remove the `abs` of `|a|`,
  also when the type of `a` was inferred from its value; the same holds for
  a coordinate with a value), so a host that keeps slider values as assigned
  symbols gets the same text for each value.
- A real or integer scalar parameter is `f32`. A list `list<number^n>` is
  `array<vec4f, ceil(n/4)>` (16-byte stride); element k (1-based) is
  component `(k-1) % 4` of entry `(k-1) / 4`, with the index rules of today's
  `At` (a negative index counts from the end; 0, a non-integer or an index
  out of range gives NaN). A list above a set limit (proposed 1024 elements,
  16 KB of the 64 KB that `maxUniformBufferBindingSize` guarantees), a list
  of unknown length, and a complex, string or boolean parameter decline with
  a message that names the storage buffer of row 462.
- The result must be a real scalar. A complex, vector, boolean or list result
  declines (`kind: 'capability'`).
- Helpers are returned by name. CE guarantees that a helper name always has
  the same source text in every compilation, so the host merges the maps of
  several fields by name. User functions get a prefix from `name`:
  `_fn_<k>_<name>_h`, with k the length of `name` (as implemented; the
  length keeps the field `my` with the function `field_h` and the field
  `my_field` with the function `h` from having one name).
- As implemented with CE-572: a symbol with a `'storage-buffer'` hint is not
  a struct field. The field function reads it by `At`, `Length`, the
  reductions and a `Sum` to `Length(S)`, also inside the user-defined
  functions it calls. Its struct type (`CE_List_f32`) is in `helpers` under
  the struct name, its `@group(G) @binding(B) var<storage, read>`
  declaration under the WGSL name of the buffer, and its layout in
  `storageBuffers`, as `compile()` gives it. The struct has the same text
  for one element type. The buffer declaration has the same text only for
  the same hint (group and binding) and the same element type: it is the
  one exception to "a helper name always has the same source" (decision
  2026-10-27). A host that merges fields gives each buffer name one hint in
  every field; two different texts under one key mean that the hints of the
  fields disagree, and the host treats that as an error.
- Everything that declines on `compile(…, { to: 'wgsl' })` declines here with
  the same diagnostic: recursion, an unseeded `Random` (use
  `WithRandomSeed`), `Integrate` (CE-280.1), a body that assigns a
  parameter, a list of unknown length (until row 462), a constant outside the
  f32 range.
  As implemented, measured on 2026-10-27: `compile()` accepts a body that
  assigns a parameter (it writes a local copy) and a constant outside the f32
  range (it emits `_gpu_inf()`). The field function declines a body that
  assigns a coordinate or a parameter (it cannot write its inputs); names
  that only the body assigns are its locals. It accepts a constant outside
  the f32 range as `compile()` does. It also declines: a body with no value
  to return (the check of `compileFunction()`), a `Return` whose value is not
  `f32`, a user-defined function that reads a coordinate it does not take as
  a parameter (it is declared at module scope, where the coordinates do not
  exist; each reachable user-defined function is checked on its own), and a
  user-defined function that declares the name `paramsVariable`. A `name`,
  `paramsStruct`, `paramsVariable` or coordinate that is a predeclared WGSL
  function or type (`sin`, `vec4f`) throws: it would hide the built-in that
  the helpers call; so does one that starts with `CE_List_`, the prefix of
  the storage-buffer structs. A storage buffer whose name is a predeclared
  WGSL name declines, in `compile()` too. A parameter struct above the
  65,536 bytes of `maxUniformBufferBindingSize` (the default limit of the
  WebGPU specification) declines and points to storage buffers.
- Documented numerical limits: f32 arithmetic; NaN and infinity computed at
  run time are not guaranteed on GPUs (a division by zero can give a finite
  value); `sin`/`cos` of large arguments lose accuracy; a sine hash is
  reported in `warnings` (`float32-unsafe-argument`).

Work: medium, about one session. It reuses `compileDeclaredFunctionBody` and
`preambleFor` (`gpu-target.ts`); new are the parameter struct, the packed
list read, the helper map and the user-function prefix. Tests: the gyroid and
metaballs witnesses, two fields in one module, a parameter change with the
same compiled text, each decline above, and a GPU run in headless Chromium.

Smaller option, recipe only: document how to wrap `compile()` output in a
function and map parameters with `vars: { c: 'params.c' }`. This works today
but leaves gaps 2 to 4 to the host, and a parameter mapped to a struct field
keeps the NaN guards (`_gpu_sin` in place of `sin`, one `select` per call).

## Row 462 (CE-572): a storage-buffer input for a list of changing length

### What CE supplies today

- A fixed-length list is a value (`_gpu_at22500(S, i)` over an
  `array<f32, 22500>` that the host supplies), or, with
  `storage: { S: 'sampler2D' }`, a texture that the host declares
  (`var S: texture_2d<f32>`). Game of life, `S: list<number^22500>`:

  ```wgsl
  _gpu_texat_S_22500(N * floor(y) + floor(x) + 1.0)

  fn _gpu_texat_S_22500(_gpu_i: f32) -> f32 {
    if (!(_gpu_i >= -22500.0 && _gpu_i <= 22500.0) || _gpu_i != floor(_gpu_i) || _gpu_i == 0.0) {
      return _gpu_nan();
    }
    … // 1-based index to a texel; width from textureDimensions(S, 0)
    return textureLoad(S, vec2i(_gpu_k % _gpu_w, _gpu_k / _gpu_w), 0).r;
  }
  ```

  New contents are a texture write. The length 22500 is in the helper name
  and the guard, so a new length needs a new compile. A texture-backed list
  can only be read by position; a reduction over it declines
  (`gpuRefuseStorageReference`, `gpu-target.ts`).
- A list of unknown length (`list<number>`) declines. Messages, verbatim:
  `At`: "the base (type `list<number>`) has no statically known length, and
  a shader value must have one."; `Length`: "the 'wgsl' 'length()' builtin is
  the Euclidean norm (CE 'Norm'), not a count."; `Sum`: "the operand `S`
  lowers to a shader array with no compile-time component list, so there is
  nothing for the reduction to fold over".
- `StorageKind` has one value, `'sampler2D'` (`compilation/types.ts`).

### Recommendation for 462

Add a storage kind `'storage-buffer'` on WGSL only (GLSL declines it: WebGL2
has no storage buffers):
`storage: { S: { kind: 'storage-buffer', group: 1, binding: 0 } }`.

CE emits the declaration in the preamble, because its helpers name the
binding:

```wgsl
struct CE_List_S { len: u32, data: array<f32> }
@group(1) @binding(0) var<storage, read> S: CE_List_S;
```

- `len` is the **logical length**, written by the host. The buffer can be
  larger than the list; a length change is one 4-byte write, with no new
  buffer, bind group or compile. `len = 0` is the empty list. (With a bare
  `array<f32>` and `arrayLength()`, an empty list is impossible, because
  WebGPU requires at least one element in the binding of a run-time-sized
  array, and each length change needs a new bind group.)
- Element type: `f32` for a list of real or integer values (stride 4 bytes).
  A list of points of dimension 2 to 4 is `array<vecNf>`; WGSL gives `vec2f`
  a stride of 8 bytes and `vec3f`/`vec4f` a stride of 16, so a 3-D point
  takes 16 bytes. Complex elements, strings, booleans and nested lists
  decline.
- Index rules: as today's `At` (1-based, negative from the end; 0, a
  non-integer, NaN, infinity or an absolute value above `len` gives NaN). The
  guard also tests `len <= arrayLength(&S.data)`, so a wrong `len` gives NaN,
  not an out-of-bounds read. An index above 2^24 is not exact in f32, so the
  documented size limit is 16.7 million elements.
- Operations that read the binding: `At(S, i)` (a `_gpu_sbat_S(i)` helper),
  `Length(S)` (`f32(S.len)`), `Sum`, `Product`, `Max`, `Min`, `Mean` of `S`
  and `\sum_{k=1}^{Length(S)} f(S_k, k)` (a loop
  `for (var k = 0u; k < S.len; k++)`). An empty list gives the value of the
  `javascript` target (sum 0, product 1; `Max`, `Min`, `Mean` pinned by
  tests). Anything that builds a list of run-time length (`Map` over `S`, a
  comprehension, `S + 1`) still declines (CE-280, width ceiling). A reduction
  runs once per invocation: 22,500 reads per pixel for the full board. CE
  documents this; the host decides.

Tests (asked by row 462): values against the `javascript` target for an
empty list, a one-element list, a length change with the same compiled text,
negative and out-of-range indices, and a `len` above the buffer size. Tycho
measures upload and update cost. `RotateLeft` and the index-floor helper of
row 460 are separate.

Work: medium to large, one or two sessions: the storage kind and its
validation, the declaration, the `At` helper, `Length`, the loop for five
reductions, GPU tests in headless Chromium.

## Row 463 (CE-573): an `interval-wgsl` target

### History

`interval-wgsl` existed from 0.50.0 (2026-02-11) to 2026-02-20 (commit
`b541210b42eb25058d03c4cf5af871138a7ec54d`, 1,669 lines, no outward
rounding). `interval-glsl` came back in 0.61.0 as a per-cell exclusion test
(the CPU kept curve extraction); 0.62.0 added outward rounding (1 ulp for
`+ − ×`, 8 ulp for `/`, `sqrt`, `exp`, `ln`, 32 ulp for `pow`; a `sin`/`cos`
pad off by default). 0.77.0 (2026-07-13) removed it, for two reasons in the
CHANGELOG: the gain exists only when the whole pipeline stays on the GPU, and
it could not compile comparisons, so not restrictions. Row 463 removes the
first reason (no read-back per level). The second must be solved from the
start.

### What a sound f32 interval target needs

**Outward rounding without rounding modes.** WGSL has no directed rounding.
CE would move each computed endpoint outward by k ulps with integer
operations on the bit pattern:

```wgsl
fn _iv_down(x: f32, k: u32) -> f32 {   // k ulps toward -infinity
  let b = bitcast<u32>(x);
  if ((b & 0x7FFFFFFFu) == 0u) { return -1.17549435e-38; } // 0 -> -smallest normal
  return bitcast<f32>(select(b + k, b - k, x > 0.0));
}
```

(`_iv_up` is the mirror.) The step from 0 goes to the smallest *normal*
value, so the bound stays valid on a GPU that flushes subnormals to zero,
which WGSL permits. The integer operations also stop a backend from fusing or
reordering the float operations across them. Cost: about 5 operations per
endpoint, so about 10 per interval operation, plus the operation itself (an
interval product is 4 products and 6 `min`/`max`). Expect 10 to 30 times the
cost of the scalar kernel.

**Error bounds in the WGSL specification** (section "Floating Point
Accuracy", f32):

| Operation                    | Bound                                                     |
| ---------------------------- | --------------------------------------------------------- |
| `+`, `-`, `*`                | correctly rounded (either neighbor of the exact value)    |
| `/`                          | 2.5 ulp for a divisor of magnitude in [2^-126, 2^126]     |
| `inverseSqrt`; `sqrt`        | 2 ulp; `sqrt` inherits the bound of `1/inverseSqrt(x)`    |
| `exp`, `exp2`                | 3 + 2·abs(x) ulp                                          |
| `log`, `log2`                | absolute 2^-21 for x in [0.5, 2]; 3 ulp outside           |
| `sin`, `cos`                 | absolute 2^-11 for x in [-π, π]; **no bound outside**     |
| `tan`, `pow`, `asin`, …      | inherited from a formula (`sin/cos`, `exp2(y·log2 x)`, …) |
| `atan`, `atan2`              | 4096 ulp                                                  |
| `abs`, `min`, `max`, `floor` | exact                                                     |

So arithmetic, `sqrt`, `exp` and `log` can be widened by a fixed number of
ulps. `sin` and `cos` cannot use the built-in outside [-π, π]: CE must reduce
the argument itself with a bounded error, then widen by 2^-11 (about
5·10^-4) absolute, which makes trigonometric enclosures much wider than on
`interval-js`. CE's own `+`/`*` polynomial with a proven remainder is the
alternative; it is slower and needs its own proof. These are the bounds the
specification promises; the 0.62.0 work found that ANGLE on Metal did not
meet the GLSL ES bounds, so each GPU family must be measured.

**No IEEE special values.** WGSL lets an implementation assume that no
infinity or NaN occurs, and an overflow gives an unspecified value. The
encoding cannot use them:

```wgsl
struct IV { lo: f32, hi: f32, flags: u32 }
// 1 EMPTY, 2 ENTIRE, 4 PARTIAL_LO, 8 PARTIAL_HI, 16 SINGULAR, 32 MISSING
```

Each operation reads the exponent bits of its operands (with `bitcast`, as
`_gpu_isnonfinite` does today) and returns ENTIRE when an endpoint reaches a
threshold (proposed 2^60), before an overflow can occur. A comparison gives
a `u32` tri-state (0 false, 1 true, 2 maybe); `And`, `Or`, `Not` use
three-valued logic. "false", the only result that lets the host reject a
cell, needs operands with no flag other than PARTIAL and strictly separated
endpoints. Every other case is "maybe". So no rejection depends on f32
rounding or on GPU NaN behavior.

The flags map to the `interval-js` kinds (`interval/types.ts`): `interval`
(no flag), `empty`, `entire`, `partial` (the `domainClipped` side),
`singular`. The `at`, `atOperand` and `continuity` fields of `singular` have
no GPU form in a first version; the host evaluates such a cell on
`interval-js`.

**Declines.** At compile time, a head with no sound kernel declines the whole
expression, with a `diagnostic.code` that names the head. At run time, the
unknown result is ENTIRE (or "maybe" for a relation), never a rejection.

**Minimal set** (proposal): `+ − × ÷`, integer powers, `Sqrt`, `Abs`, `Exp`,
`Ln`, `Sin`, `Cos` (own reduction), `Floor`, `Ceil`, `Min`, `Max`, the six
comparisons, `And`, `Or`, `Not`, `When` (restriction), `Which` (piecewise).

### Evidence CE needs before building it

1. A profile where interval evaluation is the main cost. Tycho's C37 profile
   (`sin(x²)+sin(y²)=0`) shows 314–344 ms in contour extraction and 214–245
   ms in refinement.
2. A measured prototype: C37 and one trigonometric lattice as hand-written
   WGSL with the widening above, against `interval-js` on the CPU workers at
   the same cell counts. This gives the real ratio after the 10–30x cost.
3. Measured accuracy of `sin`, `cos`, `exp`, `log`, `/`, `sqrt` on each GPU
   family Tycho supports, against the table. One GPU outside a bound makes
   the target unsound there.
4. The containment tests of row 463 (poles, tangencies, isolated zeros,
   branch boundaries, subnormals, overflow) on those GPUs: each GPU result
   must contain the `interval-js` (f64) result.

### Recommendation for 463

**Not now.** The profile does not show interval evaluation as the main cost;
the f32 trigonometric bounds make enclosures wide, so the GPU would reject
fewer cells than `interval-js`; soundness depends on GPU behavior that CE
cannot test in CI. The work is large: the removed GLSL version was about
1,700 lines and needed a second release for soundness, and this one adds
comparisons, three-valued logic, flags and argument reduction. CE keeps the
contract above for use when evidence items 1 and 2 arrive.

## Findings outside the three requests

- **F1.** `_gpu_atN` on WGSL copies the whole list into a function-scope
  variable (`var a = v;`, `gpuAtPreamble`, `gpu-target.ts`). Above 2048
  elements this exceeds the 8192 bytes of function-scope variables that the
  WGSL specification guarantees. `\sum_{k=1}^{22500} S_k` also emits the
  copy inside the loop (`var _tv2 = S;` on each pass). Not checked on a GPU.
- **F2.** `compileShader()` names the input struct `VertexInput` for every
  stage, compute included, and accepts a body that reads free symbols (`x`,
  `y`) that nothing declares; the shader then fails only on the GPU.

## Questions for the CE owner

**Decided 2026-10-27 by the user:** Q1 (a), Q2 (a), Q3 (a), Q4 (a); Q5: file
F1 and F2 (ROADMAP CE-574 and CE-575) and fix them.

**Q1 (461). Add `compileFieldFunction()`, or document a recipe only?**
- (a) Add the method. Tycho gets the layout, mergeable helpers and declines
  in one call; CE adds about one session of work and a public API.
- (b) Recipe only. No new API; Tycho does helper merging, the parameter
  struct and list packing, and struct-field parameters keep the NaN guards.
- No decision: CE-571 stays open; Tycho has no documented interface.
Recommendation: (a).

**Q2 (461, 462). Who declares the bindings?**
- (a) CE emits the parameter struct type and the storage-buffer declarations
  (with the group and binding the host passes); the host declares the one
  `var<uniform>`. The layout cannot disagree with the code.
- (b) The host declares everything from a layout table that CE returns. A
  mismatch then fails on the GPU, not in CE.
- No decision: the work on rows 461 and 462 cannot start.
Recommendation: (a).

**Q3 (462). Where is the logical length?**
- (a) A `len: u32` header in the buffer. Empty lists work; a length change is
  one 4-byte write.
- (b) `arrayLength()`. No header, but no empty list, and a new bind group per
  length change.
- (c) A separate uniform: two bindings per list.
- No decision: CE-572 stays a design.
Recommendation: (a).

**Q4 (463). Interval target on WGSL.**
- (a) Not now; keep this contract and wait for evidence items 1 and 2.
- (b) A prototype for evidence item 2, not shipped: about one session of
  hand-written WGSL for two expressions; Tycho measures.
- (c) Build the minimal set: several sessions, plus a GPU test lane per GPU
  family.
- No decision: same as (a).
Recommendation: (a).

**Q5 (F1, F2).** File both as ROADMAP entries, and fix F1 after a GPU check?
No decision: they stay unfiled, and a positional read of a list above 2048
elements on WGSL may fail in some browsers.
