// Protocol dispatch on a receiver's declared type, and the matchesType
// lowering.

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { lookupApplicable } from '../function-utils.js';
import { isNonRealNumber } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type, TypeReference } from '../../common/type/types.js';
import { declarationOf } from '../../common/type/reference.js';
import {
  isSymbol,
  isString,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { isProtocolDispatcher } from '../engine-protocols.js';
import {
  planProtocolDispatch,
  type ReceiverGuard,
} from './protocol-dispatch.js';
import { sumPolicy, sumVariantInfo } from '../sum-representation.js';
import type { CompileTarget, TargetSource } from './types.js';
import { core } from './compiler-core-hooks.js';
import { tempVar } from './compiler-naming.js';
import { jsClauseParamGuard } from './compile-callbacks.js';
import { sumBucketTest } from './compile-match.js';
import { strictLanes } from './compiler-mode.js';
import {
  complexWrapCode,
  provablyScalarOrFramedScalar,
} from './compile-user-calls.js';
import { laneMismatch } from './compile-lanes.js';
import { branchComplexCoercion } from './compile-shapes.js';
import { userFunctionName, withNestedCseHarvest } from './compile-cse.js';
import {
  compileDefinitionBody,
  prepareUserFunctionBody,
  removeDefinitionsAddedSince,
} from './compile-definitions.js';
import { withEnforcedParams } from './compile-declarations.js';
import { compileValueOperand } from './compile-statements.js';

/**
 * For a bare `Field` read whose receiver is a RAW body local — `q.n`
 * where an enclosing statement list declared `q: Person` — the receiver's
 * own static type is `unknown` (a canonical function body's locals are
 * unbound), so the `Field` compile handler, which resolves record /
 * named-tuple fields from the receiver's static type, declines. Re-type
 * the receiver from the declared parameter/local map
 * (`CompileTarget.declaredVarTypes` — the same fallback the protocol
 * GET/SET tier applies) by ascribing it: `Typed` is transparent at
 * evaluation and compiles to its operand, so only the static type the
 * handler sees changes. Returns the substituted operand list, or `null`
 * when the fallback does not apply (any head other than `Field`, a
 * non-symbol or already-typed receiver, no declared entry).
 */
export function fieldArgsWithDeclaredReceiver(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  declaredVarTypes: Readonly<Record<string, Type>> | undefined
): ReadonlyArray<Expression> | null {
  if (h !== 'Field' || declaredVarTypes === undefined) return null;
  const receiver = receiverWithDeclaredType(engine, args[0], declaredVarTypes);
  if (receiver === null) return null;
  return [receiver, ...args.slice(1)];
}

/** The `Field` receiver with its declared-type ascription applied — a raw
 * symbol becomes `Typed(sym, "<declared>")`, and a nested `Field` CHAIN
 * (`q.address.zip`) is rebuilt from its ascribed root so each intermediate
 * access resolves statically too. `null` when the fallback does not
 * apply. */
export function receiverWithDeclaredType(
  engine: ComputeEngine,
  root: Expression | undefined,
  declaredVarTypes: Readonly<Record<string, Type>>
): Expression | null {
  if (root === undefined) return null;
  if (isSymbol(root)) {
    const t = root.type.type;
    if (t !== 'unknown' && t !== 'any') return null;
    const declared = declaredVarTypes[root.symbol];
    if (declared === undefined) return null;
    return engine._fn('Typed', [root, engine.string(typeToString(declared))]);
  }
  if (isFunction(root, 'Field') && isString(root.ops[1])) {
    const inner = receiverWithDeclaredType(
      engine,
      root.ops[0],
      declaredVarTypes
    );
    if (inner === null) return null;
    return engine._fn('Field', [inner, root.ops[1]]);
  }
  return null;
}

/**
 * Extract a protocol call from a dispatcher, `ProtocolMember`, property get,
 * or unresolved `Field` read. Property stores are excluded because mutable
 * objects have no compiled representation. An unresolved `Field` is eligible
 * only for static dispatch: at runtime an ordinary record key takes
 * precedence over a protocol property.
 */
export function protocolCallParts(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
):
  | {
      implKey: string;
      member: string;
      protocol?: string;
      args: ReadonlyArray<Expression>;
      staticOnly?: boolean;
    }
  | undefined {
  if (h === 'ProtocolMember' || h === 'ProtocolProperty') {
    // Operands 0-1 ride as string literals, or as bare symbols after a
    // round trip (the `protocolMemberOperandsOf` reading).
    const nameOf = (op: Expression | undefined): string | undefined => {
      if (op === undefined) return undefined;
      return isString(op) ? op.string : isSymbol(op) ? op.symbol : undefined;
    };
    const protocol = nameOf(args[0]);
    const member = nameOf(args[1]);
    if (protocol === undefined || member === undefined) return undefined;
    if (h === 'ProtocolMember')
      return { implKey: member, member, protocol, args: args.slice(2) };
    if (args.length === 3)
      return {
        implKey: `__get__${member}`,
        member,
        protocol,
        args: args.slice(2),
      };
    // FOUR operands is a property STORE, not a call: it writes a mutable
    // object, and objects have no compiled representation yet. Declining here
    // sends it to the fail-closed throw in the value path rather than
    // lowering it to `setterImpl(receiver, value)` — which would both bypass
    // that refusal and evaluate to the SETTER's result where the interpreter
    // evaluates to the value assigned.
    return undefined;
  }

  if (h === 'Field' && args.length === 2 && isString(args[1])) {
    const name = args[1].string;
    return {
      implKey: `__get__${name}`,
      member: name,
      args: [args[0]],
      staticOnly: true,
    };
  }

  if (isProtocolDispatcher(lookupApplicable(h, engine.context.lexicalScope)))
    return { implKey: h, member: h, args };

  return undefined;
}

/**
 * The literal type text of a `MatchesType(subject, T)` call — a string
 * operand, or a settled `TypeFrom("…")` — or `undefined` when the type
 * operand is anything else (a symbol bound to a type value, a computed
 * string): only literal text can be resolved at compile time.
 */
export function matchesTypeText(expr: Expression): string | undefined {
  if (!isFunction(expr, 'MatchesType') || expr.nops !== 2) return undefined;
  const t = expr.ops[1];
  if (isString(t)) return t.string;
  if (isFunction(t, 'TypeFrom') && isString(t.op1)) return t.op1.string;
  return undefined;
}

/**
 * Whether `compileMatchesTypeJS` will compile `expr` on `target`: the
 * JavaScript target, a literal type operand, and a type with a faithful
 * test on the JS value model (`jsTypeTest`). Decided on a placeholder,
 * before the subject is compiled, so the shared gate in `compile` can fail
 * closed without paying for (or being confused by) the subject.
 *
 * JavaScript only: the interval target's values are intervals, so a
 * `typeof` test would be unfaithful there, and the shader targets have no
 * runtime type at all.
 */
export function matchesTypeLowerable(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (target.language !== 'javascript') return false;
  const text = matchesTypeText(expr);
  if (text === undefined) return false;
  let type: Type;
  try {
    type = expr.engine.type(text).type;
  } catch {
    return false;
  }
  return jsTypeTest(expr.engine, type, '_$x') !== undefined;
}

/**
 * Compile `MatchesType(subject, T)` — the engine form of an Epsil `x is T`
 * test and of a typed `match` binding (`v: T => …`) — on the JavaScript
 * target, or `undefined` when `matchesTypeLowerable` declines it (the
 * caller then falls through to the ordinary path, which fails closed).
 *
 * The type is resolved through the engine's registry at COMPILE time and
 * the resulting test is baked into the code, which is the same snapshot
 * model a compiled sum constructor pattern and a multi-clause parameter
 * guard follow. The test itself is the one those two already use
 * (`jsTypeTest`), so the three cannot disagree about which JS values
 * inhabit a type. Types with no faithful test on the JS value model
 * decline: `error` and `!error` (a compiled `match` with no matching case
 * yields `NaN`, not an error value, so nothing in compiled code can be
 * told apart as an error), collections and records (`Array.isArray`
 * cannot see element types), opaque nominals, erased sums (a plain `5` is
 * indistinguishable from an erased `jnum(5)`), generic sums (a `_tag`
 * cannot see type arguments), and the non-finite numeric types.
 *
 * `prec` is the parent's binding power: the emitted test is a loose
 * comparison chain (`typeof x === "string"`), so under a tighter parent
 * (`Not` emits `!` at 14) it is parenthesized — `!typeof x === "string"`
 * would parse as `(!typeof x) === "string"`.
 */
export function compileMatchesTypeJS(
  expr: Expression,
  target: CompileTarget<Expression>,
  prec: number
): TargetSource | undefined {
  if (!isFunction(expr) || !matchesTypeLowerable(expr, target))
    return undefined;
  const engine = expr.engine;
  const type = engine.type(matchesTypeText(expr)!).type;
  const code = core.compile(expr.ops[0], target);
  // A plain reference (a variable, a capture accessor such as `s[0]`) can
  // be repeated inside the test; anything else is bound once, since the
  // test may read its operand several times.
  let test: string;
  if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(code))
    test = jsTypeTest(engine, type, code) ?? 'true';
  else {
    const tv = tempVar(target);
    test = `((${tv}) => ${jsTypeTest(engine, type, tv) ?? 'true'})(${code})`;
  }
  return prec > 0 ? `(${test})` : test;
}

/**
 * The JavaScript test that the value in `x` inhabits `t`: a source
 * string, `null` when every value does (`any`, `unknown`), or `undefined`
 * when the type has no faithful test on the JS value model.
 *
 * A sum-declared type is testable only under the TAGGED policy, where a
 * value is a `{_tag}` object that only its constructor produces: a variant
 * tests its tag, a sum the disjunction of its variants' tags. An ERASED
 * variant is its payload's plain JS value, which any other value of that
 * shape also is, so a membership test on an arbitrary subject cannot tell
 * `jnum(5)` from `5` and declines (the constructor-pattern lowering may
 * trust the erased shape because its subject is already known to be the
 * sum; a free-standing `x is T` has no such guarantee). A GENERIC sum or
 * variant declines too — an applied reference (`tree<integer>`) and a
 * variant declared with type parameters — because a tag carries no type
 * arguments, while the interpreter compares them. An alias of a testable
 * type follows the alias; a union tests each member. Everything else is
 * the multi-clause parameter guard (`jsClauseParamGuard`): the machine
 * numbers, strings and booleans, literal value types, and numeric ranges.
 *
 * `visited` holds the alias declaration records along the current path —
 * the repo's standard guard for a `.def`-following walker — so a
 * self-referential alias stops instead of looping.
 */
export function jsTypeTest(
  engine: ComputeEngine,
  t: Type,
  x: string,
  visited?: ReadonlySet<TypeReference>
): string | null | undefined {
  if (typeof t === 'object') {
    if (t.kind === 'reference') {
      if (t.args !== undefined && t.args.length > 0) return undefined;
      const decl = declarationOf(t);
      if (decl._sumVariants !== undefined) {
        if (sumPolicy(engine, decl.name) !== 'tagged') return undefined;
        const parts: string[] = [];
        for (const v of decl._sumVariants) {
          if (v.typeParams.length > 0) return undefined;
          parts.push(`${x}?._tag === ${JSON.stringify(v.name)}`);
        }
        return parts.length === 0 ? undefined : `(${parts.join(' || ')})`;
      }
      const info = sumVariantInfo(engine, decl.name);
      if (info !== undefined) {
        if (info.policy !== 'tagged') return undefined;
        const sum = engine._typeResolver.resolve(info.sum);
        const generic =
          sum !== undefined &&
          (declarationOf(sum)._sumVariants ?? []).some(
            (v) => v.name === decl.name && v.typeParams.length > 0
          );
        if (generic) return undefined;
        return `${x}?._tag === ${JSON.stringify(decl.name)}`;
      }
      // A transparent alias of something testable (`type alias L = light`).
      if (decl.alias && decl.def !== undefined && !visited?.has(decl)) {
        const seen = new Set(visited);
        seen.add(decl);
        return jsTypeTest(engine, decl.def, x, seen);
      }
      return undefined;
    }
    if (t.kind === 'union') {
      const parts: string[] = [];
      for (const member of t.types) {
        const g = jsTypeTest(engine, member, x, visited);
        if (g === undefined) return undefined;
        if (g === null) return null;
        parts.push(g);
      }
      return `(${parts.join(' || ')})`;
    }
  }
  return jsClauseParamGuard(t, x);
}

/** The JS test that the receiver `x` takes a candidate's arm — the
 * rendering of the planner's guard descriptors. `null` = no test needed;
 * `undefined` = not renderable (whole-call decline). */
export function renderReceiverGuard(
  g: ReceiverGuard,
  x: string
): string | null | undefined {
  switch (g.kind) {
    case 'js-type':
      return jsClauseParamGuard(g.type, x);
    case 'tag':
      // Optional chaining is load-bearing: a primitive receiver must fall
      // through to the next arm, not TypeError (the compiled-`match`
      // convention).
      return `${x}?._tag === ${JSON.stringify(g.tag)}`;
    case 'bucket': {
      const test = sumBucketTest(g.bucket, x, g.complexNumber);
      if (g.tupleArity === undefined) return test;
      return `(${test} && ${x}.length === ${g.tupleArity})`;
    }
  }
}

/**
 * Compile a JavaScript protocol call. Static dispatch calls the selected
 * implementation directly; dynamic dispatch emits a most-specific-first
 * receiver guard chain and throws `protocol-implementation-missing` if no
 * guard matches. The emitted code snapshots the current protocol registry.
 *
 * Non-receiver arguments rely on canonicalization-time type checks. Receiver
 * guards operate on the JavaScript runtime representation, as do compiled
 * `Match` patterns and multi-clause function guards.
 */
export function tryCompileProtocolDispatch(
  engine: ComputeEngine,
  call: {
    implKey: string;
    member: string;
    protocol?: string;
    args: ReadonlyArray<Expression>;
    staticOnly?: boolean;
  },
  target: CompileTarget<Expression>
): TargetSource | undefined {
  const registry = target.userFunctions;
  if (!registry) return undefined;
  // JavaScript only: interval runtime values need different guards, and
  // the shader targets cannot express the dispatcher. Fail closed there.
  if (target.language !== 'javascript' || registry.lowering) return undefined;

  const receiver = call.args[0];
  if (receiver === undefined) return undefined;

  // The receiver's static type. An `Assign` LHS root is a RAW symbol (it
  // never binds — the interpreter re-resolves at evaluation), so a
  // top-primitive answer falls back to the enclosing definition's declared
  // parameter type (`CompileTarget.declaredVarTypes`).
  let receiverType = receiver.type.type;
  if (
    (receiverType === 'unknown' || receiverType === 'any') &&
    isSymbol(receiver)
  ) {
    const declared = target.declaredVarTypes?.[receiver.symbol];
    if (declared !== undefined) receiverType = declared;
  }

  const plan = planProtocolDispatch(engine, {
    implKey: call.implKey,
    argc: call.args.length,
    receiverType,
    protocol: call.protocol,
  });
  if (plan === undefined) return undefined;
  if (call.staticOnly === true && plan.tier !== 'static') return undefined;

  // ── Plan the whole emission BEFORE mutating the registry ──────────────
  // (the multi-clause whole-function-decline discipline).

  // Canonicalize every implementation literal; any invalid one declines.
  const literals: (Expression & FunctionInterface)[] = [];
  for (const c of plan.candidates) {
    const canonical = c.literal.canonical;
    if (!isFunction(canonical, 'Function') || !canonical.isValid)
      return undefined;
    if (canonical.ops.length - 1 !== plan.argc) return undefined;
    literals.push(canonical);
  }

  // Render the receiver guards (dynamic tier).
  let guardSrcs: (string | null)[] | undefined;
  if (plan.tier === 'dynamic') {
    guardSrcs = [];
    // Guarded on the NORMALIZED receiver `_$n0` (see the multi-clause
    // dispatcher): a `{re, im: 0}` receiver is the real number `re` and
    // dispatches as such; the helper still receives the raw `_$p0`.
    for (const c of plan.candidates) {
      const g = renderReceiverGuard(c.guard!, '_$n0');
      if (g === undefined) return undefined;
      guardSrcs.push(g);
    }
  }

  // Call-boundary complex coercion, per position — UNANIMOUS across the
  // candidates (the multi-clause rule: where candidates disagree, wrapping
  // would change dispatch, so the position stays uncoerced).
  const sigParams = literals.map((lit) => {
    const t = lit.type.type;
    return typeof t === 'object' && t.kind === 'signature'
      ? t.args?.map((a) => a.type)
      : undefined;
  });
  // Gated on the PARAMETER's declared type alone, never on the argument's
  // — the same rule as the single-literal call site (`tryCompileUserFunction`):
  // every candidate body consumes such a parameter through complex slots,
  // so every call owes it a `{re, im}`, whatever the call site passes. The
  // wrap form itself is chosen per argument below (`protocolComplexWrap`).
  const coerceToComplex = call.args.map((_a, i) =>
    sigParams.every((params) => {
      const pt = params?.[i];
      return pt !== undefined && isNonRealNumber(pt);
    })
  );
  // STRICT discipline (design §3, "protocol member parameters" row): a
  // complex-shaped scalar argument at a position where some candidate's
  // parameter is WIDE (admits the value, body shaped real) is a
  // LaneMismatch DECLINE. Real-only candidate parameters reject a complex
  // value by validation before this point; complex-typed ones coerce.
  if (strictLanes())
    call.args.forEach((a, i) => {
      if (!provablyScalarOrFramedScalar(a) || !core.isComplexValued(a)) return;
      const wide = sigParams.some((params) => {
        const pt = params?.[i];
        if (pt === undefined) return true;
        if (isNonRealNumber(pt)) return false;
        return !isSubtype(pt, 'real');
      });
      if (wide)
        laneMismatch(
          'protocol member parameter',
          `parameter ${i + 1} of the protocol member \`${call.member}\``,
          a
        );
    });

  // The generated code bakes the member's current conformance set: record
  // the dependency (see `CompileTarget.symbolDeps`).
  target.symbolDeps?.add(call.member);

  // ── Emit: one helper per candidate, in plan order ─────────────────────
  // The candidate bodies are the ARMS of one dispatcher: if any is
  // complex-valued, every provably-real one is coerced to `{re, im}`.
  const coerceResult = branchComplexCoercion(
    literals.map((l) => l.ops[0]),
    target
  );
  // The coercion is a property of the PLAN (the arm set), not of the edge:
  // the same edge can be emitted by a coercion-free singleton plan and
  // reused by a mixed real/complex chain (or vice versa), and the `defs`
  // cache would then hand the wrong result convention to one of them. Keep
  // the convention in the cache key so each variant is emitted once.
  const convention = coerceResult ? '$cx' : '';
  const helperNames: string[] = [];
  for (let i = 0; i < plan.candidates.length; i++) {
    const c = plan.candidates[i];
    // `$` cannot appear in a MathJSON symbol, so these names can never
    // collide with an emitted user function.
    const name = userFunctionName(
      registry,
      `${call.implKey}$${c.protocol}$e${c.edgeIndex}${convention}`
    );
    helperNames.push(name);
    if (registry.defs.has(name) || registry.compiling.has(name)) continue;
    // The definitions stored while this one compiles may call it by name
    // (a re-entrant reference, see below); when its emission fails they
    // are removed, so that no definition keeps a call of a name that is
    // never emitted.
    const definedBefore = new Set(registry.defs.keys());
    registry.compiling.add(name);
    try {
      const { params, bodyExpr, bodyTarget } = prepareUserFunctionBody(
        literals[i],
        target,
        registry
      );
      const compiled = withEnforcedParams(literals[i], () =>
        withNestedCseHarvest(bodyExpr, bodyTarget, params, () =>
          compileDefinitionBody(bodyExpr, bodyTarget)
        )
      );
      const body = coerceResult ? coerceResult(bodyExpr, compiled) : compiled;
      registry.defs.set(
        name,
        `const ${name} = (${params.join(', ')}) => ${body};`
      );
    } catch (e) {
      removeDefinitionsAddedSince(registry, definedBefore);
      throw e;
    } finally {
      registry.compiling.delete(name);
    }
  }

  const compiledArgs = call.args.map((a, i) => {
    const code = compileValueOperand(a, target);
    return coerceToComplex[i] ? complexWrapCode(code, a, target) : code;
  });

  if (plan.tier === 'static')
    return `${helperNames[0]}(${compiledArgs.join(', ')})`;

  // ── The dispatcher: guard chain, most-specific-first ──────────────────
  // Emitted once per (implKey, protocol restriction); recursion through an
  // impl body re-enters here idempotently (all defs run in the preamble
  // before any call, so forward references are safe — the multi-clause
  // argument).
  const dName = userFunctionName(
    registry,
    `${call.implKey}$${call.protocol ?? ''}$d`
  );
  if (!registry.defs.has(dName)) {
    const params = Array.from({ length: plan.argc }, (_, i) => `_$p${i}`);
    const branches = plan.candidates.map((_, i) => {
      const g = guardSrcs![i];
      const invoke = `return ${helperNames[i]}(${params.join(', ')});`;
      return g === null ? invoke : `if (${g}) ${invoke}`;
    });
    registry.defs.set(
      dName,
      `const ${dName} = (${params.join(', ')}) => { const _$n0 = _SYS.creal(_$p0); ${branches.join(' ')} ` +
        `throw new Error(${JSON.stringify(
          `protocol-implementation-missing: ${call.member}`
        )}); };`
    );
  }
  return `${dName}(${compiledArgs.join(', ')})`;
}
