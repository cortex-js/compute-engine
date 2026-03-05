# Constant Folding for Compilation Targets

## Problem

The GPU compiler emits redundant code for complex number construction and
real arithmetic. For example, `x + yi` compiles to
`vec2(x, 0.0) + (y * vec2(0.0, 1.0))` instead of `vec2(x, y)`.

## Approach

Add helper utilities for constant inspection and term folding, then update
the `GPU_FUNCTIONS` handlers to use them. Folding happens at compile time
by inspecting the expression tree — no string-level peephole passes.

## Helper Utilities

New file: `src/compute-engine/compilation/constant-folding.ts`

### `tryGetConstant(expr: Expression): number | undefined`

Returns a compile-time numeric constant if the expression is a literal
number (integer, rational, float). Returns `undefined` for symbols,
function expressions, or non-finite values.

### `tryGetComplexParts(expr, compile, target): { re: string | null, im: string | null }`

Decomposes an expression into real and imaginary code-string contributions.
`null` means zero (no contribution to that component).

Patterns handled:
- `Complex(a, b)` with constant parts
- `ImaginaryUnit` -> `{ re: null, im: "1.0" }`
- `Multiply(k, ImaginaryUnit)` -> `{ re: null, im: compiled(k) }`
- `Multiply(...reals, ImaginaryUnit, ...reals)` -> separate real product as im
- Plain real expr -> `{ re: compiled, im: null }`

### `foldTerms(terms: string[], identity: string, op: '+' | '*'): string`

Combines compiled string terms with an operator:
- Folds numeric literals (`"2.0" + "3.0"` -> `"5.0"`)
- Eliminates identities (`x + 0.0` -> `x`, `x * 1.0` -> `x`)
- Handles absorbing elements (`x * 0.0` -> `0.0`)
- Returns identity for empty array, term itself for single-element

## Handler Changes (gpu-target.ts)

### Add

1. No complex operands: use `foldTerms` on compiled real terms.
2. Complex operands: partition all operands into real/imaginary contributions
   via `tryGetComplexParts`, collect parts, fold each with `foldTerms`,
   emit `vec2(realSum, imagSum)`.

### Multiply

1. Real-only: use `foldTerms` for constant folding and identity elimination.
2. `Multiply(scalar, ImaginaryUnit)`: emit `vec2(0.0, scalar)` directly.
3. `Multiply(scalars..., complexExpr)`: fold scalar part first, then
   scalar-multiply the complex expression.

### Negate

- `Negate(Complex(a,b))`: emit `vec2(-a, -b)`.
- `Negate(constant)`: fold to negated constant.
- `Negate(ImaginaryUnit)`: emit `vec2(0.0, -1.0)`.

### Divide

- `Divide(constant, constant)`: fold to result.
- `Divide(a, constant)`: fold constant divisor.
- Complex path unchanged (uses `_gpu_cdiv`).

### Power

- `Power(x, 0)` -> `1.0`
- `Power(x, 1)` -> `x`
- `Power(x, 2)` -> `(x * x)`
- `Power(x, -1)` -> `(1.0 / x)`
- `Power(x, 0.5)` -> `sqrt(x)`
- `Power(constant, constant)` -> fold to result.

### Sqrt

- `Sqrt(constant)` -> fold to result.
- `Sqrt(0)` -> `0.0`, `Sqrt(1)` -> `1.0`.

### Root

- `Root(x, 2)` -> `sqrt(x)`.
- `Root(constant, constant)` -> fold to result.

## Testing

New file: `test/compute-engine/compile-constant-folding.test.ts`

### vec2 construction
- `x + yi` -> `vec2(x, y)`
- `x + 3i` -> `vec2(x, 3.0)`
- `2x + 3yi` -> `vec2(2.0 * x, 3.0 * y)`
- `3 + 4i` -> `vec2(3.0, 4.0)` (already works)
- `0 + yi` -> `vec2(0.0, y)`

### Real folding
- `2 + 3` -> `5.0`
- `x + 0` -> `x`
- `x * 1` -> `x`
- `x * 0` -> `0.0`
- `(2 + 3) * x` -> `5.0 * x`

### Identity elimination
- `Power(x, 0)` -> `1.0`
- `Power(x, 1)` -> `x`
- `Sqrt(4)` -> `2.0`
- `Divide(6, 3)` -> `2.0`

### Operator-specific
- `Negate(Complex(3, 4))` -> `vec2(-3.0, -4.0)`
- `Power(x, 2)` -> `(x * x)`
- `Root(x, 2)` -> `sqrt(x)`

## Scope

- Primary target: GPU (GLSL/WGSL)
- Helpers are target-agnostic so JS target can adopt them later
- No changes to expression canonicalization or simplification
