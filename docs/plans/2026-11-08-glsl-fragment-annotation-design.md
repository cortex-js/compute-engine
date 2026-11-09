# The annotation of the GLSL fragment: design note

**Status:** approved 2026-11-08, with the choices of section 9. No code yet. Step 2 of `docs/plans/2026-11-08-compile-targets-implementation-plan.md`; step 3 of that plan (ROADMAP CE-1166.3) implements it.

The spec (`docs/plans/2026-11-08-glsl-fragment-spec.md`, section 3) builds
`canCompile()` as a typing pass that gives each node of the tree a fragment
type and keeps that annotation beside the tree. This note fixes the types,
the place of the annotation, the order of the walk, which facts the
annotation can hold, which questions of the emitter it answers first, and the
diagnostic. Step 3 of the plan implements it. Section 9 lists the choices
that this note makes, each with its alternative.

The annotation is a typed front end. It is the input of a later intermediate
representation, not that representation: section 8 says what is missing.

## 1. Where the pass runs

`compileOrThrow()` in `gpu-shader-target.ts` rewrites the tree before it
emits: `rewriteAngularUnit()`, `unrollFixedWidthCollections()` (two times),
`inlinePointCalls()`, `inlinePointValues()`,
`BaseCompiler.inlineCollectionValuedCallsAtRoot()` and
`inlineSharedUserFunctionCalls()`. The `define` hook of the user functions
rewrites each body (`inlinePointCalls()`, `inlinePointValues()`), and a
function with a parameter bound to a list input is boxed again as a variant
with the name of the input in place of the parameter
(`compile-user-calls.ts`, the key `<name>#bind<positions>`). The spec puts the
result of this compile-time work inside the fragment (a comprehension over a
constant range is in because it unrolls).

The pass therefore types the tree that emission walks, not the tree that the
caller gave. The GLSL compile becomes three stages:

1. **Prepare**: the rewrites above, and the check of the written size
   (`gpuWrittenSize()`). It emits nothing.
2. **Type**: the pass. It reads the prepared root, prepares and types the
   body of each user function at the first call that reaches it, and returns
   one annotation.
3. **Emit**: today's emission, on the trees that the annotation holds.

`canCompile()` runs stages 1 and 2. `compile()` to `glsl` runs 1, 2 and 3.
The two cannot read different trees, because both get the tree from stage 1.
A subtree that the compiler folds to a constant has the type of its value:
the pass asks the value-only folder (`constantFoldValue()` in
`compiler-core.ts`) before it applies the rule of the head.

**One annotation belongs to one prepared tree.** No rewrite runs between
stage 2 and stage 3. The common-subexpression pass runs in stage 3 and binds
a node to a temporary; it changes no node, so the type of the node is the
type of the temporary. A rewrite that someone adds after stage 2 gives a new
tree, and the whole tree is typed again: step 3 has no rule to keep a part of
an annotation.

The code is two new modules in `src/compute-engine/compilation/`:

- **`fragment.ts`** names no target. It holds the types of sections 2 and 3,
  the pass, the question `fragmentFactsOf()`, and the refusal with its
  diagnostic. The pass takes a fragment definition as an argument.
- **`glsl-fragment.ts`** holds the definition of the GLSL fragment: what the
  spec's list says, and the shader representation of each type.

```ts
/** What one target compiles. `R` is the type of its representations.
 *  `glsl-fragment.ts` exports the first definition. */
type FragmentDefinition<R> = {
  /** The name of the fragment in a message: "GLSL". */
  readonly name: string;
  /** The positive list: one rule per head (section 4). */
  readonly rules: Readonly<Record<string, FragmentRule<R>>>;
  /** The type of a free symbol, from its engine type, or `undefined` when
   *  the fragment has no type for it. */
  typeOfSymbol(symbol: Expression): FragmentType | undefined;
  /** How the target holds the value of a name, chosen once, where the name
   *  is bound, from its type, its role and its declaration. `undefined`
   *  when the target cannot hold it. */
  representationOfBinding(
    type: FragmentType,
    binding: {
      role: 'input' | 'parameter' | 'local' | 'index';
      symbol: Expression;
      /** The shader type that the caller of `compileFunction()` or
       *  `compileShader()` wrote for the name (`uint`, `vec2`). */
      declared?: string;
    }
  ): R | undefined;
  /** How the target holds a computed value of this type, or `undefined`. */
  representationOfValue(type: FragmentType): R | undefined;
  /** The user function that a call reaches: the key of its entry in
   *  `FragmentAnnotation.functions`, its parameters and its prepared body.
   *  `undefined` when the call reaches no user function. */
  functionOf(
    call: Expression,
    scope: FragmentScope<R>
  ): { key: string; parameters: readonly Expression[]; body: Expression } | undefined;
};
```

The preparation (stage 1) stays in `gpu-shader-target.ts`: it is the work of
one target.

## 2. Types, representations and derived facts

These are three different things, and the note keeps them apart:

- **The type** says what the value is in the language: a real, a complex
  number, a point, a list. It names no target.
- **The representation** says how one target holds the value: a `float`, a
  `vec3`, an array, a sampler. The definition of the target gives it.
- **A derived fact** says more about the value: it is finite, it is in an
  interval, its colour channels are in a given space. Section 5 says which
  of them the annotation can hold.

```ts
/** A type that a local, a parameter or the result of a function can have. */
type FragmentValueType =
  | { kind: 'real' }
  | { kind: 'integer' }
  | { kind: 'boolean' }
  | { kind: 'complex' }
  | { kind: 'point'; size: number }
  | { kind: 'color' };

type FragmentElementType =
  | { kind: 'real' }
  | { kind: 'integer' }
  | { kind: 'point'; size: number };

type FragmentType =
  | FragmentValueType
  /** A list. `count` is absent when it is known only at run time. */
  | { kind: 'list'; element: FragmentElementType; count?: number }
  /** A `Range` with integer bounds. Only the index set of `Sum`, `Product`, `At`. */
  | { kind: 'range' }
  /** A statement of a block in a function body: it has no value. */
  | { kind: 'statement' }
  /** A user function that is emitted once as a function of the target. */
  | {
      kind: 'function';
      parameters: readonly { name: string; type: FragmentValueType }[];
      result: FragmentValueType;
    };
```

`integer` is a type and not a derived fact, because the engine's type system
has it (`Floor(x)` has the engine type `integer`), and the pass reads the
engine type. It is accepted where `real` is expected.

**Where a representation is chosen.** The type alone does not choose it: an
`integer` local is a `float`, the index of a loop is an `int`, and a shader
input can be declared `int` or `uint`.

- **At a binding**, by `representationOfBinding()`, from the type, the role
  (input, parameter, local, index) and the declaration. A read of the name
  has the representation of its binding.
- **For a computed node**, by `representationOfValue()`, from the type of
  the result.
- **Not at all** for a `statement`, a `range` and a `function`: they are not
  values at run time, and their facts have no representation field
  (section 3).

A value type or a list with no representation is refused. The
representations of the GLSL definition (`R` is one of these):

| Type | GLSL representation |
| --- | --- |
| `real` | `float` |
| `integer` | a computed value, a local, a parameter: `float`. The index of a loop: `int`. A shader input declared `int` or `uint`: that type |
| `boolean` | `bool` |
| `complex` | `vec2` (re, im) |
| `point` of size 2 to 4 | `vec2`, `vec3`, `vec4` |
| `color` | `vec3` of colour channels |
| `list` of 2 to 4 real scalars | `vec2`, `vec3`, `vec4` |
| `list` with another count, at most 256 | an array (`float[n]`, `vecM[n]`) |
| `list` input that the `storage` option names `'sampler2D'`, any count or none | a sampler, read by a `texelFetch` helper |
| `point` of another size; another `list` | none |

The first draft of this note had these three GLSL decisions in the types: a
storage kind on the list type, a small list typed as a point, and the two
shader types of an integer. They are in the table now. A `complex`, a
`point` of size 2 and a `list` of 2 reals have the same representation and
three types; today a shader type string carries them, and two side arrays
(`GPUUserFunctionSignature.complex` and `.colors` in
`gpu-declared-types.ts`) tell them apart.

**Conversions are stated by the rules, not found again by the emitter.**
There are four: `real` to `complex`; a scalar to a point or a list beside one
in component-wise arithmetic; `int` or `uint` to `float` where an index or
such an input is read in arithmetic; `float` to `int` at an index. The facts
of a node record one resolved conversion for each operand, in operand order,
with "none" where nothing changes:

```ts
type FragmentConversion<R> = {
  kind: 'none' | 'real-to-complex' | 'broadcast' | 'to-float' | 'to-int';
  /** What the node reads the operand as, after the conversion. For a
   *  broadcast, the type holds the resolved size. */
  type: FragmentType;
  representation: R;
};

// Add(z, x), with z complex and x real:
//   [{ kind: 'none', … complex, vec2 }, { kind: 'real-to-complex', … complex, vec2 }]
// Add(p, s), with p a point of size 3 and s real:
//   [{ kind: 'none', … point 3, vec3 }, { kind: 'broadcast', … point 3, vec3 }]
```

This is the result of the choice of an overload, not the overload itself, so
a later stage can make one conversion operation per entry and does not choose
the overload again. In step 3 the pass uses the conversions to accept or
refuse. The emitter still finds them itself (`gpuWidenToVector()`, the
`vec2(x, 0.0)` lift at a call) until step 5 moves those readers to the
recorded conversions.

**The type of a symbol** comes from `typeOfSymbol()`. A symbol whose type is
`unknown` or `any` has no fragment type. A parameter of a user function with
no declared type is not read that way: it takes the type of the argument at
the first call that reaches the function, and a later call is checked
against it (the spec, section 6, decision 11). Before step 3,
`gpuTypeOfDeclaredType()` read such a parameter as a `float` whatever the
argument.

**A parameter bound to a sampler-backed list** needs no type of its own. The
variant of the function has no such parameter: its body reads the input by
name, as a free symbol whose representation is a sampler. The pass types one
variant for each set of bound inputs, under the key that the emitter uses
today.

## 3. Where the annotation lives

```ts
type FragmentFacts<R> =
  /** A value at run time. */
  | {
      readonly type: FragmentValueType | (FragmentType & { kind: 'list' });
      readonly representation: R;
      /** One resolved conversion per operand (section 2). Absent for a
       *  node with no operand. */
      readonly conversions?: readonly FragmentConversion<R>[];
    }
  /** A statement, a range or a function: no value at run time. */
  | { readonly type: FragmentType & { kind: 'statement' | 'range' | 'function' } };

type FragmentScope<R> = {
  readonly parent?: FragmentScope<R>;
  /** The names that this scope binds: the inputs (root scope), the
   *  parameters, the locals, the index of a loop or of a `Sum`. */
  readonly bindings: Map<string, FragmentFacts<R>>;
  /** The facts of each node that was typed in this scope. */
  readonly facts: Map<Expression, FragmentFacts<R>>;
  /** The scope that a node of this scope opens. Only a node that binds a
   *  name opens one: a function, a block, a loop, a `Sum` or a `Product`. */
  readonly inner: Map<Expression, FragmentScope<R>>;
};

type FragmentAnnotation<R> = {
  /** The prepared root. Emission walks this tree. */
  readonly root: Expression;
  readonly scope: FragmentScope<R>;
  /** One entry per function to emit, under the key that
   *  `FragmentDefinition.functionOf()` gives. For GLSL it is the key of the
   *  registry of user functions (`f`, or `f#bind…` for a variant). */
  readonly functions: Map<
    string,
    { body: Expression; scope: FragmentScope<R>; type: FragmentType }
  >;
  /** The first node with no type. Absent when every node has one. */
  readonly refusal?: FragmentRefusal;
};
```

- **The tree does not change.** No field is added to a boxed expression, and
  the pass does no rewrite.
- **A scope is about names only.** It says which binding a name has. It does
  not say when or how many times a node is evaluated. The table of the
  operands that are evaluated on a condition (`LAZY_OPERANDS` and the regions
  in `cse.ts`) stays the one record of that, and a branch of an `If` that
  binds no name opens no scope.
- **One table per scope, not one table for the compilation.** A boxed node
  can be an operand of several parents (the common-subexpression pass and
  `gpuWrittenSize()` both handle "a node that several paths reach"), and the
  type of a node depends on the names that are bound where it is read. The
  key is the scope and the node. Section 5 says which facts this key can
  hold.
- **A second compilation does not read the first one's annotation.** Each
  call of `canCompile()` or `compile()` makes a new annotation. Only the
  targets of that call refer to it. There is no module-level table and
  nothing is stored on the tree, so the annotation is released with the call.
- **How the emitter reaches it.** The current scope is a field of the
  target, declared as an intersection type in `fragment.ts`, as
  `GPUShapeRulesTarget` is in `gpu-shapes.ts`, so `CompileTarget` gets no new
  member. The emitter enters a scope with a copy of the target
  (`{ ...target, fragmentScope: scope.inner.get(node) }`), as
  `gpuDeclaredBodyTarget()` copies the target for a declared body today.
- **What is stored and what is checked at each use.** The table stores what
  a node is: its type, its representation, its conversions. It does not
  store whether the node may stand where it is read. A `Range` is accepted
  only as an index set, a sampler-backed list only as the base of `At`, a
  `Break` only inside a loop. The pass checks the place at every use, also
  when the facts of the node are already in the table (section 4).

**A node that emission makes.** 19 lines in four shader modules build a node
(`gpu-functions.ts` 6, `gpu-shared-calls.ts` 6, `gpu-shapes.ts` 5,
`gpu-exact-trig.ts` 2); the 6 of `gpu-shared-calls.ts` are in stage 1. A node
made in stage 3 is not in the annotation, and `fragmentFactsOf()` does not
type it on request: that would let stage 3 find a refusal after
`canCompile()` answered yes. Each such rewrite is a **trusted lowering**, with
this contract:

- It is a rewrite of one operation: the node that the emitter is writing.
  It can replace operands of that node. It does not state that a new operand
  equals the old one. `gpuReduceTrigOffset()` in `gpu-shapes.ts` replaces the
  angle `u + c` of a sine by `u + c'`, where `c'` differs from `c` by a whole
  number of periods: the angle changes and the sine does not. The new angle
  is valid as the operand of that sine and nowhere else.
- It keeps the result of the operation, within the caveats of compiled code
  (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
- It keeps the evaluations: it adds, removes or repeats no evaluation of an
  operand that has an effect or runs a loop, and it moves none out of a
  branch.
- Each new operand has the type and the representation that the recorded
  conversion of its place expects, so the facts of the operation do not
  change.

The lowering registers the new operands with one function,
`fragmentReplaceOperands(node, made, target)`. That function checks the
structure: it types each new subtree with the rules and compares the result
with the recorded conversion of the place. A difference is an internal error.
The check does not show that the result of the operation is kept: one
dedicated test per lowering shows that, against the interpreter, for each
type of operand that the lowering accepts.

The check alone does not make the answer of `canCompile()` reliable: it only
changes a late decline into an error. The inventory and the tests do. Step 3
lists every lowering of stage 3 with its contract and writes its test, since
that is the step where `canCompile()` gets its guarantee. Step 5 moves each
lowering that can run in stage 1 there, where the predicate sees it.

## 4. The walk and the rules

**The context of a use.** The walk passes a small context to each node: the
role of the place (a value, a statement, an index set, the base of `At`, an
argument bound to a list input), the function that is being typed, and the
loop that encloses the node, if any. The scope does not hold this: it knows
names, not places. When the pass reaches a node, it takes the facts from the
table or computes them, and then checks the facts against the context in both
cases. A node that two parents share is therefore checked at each parent.

A head has one of two kinds of rule.

**A rule with signatures**, for a head that binds no name (`Add`, `Sin`,
`Less`, `Dot`). The pass types the operands in the current scope, from left
to right, then looks for the first signature that the types of the operands
match. A signature can be generic in the size of a point and can take any
number of operands. Step 3 fixes how a signature is written. What a match
must give is fixed here: the type of the result, and one resolved conversion
per operand (section 2).

The signatures are the list of what the pass accepts, so they are also the
list of what the emitter must write. A generated test takes each signature of
each head and builds expressions for it:

- with the sizes 2, 3 and 4, and with 2 and 3 operands, where they vary;
- with mixed operand types in each order (`Add(z, x)` and `Add(x, z)`), so
  that each conversion is tested at each place;
- with operands that are inputs, and with `constantFold: false`, so that a
  fold does not remove the operation under test.

Each expression is compiled to GLSL; a decline in stage 3 fails the test. The
source is then compiled by a GLSL ES 3.00 compiler: code that the engine
writes with no decline can still be code that no driver accepts. This
repository has no such compiler today (none in `package.json`, in
`test/compute-engine` or in `scripts`). Step 3 proposes the tool, a headless
WebGL2 context or a validator package, before it adds a dependency. A test
that only checks that each head has an emitter does not show that the emitter
handles each accepted combination of operand types.

**A rule that walks**, for a head that binds a name or restricts a place. The
pass does not type the operands first. The rule gets the node, the scope and
the function that types a node in a scope, and it types the parts in the
order below. Its cases are tests written by hand.

| Head | Order |
| --- | --- |
| A call of a user function | The arguments, in the scope of the call. Then, at the first call for a key, the definition: a new scope whose parent is the root scope and not the scope of the call, since the function is emitted at the top level; the parameters are bound from the declared signature, and a parameter with no declared type from the type of its argument at this call; then the body. The types of the arguments are checked against the parameters. A function that is already being typed is a recursion, and is refused. |
| `Block` (in a function body only) | A new scope. First the rule collects the names of the `Declare` statements of the block, with no type yet. Then the statements in order. A declaration gives its name the declared type, or the type of its first value, and marks it as reached. A read of a collected name that is not reached yet is refused, also from an inner scope, and also when an outer scope binds the same name: the lookup stops at the block and does not continue outward. An assignment of another type is refused. The type of the block is the type of the final expression. |
| A counted loop, `ParallelLoop` | The bounds, in the outer scope: they must be `integer`. A new scope that binds the index as `integer`. Then the body, with the loop in the context. |
| `Break` | No operand. Refused when the context has no loop. |
| `Sum`, `Product` | For each index in order: its bounds, in a scope that holds the indexes before it, then the index is bound as `integer`. Then the body. |
| `If`, `Which` | The conditions and the branches in order, in the current scope. The branches must have one type. No scope. |
| `At` | The base, then the index. The representation of the base decides: a point, an array or a sampler. |
| `Assign`, `AddTo`, a tuple assignment | The value, then the check that each target is a local of the function with that type. |

A rule that walks also gives one resolved conversion per operand that it
reads as a value (the `float` to `int` of the index of `At`, the `real` to
`complex` of an argument at a complex parameter). After a rule gives the type
of a value, the pass asks `representationOfValue()`, or
`representationOfBinding()` where the rule binds a name. A value with no
representation is a refusal.

## 5. Which facts the annotation can hold

The spec says that more facts can be added to the annotation later "without
a change to its shape". That is true only for a fact that has the same value
at every place where the scope reads the node. The type is such a fact: a
local has one type in its scope.

A fact about the value of a local is not. In this body the two `sin(x)` have
the same structure and the same binding of `x`, and different values:

```
let x = input
let a = sin(x)
x = x + 1
let b = sin(x)
```

An interval or a "finite" fact for `x` differs between the two reads, so it
cannot be stored under the scope and the node.

| Fact | Fits the scope and node key |
| --- | --- |
| The type, the representation, the conversion of each operand | yes |
| The node of the caller's tree that a prepared node came from | yes |
| The colour space of a value (`colorSpaceOf()` in `color-space-fact.ts`, which gives no answer for a symbol) | yes |
| The integer interval of a loop counter (`gpu-value-facts.ts`): the body does not assign it | yes |
| Which names a node reads and writes | yes |
| The interval or the finite proof of a local that the body assigns (`gpu-finite-proof.ts` leaves out the names that the code writes) | no: it needs one identity per assigned value |
| How many times a node is evaluated, and on which condition | no: it belongs to the evaluation regions of `cse.ts` |

Step 3 stores the first row only. The other facts stay in their modules. A
fact of the "no" rows needs the value identities of section 8 and is not
added to this table.

**The pass cap.** The spec gives `NaN` when one evaluation runs more passes
than `iterationBudget`. The count is of the passes that the emitted code
runs. The JavaScript target counts the same way: each pass of an emitted loop
adds one to the total of the call (`loopPassCount()` in `compile-loops.ts`).
So an expression with two equal `Sum` that the common-subexpression pass
writes once uses half the passes of the same expression compiled with
`cse: false`. A later rewrite that moves or removes a loop changes the count
in the same way. Until a rule says more, such a rewrite treats a loop as work
that it must not move, add or repeat. The tests of step 3 run an expression
over the cap and one under it, each with `cse` on and with `cse: false`.

## 6. The questions that move, in order

Counts are the occurrences of `<name>(` in `gpu-*.ts` and `glsl-target.ts`
without the line of the definition, from a text search on 2026-11-08. A
mention in a comment is counted, so each count is an upper limit.

**In step 3**, in this order:

1. **The type of a bound name** (a parameter, a local, an index). Today the
   `define` hook in `gpu-shader-target.ts` builds two maps for each function
   (`complexFrame`, `vectorFrame`, with the sentinels `LOCAL_SCALAR` and
   `LOCAL_BOOLEAN`) and pushes them with `BaseCompiler.withLocalShapeFrame()`
   (4 call sites). In step 3 one function builds these two maps from
   `FragmentScope.bindings`. The frames stay, because the shared code of all
   the targets reads them (`BaseCompiler.isComplexValued()`,
   `aggregateComponentCount()`), but they can no longer differ from the
   annotation.
2. **The signature of a user function.** Today `define` computes the
   parameter types (`gpuTypeOfDeclaredType()`, 2), then the return type from
   the body during emission (`gpuTypeOfValue()`), and checks each `Return` in
   the `onReturn` hook. In step 3 the signature is the `function` type of the
   entry in `FragmentAnnotation.functions`, known before the first line of the
   body is emitted, and `GPUUserFunctionSignature` is derived from it.
3. **The type of a declared name** (`gpuDeclaredShapeFrame()`, 2;
   `gpuDeclaredTypeOf()`, 9): the parameters of `compileFunction()` and the
   inputs and uniforms of `compileShader()`. A declaration becomes a binding
   of the root scope: `float` is `real`, `int` and `uint` are `integer`,
   `bool` is `boolean`, `vecN` is `point`. See choice 4 in section 9 for a
   spelling with no fragment type.
4. **The shader type of a value** (`gpuTypeOfValue()`, 12): the
   representation in the facts of the node.

**In step 5**, with the modules that it rewrites: `gpuOperandShape()` (46),
`gpuComponentCount()` (11), `gpuBinaryVectorWidth()` (2),
`gpuCertainValueType()` (5), the conversions (section 2), and the calls from
the shader modules of `BaseCompiler.isComplexValued()` (86),
`aggregateComponentCount()` (14), `isNonScalarShape()` (10) and `gpuType()`
(27). When they have moved, the shader targets push no shape frame, and the
table of declared types keyed by frame (`gpuDeclaredTypes`) goes.

## 7. The diagnostic

```ts
type CanCompileResult =
  | { ok: true }
  | { ok: false; diagnostic: CompileDiagnostic };

// The diagnostic of a refusal:
{
  code: 'outside-fragment',
  kind: 'capability',
  message: string,
  value: string, //     the node with no type, as `toString()` writes it
  operator?: string, // the head of that node (new field, see choice 5)
  binding?: string, //  the name, when the node is a free symbol
}
```

The pass stops at the first node whose rule gives no type. With the order of
section 4, the parts of that node all have a type, so it is the innermost
cause: `Add(Integrate(f, x), 1)` reports `Integrate`, not `Add`. A refusal in
the body of a user function names the function in the message.

`FragmentRefusal` holds the node, its scope and one of five reasons, and each
reason has one message form:

| Reason | Example | The message says |
| --- | --- | --- |
| The head is not in the list | `Integrate` | the head |
| No signature for these operands | `Less` on a complex operand; an `If` with branches of two types | the head and the types of the operands |
| A free symbol has no fragment type | `a` typed `unknown` | the name, its type, and "declare a numeric type" |
| The form is in the list but not at this place | a `Break` outside a loop; a `Range` as a value | the head and the place |
| A limit | a list of 9,801 elements; a recursive function | the limit and the value |

The code is the same for the five. `compile()` to `glsl` returns this
diagnostic when stage 2 refuses. A decline raised by stage 1 (the written
size, a `vars` source that a local shadows) is reported under the same code
with its own message.

## 8. What the annotation is for the later pipeline

The long-term goal is one pipeline for every target:

```
boxed expression
  → binding, preparation, type check        (this note, for GLSL)
  → typed structured representation
  → rewrites chosen for the target, from the shared set
  → choice of representations for one target
  → rewrites for that target only
  → emission of source
```

The targets share the machinery of the passes (the removal of common
subexpressions, the local replacement of a pattern) and the operations of the
language. Each target chooses which passes run, and gives its own rule of
what is legal and of what a rewrite costs. The rewrites that are legal for
every target are one part of what is shared, not the limit of it.

The annotation is the first line: it gives a prepared tree with a type on
each node, and an answer "in or out". It is not the representation of the
second line, and more fields in `FragmentFacts` do not make it one. What a
representation that rewrites can use needs, and this note does not build:

- **Values with an identity.** Each assignment makes a new value, and a
  branch or a loop says which values it joins or carries (the usual form is
  static single assignment). The regions stay explicit (`If`, loop,
  function), with their operations in order; the outputs are structured
  source languages, so a general control-flow graph is not needed. The rule
  that a shape is settled at compile time stays: this adds no analysis of
  the paths of control flow for shapes.
- **Conversions as operations.** The promotion to complex, the broadcast of
  a scalar and a numeric conversion are nodes, so that the removal of a
  common subexpression and a fold compare the operations that are done. The
  recorded conversions of section 2 are the data to build them from.
- **Effects and the right to evaluate.** "Pure" is not enough: a rewrite
  must know that an operation reads a name that is assigned, writes one,
  calls unknown code, can throw, or is safe to evaluate on a branch that is
  not taken. The pass cap (section 5) is one of these rules. The regions of
  `cse.ts` are the record of what is evaluated on a condition, and the
  representation uses them, not a second table.
- **A rewrite makes a new revision.** The analyses of the old revision are
  computed again unless the rewrite states that it keeps one. A checker runs
  between two stages on the types, the bindings and the structure of the
  regions. The origin of a node goes with it through a replacement.
- **A numerical rule for each rewrite.** `x / x` is `1` only with a proof
  about the domain; a change of the order of a sum needs a stated rounding
  rule. The caveats of `docs/COMPILATION-MODEL.md` ("Caveats of compiled
  code") are the contract, and the legal rewrites differ for f32, f64,
  `bigint`, complex and interval arithmetic. `interval-js` is a lowering
  whose contract is that the result encloses the value; a shared rewrite
  keeps that contract or does not run for it.

| Rewrite | What it needs first |
| --- | --- |
| A local replacement of a pattern | typed operations, conversions as operations, the numerical rule |
| Common subexpressions in one region | value identity, effects, evaluation regions |
| Removal of an unused computation | the uses of each value, and the right not to run it |
| Removal of a branch that is never taken | explicit branch regions, a known condition |
| Common subexpressions across regions; moving work out of a loop | which region comes before which, the values a loop carries, the analysis of writes and of the right to evaluate |

None of this is built before the decision of step 7 of the plan. One trial
would inform that decision: write one rewrite that is legal on both targets
and run it for GLSL and for JavaScript. It is not in the plan; it is added to
step 7 only if the user says so.

What step 3 leaves out, on purpose: the other targets (`javascript`,
`interval-js` and `python` do not read the annotation), the facts of the
"no" rows of section 5, a rewrite of any node, a type for the absent values
(`Missing`, `Nothing`, `NaN` as a state), and a public form of the
annotation (only the answer of `canCompile()` is public).

## 9. Choices in this note

1. **The pass types the prepared tree** (section 1). Alternative: type the
   caller's tree and state in each rule what the rewrites will do. That is a
   second description of the rewrites, which can differ from them, and the
   emitter could not find the nodes it walks in the annotation. Cost of the
   choice: `canCompile()` pays for the preparation. Step 3 measures the time
   of `canCompile()` against `compile()` on the showcase bodies and reports
   it.
2. **One table of rules in `glsl-fragment.ts`**, not a typing field beside
   each emitter in `gpu-functions.ts`. The table is the positive list of the
   spec in code. Cost: a head has two entries, a rule and an emitter; the
   generated test of section 4 checks one against the other.
3. **The frames stay in step 3 and are filled from the annotation**
   (section 6, item 1). Alternative: remove them in step 3. The shared code
   of the other targets reads them, so that change is larger than step 3.
4. **`compileFunction()`, `compileShader()` and `compileToSource()` of the
   GLSL target run the pass too.** A declared name whose spelling has no
   fragment type (`ivec2`, `bvec3`, a matrix, an array, a struct) is refused
   where the body reads it. Today such a name is not checked. Alternative:
   only `compile()` runs the pass; the table of declared types then stays
   for `compileFunction()` and `compileShader()`, the two entries that fill
   it. No source file of Tycho calls these three entries (searched `src/`
   and `scripts/` of `~/dev/tycho`).
5. **`CompileDiagnostic` gets one optional field, `operator`.** Tycho's audit
   counts declines by head, and the head cannot be read from `value` without
   a parser. Alternative: no new field; the head is in the message only.
6. **`canCompile()` catches every error.** An error of an option (an unknown
   storage kind, a `storage` name that is not a free symbol), which
   `compile()` throws, gives `ok: false` with the code `outside-fragment`
   and the message of the error. The spec says "never throws" and "one
   decline code". Alternative: a second code for an error of an option.
7. **The pass and its types are in `fragment.ts`, with no target in a name;
   a target gives a `FragmentDefinition`** (section 1). Alternative: one
   module `glsl-fragment.ts`; a second target would then start with a rename
   and a split. Cost: one more type. All the rules stay in the GLSL table
   until a second definition exists.
8. **The type holds no decision of a target; the representation is a second
   field that the definition gives** (section 2). A list of 3 reals is a
   `list`, and the GLSL table says that it is a `vec3`. The representation
   of a name is chosen where the name is bound, from its role and its
   declaration; a statement, a range and a function have none. Alternative:
   the first draft, where such a list was typed `point` and the list type
   had a storage kind. That is shorter, and a second target could not use
   the types.
9. **A head that binds no name is typed by a list of signatures; every node
   records one resolved conversion per operand** (sections 2 and 4).
   Alternative: one function per head that returns a type, with the
   conversions left to the emitter. Cost of the choice: the signature list
   of each head, the generated test, and a GLSL compiler for the tests,
   which this repository does not have. In step 3 the emitter does not read
   the recorded conversions yet; step 5 moves it.
10. **A rewrite that emission does is a trusted lowering of one operation,
    with a stated contract, a structural check and one test each; step 3
    lists and tests them all** (section 3). A new node is never typed on
    request. Alternative: move every such rewrite to stage 1 in step 3, so
    that stage 3 makes no node. That is the better end state, and it is
    larger than step 3: step 5 moves the ones that can move.
11. **The pass cap counts the passes of the emitted code** (section 5), as
    the JavaScript target does. Alternative: count the passes of the source
    expression, so that the answer does not depend on the `cse` option; the
    emitted code would then add the passes of each loop that it did not
    write.

12. **The place of a node is checked at every use, from a context that the
    walk passes; the table stores only what the node is** (sections 3 and
    4). Alternative: store "accepted" with the facts; a node that two
    parents share would then be checked at the first parent only.

Three corrections that this note needed in the spec, section 3. They are
applied in the spec and in the implementation plan:

- The spec names the options `hideValues` and "the per-symbol input types".
  They are options of Tycho's wrapper (`CECompileOptions`); `compile()` in
  this engine has neither (`CompileExpressionOptions` in
  `compile-expression.ts`). The options that decide the answer are `vars`,
  `storage`, `functions`, `mode`, `iterationBudget`, `constantFold` and
  `cse`.
- The answer depends on the expression, the options and the declarations
  that the expression reaches: the types of its free symbols and the
  definitions of the functions it calls. A host that keeps the answer per
  function must discard it when one of those declarations changes.
- "More facts can be propagated on it later […] without a change to its
  shape" is true for a fact that is the same at every read of a node in its
  scope (section 5). A fact about an assigned value, and the "wider
  intermediate representation" of the plan's step 7, need the value
  identities of section 8.
