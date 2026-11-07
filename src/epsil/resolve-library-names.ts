import type { MathJsonExpression } from '../math-json/types.js';
import { operands, operator, symbol } from '../math-json/utils.js';

import type { Expression, ComputeEngine } from '../compute-engine.js';
import type { BoxedDefinition } from '../compute-engine/global-types.js';
import type { Type } from '../common/type/types.js';
import { typeToString } from '../common/type/serialize.js';

import { implicitVariableCandidates } from '../compute-engine/boxed-expression/implicit-variable-rule.js';
import {
  ANONYMOUS_SLOT_NAMES,
  freeAnonymousSlots,
} from '../compute-engine/boxed-expression/function-literal.js';

import { canonicalLibraryName } from './library-names.js';
import {
  documentBindings,
  protocolFunctionMembers,
  type BinderSite,
  type ProtocolFunctionMember,
} from './occurrences.js';

//
// The resolution pass: give the Epsil spellings of the standard library
// their meaning.
//
// The parser produces the tree exactly as written: `sin(x)` is
// `["sin", "x"]` and `pi` is the symbol `pi`. This pass, run before the
// program is boxed, rewrites every FREE occurrence of a spelling to the
// canonical library name (`["Sin", "x"]`, `Pi`), in call position and in
// value position alike (`map(sin, xs)` becomes `Map(Sin, xs)`). An
// occurrence is free when nothing in the program binds the name at that
// point — no enclosing `let`, parameter, loop pattern, match pattern,
// `function`, or variable of a library call (`binderSitesOf` says which
// operands bind one) — and nothing in the ENGINE binds it either
// (an earlier notebook cell's `let mean = 5`, a host `ce.declare`). The
// scope model is the one the language server uses for rename
// (`documentBindings`), so what the server treats as one binding, this pass
// treats as one binding.
//
// Two forms are never rewritten: a verbatim spelling (`` `sin` ``), which
// names the raw symbol, and a name that spells nothing in the library.
//
// A FUNCTION member of a protocol that the program declares shadows the
// spelling too, from the end of the `protocol` statement onward, as a user
// `function` of that name does: in `protocol F { function floor(self: Self)
// -> integer }` followed by `floor(m)`, the call keeps the name `floor` and
// reaches the protocol's dispatcher, which the `protocol` statement installs
// when it runs. The library function stays reachable by its capitalized
// name (`Floor(x)`). A later batch sees the installed dispatcher as an
// engine binding, so the two cases agree (user decision 2026-10-31, ROADMAP
// CE-716).
//
// The rewrite is done in place, node by node, and keeps every node's
// `sourceOffsets`, so the diagnostics of the later phases still point at
// the source.
//

/** The name at `path` inside a raw call node, following operand indices
 * (`[1]` is the second operand, `[2, 0]` the first operand of the third). */
function symbolAtPath(
  node: MathJsonExpression,
  path: readonly number[]
): string | undefined {
  let current: MathJsonExpression | null = node;
  for (const index of path) {
    if (current === null) return undefined;
    current = operands(current)[index] ?? null;
  }
  return current === null ? undefined : (symbol(current) ?? undefined);
}

/** Whether `name` occurs in `node` as a VALUE symbol (not as a call head). */
function occursAsValue(node: MathJsonExpression | null, name: string): boolean {
  if (node === null) return false;
  if (symbol(node) === name) return true;
  const head = operator(node);
  if (head === '') return false;
  return operands(node).some((op) => occursAsValue(op, name));
}

/** Whether `name` occurs in `node` as a call head (`name(…)`). */
function occursAsHead(node: MathJsonExpression | null, name: string): boolean {
  if (node === null) return false;
  const head = operator(node);
  if (head === '') return false;
  if (head === name) return true;
  return operands(node).some((op) => occursAsHead(op, name));
}

/**
 * The operand positions, by call arity, where an operator whose signature
 * types the operand loosely reads a plain symbol (or a list, set or tuple
 * of symbols) as a VARIABLE, so the signature cannot say so:
 *
 * - `Limit(expr, x, point)` is typed `(function, point)` — the
 *   three-operand form is canonicalized into it — so the variable is
 *   operand 1 of a three-operand call only;
 * - `Solve(eq, x)` and `Solve(eqs, [x, y])` are `(any, any*)`, and so are
 *   the operands of `NSolve`;
 * - `JacobianMatrix(fs, [x, y])` and `CharacteristicPolynomial(A, x)` take
 *   the variable(s) as `any` (an undeclared symbol is inferred numeric,
 *   which a `symbol` signature would reject — the handlers say so);
 * - `FindRoot(eqs, params)` and `FindFit(data, model, params, vars)` hold
 *   their parameter and variable specs as `any`;
 * - `LinearRegression(data, x)` and `PolynomialFit(data, deg, x)` take an
 *   optional TRAILING variable, typed `(any+)`.
 *
 * Every other variable-taking operator declares the operand `symbol` in
 * its signature (`D: (expression, symbol*)`, `Series: (expression,
 * variable: symbol?, …)`, `Residue`, `Factor`, `PolynomialGCD`, …), which
 * `variableOperandPositions` reads.
 */
// A `Map`, not an object literal: a lookup by an operator name such as
// `constructor` must not reach an inherited `Object.prototype` property.
// The optional trailing variable of `LinearRegression` and `PolynomialFit`
// counts only when that operand is a bare symbol, as in the engine
// (`library/statistics.ts`): a trailing data list is data, and reading its
// symbols as variables left `linearRegression([pi, 2pi], [pi, 2pi])` with an
// unresolved `pi`.
const VARIABLE_OPERAND_POSITIONS: ReadonlyMap<
  string,
  (ops: readonly MathJsonExpression[]) => readonly number[]
> = new Map<string, (ops: readonly MathJsonExpression[]) => readonly number[]>([
  ['Limit', (ops) => (ops.length >= 3 ? [1] : [])],
  ['Solve', (ops) => range(1, ops.length)],
  ['NSolve', (ops) => range(1, ops.length)],
  ['JacobianMatrix', () => [1]],
  ['CharacteristicPolynomial', () => [1]],
  ['FindRoot', () => [1]],
  ['FindFit', () => [2, 3]],
  ['LinearRegression', trailingSymbolPosition],
  ['PolynomialFit', trailingSymbolPosition],
]);

/** The position of the last operand when it is a bare symbol (the optional
 * variable of a fit), else none. */
function trailingSymbolPosition(
  ops: readonly MathJsonExpression[]
): readonly number[] {
  return ops.length >= 2 && symbol(ops[ops.length - 1]) !== null
    ? [ops.length - 1]
    : [];
}

function range(from: number, to: number): number[] {
  const result: number[] = [];
  for (let i = from; i < to; i++) result.push(i);
  return result;
}

/**
 * The operand positions of a call to `name` with operands `ops` where a
 * plain symbol is the call's variable: the positions listed above, or the
 * positions whose parameter is typed with `symbol` in the signature —
 * required parameters first, then optional ones, then the variadic
 * parameter for every remaining position (`D: (expression, symbol*)` makes
 * every position from 1 on a variable). The variable heuristic of
 * `binderSitesOf` reads candidates at these positions only. Run at every
 * position of every operator, it read a REPEATED value as a variable — in
 * `[pi, pi]`, `max(pi, pi)` and `series(x + pi, x, pi, 3)` a `pi` that is
 * a whole operand and also occurs in another operand was left as the
 * unknown `pi` instead of `Pi`.
 */
function variableOperandPositions(
  name: string,
  def: BoxedDefinition,
  ops: readonly MathJsonExpression[]
): readonly number[] {
  const nops = ops.length;
  const listed = VARIABLE_OPERAND_POSITIONS.get(name);
  if (listed !== undefined) return listed(ops);
  if (!('operator' in def)) return [];
  const signature = def.operator.signature.type;
  if (typeof signature !== 'object' || signature.kind !== 'signature')
    return [];
  const admitsSymbol = (type: Type | undefined): boolean =>
    type !== undefined && /\bsymbol\b/.test(typeToString(type));
  const positional = [...(signature.args ?? []), ...(signature.optArgs ?? [])];
  const positions: number[] = [];
  for (let i = 0; i < nops; i++) {
    const parameter =
      i < positional.length ? positional[i] : signature.variadicArg;
    if (admitsSymbol(parameter?.type)) positions.push(i);
  }
  return positions;
}

/** The operand shapes whose direct symbol elements can name variables: the
 * `{x, 2}` of a higher-order `D`, the `[x, y]` of a `Solve`. */
const VARIABLE_GROUP_HEADS = new Set([
  'List',
  'Set',
  'Tuple',
  'Pair',
  'Triple',
]);

/**
 * The operators that choose an implicit variable for their first operand
 * when the call does not write one, with the rule of
 * `canonicalImplicitLimitFunction()` (`library/calculus.ts`): `Limit(f, a)`
 * and `Limit(f, a, direction)`, `NLimit(f, a)`, `ND(f, x)` and
 * `NIntegrate(f, lower, upper)`. The variable is visible in the first
 * operand only: the other operands (the point, the bounds) read their names
 * from outside the call. A `Limit` whose second operand is its variable
 * (`Limit(f, x, a)`) gets its site from `VARIABLE_OPERAND_POSITIONS`, and
 * the implicit rule is then not used.
 */
const IMPLICIT_VARIABLE_OPERATORS: ReadonlySet<string> = new Set([
  'Limit',
  'NLimit',
  'ND',
  'NIntegrate',
]);

/**
 * The implicit variable that the engine chooses for `f`, the first operand
 * of a call to an operator of `IMPLICIT_VARIABLE_OPERATORS`, written as in
 * the program, or `undefined` when the engine binds no name there.
 *
 * The rule is the one of `canonicalImplicitLimitFunction()`, applied to the
 * raw tree: the first, in sorted order, of the names that `f` reads from
 * outside and that `implicitVariableCandidates()` accepts. The names that
 * `f` reads from outside are the `free` groups of `documentBindings()` on
 * `f`, so a name that a nested call (`sum(k*h, k, 1, 3)`) or a construct of
 * the program (a function literal) binds inside `f` is not a candidate. A
 * name that is a call head anywhere in `f` names a function and is not a
 * candidate. A spelling of the library (`pi`) is tested under the library
 * name it stands for (`Pi`, a constant, is not a candidate), unless the
 * engine defines the written name or the occurrence is verbatim
 * (`` `pi` ``, the raw symbol `pi`).
 *
 * As in the engine, a bare symbol (`limit(sin, 0)`, which names a
 * function), a function literal (`limit((x) => sin(x)/x, 0)`, which names
 * its own parameter) and an operand with an anonymous slot (`_`) bind no
 * name.
 *
 * `isBound(name)` says whether the program binds `name` at the call. When
 * the first candidate is such a name and other candidates follow, the
 * result is `undefined`, because the choice of the engine depends on the
 * value of that name. A host that leaves out `isBound` gets the first
 * candidate in every case.
 */
function implicitVariableOf(
  ce: ComputeEngine,
  f: MathJsonExpression | undefined,
  source: string,
  members: ReadonlyMap<string, ProtocolFunctionMember> | undefined,
  isBound: (name: string) => boolean,
  memo: BinderSitesMemo
): string | undefined {
  if (f === undefined || symbol(f) !== null) return undefined;
  if (operator(f) === 'Function') return undefined;
  if (hasFreeAnonymousSlot(ce, f)) return undefined;

  // A nested call sees the bindings of `f` and those of the program around
  // the call.
  const groups = documentBindings(f, source, {
    binderSites: (node, isBoundInF) =>
      memoizedBinderSites(
        ce,
        node,
        source,
        members,
        (name) => isBoundInF(name) || isBound(name),
        memo
      ),
  });
  // The written name of each candidate, by the name the engine reads. Each
  // occurrence is read on its own: in `pi + `pi`*x`, the plain `pi` is the
  // constant `Pi` and the verbatim `pi` is the raw symbol `pi`. A name that
  // the program binds (`let pi = 5`) is not a spelling of the library.
  const writtenName = new Map<string, string>();
  // The written names whose occurrences the engine reads as two names.
  const mixed = new Set<string>();
  for (const group of groups) {
    if (group.kind !== 'free' || occursAsHead(f, group.name)) continue;
    const engineNames = new Set<string>();
    for (const occurrence of group.occurrences) {
      const engineName =
        source[occurrence.start] !== '`' &&
        !isBound(group.name) &&
        ce.lookupDefinition(group.name) === undefined
          ? (canonicalLibraryName(group.name) ?? group.name)
          : group.name;
      engineNames.add(engineName);
      if (!writtenName.has(engineName)) writtenName.set(engineName, group.name);
    }
    if (engineNames.size > 1) mixed.add(group.name);
  }
  if (writtenName.size === 0) return undefined;

  // The candidates are those of the canonical names, as in the canonical
  // body of the limit: a raw symbol has no definition yet, so the operator
  // names that the engine reads as unknowns (`N` in `limit(N + h, 1)`) were
  // not candidates. Boxing an unknown name declares it in the current scope,
  // so the names are boxed in a scope of their own, which is then removed.
  let candidates: string[];
  ce.pushScope();
  try {
    candidates = implicitVariableCandidates(
      ce.box(['List', ...writtenName.keys()])
    );
  } catch {
    candidates = [];
  } finally {
    ce.popScope();
  }
  const [first] = candidates;
  if (first === undefined) return undefined;
  const variable = writtenName.get(first);
  if (variable === undefined) return undefined;
  // A site binds every occurrence of its written name. In `pi + `pi`*x`, the
  // engine binds the verbatim `pi` only, and the plain `pi` must stay free
  // to become `Pi`: no site.
  if (mixed.has(variable)) return undefined;
  // The engine reads the value of a name that the program binds, and that
  // value is not known here. When such a name comes first and other
  // candidates follow, the engine chooses it only if its value can be a
  // number: in `let L = [1, 2]` followed by `limit(total(L)*t, 0)` the
  // variable is `t`, and in `let a = 5` followed by `limit(a*h, 0)` it is
  // `a`. The choice is left open: no site.
  if (candidates.length > 1 && isBound(variable)) return undefined;
  return variable;
}

/**
 * Whether `f` holds an anonymous slot (`_`, `_1`) that no function literal
 * or pipe stage inside `f` binds, the test of `freeAnonymousSlots()`: the
 * engine then makes the slots the parameters, and the call binds no name. In
 * `limit(h + (1 |> _^2), 0)` the pipe binds the `_`, and the call binds `h`.
 * When the engine cannot box `f` (a recovered parse), any slot counts.
 */
function hasFreeAnonymousSlot(
  ce: ComputeEngine,
  f: MathJsonExpression
): boolean {
  try {
    return freeAnonymousSlots(ce.box(f, { form: 'raw' })).size > 0;
  } catch {
    return [...ANONYMOUS_SLOT_NAMES].some((slot) => occursAsValue(f, slot));
  }
}

/**
 * The results of `binderSitesOf()` for the nodes of one tree, so that the
 * walk of a nested call (`nd(nd(h^3, 1), 1)`) is made once, not once for
 * each enclosing call that has an implicit variable.
 */
type BinderSitesMemo = Map<MathJsonExpression, readonly BinderSite[] | undefined>;

function memoizedBinderSites(
  ce: ComputeEngine,
  node: MathJsonExpression,
  source: string,
  members: ReadonlyMap<string, ProtocolFunctionMember> | undefined,
  isBound: (name: string) => boolean,
  memo: BinderSitesMemo
): readonly BinderSite[] | undefined {
  if (memo.has(node)) return memo.get(node);
  const sites = binderSitesWithMemo(ce, node, source, members, isBound, memo);
  memo.set(node, sites);
  return sites;
}

/**
 * The variables a raw call to a library operator binds, and where each one
 * is visible.
 *
 * `node` is a call node of the tree that `parseEpsil()` returns for
 * `source`, before or after `resolveLibraryNames()`: the function reads the
 * source offsets of the node to find a verbatim callee. The result is one
 * `BinderSite` per bound variable, an empty array for a library operator
 * that binds nothing in this call, and `undefined` for a node that is not a
 * call of a library operator. A host uses it to tell which names in a call
 * are the call's own variables and which ones the call reads from outside:
 *
 * ```ts
 * import {
 *   ComputeEngine,
 *   binderSitesOf,
 *   parseEpsil,
 * } from '@cortex-js/compute-engine/epsil';
 *
 * const ce = new ComputeEngine();
 * const source = 'sum(k^2, k, 1, n)';
 * // A program of one statement parses to that statement, here the call.
 * const [call] = parseEpsil(source);
 * binderSitesOf(ce, call, source);
 * // ➔ [{ name: 'k', operands: [0, 1, 2, 3] }]: `k` is bound, `n` is read.
 * ```
 *
 * The function does not see the bindings of the program, only those of the
 * engine. Call it only for a call whose callee the program does not bind:
 * after `function sum(a, b, c, d) { a }` in a program that has not run yet,
 * the call `sum(k^2, k, 1, n)` is a call of that function, but the result
 * gives the sites of the library `Sum`. The language server's scope model
 * (`documentBindings()`) makes this test before it asks for the sites.
 *
 * Three sources, combined:
 *
 * 1. The engine's binding-site selector of the callee (`Sum`, `Integrate`,
 *    `D`, the quantifiers, `Comprehension`, `Loop`), run in its `'pre'`
 *    phase on the raw operands. A site flagged clause-local (an iterator
 *    clause) is visible in the body — every operand before the first
 *    clause — and from its own operand onward; any other site is visible in
 *    the whole call.
 * 2. The rule the engine's own `Limit` handler applies, for the operators
 *    that take a variable as a plain operand without declaring a site
 *    (`Limit(expr, x, 0)`, `Solve(eq, x)`, the `{x, 2}` order form of `D`
 *    — `variableOperandPositions` says which operands): a symbol that is
 *    such an operand, or a direct element of such a list, set, or tuple
 *    operand, and that also occurs as a value inside ANOTHER operand of the
 *    call, is the call's variable. A name that is used as a call head anywhere in the
 *    call (`map(sin, [sin(1)])`) is a function, never a variable. Such a
 *    variable is visible in the whole call. An operator that takes no
 *    variable (`Max`, `List`) binds nothing this way: `max(pi, pi)` is two
 *    constants.
 * 3. When the first two sources give no site, the implicit variable of
 *    `Limit`, `NLimit`, `ND` and `NIntegrate`, which the engine chooses
 *    when the call does not write one (`implicitVariableOf`): the first, in
 *    sorted order, of the names that the first operand reads from outside.
 *    In `limit(sin(h)/h, 0)`, the result is `[{ name: 'h', operands: [0]
 *    }]`. Such a variable is visible in the first operand only.
 *
 * The callee is looked up under its written name first (an engine binding
 * wins), then under the library name its spelling stands for — unless it
 * was written verbatim (`` `integrate`(…) ``), which names the raw symbol
 * and borrows nothing from the library. A callee that is not a library
 * operator binds nothing. When the engine cannot box an operand of a
 * recovered parse, the binding-site selector is skipped, and only the second
 * rule gives sites. When `members` (the result of
 * `protocolFunctionMembers()` for the program) is given, a callee that the
 * engine does not define and that is a protocol function member declared by
 * a statement that ends at or before the call is the member's dispatcher,
 * not the library operator: it binds nothing (`solve(Money(1), pi)` after
 * `protocol S { function solve(…) }` keeps `pi` free). This is the offset
 * rule `resolveLibraryNames()` uses. The Epsil entry does not export
 * `protocolFunctionMembers()`, so a host leaves `members` out. Then a
 * callee is never read as a protocol member:
 * after `protocol S { function solve(…) }`, the call
 * `solve(Money(round(pi)), pi)` gives the sites of the library `Solve`, so
 * `pi` is read as bound.
 *
 * `isBound(name)`, when given, says whether the program binds `name` at the
 * call; `documentBindings()` gives it as the second argument of its
 * `binderSites` callback. Only the third source reads it. The engine reads
 * the value of such a name, which is not known before the program runs: an
 * implicit variable that is such a name gives no site when other candidates
 * follow it. In `let L = [1, 2]` followed by `limit(total(L)*t, 0)`, the
 * engine binds `t` because `L` is a list, and in `let a = 5` followed by
 * `limit(a*h, 0)` it binds `a`; with `isBound`, both calls give `[]`.
 * Without `isBound`, no name is bound by the program, and the two calls
 * give `L` and `a`.
 */
export function binderSitesOf(
  ce: ComputeEngine,
  node: MathJsonExpression,
  source: string,
  members?: ReadonlyMap<string, ProtocolFunctionMember>,
  isBound: (name: string) => boolean = () => false
): readonly BinderSite[] | undefined {
  return binderSitesWithMemo(ce, node, source, members, isBound, new Map());
}

/** `binderSitesOf()`, with the results already computed for the nodes of
 * the same tree. */
function binderSitesWithMemo(
  ce: ComputeEngine,
  node: MathJsonExpression,
  source: string,
  members: ReadonlyMap<string, ProtocolFunctionMember> | undefined,
  isBound: (name: string) => boolean,
  memo: BinderSitesMemo
): readonly BinderSite[] | undefined {
  const head = operator(node);
  if (head === '') return undefined;
  // A callee that the program binds (`function sum(…)` above the call) is
  // not the library operator. `documentBindings()` makes this test itself
  // before it asks; the walk of the operand of an implicit-variable call
  // starts inside that operand, so it does not see the bindings around it.
  if (isBound(head)) return undefined;
  const offsets = (node as { sourceOffsets?: [number, number] }).sourceOffsets;
  const verbatim = offsets !== undefined && source[offsets[0]] === '`';
  const defined = ce.lookupDefinition(head) !== undefined;
  const memberFrom = members?.get(head)?.from;
  if (
    !verbatim &&
    !defined &&
    memberFrom !== undefined &&
    offsets !== undefined &&
    offsets[0] >= memberFrom
  )
    return undefined;
  const name =
    verbatim || defined ? head : (canonicalLibraryName(head) ?? head);
  const def = ce.lookupDefinition(name);
  if (def === undefined || !('operator' in def)) return undefined;

  const ops = [...operands(node)];
  const sites: BinderSite[] = [];
  const bound = new Set<string>();

  const selector = def.operator.bindingSites;
  if (selector !== undefined) {
    let boxed: Expression[] | undefined;
    try {
      boxed = ops.map((op) => ce.box(op, { form: 'raw' }));
    } catch {
      // A recovered parse can hold a node the engine refuses to box; the
      // selector then has nothing to read. The heuristic below still runs.
      boxed = undefined;
    }
    if (boxed !== undefined) {
      const found = selector(boxed, 'pre');
      const firstClause = Math.min(
        ...found.filter((site) => site.clauseLocal).map((site) => site.path[0])
      );
      for (const site of found) {
        const variable = symbolAtPath(node, site.path);
        if (variable === undefined || bound.has(variable)) continue;
        bound.add(variable);
        const own = site.path[0];
        sites.push({
          name: variable,
          operands: site.clauseLocal
            ? ops.map((_, i) => i).filter((i) => i < firstClause || i >= own)
            : 'all',
        });
      }
    }
  }

  const variablePositions = variableOperandPositions(name, def, ops);
  ops.forEach((op, i) => {
    if (!variablePositions.includes(i)) return;
    const candidates: string[] = [];
    const direct = symbol(op);
    if (direct !== null) candidates.push(direct);
    else if (VARIABLE_GROUP_HEADS.has(operator(op)))
      for (const element of operands(op)) {
        const leaf = symbol(element);
        if (leaf !== null) candidates.push(leaf);
      }
    for (const candidate of candidates) {
      if (bound.has(candidate) || candidate === '_') continue;
      const elsewhere = ops.some(
        (other, j) => j !== i && occursAsValue(other, candidate)
      );
      if (!elsewhere || ops.some((other) => occursAsHead(other, candidate)))
        continue;
      bound.add(candidate);
      sites.push({ name: candidate, operands: 'all' });
    }
  });

  // An operator that chooses an implicit variable, in a call that does not
  // write the variable (no site was found above).
  if (sites.length === 0 && IMPLICIT_VARIABLE_OPERATORS.has(name)) {
    const variable = implicitVariableOf(
      ce,
      ops[0],
      source,
      members,
      isBound,
      memo
    );
    if (variable !== undefined) sites.push({ name: variable, operands: [0] });
  }

  return sites;
}

/**
 * Rewrite, in place, every free occurrence of a standard-library spelling
 * in `ast` to the library name it stands for. `source` is the text `ast`
 * was parsed from (the occurrence spans index into it), `ce` the engine the
 * program will run on (its bindings shadow the library). Returns `ast`.
 */
export function resolveLibraryNames(
  ast: MathJsonExpression,
  source: string,
  ce: ComputeEngine
): MathJsonExpression {
  const members = protocolFunctionMembers(ast);
  const groups = documentBindings(ast, source, {
    binderSites: (node, isBound) =>
      binderSitesOf(ce, node, source, members, isBound),
  });

  // The occurrences to rewrite, keyed by the start offset AND the name of the
  // written occurrence: one span is one occurrence (the walker dedups), and
  // the name tells a call head from a symbol node that could share its
  // start offset.
  const targets = new Map<string, string>();
  const keyOf = (start: number, name: string): string => `${start}:${name}`;
  for (const group of groups) {
    if (group.kind !== 'free') continue;
    const canonical = canonicalLibraryName(group.name);
    if (canonical === undefined) continue;
    // An engine binding of the written name — a previous cell's `let`, a
    // host declaration, a lowercase library value such as `e` or a unit —
    // shadows the spelling.
    if (ce.lookupDefinition(group.name) !== undefined) continue;
    const memberFrom = members.get(group.name)?.from;
    for (const occurrence of group.occurrences) {
      // The verbatim form names the raw symbol.
      if (source[occurrence.start] === '`') continue;
      // A protocol function member of this program declared above the
      // occurrence shadows the spelling.
      if (memberFrom !== undefined && occurrence.start >= memberFrom) continue;
      targets.set(keyOf(occurrence.start, group.name), canonical);
    }
  }
  if (targets.size === 0) return ast;

  const offsetsOf = (node: object): [number, number] | undefined =>
    (node as { sourceOffsets?: [number, number] }).sourceOffsets;

  const rewrite = (node: MathJsonExpression | null): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      // A bare array is the `["head", …]` form without metadata; the parser
      // never produces one, but a LaTeX island can. Nothing in it carries
      // offsets, so nothing in it is a target; still descend for nested
      // object nodes.
      for (const item of node) rewrite(item as MathJsonExpression);
      return;
    }
    const offsets = offsetsOf(node);
    if ('sym' in node) {
      const canonical =
        offsets === undefined
          ? undefined
          : targets.get(keyOf(offsets[0], node.sym));
      if (canonical !== undefined) node.sym = canonical;
      return;
    }
    if ('fn' in node) {
      const fn = node.fn as (MathJsonExpression | string)[];
      const head = fn[0];
      if (typeof head === 'string') {
        const canonical =
          offsets === undefined
            ? undefined
            : targets.get(keyOf(offsets[0], head));
        if (canonical !== undefined) fn[0] = canonical;
      } else rewrite(head);
      for (let i = 1; i < fn.length; i++) rewrite(fn[i] as MathJsonExpression);
      return;
    }
    if ('dict' in node) {
      for (const value of Object.values(node.dict as Record<string, unknown>))
        rewrite(value as MathJsonExpression);
    }
  };
  rewrite(ast);
  return ast;
}
