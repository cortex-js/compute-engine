import type { ComputeEngine } from '../compute-engine.js';
import type { MathJsonExpression } from '../math-json/types.js';
import { operand, operands, operator, symbol } from '../math-json/utils.js';
import { FatalParsingError } from './diagnostics.js';
import { isTimeoutCancellation } from '../common/interruptible.js';
import type { ExecuteEpsilOptions } from './execute-epsil.js';
import { sumVariantNames } from './execute-epsil.js';
import { islandParser } from './latex-islands.js';
import { canonicalLibraryName } from './library-names.js';
import { documentBindings, protocolFunctionMembers } from './occurrences.js';
import type { BindingGroup, BindingKind } from './occurrences.js';
import { parseEpsil } from './parse-epsil.js';
import { binderSitesOf } from './resolve-library-names.js';

//
// The sites of the names of an Epsil program (CE-1255.2, CE-1628): for each
// name that the source spells, its range, its role and the binding it
// resolves to. A host that runs a program in a scope of its own reads from
// it which occurrences name a binding OUTSIDE the program, without a copy of
// the scoping rules.
//
// The resolution is the scope walk of `documentBindings()` under its
// `engineRules` option, on the tree as the parser gives it (the only tree
// with the source ranges), and the engine's scopes for the names that the
// program does not bind. It reads the source, not the canonical form: a
// macro that expands to a read adds no site, and `v / v` has two sites also
// when its value is the constant 1.
//
// The query gives what the interpreter does: `resolveLibraryNames()` reads
// the same walk, so a library spelling that it rewrites before the program
// is boxed is `library`, and a spelling that a `let` of the program binds
// (also in a function body above the `let`) is that binding.
//

/** What a name of an Epsil program resolves to. */
export type EpsilSiteBinding = {
  /** The name of the binding. For a `library` binding it is the name of the
   * library definition (`Sum` for a site that spells `sum`). */
  name: string;
  /**
   * - `program`: a declaration at the top level of the program (a `let`, a
   *   `const`, a `function`, a `type` or a `protocol` statement).
   * - `local`: a binding of a nested scope (a parameter, a loop or
   *   comprehension variable, a `match` binder, a `let` or a `function` of
   *   a block, a variable that a library call binds).
   * - `external`: a binding of the engine that the program does not make,
   *   in the scope the query runs in or in a scope around it.
   * - `library`: a definition of the standard library.
   * - `unresolved`: no binding. A function member of a `protocol` statement
   *   of the program is also `unresolved`: its dispatcher exists only after
   *   the statement runs.
   */
  kind: 'program' | 'local' | 'external' | 'library' | 'unresolved';
  /** For a `program` or `local` binding, the construct that makes it. */
  form?: Exclude<BindingKind, 'free'>;
  /** For an `external` binding, the number of scopes between the scope the
   * query runs in (0) and the scope that holds the binding. Two bindings of
   * one name in two scopes differ by it. */
  scopeDepth?: number;
};

/** One name written in the source of an Epsil program. */
export type EpsilNameSite = {
  /** The range of the name in the source, in UTF-16 code units, the end
   * excluded. The backticks of a verbatim name are in the range. */
  start: number;
  end: number;
  /** The index of the binding in `EpsilProgramSites.bindings`. The sites of
   * one binding have the same index, and two bindings of the same name
   * have different indexes. */
  binding: number;
  /**
   * - `definition`: the name in a declaration, a parameter, a loop
   *   variable or a `match` binder. A variable that a library call binds
   *   (`sum(k^2, k in 1..3)`) has no `definition` site: each of its sites
   *   is a `read`.
   * - `read`: a use of the value; the head of a call is a `read`.
   * - `write`: the target of an assignment.
   * - `read-write`: the target of `+=`, or the collection or record of an
   *   indexed or field target (`a[1] = 2`, `r.x = 2`).
   * - `reference`: a name that reads no value: the label of a named
   *   argument, a type name in a type annotation.
   */
  role: 'definition' | 'read' | 'write' | 'read-write' | 'reference';
  /** The site is in the body of a function literal or in the default value
   * of a parameter. It runs when the function is called, which can be in
   * the statement itself (a function given to `map`). */
  deferred: boolean;
  /** The index in `EpsilProgramSites.statements` of the top-level statement
   * that holds the site. */
  statement: number;
};

/** The `program` bindings that one top-level statement names. */
export type EpsilStatementSites = {
  /** The range of the statement in the source. */
  start: number;
  end: number;
  /** The indexes of the `program` bindings that the statement reads,
   * defines and writes, each one once, in source order. The sites of a
   * function body count (`EpsilNameSite.deferred` tells them apart). A
   * `read-write` site counts as a read and as a write. */
  reads: number[];
  defines: number[];
  writes: number[];
};

/** The result of `epsilProgramSites()`. */
export type EpsilProgramSites = {
  /** The bindings that the sites resolve to, in the order of their first
   * site. The indexes are those of this result only. */
  bindings: EpsilSiteBinding[];
  /** The sites, in source order. */
  sites: EpsilNameSite[];
  /** The top-level statements, in source order. */
  statements: EpsilStatementSites[];
  /** The names of the `external` bindings that the program writes, in a
   * function body included, in the order of the first write. */
  externalWrites: string[];
};

function spanOf(node: MathJsonExpression | null): [number, number] | undefined {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
    : undefined;
}

/** Whether the source spells `name` at `start`, as written or verbatim. */
function spelledAt(source: string, name: string, start: number): boolean {
  return (
    source.startsWith(name, start) || source.startsWith('`' + name + '`', start)
  );
}

/**
 * What the tree says of the sites that the scope walk does not record:
 *
 * - `deferred`: the ranges of the function bodies and of the default values
 *   of parameters;
 * - `compound`: the start of each name that a statement reads and writes
 *   at one site (the target of `+=`, the collection of `a[1] = 2`);
 * - `values`: the start of each symbol and of each call head. A `read` that
 *   the walk records elsewhere is a label or a name in type text.
 */
function treeFacts(
  ast: MathJsonExpression | null,
  source: string
): {
  deferred: [number, number][];
  compound: Set<number>;
  values: Set<number>;
} {
  const deferred: [number, number][] = [];
  const compound = new Set<number>();
  const values = new Set<number>();
  const defer = (node: MathJsonExpression | null): void => {
    const span = spanOf(node);
    if (span !== undefined) deferred.push(span);
  };
  /** The name at the root of an indexed or field target. */
  const rootOf = (
    node: MathJsonExpression | null
  ): MathJsonExpression | null =>
    node !== null && ['At', 'Field'].includes(operator(node) as string)
      ? rootOf(operand(node, 1))
      : node;
  const compoundTargets = (node: MathJsonExpression | null): void => {
    if (node === null) return;
    const head = operator(node);
    if (head === 'Tuple' || head === 'Typed') {
      if (head === 'Tuple')
        for (const op of operands(node)) compoundTargets(op);
      else compoundTargets(operand(node, 1));
      return;
    }
    const start = spanOf(rootOf(node))?.[0];
    if (start !== undefined) compound.add(start);
  };
  const visit = (node: MathJsonExpression | null): void => {
    if (node === null || typeof node !== 'object') return;
    if (!Array.isArray(node) && 'dict' in node) {
      for (const value of Object.values(node.dict as Record<string, unknown>))
        visit(value as MathJsonExpression);
      return;
    }
    const span = spanOf(node);
    const head = operator(node);
    if (head === '') {
      if (span !== undefined && symbol(node) !== null) values.add(span[0]);
      return;
    }
    if (typeof head !== 'string') visit(head as MathJsonExpression);
    else if (span !== undefined && spelledAt(source, head, span[0]))
      values.add(span[0]);
    if (head === 'Function') {
      defer(operand(node, 1));
      for (const parameter of operands(node).slice(1))
        if (operator(parameter) === 'Optional') defer(operand(parameter, 2));
    } else if (head === 'AddTo') compoundTargets(operand(node, 1));
    else if (head === 'Assign') {
      // `a[1] = 2` is `Assign(a, ReplaceAt(a, 1, 2))`, and `r.x = 2` is
      // `Assign(Field(r, "x"), 2)`.
      const target = operand(node, 1);
      const value = operand(node, 2);
      const name = target === null ? null : symbol(target);
      if (name === null) {
        if (rootOf(target) !== target) compoundTargets(target);
      } else if (
        value !== null &&
        operator(value) === 'ReplaceAt' &&
        symbol(operand(value, 1) ?? 'Nothing') === name &&
        spanOf(operand(value, 1)) === undefined
      )
        compoundTargets(target);
    }
    for (const op of operands(node)) visit(op);
  };
  visit(ast);
  return { deferred, compound, values };
}

/**
 * The sites of the names of an Epsil program: each name that `source`
 * spells, with its range, its role and the binding it resolves to, and for
 * each top-level statement the top-level bindings that it reads, defines
 * and writes.
 *
 * The program is parsed as `executeEpsil()` parses it and is not run:
 * the query declares nothing and assigns nothing on `ce`. A name that the
 * program does not bind is looked up in the current scope of `ce`, so a
 * host calls the query in the scope in which it runs the program.
 *
 * The resolution follows the rules of the interpreter:
 *
 * - a `let` or a `const` binds its name in its whole block, or in the whole
 *   program for a top-level statement: a function body above the statement
 *   reads that binding. In the initializer of the statement, the name is
 *   the binding outside the block (`let k = k + 1` reads the outer `k`),
 *   except when the initializer is a function literal, whose body names
 *   the binding itself (`let f = (n) => … f(n - 1)` is recursive);
 * - the collection of a `for` clause is read outside the loop: in
 *   `for n in 1..n`, the second `n` is the binding around the loop;
 * - an assignment declares nothing: its target is a `write` of the binding
 *   that is visible, which is `external` when the program has none;
 * - a parameter, a loop or comprehension variable, a `match` binder and a
 *   variable that a library call binds (`sum(k^2, k in 1..3)`) are `local`.
 *
 * To run a program without a write to the bindings around it, a host
 * declares a local copy of each name of `externalWrites` first. To rename
 * an `external` binding, a host replaces the text of each site of that
 * binding, and of no other site.
 *
 * The sites are those of the source. They are not the inputs of the
 * compiled or simplified program: a library function that reads a variable
 * of the engine adds a dependency with no site. When the source has a parse
 * error, the sites are those of the tree that the parser recovered; a
 * `#error` directive gives an empty result.
 *
 * An expired time limit of `ce` (`ce.withTimeLimit()`) is thrown to the
 * caller as a `CancellationError`.
 */
export function epsilProgramSites(
  ce: ComputeEngine,
  source: string,
  options?: Pick<ExecuteEpsilOptions, 'url' | 'parseLatex' | 'allowHostPragmas'>
): EpsilProgramSites {
  const result: EpsilProgramSites = {
    bindings: [],
    sites: [],
    statements: [],
    externalWrites: [],
  };
  let ast: MathJsonExpression | null;
  try {
    [ast] = parseEpsil(source, options?.url, {
      parseLatex: islandParser(ce, options?.parseLatex),
      allowHostPragmas: options?.allowHostPragmas ?? false,
      typeNames: ce._typeResolver.names,
      protocolNames: Object.keys(ce._protocolRegistry),
      sumVariants: sumVariantNames(ce),
      deadline: ce._deadlineFrame,
      isLibraryFunction: (name) => ce._isLibraryFunction(name),
    });
  } catch (e) {
    if (e instanceof FatalParsingError && !isTimeoutCancellation(e))
      return result;
    throw e;
  }
  if (ast === null) return result;

  const members = protocolFunctionMembers(ast);
  /** The name of the library definition that the spelling `name` stands
   * for at `start`, as `resolveLibraryNames()` decides it. The target of an
   * assignment keeps its name. */
  const libraryName = (
    name: string,
    start: number,
    write: boolean
  ): string | undefined => {
    const canonical = canonicalLibraryName(name);
    if (canonical === undefined || source[start] === '`' || write)
      return undefined;
    const from = members.get(name)?.from;
    return from !== undefined && start >= from ? undefined : canonical;
  };
  // The same walk as `resolveLibraryNames()`, so a spelling that it rewrites
  // to the library name is a free name here.
  const groups = documentBindings(ast, source, {
    binderSites: (node, isBound, declarationOf) =>
      binderSitesOf(ce, node, source, members, isBound, declarationOf),
    engineRules: {
      defined: (name) =>
        ce.lookupDefinition(name) !== undefined ||
        canonicalLibraryName(name) !== undefined,
    },
  });

  const statements = operator(ast) === 'Program' ? [...operands(ast)] : [ast];
  for (const statement of statements) {
    const span = spanOf(statement) ?? [-1, -1];
    result.statements.push({
      start: span[0],
      end: span[1],
      reads: [],
      defines: [],
      writes: [],
    });
  }
  const facts = treeFacts(ast, source);

  // The binding of a name that the program does not bind, for one site.
  const outside = new Map<string, number>();
  const system = ce.contextStack[0]?.lexicalScope;
  const outsideBinding = (
    name: string,
    start: number,
    write: boolean
  ): number => {
    const definition = ce.lookupDefinition(name);
    let binding: EpsilSiteBinding;
    if (definition !== undefined) {
      let depth = 0;
      let scope: typeof system | null = ce.context.lexicalScope;
      while (scope && scope.bindings.get(name) !== definition) {
        scope = scope.parent;
        depth += 1;
      }
      binding =
        scope === system || !scope
          ? { name, kind: 'library' }
          : { name, kind: 'external', scopeDepth: depth };
    } else {
      const library = libraryName(name, start, write);
      binding =
        library !== undefined
          ? { name: library, kind: 'library' }
          : { name, kind: 'unresolved' };
    }
    const key = `${binding.kind}:${binding.name}`;
    let index = outside.get(key);
    if (index === undefined) {
      index = result.bindings.push(binding) - 1;
      outside.set(key, index);
    }
    return index;
  };

  const inside = new Map<BindingGroup, number>();
  const collected: { start: number; group: BindingGroup; index: number }[] = [];
  for (const group of groups)
    group.occurrences.forEach((occurrence, index) =>
      collected.push({ start: occurrence.start, group, index })
    );
  collected.sort((a, b) => a.start - b.start);

  for (const { group, index: occurrenceIndex } of collected) {
    const occurrence = group.occurrences[occurrenceIndex];
    const { start, end } = occurrence;
    let binding: number;
    if (group.kind === 'free')
      binding = outsideBinding(group.name, start, occurrence.role === 'write');
    else {
      binding =
        inside.get(group) ??
        result.bindings.push({
          name: group.name,
          kind: group.topLevel === true ? 'program' : 'local',
          form: group.kind,
        }) - 1;
      inside.set(group, binding);
    }
    const role: EpsilNameSite['role'] =
      occurrence.role === 'write'
        ? facts.compound.has(start)
          ? 'read-write'
          : 'write'
        : occurrence.role === 'read' && !facts.values.has(start)
          ? 'reference'
          : occurrence.role;
    const statement = result.statements.findIndex(
      (s) => s.start <= start && end <= s.end
    );
    result.sites.push({
      start,
      end,
      binding,
      role,
      deferred: facts.deferred.some(
        (span) => span[0] <= start && end <= span[1]
      ),
      statement,
    });

    const kind = result.bindings[binding].kind;
    const writes = role === 'write' || role === 'read-write';
    if (
      kind === 'external' &&
      writes &&
      !result.externalWrites.includes(group.name)
    )
      result.externalWrites.push(group.name);
    if (kind !== 'program' || statement < 0) continue;
    const summary = result.statements[statement];
    const add = (list: number[]): void => {
      if (!list.includes(binding)) list.push(binding);
    };
    if (role === 'definition') add(summary.defines);
    if (role === 'read' || role === 'read-write') add(summary.reads);
    if (writes) add(summary.writes);
  }
  return result;
}
