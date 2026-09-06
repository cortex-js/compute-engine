# Sampler-backed positional access on the shader targets

**Status:** DRAFT — design proposal. Not implemented. The consumer-facing
questions are answered (section 3); section 8 lists what is still open, all of
it engine-side.
**Date:** 2026-09-05
**Scope:** `At` over a long fixed-length list on the GLSL and WGSL targets,
where the values live in a texture instead of a uniform array.

## 1. Proposal at a glance

A fixed-length list of numbers can already be read positionally in a shader.
The compiler emits a generated helper that indexes a uniform array:

```
ce.declare('S', 'list<number^1600>');
ce.declare('k', 'integer');
glsl.compile(ce.box(['At', 'S', 'k']))
```

emits `_gpu_at1600(S, k)`, plus this preamble:

```glsl
float _gpu_at1600(float v[1600], float i) {
  // 1-based; negative counts from the end; anything else -> NaN.
  if (!(i >= -1600.0 && i <= 1600.0) || i != floor(i) || i == 0.0)
    return _gpu_nan();
  int k = int(i);
  return v[(k > 0) ? k - 1 : 1600 + k];
}
```

The host supplies `uniform float S[1600];` and uploads the values.

This proposal adds a second storage kind for the same operation. The caller
names the storage in the compile options:

```
glsl.compile(expr, { storage: { S: 'sampler2D' } })
```

and the same expression emits `_gpu_texat1600(S, k)` with this preamble:

```glsl
float _gpu_texat1600(sampler2D v, float i) {
  // Same index contract as the array form.
  if (!(i >= -1600.0 && i <= 1600.0) || i != floor(i) || i == 0.0)
    return _gpu_nan();
  int k = (i > 0.0) ? int(i) - 1 : 1600 + int(i);
  int w = textureSize(v, 0).x;
  return texelFetch(v, ivec2(k % w, k / w), 0).r;
}
```

The host supplies `uniform sampler2D S;` and uploads a single-channel float
texture holding the list row-major from texel (0, 0).

Everything above the storage choice is unchanged: the same `At` expression, the
same index contract, the same fail-closed rules for everything that has no
shader lowering.

## 2. Why this is worth doing

A uniform array has a hard ceiling that a texture does not.

A shader's uniform storage is a device-dependent budget, and the guaranteed
minimum in OpenGL ES 3.0 is small — a few hundred four-component vectors. Real
desktop hardware allows far more, which is why a 1600-element array works in
practice today. But the amount is not something the compiler can know, a float
array is not guaranteed to pack four values per vector, and exceeding the
budget is a link-time failure on the device rather than a compile-time decline
the engine can report. A texture's ceiling is the maximum texture dimension,
whose guaranteed minimum is 2048 in each direction — millions of values.

The concrete consumer is Tycho's Game of Life entry. It keeps the board as one
flat list of N-squared integers in row-major order and reads one cell per
fragment. The board size that motivates this is **not** the uniform-array
limit. At 40x40 (1600 values) the array route works today, and 64x64 (4096
values) is where the array route runs out — but that is not the target either,
because the real ceiling today is the interpreter's per-generation cost, not
storage. Compiling the generation step on the JavaScript target (measured at 60
times the interpreter: 0.75 ms at 40x40, 12.6 ms at 200x200) makes **200x200,
or 40 000 cells,** realistic. That is what the texture path is for. The
uploader's cost per generation at that size is one texture sub-image upload of
40 000 floats, well under a millisecond.

The consumer's own recommendation is worth recording: given a compiled
generation step, it would use **only** the texture path and not the uniform
array at all — one lowering, one uploader, no size-dependent switch. That does
not mean the array path should be removed from the engine (section 7), but it
does mean the texture path is the one that has to be good.

The engine-side work is small because the hard part already exists. The index
contract, the guard that makes out-of-bounds unreachable, the on-demand
preamble generation, and the shape analysis are all built and tested for the
array form. What is missing is a way to say "these values live in a texture"
and a second helper body.

## 3. What the storage contract is

These were open questions; the consumer has answered them from what its
renderer already does. They are recorded here as the contract the lowering
implements.

**Format.** A single-channel 32-bit float texture, one value per texel, nearest
filtering. The read is a bare texel fetch with no denormalizing step. This
needs no WebGL extension: sampling such a texture is core in WebGL 2. (The two
extensions that sound relevant are not: one governs *rendering into* float
targets, the other *linear filtering*, and a texel fetch does neither.) The
precondition is WebGL 2, which the GPU lane already requires.

**Layout.** The list is one-dimensional storage in a fixed-width texture, laid
out row-major from texel (0, 0). The texture width is **not** tied to any
structure in the data. This is the important decision, and it went the opposite
way from the first draft of this document: it is tempting to make the texture
exactly as wide as the Game of Life board so that the board's own row and
column become the texel coordinates directly and the lowering needs no
arithmetic. That is wrong, because the compute engine sees a flat
`list<number^1600>` and nothing else. The row-major board arithmetic
(`1 + floor(x) + N*floor(y)`) belongs to the document and already appears in
the expression being compiled; the same list carrier may be indexed by anything
at all. So the lowering unflattens against the texture's own width and stays
ignorant of what the values mean. The uploader picks a width of
`min(length, cap)` for some cap within the maximum texture dimension, and a
height of `ceil(length / width)`.

The texture must never hold **fewer** texels than the declared length. This is
a precondition on the host, not something the shader can check, and it is
load-bearing: the guard bounds the index by the list's declared length, so an
index that passes the guard still fetches out of bounds if `width * height` is
smaller than that length. The guard makes an undefined fetch unreachable only
while `length <= width * height` holds. A larger texture is fine — the trailing
texels of the last row are simply never addressed.

**Where the width comes from.** From the texture itself, at run time, inside
the helper. Not baked into the emitted source, and not a second declared name.
This costs nothing measurable per fragment and it is the point of the path: a
write to the collection must not force the shader to be rebuilt. Baking the
width in would make the uploader mirror a compile-time rule exactly, and would
turn a resize into a recompile. An explicit width uniform is an acceptable
fallback if reading the texture's dimensions turns out to be a problem, but it
adds a second thing to the contract, which is otherwise exactly one sentence:
*a single-channel float sampler holding the list row-major from texel (0, 0).*

**Index contract.** Identical to the array form, with no border convenience. An
index is 1-based; a negative index counts from the end; zero, a non-integer, an
infinity, a NaN, and anything outside the range all produce NaN. The guard runs
entirely in float space and completes before any conversion to an integer,
because converting a value outside the integer range is undefined — this is
what makes the languages' own out-of-bounds behavior (undefined in GLSL,
indeterminate in WGSL) unreachable. No clamping and no wrapping at the border.
Wrap-around in the automaton lives in the list step that computes the next
generation, never in the display read, and two lowerings that answer
differently at the edges are not interchangeable, which is worth more than the
convenience.

**How it is selected.** A per-name storage hint in the compile options, not a
type spelling and not a new engine type:

```
resolveCECompile(expr, { to: 'glsl', storage: { S: 'sampler2D' } })
```

The default stays today's uniform-array lowering. The consumer's carrier is a
free engine symbol declared `list<number^N>` with no shader declaration at all
— it assembles the shader itself and injects `uniform sampler2D S;` in its own
preamble — so a hint on the compile call is both the least it can pass and the
only channel that reaches its route. A shader type spelling in the declaration
frame would be a reasonable second way to say the same thing for hosts that do
use `compileShader`, but it does not reach this consumer and is not required.

**Helper naming.** Distinct from the array helper, so one shader can carry both
lowerings for different lists. The emitted helper must be self-contained in the
compile result's preamble, exactly as `_gpu_atN` is.

**Behavior on a non-shader target.** The hint is **ignored** on a target that
has no shader storage, and is never an error there. The consumer compiles one
boxed expression to GLSL, to JavaScript and to the interval JavaScript target
from a single options bag; the hint describes where the data lives for the
shader only, and the JavaScript lane receives the same list in its argument
bag. Rejecting the hint would force the caller to strip it per target, which is
the per-target special case a shared options bag exists to avoid.

Typo safety is handled where it actually catches typos, and there it applies on
**every** target: an unknown storage kind is an error, and so is a hint naming
a symbol that is not a free symbol of the expression being compiled. Stated as
one rule: *ignored on non-shader targets; an unknown kind or an unknown name is
an error on every target.*

## 4. What exists today, and what it constrains

Three facts about the current path shape the implementation.

**The width comes from the engine type, and the helper is generated per
width.** `gpuAtBaseShape` reads a static element count off the base's type. The
emitted call names its width (`_gpu_at1600`), and `preambleFor` scans the
emitted source for `_gpu_at(\d+)` calls and generates exactly the helper bodies
that were used. Nothing keeps a per-compilation registry; the emitted text is
the record. The sampler form reuses this mechanism unchanged by scanning for a
differently-named call. Note that the width still appears in the helper name
and in the guard even though the texture's own width is read at run time: the
two are different numbers. The name's number is the list's **length**, which
bounds the index; the run-time number is the texture's **width**, which
unflattens it.

**A caller-declared name's shape comes from the declaration, not the type.**
When a name is declared as a `compileFunction` parameter or a `compileShader`
input or uniform, `gpuDeclaredShapeFrame` enters it in a local shape frame, and
that frame entry overrides the symbol's engine type. A spelling the frame
cannot parse is entered as unshaped, and every operation on the name then
declines. The storage hint must therefore be consulted on the free-symbol route
as well as the declared one, and on the free-symbol route it is the *only*
signal — there is no declaration to read.

**The consumer does not use the declaration route.** Its carrier is a free
engine symbol with no frame entry, and the length is read from the engine type.
A design expressing the storage kind as a shader type spelling would be
expressing it on a route this consumer does not take. This is why section 3
settles on a compile option.

## 5. What the two languages need

The emitted read differs between the targets, and one difference is structural
rather than cosmetic.

**GLSL.** A combined sampler type; the fetch takes integer coordinates and a
mip level, and the dimensions come from `textureSize`:

```glsl
int w = textureSize(v, 0).x;
return texelFetch(v, ivec2(k % w, k / w), 0).r;
```

The helper takes the sampler as a parameter, exactly as the array form takes
the array. The host may need `precision highp sampler2D` in its preamble; that
is the host's to declare, like the sampler itself.

**WGSL.** Textures and samplers are separate objects, and a texture cannot be
passed as an ordinary function parameter the way an array can. A WGSL helper
must therefore either reference a module-scope binding directly, or be
generated per binding name rather than per length. The fetch itself needs no
sampler, since an unfiltered integer load is the right operation, and the
dimensions come from `textureDimensions`.

This means the preamble scan cannot be keyed on length alone for WGSL. Either
the helper name incorporates the binding name (`_gpu_texat_S`), or WGSL inlines
the guarded read at the call site. Inlining would duplicate the guard per read,
which for the Game of Life neighbour sum is eight copies in one expression —
measurable, and worth avoiding. Generating per binding name is the better
answer, and it is a genuine divergence from how every other helper in this file
is generated (question 3 in section 8).

## 6. Suggested staging

1. **The storage hint and its plumbing.** The option surface, carried to the
   point where `gpuAtBaseShape` decides the base is admissible. No emission
   change yet; a sampler-backed name simply declines with a distinct reason.
2. **The GLSL read.** The per-length helper, the preamble scan, and the
   unflattening. This is the step that makes the Game of Life case work.
3. **The WGSL read.** Per-binding-name helper generation, the piece with no
   precedent in the file.
4. **Gathers and static indices.** `At(S, [1, 3])` currently folds to a vector
   constructor of individual reads, and a static index folds to a bare
   subscript. Both need texel equivalents rather than declining. Note that a
   static index cannot fold to a constant coordinate here, because the texture
   width is not known at compile time — it folds to a fetch with a computed
   coordinate, not to nothing.

Steps 1 and 2 are the useful minimum. Steps 3 and 4 do not block the consumer.

## 7. What does not change

- **The JavaScript target is untouched.** Its by-reference form reads a plain
  array from the argument bag, and that is what the consumer's CPU lane uses.
  The storage hint is a shader-target concern: on the JavaScript targets it is
  ignored outright and must not reach or alter that lowering. Its *validation*
  still runs there — an unknown storage kind, or a hint naming something that
  is not a free symbol of the expression, is an error on every target.
- **The existing uniform-array form stays.** The consumer would use only the
  texture path, but the array path is correct, tested, and reachable by other
  callers; this proposal adds a storage kind rather than replacing one.
- **Whole-array operations keep failing closed.** Arithmetic over the whole
  list, reductions (`Sum(S)`, `Max(S)`), and a length read all continue to
  decline. A shader has no dynamic iteration and a texture does not change
  that. The consumer needs none of these in the shader; that work is its
  generation step, on a different lane.
- **The decline reasons stay mutually distinguishable.** A consumer chooses a
  fallback lane by reading them. A sampler-backed list that cannot be lowered
  needs its own distinct reason for the same purpose.
- **The index contract is shared.** If the two forms disagree about what index
  0 or index -1 means, they are not interchangeable and the storage choice
  stops being transparent.

## 8. Open questions

All engine-side; the consumer-facing ones are settled in section 3.

1. **Does the storage hint belong on the compile options or on the target?** A
   target instance is reused across compilations; an option is per-compilation.
   Per-compilation is almost certainly right, but the hint must then travel
   through the same channel as `constantFold`, which is worth confirming
   against how that option is currently threaded.
2. **What is the hint's value space?** The consumer proposes the string
   `'sampler2D'`. A string is the smallest thing that works, but if a second
   storage kind ever appears (a buffer binding, say) the option becomes a
   union of magic strings. An object with a `kind` field costs nothing now and
   avoids that. Whichever shape is chosen, the value must be **validated** —
   an unrecognized kind is an error, on every target — because that validation
   is what carries the typo safety given the hint is otherwise ignored off the
   shader targets (section 3).
3. **Is the per-binding-name WGSL helper acceptable?** Every other helper in
   the file is generated per shape, and the preamble scan is deliberately keyed
   on emitted text rather than on a registry. A per-binding-name helper still
   fits that scan, but it is a new pattern and should be a deliberate choice.
4. **Which lowerings must learn to decline a sampler-backed name?** It should
   decline with a reason naming the storage kind wherever there is no texel
   form, but that set needs enumerating rather than discovering one at a time.
5. **Does the length still have to be static?** The helper's guard uses the
   list length as its bound, which today comes from the engine type. If a
   sampler-backed list could have an open length, the bound would have to come
   from the texture's dimensions too (`width * height`), which is a different
   guard and admits a partly-filled last row. Worth deciding now, because it
   affects whether the open-element-type declines in section 7 stay correct.

## 9. Non-goals

- Writing to a texture. This is a read path only; values are produced elsewhere
  and uploaded by the host.
- Making the storage kind automatic. The compiler will not choose a texture
  because a list is large; the host knows how it uploads its data and says so.
- Multi-dimensional lists. The consumer's board is a flat list with a computed
  index, and the two-dimensional list spelling declines on `At` for separate
  reasons this proposal does not address.
