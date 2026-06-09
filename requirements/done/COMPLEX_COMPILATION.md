# Complex Number Compilation

Add compile-time support for complex-valued expressions in the JavaScript
compilation target. The compiler performs static type analysis to determine
whether each subexpression is real or complex, and emits the appropriate code
path. No runtime type dispatch is generated.

## Current State

The compilation pipeline (`base-compiler.ts:49-51`) explicitly rejects complex
numbers:

```typescript
if (expr.im !== 0) throw new Error('Complex numbers are not supported');
```

`ImaginaryUnit` is mapped to `Number.NaN` in the JavaScript target, and the
`CompileTarget.number()` method only accepts real `number` values.

Complex numbers are fully supported in the boxed expression system:
`BoxedNumber` exposes `.re`, `.im`, and `.isReal` properties. The `complex-esm`
library is already a dependency, and the `ce.complex(re, im)` factory returns
`Complex` instances.

## Design

### Runtime Representation

Complex values in compiled JavaScript are plain objects `{ re: number, im: number }`.

This matches the `complex-esm` constructor input format and avoids allocating
`Complex` instances for simple operations.

### Compile-Time Type Analysis

The compiler determines whether each subexpression is complex or real by walking
the expression tree bottom-up:

1. **Literal numbers**: `expr.im !== 0` implies complex; otherwise real.
2. **Symbols**: `ImaginaryUnit` is complex. For all others, use `expr.isReal`:
   `true` implies real, `undefined` implies real (assume-real policy),
   `false` implies complex.
3. **Function expressions**: If any operand is complex, the result is complex
   (propagation). Exceptions: `Abs`, `Arg`, `Re`, `Im` always produce real
   results regardless of operand type.

This analysis drives code generation: a function with all-real operands emits
the existing `Math.*` / infix code; a function with any complex operand emits
the complex variant.

### Two-Tier Code Generation

#### Tier 1: Inline Arithmetic (no allocation for simple ops)

For basic arithmetic on complex operands, emit inline field math. No `Complex`
instantiation, no `_SYS` call.

| Operation | Compiled output |
|---|---|
| `Add(a, b)` | `{ re: a.re + b.re, im: a.im + b.im }` |
| `Subtract(a, b)` | `{ re: a.re - b.re, im: a.im - b.im }` |
| `Multiply(a, b)` | `{ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }` |
| `Divide(a, b)` | Uses the standard `(ac+bd)/(c^2+d^2), (bc-ad)/(c^2+d^2)` formula |
| `Negate(a)` | `{ re: -a.re, im: -a.im }` |

When an inline expression references a subexpression more than once (e.g.,
`Multiply` uses both `.re` and `.im` of each operand), the compiler must hoist
complex subexpressions into temporaries to avoid double evaluation:

```javascript
// Multiply(f(x), g(x)) — subexpressions are not simple
(() => { const _a = f(x), _b = g(x);
  return { re: _a.re * _b.re - _a.im * _b.im,
           im: _a.re * _b.im + _a.im * _b.re }; })()
```

Simple operands (variables, literals) can be inlined directly without hoisting.

#### Tier 2: Delegated Functions via `_SYS`

For transcendental and other functions, delegate to `_SYS` helpers that
internally use `ce.complex()` and the `Complex` class methods:

| MathJSON | `_SYS` helper | Complex.js method | Returns |
|---|---|---|---|
| `Sqrt(z)` | `_SYS.csqrt(z)` | `.sqrt()` | `{re, im}` |
| `Exp(z)` | `_SYS.cexp(z)` | `.exp()` | `{re, im}` |
| `Ln(z)` | `_SYS.cln(z)` | `.log()` | `{re, im}` |
| `Power(z, w)` | `_SYS.cpow(z, w)` | `.pow()` | `{re, im}` |
| `Sin(z)` | `_SYS.csin(z)` | `.sin()` | `{re, im}` |
| `Cos(z)` | `_SYS.ccos(z)` | `.cos()` | `{re, im}` |
| `Tan(z)` | `_SYS.ctan(z)` | `.tan()` | `{re, im}` |
| `Arcsin(z)` | `_SYS.casin(z)` | `.asin()` | `{re, im}` |
| `Arccos(z)` | `_SYS.cacos(z)` | `.acos()` | `{re, im}` |
| `Arctan(z)` | `_SYS.catan(z)` | `.atan()` | `{re, im}` |
| `Sinh(z)` | `_SYS.csinh(z)` | `.sinh()` | `{re, im}` |
| `Cosh(z)` | `_SYS.ccosh(z)` | `.cosh()` | `{re, im}` |
| `Tanh(z)` | `_SYS.ctanh(z)` | `.tanh()` | `{re, im}` |
| `Conjugate(z)` | `_SYS.cconj(z)` | `.conjugate()` | `{re, im}` |
| `Abs(z)` | `_SYS.cabs(z)` | `.abs()` | `number` |
| `Arg(z)` | `_SYS.carg(z)` | `.arg()` | `number` |
| `Re(z)` | `z.re` | (field access) | `number` |
| `Im(z)` | `z.im` | (field access) | `number` |

Each `_SYS` helper follows the pattern:

```javascript
csqrt(z) {
  const c = ce.complex(z.re, z.im).sqrt();
  return { re: c.re, im: c.im };
}
```

Where `ce.complex()` is the `ComputeEngine` factory (already available as it is
the entry point for all `_SYS` functions).

### Real-Complex Promotion

When a binary operation mixes a real operand with a complex operand, the
compiler promotes the real value. The promotion is done inline at the point of
use, not by wrapping in a helper:

```javascript
// Add(real_expr, complex_expr)
{ re: real_expr + z.re, im: z.im }

// Multiply(real_expr, complex_expr)
{ re: real_expr * z.re, im: real_expr * z.im }
```

When the real subexpression is not simple (not a variable or literal), it is
hoisted into a temporary to avoid double evaluation.

### Changes Required

#### 1. `CompileTarget` Interface (`types.ts`)

Add an optional `complex` method:

```typescript
interface CompileTarget<Expr = unknown> {
  // ... existing methods ...

  /** Format a complex numeric literal for the target language.
   *  Only called when the imaginary part is non-zero. */
  complex?: (re: number, im: number) => string;
}
```

#### 2. `CompilationResult` Type (`types.ts`)

Widen the `run` signature to accept and return complex values:

```typescript
interface CompilationResult {
  // ... existing fields ...
  run?: (...args: (number | { re: number; im: number })[])
    => number | { re: number; im: number };
}
```

#### 3. `BaseCompiler` (`base-compiler.ts`)

- Replace the `throw` at line 50 with a call to `target.complex?.(expr.re, expr.im)`.
- Add a static method `isComplexValued(expr): boolean` that performs the
  bottom-up type analysis described above.
- When compiling function expressions, call `isComplexValued` on operands to
  decide which code path to emit. Pass this information to the target's
  `functions` callbacks.

#### 4. JavaScript Target (`javascript-target.ts`)

- Implement `complex(re, im)` → `{ re: ${re}, im: ${im} }`.
- Map `ImaginaryUnit` to `{ re: 0, im: 1 }` instead of `Number.NaN`.
- Add complex variants for all functions in the table above.
- For inline arithmetic ops (`Add`, `Multiply`, etc.), the function callbacks
  receive type information and emit either infix operators (real) or field math
  (complex).
- Add `_SYS` complex helpers to `ComputeEngineFunction.SYS` and
  `ComputeEngineFunctionLiteral.SYS`, backed by `ce.complex()` and `Complex`
  methods.

#### 5. Variable Binding

`ImaginaryUnit` changes from `Number.NaN` to `{ re: 0, im: 1 }` in the
variable map.

### Scope

- **In scope**: JavaScript target only. Core arithmetic (Add, Subtract,
  Multiply, Divide, Negate), Power, Sqrt, Exp, Ln, trig functions, hyperbolic
  functions, Conjugate, Abs, Arg, Re, Im.
- **Out of scope**: GLSL/WGSL/Python targets, interval arithmetic with complex
  numbers, arbitrary-precision complex compilation, complex-valued Sum/Product
  loop compilation.

### Example

Input expression: `(3 + 2i) * x + sin(y)` where `x` is declared as complex,
`y` is untyped (assumed real).

Compiled output:

```javascript
(() => {
  const _a = { re: 3, im: 2 };
  return {
    re: _a.re * x.re - _a.im * x.im + Math.sin(y),
    im: _a.re * x.im + _a.im * x.re
  };
})()
```

### Implementation Plan

1. **Add `isComplexValued()` to `BaseCompiler`** — Static analysis method that
   walks the expression tree and returns whether a subexpression produces a
   complex value. Uses `expr.isReal` (with assume-real-if-undefined policy),
   `expr.im !== 0` for literals, and propagation rules for functions.

2. **Extend `CompileTarget` interface** — Add optional `complex(re, im)` method.
   Widen `CompilationResult.run` type signature.

3. **Update `base-compiler.ts` number handling** — Replace the `throw` with
   `target.complex?.(re, im)`. Pass complex-awareness info through compilation.

4. **Add `_SYS` complex helpers** — Implement the `_SYS.c*` functions in both
   `ComputeEngineFunction` and `ComputeEngineFunctionLiteral` classes, backed
   by `ce.complex()`.

5. **Update JavaScript function table** — For each function that can operate on
   complex values, update the compilation callback to check operand types and
   emit either the real or complex code path. Implement inline field math for
   Add, Subtract, Multiply, Divide, Negate.

6. **Update variable map** — `ImaginaryUnit` → `{ re: 0, im: 1 }`.

7. **Tests** — Add tests for:
   - Pure complex literal compilation (`3 + 2i`)
   - Complex arithmetic (add, mul, div with complex operands)
   - Mixed real/complex promotion
   - Transcendental functions on complex args
   - `ImaginaryUnit` usage
   - `Abs`, `Arg`, `Re`, `Im` returning real from complex input
   - Assume-real behavior for untyped variables
   - Nested complex expressions with temporary hoisting
