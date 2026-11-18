# Migrating to 0.194.0: one compiler

In 0.194.0, `compile()` uses one compiler for the targets `'javascript'`,
`'glsl'` and `'interval-js'`. The APIs of the previous compilers are removed.
This note gives, for each removed API, what a host does instead. The
`CHANGELOG.md` entry of 0.194.0 lists what changes in the results.

Each removed `compile()` option throws when it is given:

```ts
compile(expr, { functions: { f: Math.sin } });
// Error: The compilation option "functions" was removed in 0.194.0: …
```

An operator definition with a removed key throws too (`compileHelpers`,
`compileShippable`, `arithmetic.compile`).

The option `callerLocals` is accepted and ignored: a GLSL function takes every
input that its body reads as a parameter, so a function of the shader that
declares the input as a parameter or a local needs no option.

The examples below use:

```ts
import { ComputeEngine } from '@cortex-js/compute-engine';
import { compile } from '@cortex-js/compute-engine/compile';

const ce = new ComputeEngine();
ce.declare('x', 'real');
```

## A custom target, `target`, `registerCompilationTarget()`

The classes `JavaScriptTarget`, `GLSLTarget`, `GPUShaderTarget` and
`BaseCompiler`, the option `target`, and `ce.registerCompilationTarget()` /
`ce.unregisterCompilationTarget()` are removed, with the types
`CompileTarget`, `LanguageTarget`, `CompiledOperators`, `CompiledFunctions`,
`CompiledFunction`, `TargetSource` and `ExecutableTarget`.

Name a built-in target with `to`:

```ts
// Before: new GLSLTarget().compile(expr) or compile(expr, { target })
const shader = compile(ce.parse('\\sin(x) + 1'), { to: 'glsl' });
shader.code; // ➔ "(sin(x) + 1.0)"
```

Every entry of the package compiles to the three targets; an engine of
`@cortex-js/compute-engine/core` needs no registration for `glsl`. For
another language, there is no replacement: walk the MathJSON of the
expression (`expr.json`) and write the code in the host.

## `functions`, `imports`, `preamble`

The compiled code cannot call a function of the host. Define the function in
the engine with a body, and the compiler compiles the body:

```ts
// Before: compile(expr, { functions: { f: (t) => t * t + 1 } })
ce.parse('f(t) \\coloneq t^2 + 1').evaluate();
compile(ce.parse('f(x) + 1')).run({ x: 2 }); // ➔ 6
```

An operator that is defined with an `evaluate` function only is not
compiled: the compilation declines, and the `run` of the result evaluates
with the interpreter (`success: false`, `diagnostic.code` is
`'outside-profile'`).

The compiled code is self-contained, so `imports` has no replacement. Put the
definitions that a `preamble` held in the host code that uses the result.

## `operators`

There is no replacement: the operators of a target are not configurable. To
change how one operator compiles, give it a `compile` handler that returns an
expression (next section).

## A `compile` handler that returns text, `compileHelpers`, `compileShippable`

An operator `compile` handler returns an `Expression`, which is compiled in
place of the node, or `undefined` to keep the library's compilation. A handler
that returns code text, or calls its `compile` callback, makes the node
decline. The keys `compileHelpers` and `compileShippable` are removed: the
compiler writes all the code, and computes whether a result can run on a
worker (`shippable`).

```ts
// Before: compile: (args, compile) => `Math.min(1, Math.max(0, ${compile(args[0])}))`
ce.declare('Clamp01', {
  signature: '(real) -> real',
  evaluate: ([t], { engine }) =>
    engine.number(Math.min(1, Math.max(0, t.re))),
});
const def = ce.lookupDefinition('Clamp01');
if (def && 'operator' in def)
  def.operator.compile = ([t]) => ce.box(['Clamp', t, 0, 1]);

const r = compile(ce.parse('\\operatorname{Clamp01}(x) \\cdot 2'));
r.run({ x: 3 }); // ➔ 2
r.run({ x: 0.25 }); // ➔ 0.5
```

## `strictTypes`

Read the type report of the result. An input whose type was inferred from its
uses, not declared, has `provenance: 'inferred'`:

```ts
const ce2 = new ComputeEngine();
ce2.declare('a', 'real');
const r = compile(ce2.parse('a + b'));
const undeclared = Object.entries(r.freeSymbolTypes ?? {})
  .filter(([, t]) => t.provenance !== 'declared')
  .map(([name]) => name);
// ➔ ["b"]
```

`freeSymbolTypes` is set on JavaScript results too.

## `broadcast`

`broadcast()` of a result needs no option:

```ts
// Before: compile(expr, { broadcast: true })
const r = compile(ce.parse('x^2'));
r.broadcast({ x: new Float64Array([1, 2, 3]) }); // ➔ [1, 4, 9]
```

## `arithmetic.compile` of a value kind

The value-kind compile contract (`ArithmeticCompile`) is removed, with no
replacement: an expression that holds a value of a kind declines, and the
interpreter evaluates it. The kind `enclosure` compiles on `'interval-js'`.

## `parallel for` and `runAsync()`

A program with a `parallel for` (`ParallelLoop`) declines, and the
interpreter runs its passes in order, on one thread. `runAsync()` of a result
resolves to the value of `run()`, and `willParallelize()` is `false`:

```ts
const r = compile(ce.parse('x^2'));
await r.runAsync({ x: 3 }); // ➔ 9
r.willParallelize(); // ➔ false
```

`broadcastAsync()` still uses the worker pool (`ce.workers`). A later release
compiles `parallel for` and sends it to the pool again.
