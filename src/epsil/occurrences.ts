import type { MathJsonExpression } from '../math-json/types.js';
import { operand, operands, operator, symbol } from '../math-json/utils.js';
import { tokenize } from './lexer.js';

//
// Scope-aware symbol occurrence resolution over the RAW Epsil AST — the one
// tree that carries `sourceOffsets` on every node the user actually wrote
// (canonicalization drops or reshapes them). This is what the language
// server's go-to-definition, find-references, occurrence highlighting, and
// rename are built on: a rename is only correct if it touches exactly the
// occurrences that bind to the same declaration, so a lexer-level text match
// is not enough — a lambda parameter `x` must not be swept up in a rename of
// a top-level `x` it shadows.
//
// The parser synthesizes nodes whose spans are BORROWED from the construct
// they desugar (`let x = 3` carries a `value` key symbol spanning the whole
// statement; a multi-clause literal parameter becomes `literalParam_1` at the
// literal's span). The guard that keeps all of them out is the SPELLING
// CHECK: a symbol node counts as an occurrence only when the source text at
// its span actually spells the symbol's name (plainly, or as the
// backtick-quoted verbatim form). Synthesized names never spell their span.
//

/** How one occurrence uses its symbol. */
export type OccurrenceRole = 'definition' | 'write' | 'read';

/** One appearance of a symbol in the source, as the span of its name token
 * (a verbatim symbol's span includes its backticks). */
export type Occurrence = {
  start: number;
  end: number;
  role: OccurrenceRole;
};

/** What form of construct bound the group's name — or `free` when nothing in
 * the document did (an undeclared symbol, or a library name). */
export type BindingKind =
  | 'function'
  | 'parameter'
  | 'variable'
  | 'loop'
  | 'pattern'
  | 'type'
  | 'free';

/**
 * Every occurrence in the document that resolves to ONE binding — renaming
 * the group's name means editing exactly these spans. A `free` group collects
 * the unbound uses of one name instead; it has no `declaration`.
 */
export type BindingGroup = {
  name: string;
  kind: BindingKind;
  /** All co-binding occurrences, in source order; for a bound group the
   * binder itself is among them with role `definition` (several, for a
   * multi-clause function definition or a redeclaration). */
  occurrences: Occurrence[];
  /** The span of the declaring statement — a function definition's whole
   * header-plus-body, a `let`'s statement — used as an outline range. */
  declaration?: [number, number];
  /** The span of the scope the binding is visible in. */
  scope: [number, number];
  /** Where visibility begins inside that scope: a `let`/binding assignment
   * is visible only AFTER its statement (a use above the `let`, or in its
   * initializer, binds outward — verified against the interpreter), while
   * functions, types, parameters, loop and match-pattern variables are
   * visible from their scope's start. */
  visibleFrom: number;
};

type Scope = {
  span: [number, number];
  bindings: Map<string, BindingGroup>;
  parent: Scope | undefined;
};

/** Sort order for same-span duplicates: the strongest role survives dedup. */
const ROLE_RANK: Record<OccurrenceRole, number> = {
  definition: 0,
  write: 1,
  read: 2,
};

/**
 * Resolve every symbol occurrence in a parsed (raw, uncanonicalized) Epsil
 * program to its binding. Groups come back in order of first occurrence.
 *
 * Scoping model, matched to the constructs the parser produces:
 *
 * - `Block` opens a scope; `Declare` (`let`/`const`) binds its target
 *   pattern in the enclosing scope from the end of its statement onward.
 * - `Assign` to a name with no visible binding binds it (a bare `x = 1`
 *   declares); to a visible one it records a `write`.
 * - `DefineFunction` binds its name for the WHOLE enclosing scope (forward
 *   references to a later-defined function are legal), and clauses of a
 *   multi-clause definition join one group. Parameters — including `Typed`
 *   annotations and `Tuple` destructuring patterns — bind in the function's
 *   own scope.
 * - `for` loops (`Loop` whose iterator operand is `Element`) bind the loop
 *   pattern in the loop's scope; `Match` arms bind their pattern variables
 *   (spelled `_name` by the parser, at the span of `name`) in the arm.
 * - `DeclareType` / `DeclareProtocol` bind a type-tier name. Their USES live
 *   inside type-annotation STRINGS, which this resolver deliberately does not
 *   enter — which is why the server refuses to rename a type: the definition
 *   is the only occurrence it could edit.
 * - Dictionary keys and named-argument labels are not symbol uses; neither
 *   is the wildcard `_`.
 */
export function documentBindings(
  ast: MathJsonExpression | null,
  text: string
): BindingGroup[] {
  const groups: BindingGroup[] = [];
  const freeGroups = new Map<string, BindingGroup>();
  const root: Scope = {
    span: [0, text.length],
    bindings: new Map(),
    parent: undefined,
  };

  /** The source span a raw AST node carries, when it has one. */
  function spanOf(
    node: MathJsonExpression | null
  ): [number, number] | undefined {
    return typeof node === 'object' && node !== null && !Array.isArray(node)
      ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
      : undefined;
  }

  /** Whether the source at `span` actually spells `name` — plainly, as the
   * verbatim `` `name` `` form, or as a glyph alias the lexer canonicalizes
   * (`π` lexes to the symbol `Pi` while keeping the glyph's span). Synthesized
   * nodes borrow their construct's span and fail this check, which is what
   * keeps them out of the results. */
  function spelled(name: string, span: [number, number]): boolean {
    if (span[0] < 0 || span[1] > text.length || span[0] >= span[1])
      return false;
    const slice = text.slice(span[0], span[1]);
    if (slice === name || slice === '`' + name + '`') return true;
    // The alias fallback: the slice must lex to exactly this one symbol. A
    // borrowed span never does — a whole-statement slice lexes to many
    // tokens, a literal's slice to a number.
    if (slice.length > name.length + 8) return false;
    const tokens = tokenize(slice).filter((t) => t.type !== 'EOF');
    return (
      tokens.length === 1 &&
      tokens[0].start === 0 &&
      tokens[0].end === slice.length &&
      (tokens[0].type === 'SYMBOL' || tokens[0].type === 'VERBATIM_SYMBOL') &&
      (tokens[0].value ?? tokens[0].text) === name
    );
  }

  function childScope(
    span: [number, number] | undefined,
    parent: Scope
  ): Scope {
    return { span: span ?? parent.span, bindings: new Map(), parent };
  }

  /** The group for `name` bound in `scope`, creating it on first sight. A
   * re-binding of a name already bound in the SAME scope (a redeclaration, or
   * the next clause of a multi-clause definition) joins the existing group
   * rather than opening a second one. */
  function ensureBinding(
    scope: Scope,
    name: string,
    kind: BindingKind,
    declaration: [number, number] | undefined,
    visibleFrom: number
  ): BindingGroup {
    const existing = scope.bindings.get(name);
    if (existing !== undefined) return existing;
    const group: BindingGroup = {
      name,
      kind,
      occurrences: [],
      ...(declaration === undefined ? {} : { declaration }),
      scope: scope.span,
      visibleFrom,
    };
    groups.push(group);
    scope.bindings.set(name, group);
    return group;
  }

  /** Record a use of `name` at `span`: resolve outward through the scopes —
   * skipping a binding whose visibility starts after the use — and fall back
   * to the document-wide free group for the name. */
  function use(
    name: string,
    span: [number, number],
    scope: Scope,
    role: OccurrenceRole
  ): void {
    for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) {
      const binding = s.bindings.get(name);
      if (binding !== undefined && span[0] >= binding.visibleFrom) {
        binding.occurrences.push({ start: span[0], end: span[1], role });
        return;
      }
    }
    let group = freeGroups.get(name);
    if (group === undefined) {
      group = {
        name,
        kind: 'free',
        occurrences: [],
        scope: root.span,
        visibleFrom: 0,
      };
      freeGroups.set(name, group);
      groups.push(group);
    }
    group.occurrences.push({ start: span[0], end: span[1], role });
  }

  /** A symbol node's cooked name and span, when it is a genuine written
   * occurrence (has offsets, spells its span, and is not the `_` wildcard). */
  function writtenSymbol(
    node: MathJsonExpression | null
  ): { name: string; span: [number, number] } | undefined {
    const name = node === null ? null : symbol(node);
    if (name === null || name === '_') return undefined;
    const span = spanOf(node);
    if (span === undefined || !spelled(name, span)) return undefined;
    return { name, span };
  }

  /**
   * Bind a declaration-position pattern into `scope`: a plain name, a
   * `Typed(name, "type")` annotation (the type is a string, not entered), or
   * a `Tuple` destructuring of either, nested. Anything else in target
   * position (it happens on recovered parses) is walked as ordinary uses.
   */
  function bindPattern(
    node: MathJsonExpression | null,
    scope: Scope,
    kind: BindingKind,
    declaration: [number, number] | undefined,
    visibleFrom: number
  ): void {
    if (node === null) return;
    const head = operator(node);
    if (head === '') {
      const written = writtenSymbol(node);
      if (written === undefined) return;
      ensureBinding(
        scope,
        written.name,
        kind,
        declaration,
        visibleFrom
      ).occurrences.push({
        start: written.span[0],
        end: written.span[1],
        role: 'definition',
      });
      return;
    }
    if (head === 'Typed') {
      bindPattern(operand(node, 1), scope, kind, declaration, visibleFrom);
      return;
    }
    if (head === 'Tuple') {
      for (const op of operands(node))
        bindPattern(op, scope, kind, declaration, visibleFrom);
      return;
    }
    walk(node, scope);
  }

  /**
   * Bind a `Match` arm's pattern into the arm's scope. The parser marks a
   * pattern VARIABLE by prefixing its name with `_` while keeping the span of
   * the written name (`(0, y)` yields the symbol `_y` at `y`'s span); `_`
   * alone is the wildcard. A pattern symbol without the marker is a value to
   * match against — an ordinary read.
   */
  function bindMatchPattern(
    node: MathJsonExpression | null,
    scope: Scope
  ): void {
    if (node === null) return;
    const head = operator(node);
    if (head !== '') {
      if (head === 'Typed') {
        bindMatchPattern(operand(node, 1), scope);
        return;
      }
      for (const op of operands(node)) bindMatchPattern(op, scope);
      return;
    }
    const marked = symbol(node);
    if (marked === null || /^_+$/.test(marked)) return;
    const span = spanOf(node);
    if (span === undefined) return;
    // A rest capture (`...rest`) is encoded as `___rest`, its span covering
    // the ellipsis; the binding anchors on the NAME part only, so a rename
    // rewrites `rest` and leaves the `...` alone.
    if (marked.startsWith('___')) {
      const name = marked.slice(3);
      const nameSpan: [number, number] = [span[0] + 3, span[1]];
      if (text.slice(span[0], span[0] + 3) === '...' && spelled(name, nameSpan))
        ensureBinding(
          scope,
          name,
          'pattern',
          span,
          scope.span[0]
        ).occurrences.push({
          start: nameSpan[0],
          end: nameSpan[1],
          role: 'definition',
        });
      return;
    }
    if (marked.startsWith('_') && spelled(marked.slice(1), span)) {
      ensureBinding(
        scope,
        marked.slice(1),
        'pattern',
        span,
        scope.span[0]
      ).occurrences.push({ start: span[0], end: span[1], role: 'definition' });
      return;
    }
    if (spelled(marked, span)) use(marked, span, scope, 'read');
  }

  /** Bind a `DefineFunction`'s name into `scope` — visible scope-wide, so a
   * call written above the definition still resolves to it — joining the
   * group of an earlier clause of the same name. */
  function bindFunctionName(
    node: MathJsonExpression,
    scope: Scope,
    withOccurrence: boolean
  ): void {
    const written = writtenSymbol(operand(node, 1));
    if (written === undefined) return;
    const clause = spanOf(node) ?? written.span;
    const group = ensureBinding(
      scope,
      written.name,
      'function',
      clause,
      scope.span[0]
    );
    // A later clause of a multi-clause definition joins the first clause's
    // group; the declaration span widens to cover every clause, so the
    // outline's range (and its containment nesting) spans the whole
    // definition rather than just the first line.
    if (group.declaration !== undefined)
      group.declaration = [
        Math.min(group.declaration[0], clause[0]),
        Math.max(group.declaration[1], clause[1]),
      ];
    if (withOccurrence)
      group.occurrences.push({
        start: written.span[0],
        end: written.span[1],
        role: 'definition',
      });
  }

  /** Pre-bind the function names among a scope's statements, so that a
   * forward reference — a call above the `function` statement that defines
   * its callee — resolves to the definition instead of reading as free. */
  function hoistFunctions(
    statements: readonly (MathJsonExpression | null)[],
    scope: Scope
  ): void {
    for (const statement of statements)
      if (statement !== null && operator(statement) === 'DefineFunction')
        bindFunctionName(statement, scope, false);
  }

  /** A function literal: parameters bind in the function's own scope; the
   * body — the FIRST operand, though it is written last — is walked inside
   * it. */
  function walkFunction(node: MathJsonExpression, outer: Scope): void {
    const scope = childScope(spanOf(node), outer);
    const ops = [...operands(node)];
    for (let i = 1; i < ops.length; i++)
      bindPattern(ops[i], scope, 'parameter', undefined, scope.span[0]);
    walk(ops[0] ?? null, scope);
  }

  function walk(node: MathJsonExpression | null, scope: Scope): void {
    if (node === null) return;
    const head = operator(node);

    if (head === '') {
      const written = writtenSymbol(node);
      if (written !== undefined) use(written.name, written.span, scope, 'read');
      return;
    }

    switch (head) {
      case 'Block': {
        const inner = childScope(spanOf(node), scope);
        const statements = [...operands(node)];
        hoistFunctions(statements, inner);
        for (const statement of statements) walk(statement, inner);
        return;
      }

      case 'Declare': {
        // The initializer first: `let x = x + 1` reads the OUTER `x`.
        const ops = [...operands(node)];
        for (let i = 1; i < ops.length; i++) walk(ops[i], scope);
        const statementSpan = spanOf(node);
        bindPattern(
          ops[0] ?? null,
          scope,
          'variable',
          statementSpan,
          statementSpan?.[1] ?? scope.span[0]
        );
        return;
      }

      case 'Assign': {
        const ops = [...operands(node)];
        for (let i = 1; i < ops.length; i++) walk(ops[i], scope);
        assignTarget(ops[0] ?? null, scope, spanOf(node));
        return;
      }

      case 'DefineFunction': {
        bindFunctionName(node, scope, true);
        const fn = operand(node, 2);
        if (fn !== null && operator(fn) === 'Function') walkFunction(fn, scope);
        else walk(fn, scope);
        // The attributes operand (doc comment, …) holds no written symbols,
        // but walking it is harmless: dictionary keys are skipped below and
        // its values are strings.
        walk(operand(node, 3), scope);
        return;
      }

      case 'Function':
        walkFunction(node, scope);
        return;

      case 'Loop': {
        // A `for` loop: `Loop(body, Element(pattern, collection))`. The
        // collection is read OUTSIDE the loop's scope; the pattern binds
        // inside it. A `while` lowers to a `Loop` without the `Element`
        // iterator and takes the generic path.
        const iterator = operand(node, 2);
        if (iterator !== null && operator(iterator) === 'Element') {
          walk(operand(iterator, 2), scope);
          const inner = childScope(spanOf(node), scope);
          bindPattern(
            operand(iterator, 1),
            inner,
            'loop',
            spanOf(iterator),
            inner.span[0]
          );
          walk(operand(node, 1), inner);
          return;
        }
        for (const op of operands(node)) walk(op, scope);
        return;
      }

      case 'Match': {
        walk(operand(node, 1), scope);
        const ops = [...operands(node)];
        for (let i = 1; i < ops.length; i++) {
          const arm = ops[i];
          if (arm !== null && operator(arm) === 'MatchCase') {
            const inner = childScope(spanOf(arm), scope);
            const armOps = [...operands(arm)];
            bindMatchPattern(armOps[0] ?? null, inner);
            for (let j = 1; j < armOps.length; j++) walk(armOps[j], inner);
          } else walk(arm, scope);
        }
        return;
      }

      case 'DeclareType':
      case 'DeclareSumType':
      case 'DeclareProtocol': {
        // The declared name is a symbol; every USE of it lives inside type
        // strings (annotations, member signatures) that this resolver does
        // not enter — so the remaining operands are not walked.
        const written = writtenSymbol(operand(node, 1));
        if (written !== undefined)
          ensureBinding(
            scope,
            written.name,
            'type',
            spanOf(node) ?? written.span,
            scope.span[0]
          ).occurrences.push({
            start: written.span[0],
            end: written.span[1],
            role: 'definition',
          });
        return;
      }

      case 'KeyValuePair':
      case 'NamedArgument': {
        // The key/label is a name for the READER, not a reference — and the
        // parser's desugarings synthesize keys (`value`) with borrowed spans.
        const ops = [...operands(node)];
        for (let i = 1; i < ops.length; i++) walk(ops[i], scope);
        return;
      }

      case 'Typed': {
        // The annotation (operand 2) is a STRING naming a type; only the
        // annotated expression is walked.
        walk(operand(node, 1), scope);
        return;
      }

      default: {
        // A CALL carries its callee as the operator — a plain string with no
        // span of its own (`fib(n - 1)` is `["fib", …]`); the node's span
        // starts at the callee, so the name is recovered by spelling it
        // there. Structural heads (`Add` for `x + y`, `If` for `if …`) never
        // spell their span's start and contribute nothing. A head can also
        // be an EXPRESSION (`(f)(x)`), which is walked like any operand.
        if (typeof head === 'string') useHead(node, head, scope);
        else walk(head as MathJsonExpression, scope);
        for (const op of operands(node)) walk(op, scope);
        return;
      }
    }
  }

  /** Record the callee of a call node as a read, when the node's span begins
   * by spelling the operator's name — plainly or verbatim. */
  function useHead(node: MathJsonExpression, name: string, scope: Scope): void {
    if (name === '' || name === '_') return;
    const span = spanOf(node);
    if (span === undefined) return;
    const plain: [number, number] = [span[0], span[0] + name.length];
    if (plain[1] <= span[1] && spelled(name, plain)) {
      use(name, plain, scope, 'read');
      return;
    }
    const verbatim: [number, number] = [span[0], span[0] + name.length + 2];
    if (
      verbatim[1] <= span[1] &&
      text.slice(verbatim[0], verbatim[1]) === '`' + name + '`'
    )
      use(name, verbatim, scope, 'read');
  }

  /**
   * An assignment's target: a name with a visible binding is written to;
   * without one, the assignment IS the declaration (a bare `x = 1` declares).
   * `Tuple`/`Typed` targets are handled leaf by leaf, each leaf making its
   * own visible-or-declare decision — though the parser currently produces
   * only plain-symbol `Assign` targets (`(a, b) = x` parses as `Equal`), so
   * the structural cases are defensive. Anything else in target position is
   * walked as ordinary uses.
   */
  function assignTarget(
    target: MathJsonExpression | null,
    scope: Scope,
    statementSpan: [number, number] | undefined
  ): void {
    if (target === null) return;
    const head = operator(target);
    if (head === 'Tuple') {
      for (const element of operands(target))
        assignTarget(element, scope, statementSpan);
      return;
    }
    if (head === 'Typed') {
      assignTarget(operand(target, 1), scope, statementSpan);
      return;
    }
    const written = writtenSymbol(target);
    if (written !== undefined) {
      if (visibleBinding(scope, written.name, written.span[0]) !== undefined)
        use(written.name, written.span, scope, 'write');
      else
        bindPattern(
          target,
          scope,
          'variable',
          statementSpan,
          statementSpan?.[1] ?? scope.span[0]
        );
      return;
    }
    walk(target, scope);
  }

  /** The binding `name` resolves to at `offset`, walking outward. */
  function visibleBinding(
    scope: Scope,
    name: string,
    offset: number
  ): BindingGroup | undefined {
    for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) {
      const binding = s.bindings.get(name);
      if (binding !== undefined && offset >= binding.visibleFrom)
        return binding;
    }
    return undefined;
  }

  if (ast !== null) {
    if (operator(ast) === 'Block') {
      const statements = [...operands(ast)];
      hoistFunctions(statements, root);
      for (const statement of statements) walk(statement, root);
    } else {
      hoistFunctions([ast], root);
      walk(ast, root);
    }
  }

  for (const group of groups) {
    group.occurrences.sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        ROLE_RANK[a.role] - ROLE_RANK[b.role]
    );
    // One span is ONE occurrence, the strongest role winning: the parser can
    // record a written name twice (a typed match pattern `x: number`
    // desugars into a pattern variable AND an implicit type-guard `Element`
    // whose operand sits at the same span), and duplicate spans would become
    // overlapping rename edits.
    group.occurrences = group.occurrences.filter(
      (o, i, all) =>
        i === 0 || all[i - 1].start !== o.start || all[i - 1].end !== o.end
    );
  }
  groups.sort(
    (a, b) => (a.occurrences[0]?.start ?? 0) - (b.occurrences[0]?.start ?? 0)
  );
  return groups;
}

/**
 * The group owning the occurrence at `offset`, with the occurrence itself.
 * Half-open like the spans, plus the boundary position just past the name —
 * the same rule the server's hover uses for the cursor.
 */
export function occurrenceAt(
  groups: readonly BindingGroup[],
  offset: number
): { group: BindingGroup; occurrence: Occurrence } | undefined {
  for (const group of groups)
    for (const occurrence of group.occurrences)
      if (occurrence.start <= offset && offset <= occurrence.end)
        return { group, occurrence };
  return undefined;
}

/**
 * Whether some binding of `name` is visible at `offset` — the conflict probe
 * a rename runs before rewriting: a new name that is visible at any renamed
 * occurrence (or already used inside the renamed binding's scope) would
 * change what an occurrence binds to. Over-approximate by design: it answers
 * from scope SPANS, which is exact for declining a rename.
 */
export function isNameVisibleAt(
  groups: readonly BindingGroup[],
  name: string,
  offset: number
): boolean {
  return groups.some(
    (group) =>
      group.name === name &&
      group.kind !== 'free' &&
      offset >= group.visibleFrom &&
      offset >= group.scope[0] &&
      offset < group.scope[1]
  );
}
