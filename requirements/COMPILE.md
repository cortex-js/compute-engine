# Compiler Customization Enhancement Plan

This document outlines the plan for improving the compiler interface to support
better customization and multi-target compilation, as requested in
[Issue #240](https://github.com/cortex-js/compute-engine/issues/240).

## Current State

### Architecture Overview

The compilation system consists of:

1. **`CompileTarget` Interface**
   (`src/compute-engine/compilation/types.ts:38-65`)
   - Defines language-specific compilation configuration
   - Methods for operators, functions, variables, strings, numbers
   - Contains preamble and formatting options

2. **`LanguageTarget` Interface**
   (`src/compute-engine/compilation/types.ts:70-85`)
   - Base interface for language-specific targets
   - Provides `getOperators()`, `getFunctions()`, `createTarget()`,
     `compileToExecutable()`

3. **`JavaScriptTarget` Class**
   (`src/compute-engine/compilation/javascript-target.ts:358`)
   - Implements `LanguageTarget` for JavaScript
   - Uses `JAVASCRIPT_OPERATORS` and `JAVASCRIPT_FUNCTIONS` constants
   - Creates executable functions via `ComputeEngineFunction` class

4. **`BaseCompiler` Class**
   (`src/compute-engine/compilation/base-compiler.ts:12`)
   - Language-agnostic compilation logic
   - Handles expression traversal and code generation

5. **`BoxedExpression.compile()` Entry Point**
   (`src/compute-engine/boxed-expression/abstract-boxed-expression.ts:743`)
   - User-facing API
   - Currently only accepts `functions`, `vars`, `imports`, `preamble` options
   - Hard-coded to JavaScript target

### Current Limitations

1. **No operator customization**: Users cannot override operators like `Add`,
   `Multiply` to function calls
2. **Fixed operator mappings**: `JAVASCRIPT_OPERATORS` is not customizable
3. **No target customization**: `CompileTarget` interface exists but isn't
   exposed through public API
4. **Single target**: Only JavaScript compilation is implemented
5. **Limited extensibility**: Adding new targets requires modifying core code

## Problem Statement

### Use Case 1: Vector/Matrix Operations in JavaScript

When compiling expressions with vector operations:

```javascript
// Expression: [1,1,1] + [1,1,1]
// Current output: "[1,1,1] + [1,1,1]"  // Invalid JavaScript!
// Desired output: "add([1,1,1], [1,1,1])"  // Valid with custom add function
```

### Use Case 2: GLSL Compilation

GLSL has different syntax requirements:

- Different function names (`pow` vs `Math.pow`)
- Different constant names (`PI` vs `Math.PI`)
- Different type declarations
- Vector/matrix operators work differently

### Use Case 3: Custom DSL Targets

Users may want to compile to:

- WebGPU Shading Language (WGSL)
- Python (NumPy)
- MATLAB
- Custom domain-specific languages

## Proposed Solution

### Phase 1: Expose Operator Customization (High Priority)

Allow users to override operators through the `compile()` options.

#### API Design

```typescript
interface CompilationOptions {
  /** Target language */
  to?: 'javascript' | 'glsl' | 'python' | 'wgsl';

  /** Custom operator mappings */
  operators?: Partial<CompiledOperators> |
              ((op: MathJsonSymbol) => [op: string, prec: number] | undefined);

  /** Custom function implementations */
  functions?: Record<MathJsonSymbol, TargetSource | Function>;

  /** Variable bindings */
  vars?: Record<MathJsonSymbol, TargetSource>;

  /** Additional imports/libraries to include */
  imports?: unknown[];

  /** Additional preamble code */
  preamble?: string;

  /** Whether to fall back to interpretation on compilation failure */
  fallback?: boolean;
}
```

#### Example Usage

```javascript
// Vector addition example
const expr = ce.parse("v + w");
const f = expr.compile({
  operators: {
    Add: ['add', 11],      // Convert + to add() function
    Multiply: ['mul', 12]   // Convert * to mul() function
  },
  functions: {
    add: 'vectorAdd',        // Reference to runtime function
    mul: 'vectorMultiply'
  }
});

// Result: "add(v, w)" instead of "v + w"
```

#### Implementation Steps

1. **Update `CompilationOptions` interface** (`types.ts:90-102`)
   - Add `operators` field
   - Make it union type: partial object or function

2. **Modify `JavaScriptTarget.createTarget()`** (`javascript-target.ts:367`)
   - Accept operator overrides in options
   - Merge custom operators with defaults
   - Create operator lookup function that checks custom first, then defaults

3. **Update `JavaScriptTarget.compileToExecutable()`**
   (`javascript-target.ts:395`)
   - Pass operator overrides to `createTarget()`
   - Handle both object and function forms of `operators` option

4. **Update `BoxedExpression.compile()` signature** (`global-types.ts:1542` and
   `abstract-boxed-expression.ts:743`)
   - Add `operators` parameter
   - Pass through to `JavaScriptTarget`

5. **Add tests** (`test/compute-engine/compile.test.ts`)
   - Test operator overrides as object
   - Test operator overrides as function
   - Test vector addition use case
   - Test partial overrides (only some operators)

### Phase 2: Export CompileTarget Interface (Medium Priority)

Make the `CompileTarget` interface and related types available for advanced
users.

#### API Design

```typescript
// Export from main index
export {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  CompilationOptions,
  LanguageTarget
} from './compilation/types';

export { JavaScriptTarget } from './compilation/javascript-target';
export { BaseCompiler } from './compilation/base-compiler';
```

#### Advanced Usage

```javascript
import { CompileTarget, BaseCompiler } from '@cortex-js/compute-engine';

// Custom target for vector operations
const vectorTarget: CompileTarget = {
  language: 'javascript',
  operators: (op) => {
    switch(op) {
      case 'Add': return ['add', 11];
      case 'Subtract': return ['sub', 11];
      case 'Multiply': return ['mul', 12];
      case 'Divide': return ['div', 13];
      default: return undefined;
    }
  },
  functions: (id) => vectorFunctions[id],
  var: (id) => id,
  string: (str) => JSON.stringify(str),
  number: (n) => n.toString(),
  ws: () => '',
  preamble: '',
  indent: 0
};

// Compile using custom target
const source = BaseCompiler.compile(expr, vectorTarget);
```

#### Implementation Steps

1. **Add exports to `src/compute-engine/index.ts`**
   - Export types from `compilation/types.ts`
   - Export `JavaScriptTarget` and `BaseCompiler`

2. **Update documentation** (`API.md` - autogenerated)
   - Document exported compilation interfaces
   - Provide examples of custom targets

3. **Add examples** (`examples/` directory)
   - Vector/matrix operations example
   - Custom DSL example

### Phase 3: Plugin Architecture for Custom Targets (Lower Priority)

Create a plugin system for registering custom compilation targets.

#### API Design

```typescript
interface CompilationOptions {
  to?: 'javascript' | 'glsl' | 'python' | 'wgsl' | string;
  target?: CompileTarget;  // Direct target override
  // ... existing options
}

// Register custom target
ce.registerCompilationTarget('glsl', new GLSLTarget());

// Use custom target
const f = expr.compile({ to: 'glsl' });
```

#### Implementation Steps

1. **Create target registry** in `ComputeEngine`
   - Map of target name → `LanguageTarget` implementation
   - Default registry with built-in targets

2. **Update `BoxedExpression.compile()`**
   - Check `options.target` for direct override
   - Lookup `options.to` in registry
   - Fall back to JavaScript

3. **Create base class helpers**
   - `AbstractLanguageTarget` base class
   - Common patterns for target implementation

4. **Document plugin architecture**
   - Guide for creating custom targets
   - API reference for `LanguageTarget` interface

### Phase 4: GLSL Target Implementation (Optional)

Implement a GLSL compilation target as a reference implementation and to support
shader use cases.

#### GLSL-Specific Considerations

```glsl
// Operators work on vectors/matrices natively
vec3 a = vec3(1.0, 2.0, 3.0);
vec3 b = vec3(4.0, 5.0, 6.0);
vec3 c = a + b;  // Valid GLSL

// Function differences
float x = pow(2.0, 3.0);  // Not Math.pow
float pi = 3.14159265359; // Not Math.PI

// Type declarations required
float f(float x) {
  return x * x;
}
```

#### Implementation Steps

1. **Create `GLSLTarget` class**
   (`src/compute-engine/compilation/glsl-target.ts`)
   - Implement `LanguageTarget` interface
   - Define GLSL operators (same as JS for basic math)
   - Define GLSL functions (`pow`, `sin`, `cos`, etc.)
   - Handle variable declarations with types

2. **Type inference for GLSL**
   - Analyze expression types
   - Generate appropriate type declarations
   - Handle vector/matrix types

3. **Add GLSL-specific formatting**
   - Float literals need `.0` suffix
   - Vector constructors: `vec3(1.0, 2.0, 3.0)`
   - Matrix constructors

4. **Testing**
   - Unit tests for GLSL compilation
   - Integration tests with shader compilation

## Implementation Priority

### High Priority (Phase 1) ✅ COMPLETED

- [x] Update `CompilationOptions` to include `operators`
- [x] Modify `JavaScriptTarget.compileToExecutable()` for operator overrides
- [x] Update `BoxedExpression.compile()` signature
- [x] Add comprehensive tests
- [x] Create example demonstrating vector operations

**Status**: ✅ **Completed**
**Impact**: Solves the immediate use case from Issue #240

**Implementation notes**:
- Operators can now be overridden using either an object or function
- Function-name operators (e.g., `add`, `mul`) are compiled as function calls
- Symbol operators (e.g., `+`, `-`) are compiled as infix operators
- Works with both scalar and collection (vector/array) arguments
- Added comprehensive test coverage including edge cases
- Created working example in `examples/compile-vector-operations.js`

### Medium Priority (Phase 2) ✅ COMPLETED

- [x] Export `CompileTarget` and related interfaces
- [x] Export `JavaScriptTarget` and `BaseCompiler`
- [x] Add advanced examples
- [x] Document custom target creation

**Status**: ✅ **Completed**
**Impact**: Enables advanced users to create custom targets

**Implementation notes**:
- Exported all compilation types from main entry point (`src/compute-engine.ts`)
- Types exported: `CompileTarget`, `CompiledOperators`, `CompiledFunctions`, `CompilationOptions`, `CompiledExecutable`, `LanguageTarget`, `TargetSource`, `CompiledFunction`
- Classes exported: `JavaScriptTarget`, `BaseCompiler`
- Created comprehensive example (`examples/compile-custom-target.js`) showing:
  - Extending JavaScriptTarget with custom mappings
  - Creating all-function-call targets for legacy systems
  - Implementing RPN (Reverse Polish Notation) compilation
  - SQL-like expression target
  - Pretty-print target with formatting
- All exports are available in the production build

### Lower Priority (Phase 3) ✅ COMPLETED

- [x] Create target registry in `ComputeEngine`
- [x] Update `compile()` to use registry
- [x] Add `registerCompilationTarget()` method
- [x] Update `CompilationOptions` to include `to` and `target` options
- [x] Document plugin architecture
- [x] Create comprehensive tests
- [x] Create example demonstrating plugin architecture

**Status**: ✅ **Completed**
**Impact**: Better extensibility, cleaner architecture, enables custom compilation targets

**Implementation notes**:
- Added `_compilationTargets` Map to ComputeEngine for storing registered targets
- Initialized registry with built-in JavaScript and GLSL targets in constructor
- Created public `registerCompilationTarget(name, target)` method
- Updated `compile()` method in BoxedExpression to:
  - Support `target` option for direct target override
  - Support `to` option for named target lookup
  - Use registry to resolve target names to LanguageTarget instances
  - Fall back to JavaScript if target not found (with error when fallback is disabled)
- Added comprehensive tests in `test/compute-engine/compile-plugin.test.ts`:
  - Target registry operations
  - Compiling with custom targets (Python, RPN)
  - Direct target override
  - Error handling for unregistered targets
  - Integration with built-in targets
- Created example in `examples/compile-plugin-architecture.js` demonstrating:
  - Using built-in targets (JavaScript, GLSL)
  - Creating and registering custom targets (Python, RPN)
  - Direct target override (Forth)
  - Switching between targets
- Updated documentation in `doc/13-guide-compile.md` with:
  - Plugin Architecture section
  - Built-in targets documentation
  - Registering custom targets tutorial
  - Direct target override examples
  - Creating custom language targets guide
  - LanguageTarget interface documentation

### Optional (Phase 4) ✅ COMPLETED

- [x] Implement `GLSLTarget`
- [x] Add GLSL-specific formatting (float literals, vector constructors)
- [x] GLSL-specific tests
- [x] Example shaders
- [x] Complete shader generation (fragment/vertex shaders)
- [x] GLSL function compilation with type signatures

**Status**: ✅ **Completed**
**Impact**: Demonstrates multi-target capability, useful for graphics applications

**Implementation notes**:
- Created complete `GLSLTarget` class (`src/compute-engine/compilation/glsl-target.ts`)
- GLSL operators match JavaScript for basic arithmetic (work on vectors/matrices natively)
- GLSL functions without `Math.` prefix (`sin`, `cos`, `sqrt`, `pow`, etc.)
- Float literals automatically formatted with `.0` suffix
- Vector constructors: `vec2()`, `vec3()`, `vec4()`
- Complete shader generation with `compileShader()` method
- Function generation with `compileFunction()` method for reusable GLSL functions
- Comprehensive test suite in `test/compute-engine/compile-glsl.test.ts`
- Working examples in `examples/compile-glsl-shaders.js` including:
  - Basic expression compilation
  - Vector operations
  - Complete GLSL functions
  - Fragment and vertex shader generation
  - Mandelbrot set example
- Exported from main entry point for public use

## Breaking Changes

### None Expected

All proposed changes are additive:

- New optional parameters to existing functions
- New exports that don't conflict with existing API
- Backward-compatible default behavior

## Testing Strategy

### Unit Tests

1. **Operator override tests**
   - Override single operator
   - Override multiple operators
   - Override as object vs function
   - Partial overrides (some operators)
   - Invalid operator configurations

2. **Vector operation tests**
   - Vector addition/subtraction
   - Vector multiplication/division
   - Mixed scalar/vector operations

3. **Custom target tests**
   - Create minimal custom target
   - Compile simple expressions
   - Handle edge cases

### Integration Tests

1. **Real-world vector math library**
   - Compile expressions using gl-matrix or similar
   - Verify generated code executes correctly

2. **GLSL shader compilation** (if Phase 4 implemented)
   - Compile to GLSL
   - Validate GLSL syntax
   - Test in WebGL context

### Performance Tests

- Benchmark compilation time with custom operators
- Compare operator lookup performance (object vs function)
- Memory usage with large expressions

## Documentation Requirements

### User Documentation

1. **Compilation Guide** (new section in docs)
   - Introduction to compilation
   - Basic usage examples
   - Customizing operators and functions
   - Advanced: Custom targets

2. **API Reference Updates**
   - `BoxedExpression.compile()` options
   - `CompilationOptions` interface
   - Exported compilation types

3. **Examples**
   - Vector math compilation example
   - Custom DSL example
   - GLSL shader example (if implemented)

### Developer Documentation

1. **Architecture Overview** (this document)
2. **Creating Custom Targets Guide**
   - Implementing `LanguageTarget`
   - Defining operators and functions
   - Handling special constructs
   - Testing custom targets

3. **Contributing Guidelines**
   - How to add new compilation features
   - Testing requirements
   - Code style for compiler code

## Compatibility Notes

### TypeScript Compilation

The compilation system generates strings that are executed via `Function`
constructor. This has implications:

1. **Content Security Policy (CSP)**: Won't work in strict CSP environments
2. **Type safety**: Generated code is not type-checked
3. **Debugging**: Source maps not available

### Runtime Dependencies

Compiled JavaScript functions depend on:

- `_SYS` object with helper functions (gamma, integrate, etc.)
- User-provided functions from `options.functions`
- User-provided imports from `options.imports`

These must be available at runtime for compiled code to execute.

## Future Enhancements

### Beyond Initial Implementation

1. **Source Maps**: Generate source maps for debugging compiled code
2. **Static Analysis**: Validate expressions before compilation
3. **Optimization Passes**:
   - Constant folding
   - Dead code elimination
   - Common subexpression elimination
4. **WebAssembly Target**: Compile to WASM for better performance
5. **Streaming Compilation**: Compile large expressions incrementally
6. **JIT Compilation**: Cache compiled expressions

### Type System Integration

- Infer types from expressions
- Generate typed code (TypeScript output)
- Validate operator compatibility with types

### Multi-Language Support

- Python (NumPy) target
- MATLAB target
- R target
- Julia target

## Open Questions

1. **Operator precedence with custom operators**: If users override operators to
   functions, how do we handle precedence?
   - **Answer**: Keep precedence in operator definition, use it for
     parenthesization

2. **Function vs operator distinction**: Should we allow converting operators to
   functions easily?
   - **Answer**: Yes, via operator override with function name string

3. **Type annotations for non-JavaScript targets**: How to specify types?
   - **Answer**: Future enhancement, type inference system

4. **Performance implications**: What's the overhead of custom operator lookup?
   - **Answer**: Benchmark both approaches, optimize if needed

## Related Issues

- [#240](https://github.com/cortex-js/compute-engine/issues/240) -
  Overloading/removing operators, functions in box.compile()

## References

- Current implementation: `src/compute-engine/compilation/`
- Tests: `test/compute-engine/compile.test.ts`
- Types: `src/compute-engine/compilation/types.ts`
- JavaScript target: `src/compute-engine/compilation/javascript-target.ts`
