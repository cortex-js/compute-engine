# Default values for optional parameters (GitHub issue #490)

Status: DECIDED 2026-10-31, revision 5. The user decided Q1 to Q7 of §8 on
2026-10-31: the spelling in the signature, symbol defaults without a
declaration, the canonical form carries the default, the head `Optional`,
the v1 scope, the empty list and dictionary as the only collection defaults,
and no shorthand for a union of literal symbol types. Revision 4 applied the
19 findings of the first dual review
(`docs/scratch/2026-10-31-parameter-default-values_SPEC_REVIEW.md`);
revision 5 applies the 14 findings of the second
(`docs/scratch/2026-10-31-parameter-default-values_SPEC_REVIEW_ROUND2.md`).
Two review rounds are the limit of the review process. IMPLEMENTED
2026-10-31: steps 1-5 of §6 are commits `c3317ef55`, `a4d2de2d5` (steps 2
and 3), `920ac2012` and `38f9b8375`; step 6 and step 7 complete the work.
§11 records the corrections found during the implementation. The
measurements in §2 were made on the working tree at commit `5f44931f4` with
scratch scripts (`ce.declare`, `ce.box`, `ce.type`, `executeEpsil`).

## 1. The request

Issue #490 (enumeratio, 2026-10-29): an optional parameter has no default
value. When the caller leaves it out, the operand is absent, so every
`evaluate` handler re-implements "if the operand is missing, use 2", and a
`Function` literal with an optional parameter cannot be called without it:
the call is a partial application.

The author asks for a default that is filled in at canonicalization, so that
`Scaled(3)` reaches the handler as `Scaled(3, 2)`, spelled in the signature
(`(x: number, factor: number = 2) -> number`) or beside it
(`defaults: { factor: 2 }`), and the same for a function literal.

The user asked (2026-10-31) whether number, string and boolean defaults are
enough. The author answered: yes for most (densities, branches, tolerances,
flags), but a ring option `over: Integers` and options that default to a
constant such as `Automatic` need a symbol, "read as the symbol itself and
not evaluated".

## 2. What the engine does today

Measured 2026-10-31.

Measured again 2026-10-31 at HEAD `fc5d21302577b3f5daa58185cf49f616b0289c23`
(one commit after `5f44931f4`: CE-713, protocol extension), before step 1.
Items 1, 2, 3, 5, 6, 9, 10, 11, 12 and 14 give the same results as below
(item 5 measured through Epsil, `Scaled3(3, factor: 5)`). Items 4, 7, 8 and
13 were not measured again; the commit does not change the files they cite.
These line numbers moved; the text of the spec keeps the old numbers, read
them as these:

- `box.ts`: unchanged (the comment at 2849, `suppliedOperandCount` at 2851,
  `_reboxedForCallee` at 3299); the Spread skip is at 4231 (was "near 4228").
- `compile-definitions.ts`: the optional-or-variadic decline is at 872 (was
  869), the clause-arity check at 885 (was 879).
- `subtype.ts`: the arity-range comparison is at 3495 (was "near 3486").
- `boxed-function.ts`: the signature-inference rebuild that copies `optArgs`
  is at 1870 (was "near 1868").
- `utils.ts`: `functionArity` is at 476.
- `javascript-target.ts`: the `Missing` = `undefined` comment is at 3023 (was
  "near 3020"); this file has uncommitted changes of another session (the
  `bigint` compile mode, CE-715).
- `engine-protocols.ts`: the optional-member refusal is at 747 (was 744),
  moved by CE-713. `parseProtocolSignature` is still the parser of a
  protocol requirement (`src/epsil/parser.ts` line 2692).

1. `ce.declare("Scaled", { signature: "(x: number, factor: number?) -> number", evaluate: (ops) => ce.number(ops.length) })`.
   `Scaled(3)` evaluates to 1, `Scaled(3, factor: 5)` to 2. The handler sees
   the written operands only.
2. `signature: "(x: number, factor: number = 2) -> number"` throws
   `Failed to parse type …: Unexpected character: =`. The type lexer has no
   `=` token (`src/common/type/lexer.ts`, `TokenType`).
3. `["Function", ["Multiply", "x", "f"], "x", ["Typed", "f", "'number?'"]]`
   applied to `3` gives `(_1) => Apply((x, f) => f * x, 3, _1)`: a partial
   application. The literal's type is `(x: unknown, unknown) -> number`. The
   cause: `number?` is not a type, `parseTypeOperand`
   (`src/compute-engine/boxed-expression/function-literal.ts`) fails and
   returns `undefined`, and the parameter is treated as unannotated. The `?`
   is ignored without a diagnostic, and the parameter name is lost from the
   type. This is a defect; the change of this spec touches the code, so it is
   fixed in the same change (§4, rule R6).
4. A function literal's arity is the number of its parameters:
   `saturated = args.length >= params.length` in `apply`
   (`src/compute-engine/function-utils.ts`). The inferred signature of a
   literal has no `optArgs`.
5. Named arguments: with `(x: number, density: number?, factor: number?)`,
   `Scaled3(3, factor: 5)` is the error `argument-optional-skipped`
   ("every optional parameter declared before it must also be supplied;
   `density` is not"). This is sub-ruling R1 of the named-arguments design
   (`src/compute-engine/boxed-expression/named-arguments.ts`, step 5): the
   engine has no absent-argument placeholder, because `flatten` drops
   `Nothing`. Measured: `Sc(3, Nothing, 5)` canonicalizes to `Sc(3, 5)`.
6. The type DSL has literal value types: `2`, `"abc"`, `true` parse
   (`ValueType`, `parseValue` in `src/common/type/parser.ts`). A symbol does
   not: `ce.type("Integers")` fails. `(x: number, k: 2) -> number` parses, but
   it means "`k` accepts only the value 2" (`Lit(3, 5)` is
   `incompatible-type`), not a default.
7. Parameter names are part of the type but not of subtyping:
   `(x: number) -> number` matches `(y: number) -> number`.
8. Library operators implement their own defaults in the handler. Example:
   `LambertW(z, branch: integer?)` uses branch 0 (`src/compute-engine/library/arithmetic.ts`).
   The LaTeX differs: `LambertW(1)` is `\operatorname{W}(1)`,
   `LambertW(1, 0)` is `\operatorname{W}_{0}(1)`.
9. `Automatic` is not a library symbol (`ce.lookupDefinition("Automatic")` is
   undefined); `Integers` is (type `set<integer>`).
10. Epsil: `(x, k = 2) => x * k` is the diagnostic `symbol-expected` at the
    `=`. `function f(x: number, k: number = 2)` does not parse either.
11. The DSL has a literal symbol type: `symbol<Auto>` parses, and so does the
    union `symbol<Auto> | symbol<Manual>` (`parseSymbolType` in
    `src/common/type/parser.ts`). The bare `Auto | Manual` is "Invalid
    type": an identifier in type position is a type name.
12. An undeclared symbol written as an operand is admitted at every
    parameter type at canonicalization, because its type `unknown` is not
    provably wrong: with `(x: number, mode: symbol<Auto> | symbol<Manual>)`,
    `M2(3, Other)` is valid, and with `(x: number, over: set)`,
    `S(3, Integer)` is valid. Boxing the operand auto-declares the symbol.
    `ce.box("Zork").type.matches("set")` is nevertheless false: the
    admission rule of a call is wider than `matches`.
13. A `symbol`-typed parameter evaluates its operand: after `Auto := 7`,
    `M(3, Auto)` with `mode: symbol` is `incompatible-type` (`7` is not a
    symbol).
14. `ce.box(["List"]).type` is `list<never>`, which matches `list<number>`;
    `ce.box(["Dictionary"]).type` is `dictionary<never>`, which matches
    `dictionary`. The DSL has no list or dictionary value spelling.

## 3. Design in one paragraph

A default is written in the signature after the parameter type:
`factor: number = 2`. It is stored on the parameter in the parsed `Type`,
beside the parameter name, and printed back by the serializer. It is a
number, a string, a boolean, a symbol, `[]` or `{}`. A parameter with a default is
optional. When a call leaves the parameter out, canonicalization inserts the
default operand, so the canonical form, the handler, the type handlers, the
compiler and the documentation all see `Scaled(3, 2)`. A function literal
spells a default with a parameter wrapper `["Optional", param, default]`
(Epsil: `(x, k = 2) => …`, `function f(x, k: number = 2)`), and a call with
fewer arguments than parameters but at least the required ones is a full
call, not a partial application.

## 4. Rules

### R1. Spelling in the type DSL

```
<argument>          ::= <named_element> ( "?" | "=" <default_value> )?
<default_value>     ::= <value> | <identifier> | "[" "]" | "{" "}"
```

- A parameter with a default is optional. `number? = 2` is a parse error:
  "a parameter with a default value is optional; remove the `?`".
- A default is allowed only in the argument list of a function signature. In
  a tuple type (`(x: number, k: number = 2)` with no arrow) it is a parse
  error. A variadic parameter cannot have a default.
- Where a default is accepted in v1: the top-level signature of an operator
  definition (`ce.declare`, `ce.assign`), the top-level signature of a
  declared variable (`ce.declare("g", "(number, number = 2) -> number")`),
  and a function literal's `Optional` parameter (R6). A default anywhere else
  in a type parses, but the declaration that uses the type throws "a default
  value is allowed only in a top-level function signature": a parameter
  annotation of a signature (`(f: (number, number = 2) -> number) -> number`),
  an element type, a record field, a `Typed` annotation, `declareType`. The
  parser cannot know the position, so the check is in the engine where the
  type is installed. Reason: nothing would box, check and insert such a
  default (R4), and R5 fills only from a definition.
- A default on a parameter whose type mentions a type parameter
  (`<T>(x: T, k: T = 2) -> T`) is refused at declaration in v1: "a default
  value on a generic parameter is not supported yet". The check of R4 has no
  defined result before instantiation, and whether the filled operand takes
  part in solving `T` is a design question of its own.
- Order: required parameters, then optional parameters with a default, then
  optional parameters without a default (then nothing: optional and variadic
  do not mix today, unchanged). A defaulted parameter after a default-less
  optional is a parse error. Reason: the fill is positional. With
  `(x, a: number?, b: number = 2)`, a call `f(1)` would put the default of
  `b` in the slot of `a`.
- `<identifier>` in default position is a symbol name, not a type name. The
  lexer gets an `=` token. `-1` already lexes as one number literal, so
  `branch: integer = -1` needs nothing more.
- The identifiers `True` and `False` in default position are the boolean
  values `true` and `false`, so `flag: boolean = True` and
  `flag: boolean = true` are one spelling with one identity key. No other
  identifier is normalized.
- A default may not name a parameter of the same signature
  (`(x: number, k: number = x)`): the interpreter skips the parameter
  activation when it reads a symbol default (R4), so the symbol would mean an
  outer `x`, while a native JavaScript default reads the parameter (R8). It
  is a parse error: "a default value cannot name a parameter". A default may
  not be `Nothing` or `Missing`: `flatten` drops a written `Nothing`, so the
  inserted operand would disappear at the next canonicalization. Parse
  error: "`Nothing` is not a default value; leave the parameter optional
  instead".

### R2. Representation

`NamedElement` (`src/common/type/types.ts`) gains an optional field:

```ts
export type ParameterDefault =
  | { kind: 'value'; value: number | string | boolean }
  | { kind: 'symbol'; name: string }
  | { kind: 'empty-list' }
  | { kind: 'empty-dictionary' };

export type NamedElement = { name?: string; type: Type; default?: ParameterDefault };
```

- The serializer prints `name: type = default` (strings quoted, symbols
  bare, `NaN`/`+oo`/`-oo` as the DSL spells them), so `typeToString` and the
  identity key (`typeToIdentityKey`) distinguish two signatures that differ
  only by a default. A type is immutable; the default is frozen with it.
- Subtyping, compatibility, overload admission and specificity ignore the
  default, as they ignore the parameter name (§2, item 7). A default changes
  what a call means, not which calls are admitted. One exception: when a
  VALUE is checked against a DECLARED type (an assignment to a variable
  declared `(number, number = 2) -> number`), a defaulted slot of the
  declared type counts as a required slot of the declared type, because R5
  fills it before any call reaches the value. So `(x, k) => x * k`, whose
  minimum arity is 2, is accepted where the declared minimum would otherwise
  be 1 (`subtype.ts`, the arity-range comparison near its line 3486). Without
  the exception the main use of a default on a declared type, storing a value
  that requires the parameter, would be refused. Recorded in
  `docs/TYPE-SYSTEM.md` with this example.
- Every place that rebuilds `args`, `optArgs` or `variadicArg` from a
  signature carries the field (a `{...element, type}` spread does; a
  `{ name, type }` literal drops it). The implementation runs a census of the
  13 files in `src/common/type` that mention `optArgs`, and of
  `boxed-function.ts` (the signature-inference rebuild near its line 1868
  copies `optArgs` by reference, which is fine).

### R3. Which values

A default is a number that a JavaScript `number` holds (a finite number,
`NaN`, `+oo`, `-oo`), a string, `true` or `false`, a symbol, the empty list
`[]` or the empty dictionary `{}` (user decision 2026-10-31, Q6 in §8). The
two `<value>` spellings that the type parser represents with object
sentinels, `Indeterminate` and `~oo`, are not defaults: a `number` field
cannot hold them without merging `Indeterminate` with `NaN`, and no
parameter needs them as a default. Parse error: "`Indeterminate` is not a
default value".

A symbol default is the symbol itself: the declaration stores its name, never
a value read at declaration time, and the symbol need not be declared (user
decision 2026-10-31). When the call is evaluated, the inserted symbol is
evaluated like any written operand of that slot (`Integers` and `Automatic`
evaluate to themselves; `Pi` to its value). A symbol with a value as a
default therefore behaves exactly as if the author had written the symbol in
the call. This is documented with that example. The natural parameter types
for a symbol option are `symbol` (any symbol) and a union of literal symbol
types, `mode: symbol<Auto> | symbol<Manual> = Auto`, both of which the DSL
has today (§2, item 11).

Other values (a non-empty list, a tuple such as `(0, 0)`, a dictionary with
entries, a function) are not spelled in v1. The DSL would need an expression
grammar for them. The escape hatch is a symbol: the host declares a constant
(`ce.declare("DefaultWeights", { value: [1, 2, 3], constant: true })`) and
writes `weights: list<number> = DefaultWeights`; the symbol evaluates to the
list when the call is evaluated, as a written `DefaultWeights` would.

### R4. Check at declaration

When an operator definition is built (`ce.declare`, and the derived signature
of `ce.assign` with a function literal), or a variable is declared with a
function type that carries a default, each default is boxed once, in the
declaring scope, and kept on the boxed definition (operator or value), which
is where `fillParameterDefaults` (R5) reads the boxed operands. A function
literal gets the same checks when it is canonicalized
(`canonicalFunctionLiteralArguments`, `src/compute-engine/function-utils.ts`):
the default operand of an `Optional` parameter is canonicalized with the
literal, and a default that does not match the parameter's type, annotated
or inferred from the body (`(k: number = "a") => …`, `(x, k = "a") => x * k`
where the body makes `k` a number), is the error `incompatible-type` on that
parameter, as a wrong argument is. The same literal is then accepted or
refused the same way inline and at `ce.assign`.

The conversion of a literal's default operand to a `ParameterDefault` (R2),
after the operand is canonicalized: a machine number, finite, `NaN` or
`±∞`, and the symbols `NaN`, `PositiveInfinity`, `NegativeInfinity` give the
value kind; `True` and `False` give a boolean; `["List"]` and
`["Dictionary"]` with no operands give the two collection kinds; any other
symbol gives the symbol kind, except `ComplexInfinity`, `Indeterminate`,
`Nothing` and `Missing`, which are `expected-a-literal-default` (R3); a
rational, a number that a double does not hold exactly and a complex number
are `expected-a-literal-default` in v1 (the escape hatch is a constant
symbol, R3). So the printed type of a literal parses back to the same
identity key.

- A value default (number, string, boolean, `[]`, `{}`) must match the
  parameter type (`boxedDefault.type.matches(paramType)`). Otherwise the
  declaration throws, as a signature that fails to parse throws today.
  `factor: number = "a"` and `over: set = 3` are refused; `xs: list<number> = []`
  is accepted (`list<never>` matches `list<number>`, §2 item 14).
- A symbol default is checked as a written symbol operand is checked at that
  parameter (§2, item 12): a declared symbol whose type does not match is
  refused (`k: number = Integers`), an undeclared symbol is accepted at every
  parameter type, and no declaration is required (user decision
  2026-10-31). One check is added that the call site cannot make: when the
  parameter type is a literal symbol type or a union of them
  (`symbol<Auto> | symbol<Manual>`), the default's name must be one of the
  listed names, so `mode: symbol<Auto> | symbol<Manual> = Atuo` is refused.
  This costs nothing and the names are known statically.
- Boxing the default at declaration auto-declares an undeclared symbol in the
  declaring scope, exactly as writing the symbol in an expression would. The
  boxed default is the operand inserted in each call, and it is read exactly
  as a written symbol operand at the call site is read: the value of a data
  symbol is the innermost binding of the name when the call is evaluated,
  with the parameter activations of other functions skipped
  (`docs/SCOPING-MODEL.md`, the paragraph that starts "Reading a symbol's
  VALUE during evaluation"). So a declaration of the same name in a scope
  entered after the call was made is read, and a parameter of the function
  being called with the same name is not. The spec promises no stronger
  capture: the engine has no mechanism that binds a data symbol to one
  declaration for good, and a default is not the place to add one. This is
  R3's "as if the author had written the symbol in the call".
- The call of a callback that a lazy view (`Map(f, xs)`) makes when it is
  read takes place in the context where the view was created, not where it
  is read: a symbol default of `f` reads the binding of the place where
  `Map(f, xs)` was written, also after the function that created the view
  has returned (§11 item 6).

### R5. The fill at canonicalization

The fill is one function, `fillParameterDefaults(ops, signature)`: for a
callee with one signature, when every required slot has an operand, every
defaulted slot that has no operand receives its default operand (the boxed
operand of R4). When a required slot is empty (`Scaled()`), nothing is
filled: the call reports `missing` for the required slot as it does today,
and the default is never shifted into a required slot. The fill does not
change an operand that is present.

**Amendment of 2026-11-01 (R6 of
`docs/plans/2026-11-01-absent-value-contract.md`, decided by the user): a
default also fills a supplied ABSENT argument.** A defaulted slot whose
operand is absent, or evaluates to an absent value, takes its default, at
canonicalization when the operand is the written symbol and at evaluation
otherwise. The test of absence is the one of `Coalesce` (`Missing`,
`Undefined`, `NaN` and `Indeterminate`; `Nothing` passes through). A
default parameter is then a discharge of absence, as `Coalesce` is:
`(k: real | missing = 2) ↦ k` gives 2 for `f()`, `f(Missing)` and
`f(At(L, 100))` with `L` a list of two points, and `(k: real = 2) ↦ k`
gives 2 for `f(0/0)`. A caller that needs to pass an absent value through a
parameter declares no default for it. A lazy operator receives its operands
unevaluated, so it fills only a written absent operand. Compiled code fills
the default with the target's own `Coalesce` test (R8), and the fill by
argument count is removed.
Before this amendment, a supplied `Missing` stayed `Missing` and only an
argument left out took the default.

`makeCanonicalFunction` (`src/compute-engine/boxed-expression/box.ts`) has
several routes, and the fill runs on each of them at the point where the
positional operand list is final:

- Ordinary route (no custom `canonical` handler): after named-argument
  normalization and `flatten`, before `validateArguments`.
- Custom `canonical` handler: the handler receives operands that are not
  flattened (comment near its line 2849), so a top-level `Sequence` operand
  stands for several positions. The fill counts the supplied positions with
  `suppliedOperandCount` (box.ts line 2851), the function the arity check of
  this route already uses, and appends the default operands after the
  written operands: `F(Sequence(3, 5))` with `(x, k = 2)` supplies two
  positions and gets no default; `F(Sequence(3))` gets one. The fill runs
  only for a callee whose signature has a defaulted slot; a written
  `Nothing` operand is removed first for such a callee only (as `flatten`
  removes it on the ordinary route), so an operator without defaults sees
  exactly the operands it sees today. A handler that returns a different
  expression keeps its result; a handler that returns `null` continues on
  the ordinary route, which does not fill again.
- Lazy operator: the same as the custom-handler route, with the same
  counting; the inserted operand is the canonical boxed default of R4 (not a
  raw symbol), held like the written operands. A lazy call with an
  unresolved `Spread` operand is not filled (next item).
- A call with an unresolved `Spread` operand (`Scaled(...p)` with `p` not a
  literal tuple), on any route: the positional count is unknown, so the call
  is not filled at canonicalization (as it is not validated, box.ts near line
  4228). The rebuild of the call at evaluation, after the splice,
  canonicalizes the spliced operand list and fills then.

Then validation and the handlers run as today.

- A call through a variable whose declared type is a function signature with
  a default (`g: (number, number = 2) -> number`) is filled from the declared
  type at canonicalization, as the names of a named-argument call are read
  from the declared type only (decision of 2026-10-01 in
  `named-arguments-declared-callee.test.ts`). The default of the value the
  variable holds applies only to a slot the declared type leaves without a
  default; the value's own `apply` (R6) fills it at evaluation. A variable
  declared with the bare `function` type gets every default at evaluation.
  Passing the variable as a callback (`Map(L, g)`) passes its value, and the
  library operator calls the value with the arguments it has; a value that
  requires the parameter then reports `missing`. Documented as a limit of
  v1 with this example.
- A callee whose signature can change after the call is made: a user
  function (an operator definition made by `ce.assign` of a function
  literal) and a variable with an INFERRED type. For these, `box.ts` keeps
  the written argument slots of a named-argument call and matches them again
  against the function the name holds when the call is evaluated
  (`writtenArgumentSlots`, `_reboxedForCallee`, box.ts near line 3299). A
  default follows the same rule: the call is filled at canonicalization from
  the current definition, so the canonical form carries the default, and the
  written slots are recorded so that the evaluation re-match fills the
  WRITTEN arguments again from the definition in force then. With
  `f := (x, k = 2) => x * k`, `e := f(3)`, then `f := (x) => x`,
  `e.evaluate()` is 3, not `unexpected-argument`; after `f := (x, k = 5) => x * k`
  it is 15. An operator declared with `ce.declare` and a variable with a
  declared type are contracts and are not re-matched (unchanged).
- The canonical form carries the default. `Scaled(3)` and `Scaled(3, 2)` are
  one expression: same `.json`, same LaTeX, `isSame` is true. This is what
  the issue asks for, and it is what makes the handler, the type handler,
  `sgn`, the derivative handlers and the compiler agree without each filling
  the default itself.
- Named arguments: a hole (sub-ruling R1 of the named-arguments design) at a
  defaulted slot is filled by the default; a hole at a default-less optional
  stays `argument-optional-skipped`. With R1's order rule, such a hole can
  only be at a default-less optional that precedes another named
  default-less optional. `f(k: Nothing)` omits `k`, so `k` takes its
  default.
- A positional written `Nothing` is still dropped by `flatten` before the
  fill (§2, item 5): unchanged.
- A non-canonical boxing (`ce.box(x, { canonical: false })`) does not fill,
  as it does not flatten.
- The fill runs only when the callee's signature is known at
  canonicalization: an operator definition, a declared variable type, or an
  inline literal (R6). Otherwise `apply` fills at evaluation (R6).

### R6. Function literals

MathJSON spelling: a parameter operand `["Optional", param, default]`, where
`param` is a symbol or `["Typed", symbol, type]`, and `default` is a number,
a string, `True`, `False`, a symbol, the empty list `["List"]` or the empty
dictionary `["Dictionary"]`. Any other default is the error
`expected-a-literal-default` on that parameter; a default that names a
parameter of the same literal, `Nothing` or `Missing` is the same error (R1
gives the reasons). A rest or destructuring parameter cannot be `Optional`
in v1: the error is `expected-a-symbol` on the wrapped operand. An
`Optional` with no default operand is the error `missing` on the parameter in
v1 (see §9).

- Order: as R1. A plain parameter after an `Optional` parameter is the error
  `expected-a-symbol` on the plain parameter ("a required parameter cannot
  follow a parameter with a default"); a rest parameter after an `Optional`
  is the same error on the rest parameter (optional and variadic do not mix,
  R1), and `apply`'s rest-parameter branch is not extended. In Epsil, a
  default on a `bind` parameter of a `hold` definition is
  `default-value-invalid`, and a default beside a literal parameter
  (`function f(0, k = 2)`) makes a multi-clause function, which R9 refuses.
- The literal's inferred signature puts an `Optional` parameter in `optArgs`
  with its default. The parameter's type is what it is for a parameter
  without a default: the annotation when there is one, otherwise the type the
  body's uses infer (`docs/TYPE-SYSTEM.md`, "The inferred signature of a
  function literal"). The default does not narrow or widen that type; a
  default that does not match it is refused (R4). So
  `((x, k = 2) => k).type` is `(x: unknown, k: unknown = 2) -> unknown`
  when the body proves nothing about `k`, `((x, k = 2) => x * k).type` is
  `(x: unknown, k: number = 2) -> number` because `Multiply` demands a
  number, and `((x, k: number = 2) => x * k).type` is
  `(x: unknown, k: number = 2) -> number`.
- `apply` (`src/compute-engine/function-utils.ts`): a call is saturated when
  `args.length >= requiredCount`, the number of parameters before the first
  `Optional`. A saturated call with fewer arguments than parameters is filled
  by the same `fillParameterDefaults` before the arguments are evaluated
  (step 2), so the body always has every parameter bound. A call with fewer
  arguments than `requiredCount` is not filled and curries as today. The
  residual keeps the shape it has today, a wrapper that re-applies the
  original literal, and its fresh parameters keep the `Optional` wrappers of
  the unapplied parameters, with the original default operand: the residual
  of `((x, k = 2) => x * k)()` is `(_1, Optional(_2, 2)) => Apply(lit, _1, _2)`,
  so `residual(3)` is 6 and `residual(3, 5)` is 15.
- An operator that chooses a mode from a callback's arity reads the number
  of REQUIRED parameters when the callback has defaults. `functionArity`
  (`src/common/type/utils.ts`) returns `undefined` for a signature with
  `optArgs`, and `Sort`/`Ordering` (a unary key against a binary
  comparator), `Iterate` (one argument against index and previous value) and
  the two other callers in `collections.ts` test `functionArity(...) === 1`.
  Without a rule, `Sort(L, (x, k = 2) => x * k)` would silently become a
  comparator. A new `requiredArity` reads `args.length` when every optional
  parameter of every arm has a default and the arms agree; the mode
  selectors use it, so `(x, k = 2) => x * k` is a unary key and `k` is
  filled. A default-less optional keeps today's `undefined`.
- Every reader of a literal's parameter list that counts parameters or reads
  them by position unwraps `Optional` and treats a defaulted parameter as
  optional. The implementation runs a census of `ops.slice(1)` and
  `nops - 1` over `Function` literals, and of `functionArity` callers. Known
  sites: `callback-arity.ts`
  (today "every parameter of a literal is required"; it returns the
  defaulted parameters as optional, `{ required, max }`), the pipe-stage
  arity check, `binders.ts`, `binding-sites.ts`, `effects-inference.ts`,
  `call-result-type.ts`. The symbol a default names is a captured (free)
  variable of the literal for binding and effects, not a parameter.
- Canonical-time fill (R5) also applies to an inline literal callee
  (`inlineLiteralSignature` in `box.ts`) and to an operator whose signature
  was derived from a literal by `ce.assign`.
- LaTeX serialization in v1: an `Optional` parameter prints as `k = 2` in
  the parameter list, `(x, k = 2) \mapsto x k`, and the default prints as
  its own LaTeX. Parsing that text back gives `Equal(k, 2)` in parameter
  position, which the `Function` canonical form rejects as a parameter
  today; reading it as `Optional(k, 2)` is the §9 item. The test records the
  round-trip result.
- Signature-string sugar: `["Function", body, "'(x: number, k: number = 2) -> number'"]`
  desugars to the `Optional` form. The sugar keeps refusing `?` without a
  default and variadic markers.
- `["Typed", k, "'number?'"]` (the issue's spelling) becomes the error
  `invalid-parameter-annotation` with the hint "write `Optional(k, default)`
  for an optional parameter", instead of silently typing `k` as `unknown`
  (§2, item 3).
- The `Optional` operator definition (`src/compute-engine/library/core.ts`,
  beside `Spread` and `NamedArgument`) is a parse-level carrier: outside a
  parameter list it is the error `unexpected-argument`.

### R7. Epsil surface syntax

```
function f(x: number, k: number = 2) -> number { x * k }
let g = (x, k = 2) => x * k
let h = (x, k: number = 2) => x * k
```

- `parseParameterList` (`src/epsil/parser.ts`) accepts `= <default>` after
  the optional type annotation, where `<default>` is a number literal with an
  optional sign, a string literal, `true`, `false`, a symbol, `[]` or `{}`.
  Any other expression is the diagnostic `default-value-invalid` ("a default
  value is a number, a string, a boolean, a symbol, `[]` or `{}`"); a
  default that names a parameter of the same list, or `Nothing`, is the same
  diagnostic with the reason of R1. The parameter lowers to
  `["Optional", param, default]`, with `["List"]` and `["Dictionary"]` for
  the two collections.
- The formatter and `serialize-epsil` print the default back. `epsil doc f`
  shows it through the type serializer. The static diagnostic
  `argument-optional-skipped` follows R5 (a defaulted hole is no longer a
  diagnostic).
- `hold` definitions share `parseParameterList`, so they accept the
  spelling. A protocol requirement does not: it is parsed by
  `parseProtocolSignature` (`src/epsil/parser.ts`), and a requirement with an
  optional parameter is refused by `engine-protocols.ts` (its line 744),
  because protocol dispatch assumes a fixed arity
  (`docs/TYPE_SYSTEM_ROADMAP.md`, "Signature matching (ruling)"). A default
  makes the parameter optional, so a default in a protocol requirement is
  refused by the same check, with the existing diagnostic. Multi-clause
  functions: see R9.

### R8. Compilation

- A call of a declared operator needs no compiler change: its canonical form
  is saturated (R5).
- A compiled function literal or user function with `Optional` parameters,
  JavaScript target: the function fills each defaulted parameter with the
  test of `Coalesce` (`((_c) => Number.isNaN(_c ?? Number.NaN) ? 2 : _c)(k)`,
  which reads `undefined`, `null` and `NaN`), not with a native default
  parameter (`function (x, k = 2)`), which fills only `undefined`: a read
  past the end of a numeric list passes `NaN`. This is the rule since the
  amendment of R5 (2026-11-01): a supplied absent value takes the default
  too. A call of an engine user function wraps an argument whose static
  type can be absent in `Coalesce(arg, default)` at the call site. Before
  the amendment a parameter typed `number | missing = 2` kept a supplied
  `Missing`, and the emitted function filled from the argument count
  (`if (arguments.length < 2) k = …`); that code is removed. The default
  expression itself: a
  value default is emitted through the target's own compilation of that
  value (a plain number on the JavaScript target, the interval constant on
  the interval target), never as a raw literal; a symbol default is emitted
  as the read of the symbol (a native default expression is evaluated at
  each call, so the read happens at the call, as the interpreter's does); a
  collection default is `[]` or `{}`, a fresh object per call.
- Python target: every defaulted parameter takes `None` as its sentinel
  and is filled with the test of `Coalesce` (`None`, or a float or complex
  `NaN`): `lambda k=None: (lambda k: k)(2 if <absent test of k> else k)`.
  The default is evaluated at each call, so a mutable default is not shared
  between calls.
- GLSL, WGSL and interval-JavaScript targets: no default parameters. The
  function is emitted with its full arity, and a call site with fewer
  arguments is completed by the compiler with the default operand, compiled
  as a written operand at that call site would be. This matches the
  interpreter's reading of a symbol default (R4), except when the call site
  is inside a function whose parameter has the default's name, which the
  interpreter skips: the compiler declines that case ("a default value is
  shadowed by a parameter at the call site"). The completion covers
  callbacks that a library operator invokes inside compiled code
  (`Map(L, (x, k = 2) => …)`), which R5 and R6 do not saturate. The arity
  checks of the targets (`assertApplyArity` in `javascript-target.ts`, the
  interval-JavaScript `Apply` check) accept `required <= count <= params`.
  A symbol default that a target cannot compile declines as the written
  symbol would.
- `compile-definitions.ts` (its line 869) declines "a clause with an optional
  or variadic parameter". In v1 only a one-clause user function can carry a
  default (R9). Such a function no longer declines on the JavaScript target:
  it has no guard to spell, and its defaults are emitted as above. The
  clause-arity check that follows (its line 879, "a clause literal takes a
  different number of parameters than its signature") counts
  `args + optArgs`, so a defaulted literal passes it. The
  decline stays for a default-less optional and for every multi-clause
  function (unchanged); the guard rule for defaulted clauses belongs to v2
  with R9.

### R9. Overloads and multi-clause functions: not in v1

A default in an arm of an intersection signature, or in a clause of a
multi-clause Epsil function, is a declaration error in v1: "a default value
in an overloaded signature is not supported yet". Reason: with an operand of
type `unknown` or `any`, the arm is undecided at canonicalization, and the
fill needs one arm. A sound v2 rule exists (fill when every viable arm agrees
on the slot's default; otherwise fill at evaluation, when the arm is known).
Recorded as a ROADMAP entry when v1 lands.

### R10. Library operators: no change in v1

No library operator gets a default in v1. A default changes the canonical
form and the LaTeX (`W(1)` would print as `W_0(1)`, §2 item 8). A later
item can add defaults to library operators together with a serializer rule
that elides an operand equal to the default.

### R11. `inferredSignature: true`

The derived signature takes the literal's defaults; a declared default is a
starting point, as the declared types are. When they differ (declared
`k: number = 2`, assigned `(x, k = 3) => …`), the literal's default replaces
the declared one, as an assignment replaces the declared types (D6, "Assign
always full-replaces", `types-definitions.ts`). A call made before the
assignment is a call of a user function, so the rule of R5 for callees whose
signature can change applies: its written arguments are matched and filled
again from the new definition when it is evaluated.

### R12. Reporting

`def.signature.toString()`, the type of the operator symbol and `epsil doc`
print the default: `(x: number, factor: number = 2) -> number`. The issue
asked that the signature report the default; this is where it does.

## 5. Alternatives considered and not recommended

1. **`defaults: { factor: 2 }` beside the signature.** Two sources that can
   disagree, no place for a function literal, and the signature could not
   report the default. The author offered it as a second choice only.
2. **Fill at evaluation and compilation only, canonical form unchanged.**
   Every reader of operands (type handlers, `sgn`, derivative handlers, the
   compiler, serializers of other hosts) would fill the default itself, and
   `Scaled(3)` and `Scaled(3, 2)` would stay two expressions. The issue asks
   for the fill at canonicalization.
3. **The default in the `Typed` type string, `["Typed", "k", "'number = 2'"]`.**
   The second operand of `Typed` is a type; `number = 2` is not one, and an
   untyped parameter with a default would be `'unknown = 2'`. A string default
   nests quotes. The `Optional` wrapper keeps the default as an expression.
4. **`number? = 2` accepted as well as `number = 2`.** Two spellings for one
   thing; the serializer would have to pick one, and a round trip would
   change the text.
5. **A symbol default must be declared first.** Rejected by the user
   2026-10-31. The engine admits an undeclared symbol as a written operand at
   every parameter (§2, item 12), so a declaration requirement would make a
   default stricter than the operand it stands for, and the author's
   `Automatic` would need a declaration for no gain.
6. **Store the default in the operator definition only, not in the `Type`.**
   A `Type` object passed as `signature` could then not carry it, and the
   literal's inferred signature could not report it. Parameter names set the
   precedent: in the type, ignored by subtyping.

## 6. Implementation steps

Each step is one sub-agent task; sizes are estimates (S: one file, M: a few
files, L: many files or a design question inside).

1. **Type DSL** (M): `=` token in `lexer.ts`; `parseArgument` reads
   `= <default_value>`; `ArgumentNode` gets `default`; `type-builder.ts`
   copies it to `NamedElement.default`; order and placement errors of R1;
   `serialize.ts` prints it; grammar comments in `types.ts` and `parser.ts`;
   `docs/TYPE-SYSTEM.md`. Census of `optArgs` rebuilds in `src/common/type`
   (R2).
2. **Definitions** (M): `boxed-operator-definition.ts` and the value
   definition of a declared function-typed variable box and check each
   default (R4), refuse a default in an overloaded signature (R9), on a
   generic parameter and in a nested position (R1), keep the boxed
   defaults; `types-definitions.ts` documents the field on
   `OperatorDefinition.signature`; the subtype exception for a declared type
   (R2) in `subtype.ts` and `docs/TYPE-SYSTEM.md`.
3. **The fill** (M): `fillParameterDefaults`; `box.ts` `makeCanonicalFunction`
   on each route of R5 (ordinary, custom `canonical` handler with
   `suppliedOperandCount`, lazy, Spread deferred to the evaluation rebuild);
   the declared-type variable rule; the written-slot record and the
   evaluation re-fill for user functions and inferred-type variables
   (`writtenArgumentSlots`, `_reboxedForCallee`); `named-arguments.ts` step
   5 fills a defaulted hole; tests of §7 items 1-6.
4. **Function literals** (L): `Optional` carrier in `core.ts`;
   `function-literal.ts` helpers (`functionLiteralParameterNames`,
   `functionLiteralParameterType`, the inferred signature) unwrap it;
   `function-utils.ts`: `canonicalFunctionLiteralArguments` accepts it,
   checks the default (R4) and diagnoses `number?`, `apply` saturation and
   fill, the residual of a partial application, the signature-string sugar
   (R6); the default-to-`ParameterDefault` conversion (R4); the census of
   parameter-list readers (`callback-arity.ts`, the pipe-stage check,
   `binders.ts`, `binding-sites.ts`, `effects-inference.ts`,
   `call-result-type.ts`) and of `functionArity` callers, with
   `requiredArity` for the mode selectors (R6); the LaTeX serializer of a
   `Function` literal prints `k = 2`.
5. **Epsil** (M): `parseParameterList`, formatter, `serialize-epsil`,
   static diagnostics, `error-explanations.ts`, `docs/EPSIL-LANGUAGE-MODEL.md`
   (R7); a test that a protocol requirement with a default is refused with
   the existing diagnostic.
6. **Compilation** (M): default parameters and the argument-count form in
   the JavaScript emitter, the sentinel form in the Python emitter of a
   function literal; call-site completion for GLSL, WGSL and
   interval-JavaScript and for compiled callbacks, with the
   shadowed-parameter decline; the `Apply` arity checks of the JavaScript
   and interval targets; `compile-definitions.ts` for a one-clause user
   function, both checks (R8).
7. **Docs and records** (S): CHANGELOG (the issue is by enumeratio),
   ROADMAP entry for R9 (v2) and for the library defaults with the elision
   rule (R10), reply on the issue.

## 7. Tests

1. Parse and print: `(x: number, factor: number = 2) -> number` round-trips;
   `(number, number = 2) -> number` (unnamed) round-trips; string, boolean,
   negative number, `NaN`, `+oo`, symbol, `[]` and `{}` defaults round-trip;
   `flag: boolean = True` prints as `flag: boolean = true`. Two signatures
   that differ only by a default have different `typeToIdentityKey` values
   and still match each other. A signature passed as a `Type` object with a
   `default` field is kept through `instantiate`, `reduce` and `widen`
   (R2 census).
2. Parse errors: `number? = 2`; a default in a tuple type; on a variadic; a
   defaulted parameter after a default-less optional; a required parameter
   after a defaulted one; `k: number = x` where `x` is a parameter of the
   same signature; `= Nothing`; `= Indeterminate`; `= ~oo`.
3. Declaration checks: `factor: number = "a"` throws; `over: set = Integers`
   is accepted; `mode: symbol = Automatic` is accepted with `Automatic`
   undeclared; `k: number = Integers` throws;
   `mode: symbol<Auto> | symbol<Manual> = Atuo` throws;
   `xs: list<number> = []` and `opts: dictionary = {}` are accepted;
   `xs: number = []` throws; `<T>(x: T, k: T = 2) -> T` throws;
   `(f: (number, number = 2) -> number) -> number` throws at `ce.declare`,
   and so does `ce.declare("g", "list<(number, number = 2) -> number>")`;
   `ce.declare("g", "(number, number = 2) -> number")` is accepted, and
   `ce.declare("g", "(number, number = \"a\") -> number")` throws.
3b. Collection defaults: `F(1)` with `xs: list<number> = []` canonicalizes
   to `F(1, [])`, and the handler receives an empty list; the same for `{}`
   and an empty dictionary; the signature prints `xs: list<number> = []`.
4. The fill: `Scaled(3)` has two operands and `.json` `["Scaled", 3, 2]`;
   `Scaled(3)` is the same expression as `Scaled(3, 2)`; the handler receives
   two operands; `Scaled(3, factor: 5)` keeps 5; `Scaled(3, factor: Nothing)`
   gives 2. `Scaled()` is `missing` for `x` and the default is not inserted;
   with `(a: number, b: number, k: number = 2)`, `F(1)` is `missing` for `b`.
4b. Routes: an operator with a custom `canonical` handler and a defaulted
   parameter sees two operands in its handler, eager and lazy, for `F(3)`,
   `F(Sequence(3))` and `F(Sequence(3, 5))` (the last with 5, not the
   default), and sees the written operands with no default for
   `F(Sequence())` (`missing`); an operator with a custom handler and no
   default sees exactly the operands it sees today, a written `Nothing`
   included; a lazy operator holds the inserted default, which is the boxed
   operand of R4; `ce.box(["Scaled", 3], { canonical: false })` has one
   operand. `Scaled(...p)` with `p` a symbol keeps one operand at
   canonicalization, eager and lazy, and evaluates to `missing` for `x` when
   `p = ()`, to the two-operand call (6 with the handler `x * k`) when
   `p = (3)`, to 15 when `p = (3, 5)`, and to `unexpected-argument` when
   `p = (3, 5, 7)`.
4c. Declared-type variable: `g` declared `(number, number = 2) -> number`
   accepts the assignment of `(x, k) => x * k` (R2 exception) and `g(3)` is
   6; holding `(x, k = 3) => x * k`, `g(3)` is 6 too (the declared default
   wins); the assignment of `(x) => x` is refused (maximum arity 1 against
   2, unchanged); `Map([1], g)` with the first value is `missing` for `k`
   (documented limit). `h` declared `function` holding `(x, k = 2) => x * k`
   gives 6 for `h(3)` at evaluation.
4d. Callees that change: `f := (x, k = 2) => x * k; e := f(3)` has the
   canonical form `f(3, 2)`; after `f := (x) => x`, `e.evaluate()` is 3;
   after `f := (x, k = 5) => x * k`, it is 15; after `f := (x, k) => x * k`,
   it is `missing` for `k`. The same three steps with `let f` and no
   declared type (inferred type). With `ce.declare("f", "(number, number = 2) -> number")`
   first, the canonical `f(3, 2)` is not re-matched and `e.evaluate()` after
   `f := (x, k = 5) => x * k` is 6.
5. Holes: `(x, density: number = 1, factor: number = 2)` with
   `f(3, factor: 5)` gives `f(3, 1, 5)`; `(x, a: number = 1, b: number?, c: number?)`
   with `f(3, c: 7)` is still `argument-optional-skipped` for `b`.
6. Symbol default: `over: set = Integers`; `Over(x)` canonicalizes to
   `Over(x, Integers)`. A default with a value (`k: number = Pi`) evaluates
   as a written `Pi` would. Scoping (R4): with `k: number = d` and `d := 2`,
   `F(3)` inside a block that declares `d := 5` reads 5, as the written
   `F(3, d)` does; `F(3)` inside a function whose parameter is named `d`
   reads the outer `d`, as the written call does. Re-assigning `d` after the
   call was made changes the value of a later evaluation.
7. Literals: `((x, k = 2) => x * k)(3)` is 6, not a partial application;
   `((x, k = 2) => x * k)(3, 5)` is 15; `((x, k = 2) => x * k)()` curries,
   the residual applied to `3` is 6 and applied to `(3, 5)` is 15; the
   literal's type prints the default and the untyped `k` stays `unknown`
   while an annotated `k: number` prints `k: number = 2`;
   `Typed(k, "number?")` is a diagnostic; the signature-string sugar with
   `= 2` and with `= []` works; `(xs = []) => Length(xs)` gives 0;
   `(k: number = "a") => k` and `(x, k = "a") => x * k` are
   `incompatible-type`, inline and at `ce.assign`; a default that names a
   parameter, `Nothing`, `ComplexInfinity`, a rational, a non-literal
   expression, `Optional` on a rest parameter, a rest parameter after an
   `Optional`, `Optional` with no default, a plain parameter after an
   `Optional`, and `Optional` outside a parameter list each give their error
   of R6; `(x, k = 2) => …` (a plain parameter before the `Optional`) is
   accepted. The printed type of a literal with each admitted default kind
   parses back to the same identity key (R4 conversion). A literal whose
   default names a local reads the binding the scoping rule of R4 selects at
   the call.
7b. Literal readers: `Map([1, 2], (x, k = 2) => x * k)` is `[2, 4]`,
   interpreted and compiled on the JavaScript target; `[1, 2] |> Map((x, k = 2) => x * k)`
   likewise; `Sort([3, 1, 2], (x, k = 2) => x * k)` sorts by the unary key
   (`[1, 2, 3]`) and `Iterate((x, k = 2) => x + k, 0, 3)` adds 2 three times,
   interpreted and compiled; the static callback-arity check accepts the
   literal; a literal with a symbol default has that symbol among its free
   variables and the effects of reading it.
7c. LaTeX: `((x, k = 2) => x * k).latex` is `(x, k = 2) \mapsto x k` (the
   exact text is recorded by the test), and parsing it back is recorded.
8. Epsil: the three spellings of R7 evaluate; `k = x + 1` as a default is
   `default-value-invalid`, and so is `hold f(bind i = 1, n) = …`;
   `function f(0, k = 2) = …` with a second clause is the R9 error;
   `(xs = []) => …` and `(d = {}) => …` evaluate;
   the formatter prints `k: number = 2` and `xs = []`; `epsil doc` shows it;
   a protocol requirement with `k: number = 2` is refused with the existing
   optional-parameter diagnostic; a `hold` definition with a default works.
9. Compilation: `ce.compile(literal)` on the JavaScript target gives a
   function that returns 6 for one argument and 15 for two;
   `(k: number | missing = 2) => k` compiled gives 2 for an omitted
   argument, an explicit `Missing` and an expression that evaluates to
   `Missing` (the amendment of R5, 2026-11-01; before it, a supplied
   `Missing` stayed); the Python target emits `k=2` for a value default and the
   sentinel form for a symbol default, and a Python test changes the
   symbol's binding between the definition and an omitted-argument call and
   reads the new value; a collection default gives a fresh empty list per
   call in both targets; the interval, GLSL and WGSL targets agree with the
   interpreter on a saturated call and on a call completed by the compiler,
   including a literal with a value default on the interval target (the
   default is an interval constant) and a callback inside `Map` on GLSL;
   a call site inside a function whose parameter has the default's name
   declines on those targets; a one-clause user function with a default
   compiles on the JavaScript target and a two-clause one with a default is
   the R9 declaration error.
10. Overloads: a default in an intersection signature throws the R9 error.
11. Existing suites: `named-arguments*.test.ts`,
    `typed-function-literals.test.ts`, `function-literal-rest-parameter.test.ts`,
    the Epsil parser and formatter suites, unchanged.

## 8. Decisions

Decided by the user 2026-10-31:

- **Q1. The spelling.** `factor: number = 2` in the signature. The
  alternative `defaults: { factor: 2 }` beside the signature is rejected
  (§5, item 1).
- **Q2. Symbol defaults.** Allowed; the symbol need not be declared. The
  type of such a parameter is `symbol`, or a union of literal symbol types
  (`symbol<Auto> | symbol<Manual>`), or any type the symbol's value has
  (`set` for `Integers`). R4 states the check.
- **Q3. The canonical form carries the default.** `Scaled(3)` and
  `Scaled(3, 2)` are one expression. The evaluation-only fill is rejected
  (§5, item 2).
- **Q4. The MathJSON head** for a literal's parameter is `Optional`.
- **Q5. Scope of v1**: single-signature operators, function literals, Epsil
  syntax, JavaScript and Python default parameters. Out: overload arms and
  multi-clause functions (R9), library defaults (R10), `Optional` without a
  default, LaTeX of an `Optional` parameter (§9).

- **Q6. Collection defaults.** Only the empty list `[]` and the empty
  dictionary `{}`. The lexer has the four bracket tokens, the two values have
  no content to spell, and their types `list<never>` and `dictionary<never>`
  match every list and dictionary type (§2, item 14). A list or dictionary
  with contents is not spelled: the type DSL would need an expression
  grammar. A non-empty value uses the constant-symbol escape hatch of R3.
- **Q7. No shorthand for a union of literal symbol types.** The spelling is
  `mode: symbol<Auto> | symbol<Manual>`, which exists. Reading an identifier
  that resolves to no type as a literal symbol type was rejected: `numbr`
  would become the type of the symbol `numbr` instead of a parse error, and
  the meaning of a signature would depend on which types are declared when
  it is parsed.

## 9. Out of scope, recorded for later

- `Optional(k)` with no default: an optional literal parameter bound to
  `Nothing` when absent. Needs the absent-value rules of
  `docs/ERROR-MODEL.md`; not asked for.
- LaTeX parsing of a literal with an `Optional` parameter: read
  `(x, k = 2) \mapsto …` back to `Optional`. The serialization is in v1
  (R6); the parse joins ROADMAP CE-441 (rest and destructuring parameters
  have the same gap).
- Defaults in overload arms and multi-clause functions (R9).
- Defaults on library operators, with a serializer elision rule (R10).
  Candidates: `LambertW` branch 0, and every handler that today documents
  "default" for an absent optional operand.

## 10. Draft reply on the issue

> Thanks for the detail. Here is what I plan:
>
> - Spelling: `(x: number, factor: number = 2) -> number`. A parameter with
>   a default is optional; `?` and `=` are not combined.
> - Values: a number, a string, a boolean, a symbol, the empty list `[]` or
>   the empty dictionary `{}`. A symbol default is the symbol itself
>   (`over: set = Integers`, `mode: symbol<Auto> | symbol<Manual> = Auto`),
>   bound where the operator is declared; it need not be declared. For any
>   other value, declare a constant and name it:
>   `weights: list<number> = DefaultWeights`.
> - The default is filled at canonicalization: `Scaled(3)` and
>   `Scaled(3, 2)` are the same expression, and the handler, the compiler and
>   `def.signature` all see it.
> - Function literals: `["Optional", ["Typed", "f", "'number'"], 2]` as the
>   parameter, or `(x, f: number = 2) => …` in Epsil. A call with the
>   required arguments is a full call, not a partial application. The
>   `Typed(f, "number?")` spelling will become a diagnostic instead of being
>   ignored.
> - Not in the first version: a default in an overloaded signature or a
>   multi-clause function, and defaults on the built-in library.
>
> I will post here when it ships.

## 11. Corrections found during the implementation

Measured in step 3 (CE-717.3), 2026-10-31. Where this section and the text
above disagree, this section is correct.

1. **A symbol default inside a function with a parameter of that name**
   (R4, §7 item 6, R8). Inside `(d) => ScaledByD(3)`, with
   `k: number = d`, the filled call reads the parameter `d` of that
   function, and so does the written call `ScaledByD(3, d)`: both give 30
   when the function is applied to 10. The rule that holds is R3's: the
   default behaves exactly as if the author had written the symbol in the
   call. The text "with the parameter activations of other functions
   skipped" applies to a function that is CALLED (a parameter of the
   callee's body), not to a function whose body contains the call. So the
   compile targets need no "shadowed by a parameter at the call site"
   decline (R8): the completed operand is compiled as a written operand at
   that call site, which reads the same binding.
2. **The limit of a declared-type variable as a callback** (R5, §7 item 4c).
   `Map` takes the function first. `Map(g, [1])` with the NAME `g` is
   filled, because a symbol callee is called through its name. The limit is
   a function VALUE passed as an argument: `((f) => f(3))(g)` is a partial
   application, and `((f) => Map(f, [1]))(g)` is `callback-arity`.
3. **A callee replaced by one that requires the parameter** (§7 item 4d,
   last step). After `f := (x, k) => x * k`, `e.evaluate()` is a partial
   application, not `missing` for `k`: a call of a user function with fewer
   arguments than it requires curries (§2 item 4), as a written `f(3)` does.
4. **The slot type of a bare parameter with a default** (R6, measured in
   step 4). `((x, k = 2) => x * k).type` is
   `(x: unknown, k: unknown = 2) -> number`, not `k: number = 2`: the slot of
   a bare parameter stays `unknown` in the inferred signature whether or not
   it has a default, as `docs/TYPE-SYSTEM.md` ("The inferred signature of a
   function literal") states for every bare parameter (the `x` of the same
   example is `unknown` too). The check of the default (R4) reads the type
   that the body infers for the parameter's binding, so
   `(x, k = "a") => x * k` is still `incompatible-type`.
5. **The argument order of `Map`** (§7 item 7b). `Map` takes the function
   first: the test is `Map((x, k = 2) => x * k, [1, 2])`. `Iterate(f, 0, 3)`
   does not stop after three steps; the test reads
   `Take(Iterate(f, 0), 3)`.
6. **Where a lazy view calls its callback** (R4, ROADMAP CE-728, user
   decision 2026-10-31, option (a)). A lazy collection view calls its
   callback when the view is read, which can be after the function that
   created the view has returned. With `f := (x, k = d) => x * k` and
   `g := (d, xs) => Map(f, xs)`, the call `f(x)` that the view makes is
   filled with `d`, and the elements of `g(10, [1, 2])` were `d` and `2d`:
   `d` was read in the context of the reader. The call of a callback by a
   lazy view now takes place in the context where the view was created. The
   operators of such views set the flag `callsCallbackOnRead` of their
   collection handlers: `Map`, `Filter`, `Scan`, `TakeWhile`, `DropWhile`,
   `FlatMap`, `Tabulate` (`Table` evaluates to it), `Iterate` and `Fill`.
   An operator of the host can set the flag too. The evaluation that
   creates such a view during a function call records the context stack up
   to the frame of the call and, when the view is made in a scope of the
   body between the current scope and the frame (a `Block`, an `If` branch,
   a loop body), the bindings of these nested scopes, their values and
   their write versions at that time, and the call frames on the stack that
   the scope chain of the creation reaches. No scope is copied and no
   definition is made, so a view that the call reads at once costs little.
   The frame of the call is not copied. At the end of each call, before its
   pop, the frame is marked as retained when a view whose record names it is
   reachable from the returned value (through operands, dictionary values,
   symbol values, the bodies and the scopes of the closures of the value
   and the scopes of the records met). The pop of a retained frame does not dispose or
   tombstone its definitions (`discardEvalContext`, `engine-scope.ts`), so a
   read after the call has returned resolves the names of the frame to live
   definitions with their declared types. The cost: these definitions are
   never marked `disposed`, their write version does not advance at the
   pop, and the debug check of dead bindings does not cover them. A call
   that reads its views at once returns no view and is not retained. Each
   call has a new frame that no other call writes in, so its values are
   those of the end of the call, unless a closure that the call returned
   shares the frame and writes in it. The nested scopes belong to the body,
   which every call shares: a view reads them with their values at its
   creation. A read uses the live stack while the context of the creation is
   on the stack, each nested scope has its parent of the creation (a
   recursive call of the same function changes the parent of its body
   scope), and each nested binding is the same and was not written since;
   otherwise it uses copies of the nested scopes, made once per view and
   chained onto the frame, in which each value binding is a clone of its
   definition that holds the recorded value. An enumeration makes this
   choice once, when it starts, and keeps the stack of its start for each
   step, also for a step after the call has returned. A view that is never evaluated has no
   record: a view of the body that is an operand of a lazy operator of the
   body (`Dedup(Map(f, xs))`, `Take(Map(f, xs), 2)`), or a view
   canonicalized during the call (`ReleaseHold(Hold(Dedup(Map(f, xs))))`).
   The end of the call gives such a view of its result a record on a new
   node, since a held node of the body is shared by every call of the
   function. The set of held views is computed once per function body, and
   a body with none, in a call where each view that it canonicalized got a
   record (the result of an evaluation gets one at once), costs two lookups
   at each call end. A view that the call did not make (the value of a
   variable made at the top level) is not adopted, and keeps reading in the
   context of its reader.
   Each read of the view (its
   elements, an element by index, its count and its other collection facets)
   runs in the recorded context, and so does an evaluation of the view
   again (the numeric pass of an outer call). So a symbol default reads the
   binding of the place where `Map(f, xs)` was written: `[10, 20]`, the
   value of the
   compiled function and of `ListFrom(Map(f, xs))` inside `g`. A view
   created outside every function call records nothing and is read in the
   context of its reader, as before. The end of a call, which rebuilds its
   result (closure re-rooting, the substitution of the parameter values),
   and the rewrite of an argument that reads locals of the caller keep the
   record, also in the body of a function literal; a rebuild by the host (`subs()`, `ce.function()` with
   new operands, a serialization parsed again) makes a new view with no
   record. Mechanism:
   `src/compute-engine/boxed-expression/lazy-view-context.ts`; tests:
   `test/compute-engine/lazy-view-scope.test.ts`.
