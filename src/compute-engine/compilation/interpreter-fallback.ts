// The interpreter fallback of `compile()`: the `success: false` result of a
// declined compilation, whose `run` evaluates the expression with the
// interpreter. This module uses no compiler: the result of a decline of the
// profile `ir` is built here (`interpreterFallback()`) with the runner
// `interpreterRun()`.

import type { BoxedDefinition, Expression, Scope } from '../global-types.js';
import { isOperatorDef, isValueDef } from '../boxed-expression/utils.js';
import { rewriteWithBinders } from '../boxed-expression/binders.js';
import { withBindingValuesFn } from '../engine-declarations.js';
import { isSealedPreparedNamespace } from '../boxed-expression/prepared-import-binding.js';
import {
  collectionElementType,
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { isSubtype, provablyDisjoint } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isString,
  isCharacter,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameters } from '../boxed-expression/function-literal.js';
import {
  STATIC_TYPE_ERROR_CODE,
  UNION_DISPATCH_CODE,
  UNSETTLED_SHAPE_CODE,
  UNTYPED_INPUT_CODE,
} from './diagnostics.js';
import {
  COLOR_SPACE_HEADS,
  INTERPRETED_COLOR_SPACES,
} from './compiler-tables.js';
import type {
  CompileDiagnostic,
  CompilationResult,
  CompiledColor,
  CompiledRunner,
  ComplexResult,
} from './types.js';

/**
 * The scopes that `compile()` was called in, innermost last, for the
 * compilations in progress (`inCallerScope()`).
 */
const callerScopes: { engine: object; scope: Scope }[] = [];

/**
 * Run `f`, a compilation of `expr` that `compile()` was called for, with the
 * current scope recorded as the scope of the call. The interpreter fallback
 * of the compilation is built for that scope (`callerScopeOf()`), also when
 * the compilation runs in the scope of `expr`.
 */
export function inCallerScope<T>(expr: Expression, f: () => T): T {
  const ce = expr.engine;
  callerScopes.push({ engine: ce, scope: ce.context.lexicalScope });
  try {
    return f();
  } finally {
    callerScopes.pop();
  }
}

/**
 * The scope that the innermost compilation in progress on `ce` was called
 * in (`inCallerScope()`), or the current scope.
 */
export function callerScopeOf(ce: { context: { lexicalScope: Scope } }): Scope {
  for (let i = callerScopes.length - 1; i >= 0; i--)
    if (callerScopes[i].engine === ce) return callerScopes[i].scope;
  return ce.context.lexicalScope;
}

/**
 * An occurrence of each name that `expr` reads from outside itself (not a
 * variable of a binder of `expr`), and of each name that the value of a
 * symbol it reads, or the body of a function it calls, reads in turn
 * (`f15 := f14 + f14`, `g := t ↦ t + a` with `a := 3t + 1`), in the order
 * in which the interpreter first reads them: the names of `expr` first, in
 * the order of the walk, then those of each value and body, in the order
 * they were reached. An occurrence in a held operand (not canonical) is
 * bound to nothing yet: a canonical occurrence of the same name is preferred
 * to it.
 *
 * The body of a call whose operator is in `skipBodies` is not followed (a
 * head that the caller of `compile()` implements with its `functions`
 * option).
 */
export function namesRead(
  expr: Expression,
  skipBodies?: (name: string) => boolean
): Map<string, Expression & { symbol: string }> {
  const freeOccurrences = new Map<string, Expression & { symbol: string }>();
  // A held occurrence (not canonical) is bound to no definition: the
  // interpreter reads the definition of its name in the scope of the call
  // (`definitionRead()`), so its value or body is followed from there
  // (`Expand(g)` with `g := Q + 1` reads `Q`). This over-approximates: a
  // held name is followed as a read also where the operator that holds it
  // does not evaluate it (`Hold(g)`, the index of a held `Sum`), which only
  // reports an extra input, and every held occurrence, also one in a
  // followed body, is resolved from the scope of the call.
  const scope = callerScopeOf(expr.engine);
  const heldDefinition = (e: Expression, name: string) =>
    e.isCanonical ? undefined : definitionRead(e, name, scope);
  const followed = new Set<object>();
  const pending: Expression[] = [];
  const follow = (def: object | undefined, source: () => unknown): void => {
    if (def === undefined || followed.has(def)) return;
    followed.add(def);
    const e = source();
    if (e !== undefined && e !== null) pending.push(e as Expression);
  };
  const collect = (e: Expression): void => {
    rewriteWithBinders(
      e,
      (sym, shadowed) => {
        if (shadowed?.has(sym.symbol)) return sym;
        const seen = freeOccurrences.get(sym.symbol);
        if (seen === undefined || (!seen.isCanonical && sym.isCanonical))
          freeOccurrences.set(sym.symbol, sym);
        const held = heldDefinition(sym, sym.symbol);
        const def =
          sym.valueDefinition ?? (isValueDef(held) ? held.value : undefined);
        if (def !== undefined && !def.isConstant) follow(def, () => def.value);
        return sym;
      },
      undefined,
      false,
      new Map(),
      (app, _ops, shadowed) => {
        if (shadowed?.has(app.operator)) return undefined;
        if (skipBodies?.(app.operator) === true) return undefined;
        const held = heldDefinition(app, app.operator);
        const op =
          app.operatorDefinition ??
          (isOperatorDef(held) ? held.operator : undefined);
        follow(op, () => op?._lambdaLiteral);
        const value =
          app.valueDefinition ?? (isValueDef(held) ? held.value : undefined);
        if (value !== undefined && !value.isConstant)
          follow(value, () => value.value);
        return undefined;
      }
    );
  };
  collect(expr);
  while (pending.length > 0) collect(pending.shift()!);
  return freeOccurrences;
}

/**
 * The definition that the occurrence `sym` of the name `k` reads when the
 * interpreter evaluates it, or `undefined` when there is none: the
 * definition a canonical occurrence is bound to (for a free name, the one
 * of its home scope, when it has one), and for a held occurrence (not
 * canonical) the definition of `k` in `scope` or one of its parents.
 */
function definitionRead(
  sym: Expression,
  k: string,
  scope: Scope
): BoxedDefinition | undefined {
  if (sym.isCanonical)
    return (
      sym as Expression & { _resolvedDefinition(): BoxedDefinition | undefined }
    )._resolvedDefinition();
  for (let s: Scope | null | undefined = scope; s; s = s.parent) {
    const found = s.bindings.get(k);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The names that the run of `expr` takes from its inputs, in the order in
 * which the interpreter first reads them (`namesRead()`): each name whose
 * definition, as the interpreter reads it, has no value (a name declared
 * with a type only, a name with no definition), and each name of
 * `varsKeys` (the `vars` option of `compile()`) that it reads. A name with
 * a value, a constant and the name of an operator are not inputs. The body
 * of a call whose operator is in `skipBodies` is not read.
 */
export function inputNamesRead(
  expr: Expression,
  varsKeys?: ReadonlySet<string>,
  skipBodies?: (name: string) => boolean
): string[] {
  return inputsRead(expr, varsKeys, skipBodies).map((x) => x.name);
}

/**
 * The inputs of `inputNamesRead()`, each with the type of its definition
 * (`unknown` for a name with no definition; none for a name of `varsKeys`).
 */
function inputsRead(
  expr: Expression,
  varsKeys?: ReadonlySet<string>,
  skipBodies?: (name: string) => boolean
): { name: string; type?: Type }[] {
  const scope = callerScopeOf(expr.engine);
  const result: { name: string; type?: Type }[] = [];
  for (const [name, sym] of namesRead(expr, skipBodies)) {
    if (varsKeys?.has(name)) {
      result.push({ name });
      continue;
    }
    const def = definitionRead(sym, name, scope);
    if (def === undefined) {
      result.push({ name, type: sym.type.type });
      continue;
    }
    if (!isValueDef(def)) continue;
    if (!def.value.isConstant && def.value.value === undefined)
      result.push({ name, type: sym.type.type });
  }
  return result;
}

/**
 * The run of `expr` with the interpreter, under the value contract of a
 * compiled runner, and its calling convention.
 *
 * The runner honors the compiled runner's value contract in both
 * directions (design D7, `docs/COMPILATION-MODEL.md`
 * §8): each `vars` value is declared from its RUNTIME SHAPE (`complex` for
 * a `{re, im}` object, `number` for a number), and a scalar result comes
 * back as a plain `number` when its imaginary part is exactly zero, as a
 * `{re, im}` `ComplexResult` otherwise, and as a boolean when it is one —
 * the same convention a successful JavaScript compile uses, so a caller
 * cannot tell a decline from a compile by the SHAPE of the values. A
 * scalar collapses to its real part, a finite indexed collection
 * materializes to a nested JS array, and a `Function` literal uses the
 * positional `lambda` calling convention.
 *
 * `absence` is the spelling of an absent value on the target:
 * `objectNull` when the target has an object null (the target declares no
 * absence capability, or one with an object axis), and `writtenNumeric`
 * when it spells a written absence symbol with its numeric marker. On
 * JavaScript, both are `{ objectNull: true, writtenNumeric: false }`.
 *
 * `observe`, when given, receives the evaluated value of each run before it
 * is converted: the interval fallback reads from it whether a number is
 * exact (`interval-fallback.ts`).
 *
 * With `callable`, a function value (a value whose type is a function
 * signature: `x ↦ x + 4`, `Derivative(Sin)`) is a JavaScript function that
 * applies the value to its arguments with the interpreter and converts the
 * result as the run does, as a compiled function value is. Without it, a
 * function value is `NaN`.
 */
function interpreterRun(
  expr: Expression,
  absence: { objectNull: boolean; writtenNumeric: boolean },
  observe?: (value: Expression) => void,
  callable = false
): { calling: 'lambda' | 'expression'; run: CompiledRunner } {
  const ce = expr.engine;
  // The color value of an evaluated color node, or `undefined` when `e` is
  // not one. The interpreter spells a color as one of five typed heads
  // (`library/colors.ts`), and the head names the space its three channels
  // are in — the same five spaces a compiled color value carries.
  //
  // The alpha follows the compiled runtime's rule (`normalizeAlpha`): an
  // absent, non-finite or effectively-1 alpha is `undefined`, so the two
  // routes answer the same object for an opaque color.
  const interpretedColorValue = (e: Expression): CompiledColor | undefined => {
    if (!isFunction(e)) return undefined;
    const space = INTERPRETED_COLOR_SPACES[e.operator];
    if (space === undefined) return undefined;
    const ops = e.ops;
    if (ops.length < 3) return undefined;
    // Each channel is numericized before it is read, for the reason
    // `interpretedRunValue` numericizes a scalar leaf: `evaluate()` stays
    // symbolic for an exact argument, and `.re` of a symbolic expression is
    // `NaN`.
    const channel = (i: number): number => ops[i].N().re;
    let alpha = ops.length >= 4 ? channel(3) : undefined;
    if (
      alpha === undefined ||
      !Number.isFinite(alpha) ||
      Math.abs(alpha - 1) < 1e-9
    )
      alpha = undefined;
    return {
      space,
      c0: channel(0),
      c1: channel(1),
      c2: channel(2),
      alpha,
    };
  };
  // The value an ABSENT interpreter result (`Missing`) takes in
  // the compiled-runner value contract. Compiled code spells an absent value
  // by the kind of the position that holds it (`docs/ERROR-MODEL.md` §3): the
  // numeric marker `NaN` in a numeric position, and the target's object null
  // (`undefined` on JavaScript) in an object-domain position — a point, a
  // tuple, a list, a colour, a boolean, a string — and wherever the position
  // admits `missing` itself, since a written absence symbol lowers to the
  // object null so that an absent cell stays distinct from a `NaN` cell. The
  // fallback spells it the same way as a producer of compiled code (a
  // written `Missing`, a read past the end), so a host cannot tell from the
  // value which route ran. Without this rule every absent result was `NaN`,
  // where a compiled producer of an absent point answers `undefined`.
  //
  // The kind is read from the static type `t` of the position. When that
  // type says nothing (`unknown`, `any`, or no type), `hint` gives the kind
  // of the present sibling cells of the same collection; with no hint the
  // value is the spelling of a WRITTEN absence symbol on the target
  // (`undefined` on JavaScript). A target that declares an absence
  // capability without an object axis (the shader targets, the interval
  // target) spells every absent value with its numeric marker, so the
  // fallback gives `NaN` there.
  //
  // A target that spells a written absence symbol with its NUMERIC marker
  // uses the
  // object null only for an absent value in an object-domain position: a position whose type admits `missing`
  // gives `NaN` unless every other arm of the type is disjoint from
  // `number`.
  const hasObjectNull = absence.objectNull;
  const writtenNumeric = absence.writtenNumeric;
  // Whether `t` admits `missing` as one of its own arms (not in a cell).
  const admitsMissing = (t: Readonly<Type>): boolean => {
    const r = resolveTypeForCompilation(t);
    if (r === 'missing') return true;
    return (
      typeof r !== 'string' && r.kind === 'union' && r.types.some(admitsMissing)
    );
  };
  const absentRunValue = (
    t: Readonly<Type> | undefined,
    hint: 'number' | 'object' | undefined
  ): number | undefined => {
    if (!hasObjectNull) return NaN;
    let typed = false;
    if (t !== undefined) {
      const r = resolveTypeForCompilation(t);
      if (r !== 'unknown' && r !== 'any') {
        typed = true;
        if (admitsMissing(r)) {
          if (!writtenNumeric) return undefined;
          const present =
            typeof r !== 'string' && r.kind === 'union'
              ? r.types.filter((x) => !admitsMissing(x))
              : [];
          return present.length > 0 &&
            present.every((x) => provablyDisjoint(x, 'number'))
            ? undefined
            : NaN;
        }
        if (isSubtype(r, 'number')) return NaN;
        if (provablyDisjoint(r, 'number')) return undefined;
      }
    }
    if (hint !== undefined) return hint === 'object' ? undefined : NaN;
    return typed || writtenNumeric ? NaN : undefined;
  };
  // The static type of cell `i` of a collection whose type is `t`: the
  // positional type of a tuple, the element type of a list, `undefined`
  // when the type does not say. The collection's own `missing` arm is
  // removed first: the collection is present, since it has cells. When `t`
  // is not a collection type at all, the collection is a cell of an outer
  // list whose type names only the scalar leaves (`[[1, Missing], [t, 2]]`
  // is typed `list<integer | missing | number>`), and that leaf type applies
  // to the cells at this depth too.
  const isCollectionType = (x: Readonly<Type>): boolean =>
    collectionElementType(x) !== undefined;
  const cellType = (
    t: Readonly<Type> | undefined,
    i: number
  ): Type | undefined => {
    if (t === undefined) return undefined;
    let r = resolveTypeForCompilation(t);
    if (typeof r !== 'string' && r.kind === 'union') {
      const arms = r.types
        .filter((x) => !admitsMissing(x))
        .map((x) => resolveTypeForCompilation(x));
      if (!arms.some(isCollectionType)) return r;
      if (arms.length !== 1) return undefined;
      r = arms[0];
    }
    if (typeof r !== 'string' && r.kind === 'tuple') return r.elements[i]?.type;
    return collectionElementType(r) ?? r;
  };
  const isAbsentValue = (e: Expression): boolean => isSymbol(e, 'Missing');
  // Whether `e` is a function value: a `Function` literal, or a value whose
  // type is a function signature (the name of an operator).
  const isFunctionValue = (e: Expression): boolean => {
    if (isFunction(e, 'Function')) return true;
    const r = resolveTypeForCompilation(e.type.type);
    return (
      r === 'function' || (typeof r !== 'string' && r.kind === 'signature')
    );
  };
  // The JavaScript function of the function value `f` (`callable`): each
  // call applies `f` to its arguments, boxed under the declared types of
  // the parameters of a `Function` literal, and converts the value as the
  // run does (a function value is a JavaScript function again).
  const callableOf =
    (f: Expression) =>
    (...args: unknown[]): unknown => {
      const paramTypes = isFunction(f, 'Function')
        ? functionLiteralParameters(f).map((p) => p.type)
        : [];
      const applied = ce.function('Apply', [
        f,
        ...args.map((a, i) => boxArg(a, paramTypes[i])),
      ]);
      return interpretedRunValue(applied.evaluate(), applied.type.type);
    };
  // Materialize an interpreted result matching the compiled-runner value
  // contract: a scalar yields a `number` (imaginary part exactly zero), a
  // `{re, im}` object (otherwise) or a boolean; a finite indexed collection
  // becomes a nested JS array of element values; an absent value is spelled
  // by `absentRunValue` from the static type `t` of its position. A scalar
  // leaf is numericized first — `evaluate()` correctly stays symbolic for an
  // exact argument (`ln(2)` evaluates to `Ln(2)`), and `.re` of a symbolic
  // expression is NaN, so without `.N()` every decline whose expression has
  // no non-symbolic evaluation would run to NaN instead of its value.
  const interpretedRunValue = (
    e: Expression,
    t?: Readonly<Type>
  ):
    | number
    | boolean
    | ComplexResult
    | CompiledColor
    | string
    | unknown[]
    | ((...args: unknown[]) => unknown)
    | undefined => {
    if (isAbsentValue(e)) return absentRunValue(t, undefined);
    if (callable && isFunctionValue(e)) return callableOf(e);
    // A string is a JS string, as compiled code answers it. It is tested
    // before the collection rule below: a string is an indexed collection
    // of its grapheme clusters, which that rule read as an array of `NaN`.
    // A character (`isString` is false for it) is also a JS string, as
    // compiled code answers it: without this test the scalar rule below
    // read it as `NaN`. The same test serves a character cell of a list,
    // since the collection rule calls this function for each cell.
    if (isString(e) || isCharacter(e)) return e.string;
    // A COLOR node keeps its space. The interpreter answers a color as a
    // typed head — `Rgb(r, g, b)`, `Hsv(h, s, v)`, … — and the compiled
    // runtime's color value carries the same three channels plus the space
    // the head names, so a declining color expression comes back as the
    // color it denotes. Without this the numericization below reduced the
    // whole head to `NaN` (`.re` of a non-numeric expression), and a
    // declined color expression ran to a scalar `NaN` under the default
    // `fallback: true`.
    const color = interpretedColorValue(e);
    if (color !== undefined) return color;
    if (e.isCollection) {
      // The present cells are rendered first: when the type of an absent
      // cell says nothing, their kind is the hint for its spelling (a
      // list of points holds `undefined`, a list of numbers `NaN`).
      const cells = [...e.each()];
      const out = cells.map((c, i) =>
        isAbsentValue(c) ? undefined : interpretedRunValue(c, cellType(t, i))
      );
      const kinds = new Set(
        out
          .filter((v, i) => !isAbsentValue(cells[i]))
          .map((v) =>
            typeof v === 'number' || isComplexArg(v) ? 'number' : 'object'
          )
      );
      const hint =
        kinds.size === 1
          ? (kinds.values().next().value as 'number' | 'object')
          : undefined;
      return out.map((v, i) =>
        isAbsentValue(cells[i]) ? absentRunValue(cellType(t, i), hint) : v
      );
    }
    if (isSymbol(e, 'True')) return true;
    if (isSymbol(e, 'False')) return false;
    const n = e.N();
    if (isSymbol(n, 'True')) return true;
    if (isSymbol(n, 'False')) return false;
    if (isAbsentValue(n)) return absentRunValue(t, undefined);
    const im = n.im;
    // `im` is NaN for a symbolic residue (no numeric value): a number, not
    // an object, is the honest shape for "no value" — `re` is NaN too.
    if (im !== 0 && !Number.isNaN(im)) return { re: n.re, im };
    return n.re;
  };
  // The interpreter's value for a runtime argument: a `{re, im}` object is a
  // complex number, anything else boxes as it always did.
  const isComplexArg = (v: unknown): v is ComplexResult =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ComplexResult).re === 'number' &&
    typeof (v as ComplexResult).im === 'number';
  // A COLOR argument: the value shape a compiled runner answers for a color
  // (`CompiledColor`). The same test the compiled runtime makes — an object
  // whose `space` is one of the five spellings — so a color one runner
  // produced can be handed straight back in as a `vars` value.
  const isColorArg = (v: unknown): v is CompiledColor =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as CompiledColor).space === 'string' &&
    (v as CompiledColor).space in COLOR_SPACE_HEADS &&
    typeof (v as CompiledColor).c0 === 'number';
  // A JS ARRAY is a collection VALUE — the runner-argument shape of a list
  // or point parameter (`{ P: [[0, 0], [3, 4]] }`) — not MathJSON:
  // `ce.expr([1, 2])` reads it as an application and boxes an
  // `unexpected-mathjson` error, so a list-valued argument ran the
  // interpreter against an error value (Tycho item 234). Box it element by
  // element, guided by the parameter's DECLARED type when one is in scope:
  // an array in a `tuple<…>` position is a point, in a `list<…>` position
  // a list whose elements follow the list's element type, and with no type
  // evidence an array is a `List` — the same reading `PointList` and the
  // compiled runtime give a bare array.
  const boxArg = (v: unknown, type?: Type): Expression => {
    if (isComplexArg(v)) return ce.number(ce.complex(v.re, v.im));
    // A JS string is a string VALUE. `ce.expr` reads a string as MathJSON,
    // where `"abc"` is the SYMBOL `abc`, so the interpreter read a text
    // argument as an unknown symbol.
    if (typeof v === 'string') return ce.string(v);
    // A color VALUE boxes to the typed head that names its space, with its
    // channels as operands and its alpha as a fourth. Without this the
    // object reached `ce.expr` as MathJSON and boxed to an error, so a
    // color a compiled runner produced could not be fed back into a
    // declining color expression.
    if (isColorArg(v)) {
      const ops = [ce.number(v.c0), ce.number(v.c1), ce.number(v.c2)];
      if (v.alpha !== undefined) ops.push(ce.number(v.alpha));
      return ce.function(COLOR_SPACE_HEADS[v.space], ops);
    }
    if (Array.isArray(v)) {
      const t = type === undefined ? undefined : resolveTypeAlias(type);
      if (typeof t !== 'string' && t?.kind === 'tuple')
        return ce.function(
          'Tuple',
          v.map((x, i) => boxArg(x, t.elements[i]?.type))
        );
      const elt =
        typeof t !== 'string' &&
        (t?.kind === 'list' || t?.kind === 'indexed_collection')
          ? t.elements
          : undefined;
      return ce.function(
        'List',
        v.map((x) => boxArg(x, elt))
      );
    }
    return ce.expr(v as never);
  };
  // The inputs of `run` below are given to the definitions that the
  // occurrences of `namesRead()` are bound to.
  const freeOccurrences = namesRead(expr);
  // The scope that a name of a held operand resolves from: a held operand
  // is bound when it is evaluated, and `run` evaluates `expr` in the scope
  // that is current when the fallback is built, the scope `compile()` is
  // called in. An expression boxed in a pushed scope and compiled after its
  // pop reads its canonical names from their own definitions, and its held
  // names from this scope, as an evaluation after the pop does. A
  // compilation that runs in the scope of `expr` builds its fallback there,
  // and the scope of the call is the one it recorded (`callerScopeOf()`).
  const buildScope = callerScopeOf(ce);
  // The binding record that the occurrence of `k` reads, or `undefined`.
  // With `declare`, a name with no definition is declared in the scope that
  // it resolves from: the home scope of a free name, `buildScope` for a
  // name of a held operand. A sealed prepared namespace (the scope of a
  // Document revision) refuses every declaration: such a name is declared
  // nowhere, and `sealed` receives it when `expr` itself reads it
  // (`fallbackRun` substitutes its value); otherwise it is ignored, as a
  // name that the expression does not read.
  const bindingOf = (
    k: string,
    declare: boolean,
    sealed?: Set<string>
  ): BoxedDefinition | undefined => {
    const sym = freeOccurrences.get(k) as
      | (Expression & {
          symbol: string;
          _resolvedDefinition(): BoxedDefinition | undefined;
          _homeScope?: Scope;
        })
      | undefined;
    if (sym === undefined) return undefined;
    const resolve = (): BoxedDefinition | undefined =>
      definitionRead(sym, k, buildScope);
    const found = resolve();
    const home = sym.isCanonical ? sym._homeScope : buildScope;
    if (found !== undefined || !declare || home === undefined) return found;
    let scope: Scope = home;
    while (scope.noAutoDeclare && scope.parent) scope = scope.parent;
    if (isSealedPreparedNamespace(scope)) {
      if (ownNamesRead().has(k)) sealed?.add(k);
      return undefined;
    }
    ce._declareSymbolValue(k, { type: 'unknown', inferred: true }, scope);
    return resolve();
  };
  // The names that `expr` itself reads from outside itself, also in a held
  // operand (`Expand` holds its operand and evaluates it): the names of
  // `namesRead()` without those it reaches through a value or a function
  // body. Made on first use.
  let ownNames: Set<string> | undefined;
  const ownNamesRead = (): Set<string> => {
    if (ownNames !== undefined) return ownNames;
    const names = new Set<string>();
    rewriteWithBinders(expr, (sym, shadowed) => {
      if (!shadowed?.has(sym.symbol)) names.add(sym.symbol);
      return sym;
    });
    ownNames = names;
    return names;
  };
  // The declared type of a free symbol of `expr`, when it has one — the
  // value given by `run` below must admit the argument value under that
  // declaration's shape.
  const declaredTypeOf = (k: string): Type | undefined => {
    const def = bindingOf(k, false);
    if (!isValueDef(def)) return undefined;
    const t = def.value.type.type;
    return t === 'unknown' || t === 'any' ? undefined : t;
  };

  // A function literal (lambda) uses the positional `lambda` calling
  // convention — `run(a, b, ...)`. The fallback must mirror that by applying
  // the function to its positional arguments via the interpreter; otherwise
  // positional arguments are silently dropped.
  if (isFunction(expr, 'Function')) {
    // A positional argument is boxed under its parameter's declared type
    // (`(p: tuple<number, number>) -> …` receives `[0, 0]` as a POINT), as
    // the vars-object convention below does through `declaredTypeOf`.
    const paramTypes = functionLiteralParameters(expr).map((p) => p.type);
    // The absent result is spelled by the static type of the application,
    // which is the function's result type for these arguments.
    const lambdaRun = ((...args: unknown[]) => {
      const applied = ce.function('Apply', [
        expr,
        ...args.map((a, i) => boxArg(a, paramTypes[i])),
      ]);
      const value = applied.evaluate();
      observe?.(value);
      return interpretedRunValue(value, applied.type.type);
    }) as unknown as CompiledRunner;
    return { calling: 'lambda', run: lambdaRun };
  }

  // Otherwise the expression uses the `expression` calling convention:
  // `run({ x, y, ... })` with a variables object.
  const fallbackRun = ((vars: Record<string, unknown>) => {
    // The arguments are the values of the inputs while the expression is
    // evaluated, given to the definitions that the expression reads
    // (`withBindingValuesFn()`): a `{re, im}` object is a complex number,
    // a color, a list, a string and a boolean are boxed as such, and any
    // other argument is a number. An input that the expression does not
    // read is ignored.
    const values: Record<string, Expression> = {};
    const bindings: { name: string; record: BoxedDefinition }[] = [];
    // The inputs with no definition whose declaration a sealed namespace
    // refuses: their values are substituted in `expr` (`subs()` leaves a
    // name that a binder of `expr` binds), and no name is declared. The
    // value of a definition that `expr` reads, and the body of a function
    // it calls, are not substituted: with a published row `g = Q + 1` or
    // `f(x) = x + Q` and `Q` undeclared, `run({ Q: 4 })` of `Expand(g)` or
    // `Expand(f(2))` gives `null` where the compiled code gives `5` or `6`
    // (known limitations, `docs/COMPILATION-MODEL.md`). Declaring `Q` as an
    // input gives the value: `namesRead()` follows a held name (CE-1666).
    const sealed = new Set<string>();
    const substituted: Record<string, Expression> = Object.create(null);
    if (vars && typeof vars === 'object')
      for (const [k, v] of Object.entries(vars)) {
        const record = bindingOf(k, true, sealed);
        if (record === undefined && !sealed.has(k)) continue;
        if (record !== undefined) bindings.push({ name: k, record });
        const target = record === undefined ? substituted : values;
        target[k] = isComplexArg(v)
          ? ce.number(ce.complex(v.re, v.im))
          : isColorArg(v)
            ? boxArg(v)
            : Array.isArray(v)
              ? boxArg(v, declaredTypeOf(k))
              : typeof v === 'string'
                ? ce.string(v)
                : typeof v === 'boolean'
                  ? v
                    ? ce.True
                    : ce.False
                  : ce.number(v as number);
      }
    return ce._inScope(buildScope, () =>
      withBindingValuesFn(ce, bindings, values, () => {
        // Each such run rebuilds `expr` with `subs()`: the cost of not
        // declaring in a sealed namespace.
        const value = (
          sealed.size === 0 ? expr : expr.subs(substituted)
        ).evaluate();
        observe?.(value);
        return interpretedRunValue(value, expr.type.type);
      })
    );
  }) as unknown as CompiledRunner;
  return { calling: 'expression', run: fallbackRun };
}

/**
 * The `success: false` result of a compilation of `expr` to JavaScript
 * that declined with `error` and `diagnostic`, with `run` set to the
 * interpreter (`interpreterRun()`): the result that `compile()` gives for a
 * decline of the profile `ir`. It uses no compiler.
 *
 * - `freeSymbols`: the names that the run takes from its inputs, in the
 *   order in which the interpreter first reads them (`inputNamesRead()`),
 *   with the names of `vars` that it reads.
 * - `unsupported`: the operator that the decline names (its diagnostic's
 *   `operator`); the names of the inputs of an `'untyped-input'` or a
 *   `'union-dispatch'` decline, and the node of an `'unsettled-shape'`
 *   decline (its diagnostic's `value`); the token `ErrorCode` for an
 *   invalid expression or a `'static-type-error'` decline, which a host
 *   reads to tell an error in the expression from a missing lowering; and,
 *   for every decline, the inputs whose type where they are read is
 *   `unknown` or `any`.
 * - `mode`: `'strict'`, since no code was emitted.
 *
 * It has no `freeSymbolTypes`: the result of a compilation of the profile
 * on JavaScript has none. `observe`, when given, receives the evaluated
 * value of each run before it is converted (`interpreterRun()`). With
 * `callable` (the default), a function value is a JavaScript function
 * (`interpreterRun()`); the interval fallback, which gives no interval for
 * a function value, passes `false`.
 */
export function interpreterFallback(
  expr: Expression,
  error: string,
  diagnostic: CompileDiagnostic,
  varsKeys?: ReadonlySet<string>,
  observe?: (value: Expression) => void,
  callable = true
): CompilationResult<'javascript'> {
  const { calling, run } = interpreterRun(
    expr,
    {
      objectNull: true,
      writtenNumeric: false,
    },
    observe,
    callable
  );
  const unsupported: string[] = [];
  if (diagnostic.operator !== undefined) unsupported.push(diagnostic.operator);
  if (diagnostic.code === STATIC_TYPE_ERROR_CODE || !expr.isValid)
    unsupported.push('ErrorCode');
  if (diagnostic.value !== undefined) {
    if (diagnostic.code === UNSETTLED_SHAPE_CODE)
      unsupported.push(diagnostic.value);
    if (
      diagnostic.code === UNTYPED_INPUT_CODE ||
      diagnostic.code === UNION_DISPATCH_CODE
    )
      unsupported.push(...diagnostic.value.split(','));
  }
  // The inputs with no type (`unknown` or `any`), whatever the cause of the
  // decline: a host learns which names to declare (rule R1). A local of a
  // block (`Declare`) is not one, though `namesRead()` reads it.
  const locals = new Set<string>();
  const declared = (x: Expression): void => {
    if (!isFunction(x)) return;
    if (x.operator === 'Declare' && isSymbol(x.ops[0]))
      locals.add(x.ops[0].symbol);
    x.ops.forEach(declared);
  };
  declared(expr);
  const inputs = inputsRead(expr, varsKeys);
  for (const { name, type } of inputs) {
    const t = type === undefined ? undefined : resolveTypeAlias(type);
    if ((t === 'unknown' || t === 'any') && !locals.has(name))
      unsupported.push(name);
  }
  return {
    target: 'javascript',
    success: false,
    code: '',
    calling,
    run: run as CompilationResult<'javascript'>['run'],
    error,
    diagnostic,
    mode: 'strict',
    freeSymbols: inputs.map((x) => x.name),
    unsupported: [...new Set(unsupported)],
  };
}
