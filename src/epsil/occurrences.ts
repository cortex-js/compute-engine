import type { MathJsonExpression } from '../math-json/types.js';
import {
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';
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

/** A variable a call binds, and the operands (by index) it is visible in. */
export type BinderSite = { name: string; operands: 'all' | readonly number[] };

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

/**
 * A stretch of source text that is written in the TYPE grammar, recorded
 * during the walk and resolved after it (see `resolveTypeRegions`). The raw
 * AST holds a type as an opaque STRING (`let p: point` carries
 * `{"str": "point"}`), so the uses of a declared type name inside it are
 * found by lexing the source text the string was read from.
 *
 * `sum` marks the right-hand side of a sum-type declaration
 * (`type shape = circle(point) | square`), where the first name of each
 * alternative is a VARIANT name, not a type.
 */
type TypeRegion = { span: [number, number]; scope: Scope; sum: boolean };

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
 * - `DeclareType` / `DeclareProtocol` bind a type-tier name, visible in its
 *   whole scope. Its USES live in type text — annotations, other type
 *   declarations, protocol member signatures — which the raw AST holds as
 *   opaque strings; they are found by lexing the source that text was read
 *   from, after the walk (`resolveTypeRegions`). A name inside type text
 *   resolves to a TYPE binding only: `(point: point) => point` has one use
 *   of the type, its annotation. The converse does not hold — a nominal
 *   type's constructor function shares the type's name and its group, so a
 *   constructor call `point(1, 2)` is an occurrence of the type.
 * - A named-argument label (`g(a: 2)`) is an occurrence of the parameter it
 *   names when the callee is bound to exactly one function literal
 *   (`resolveLabels`); any other label is left out, and reported by
 *   {@link unresolvedLabels}.
 * - Dictionary keys are not symbol uses; neither is the wildcard `_`.
 */
export function documentBindings(
  ast: MathJsonExpression | null,
  text: string,
  options?: {
    /**
     * The variables a CALL binds among its operands, for an operator that is
     * a binder (`Integrate(x^2, x)` binds `x`; `Sum(k^2, k)` binds `k`). Each
     * entry names one variable and says in which operands (by index) it is
     * visible — `'all'` for the whole call, a list of indices for an
     * iterator clause whose binding is visible only from its own clause
     * onward and in the body. A same-named occurrence in a visible operand
     * resolves to the call, not to an outer binding. Answers `undefined` for
     * a call that binds nothing. The caller supplies this from the engine's
     * binding-site selectors (see `resolve-library-names.ts`); without it, a
     * binder's variable reads as an ordinary use of the enclosing scope,
     * which is the language server's default.
     */
    binderSites?: (
      node: MathJsonExpression
    ) => readonly BinderSite[] | undefined;
  }
): BindingGroup[] {
  const groups: BindingGroup[] = [];
  const freeGroups = new Map<string, BindingGroup>();
  const typeRegions: TypeRegion[] = [];
  // Named-argument labels (`f(x: 3)`), resolved after the walk — see
  // `resolveLabels`. `parametersOf` holds, per function LITERAL node, the
  // bindings of its parameters; `literalsOf` holds, per binding, the
  // literals the document gives it (a `function` definition's clauses, the
  // literal a `let` or an assignment binds).
  const parametersOf = new Map<MathJsonExpression, Map<string, BindingGroup>>();
  const literalsOf = new Map<BindingGroup, MathJsonExpression[]>();
  const labels: {
    callee: string;
    name: string;
    span: [number, number];
    scope: Scope;
  }[] = [];
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

  /** Record the source text of a type STRING node (an annotation, a type
   * declaration's right-hand side) for `resolveTypeRegions`. A node that is
   * not a string, or that carries no span, records nothing. */
  function typeText(node: MathJsonExpression | null, scope: Scope): void {
    if (node === null || stringValue(node) === null) return;
    const span = spanOf(node);
    if (span !== undefined) typeRegions.push({ span, scope, sum: false });
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
   * `Typed(name, "type")` annotation (the type string is recorded as type
   * text, see `resolveTypeRegions`), or
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
      typeText(operand(node, 2), scope);
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
        typeText(operand(node, 2), scope);
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
    // Type-tier names first. A nominal type and its constructor function
    // share one name, and so one group (`ensureBinding` joins a same-scope
    // name); the group's kind is the FIRST binder's. Binding the type first
    // makes that group a `type` whatever the statement order, which is what
    // lets the uses inside type text join it — a `function` group would be
    // passed over by `resolveTypeRegions`, and a rename would leave every
    // annotation behind.
    for (const statement of statements) {
      if (statement === null) continue;
      const head = operator(statement);
      if (
        head === 'DeclareType' ||
        head === 'DeclareSumType' ||
        head === 'DeclareProtocol'
      )
        bindTypeName(statement, scope, false);
    }
    for (const statement of statements)
      if (statement !== null && operator(statement) === 'DefineFunction')
        bindFunctionName(statement, scope, false);
  }

  /** Bind the name a `type` or `protocol` statement declares into `scope`,
   * visible scope-wide. */
  function bindTypeName(
    node: MathJsonExpression,
    scope: Scope,
    withOccurrence: boolean
  ): void {
    const written = writtenSymbol(operand(node, 1));
    if (written === undefined) return;
    const group = ensureBinding(
      scope,
      written.name,
      'type',
      spanOf(node) ?? written.span,
      scope.span[0]
    );
    if (withOccurrence)
      group.occurrences.push({
        start: written.span[0],
        end: written.span[1],
        role: 'definition',
      });
  }

  /** A function literal: parameters bind in the function's own scope; the
   * body — the FIRST operand, though it is written last — is walked inside
   * it. */
  function walkFunction(node: MathJsonExpression, outer: Scope): void {
    const scope = childScope(spanOf(node), outer);
    const ops = [...operands(node)];
    for (let i = 1; i < ops.length; i++)
      bindPattern(ops[i], scope, 'parameter', undefined, scope.span[0]);
    // Copied before the body is walked: a body that is not a block can
    // declare into this scope, and those names are not parameters.
    parametersOf.set(node, new Map(scope.bindings));
    walk(ops[0] ?? null, scope);
  }

  /** Note that the document binds the function literal `literal` to `name`
   * (as visible at `offset`), for `resolveLabels`. */
  function bindsLiteral(
    name: MathJsonExpression | null,
    literal: MathJsonExpression | null,
    scope: Scope,
    offset: number
  ): void {
    const written = writtenSymbol(name);
    if (written === undefined || literal === null) return;
    if (operator(literal) !== 'Function') return;
    const group = visibleBinding(scope, written.name, offset);
    if (group === undefined) return;
    const literals = literalsOf.get(group);
    if (literals === undefined) literalsOf.set(group, [literal]);
    else literals.push(literal);
  }

  /**
   * The parameter names a declaration's SIGNATURE annotation spells are
   * occurrences of the initializer's parameters:
   * `const f: (a: number) -> number = (a) => a` names `a` twice, the parser
   * requires the two spellings to agree (`parameter-name-mismatch`), and a
   * rename that rewrote only the literal's would break the declaration. The
   * names are the labels of the annotation's FIRST parameter list, at its
   * own depth — a label deeper in (`(f: (a: number) -> number) -> …`) names
   * a parameter of a callback type, not of this literal.
   */
  function signatureParameterNames(
    annotation: MathJsonExpression | null,
    literal: MathJsonExpression | null
  ): void {
    if (annotation === null || stringValue(annotation) === null) return;
    const parameters = literal === null ? undefined : parametersOf.get(literal);
    const span = spanOf(annotation);
    if (parameters === undefined || span === undefined) return;
    const tokens = tokenize(text.slice(span[0], span[1])).filter(
      (t) => t.type !== 'EOF'
    );
    let depth = 0;
    let listSeen = false;
    for (let i = 0; i < tokens.length - 1; i++) {
      const token = tokens[i];
      if (token.type === 'OPEN_PAREN') {
        depth += 1;
        if (depth === 1 && listSeen) return;
        listSeen = true;
      } else if (token.type === 'CLOSE_PAREN') {
        depth -= 1;
        if (depth === 0) return;
      } else if (
        depth === 1 &&
        (token.type === 'SYMBOL' || token.type === 'VERBATIM_SYMBOL') &&
        tokens[i + 1].type === 'OPERATOR' &&
        tokens[i + 1].text === ':'
      )
        parameters.get(token.value ?? token.text)?.occurrences.push({
          start: span[0] + token.start,
          end: span[0] + token.end,
          role: 'read',
        });
    }
  }

  /** The initializer of a `let`/`const`: the parser puts it in the trailing
   * attributes dictionary, under the key `value`. */
  function initializerOf(node: MathJsonExpression): MathJsonExpression | null {
    const ops = [...operands(node)];
    const attributes = ops[ops.length - 1] ?? null;
    if (attributes === null || operator(attributes) !== 'Dictionary')
      return null;
    for (const entry of operands(attributes))
      if (
        operator(entry) === 'KeyValuePair' &&
        symbol(operand(entry, 1) ?? 'Nothing') === 'value'
      )
        return operand(entry, 2);
    return null;
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
        for (let i = 1; i < ops.length; i++) {
          // A direct STRING operand is the type annotation: the parser puts
          // the initializer — a string literal included — inside the
          // trailing attributes dictionary, never here.
          typeText(ops[i], scope);
          walk(ops[i], scope);
        }
        const statementSpan = spanOf(node);
        bindPattern(
          ops[0] ?? null,
          scope,
          'variable',
          statementSpan,
          statementSpan?.[1] ?? scope.span[0]
        );
        bindsLiteral(
          ops[0] ?? null,
          initializerOf(node),
          scope,
          statementSpan?.[1] ?? scope.span[0]
        );
        for (let i = 1; i < ops.length; i++)
          signatureParameterNames(ops[i], initializerOf(node));
        return;
      }

      case 'Assign': {
        const ops = [...operands(node)];
        for (let i = 1; i < ops.length; i++) walk(ops[i], scope);
        const statementSpan = spanOf(node);
        assignTarget(ops[0] ?? null, scope, statementSpan);
        bindsLiteral(
          ops[0] ?? null,
          ops[1] ?? null,
          scope,
          statementSpan?.[1] ?? scope.span[0]
        );
        return;
      }

      case 'DefineFunction': {
        bindFunctionName(node, scope, true);
        const fn = operand(node, 2);
        // The header — everything between the function's name and its body
        // — is written in the type grammar wherever it is not a parameter
        // name: parameter annotations, the result type, a generic clause
        // (`<T>`) and a `where T is Comparable` constraint, which no string
        // node of the AST spans. Parameter names are told apart in
        // `resolveTypeRegions`.
        const nameSpan = spanOf(operand(node, 1));
        const bodySpan =
          fn !== null && operator(fn) === 'Function'
            ? spanOf(operand(fn, 1))
            : undefined;
        if (
          nameSpan !== undefined &&
          bodySpan !== undefined &&
          nameSpan[1] < bodySpan[0]
        )
          typeRegions.push({
            span: [nameSpan[1], bodySpan[0]],
            scope,
            sum: false,
          });
        if (fn !== null && operator(fn) === 'Function') walkFunction(fn, scope);
        else walk(fn, scope);
        bindsLiteral(
          operand(node, 1),
          fn,
          scope,
          nameSpan?.[0] ?? scope.span[0]
        );
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
        // The declared name is a symbol; every USE of a type name lives
        // inside type text — annotations, the declaration's own right-hand
        // side, member signatures — resolved by `resolveTypeRegions`. The
        // remaining operands hold no written symbols and are not walked.
        bindTypeName(node, scope, true);
        const statementSpan = spanOf(node);
        const declaredName = spanOf(operand(node, 1));
        if (head !== 'DeclareProtocol') {
          // The region runs from the end of the declared name to the end of
          // the statement, so that it takes in a generic clause
          // (`type box<T> = tuple<T, T>`) as well as the right-hand side. A
          // sum type's variant payload strings borrow the whole statement's
          // span, so its region cannot be built from them anyway.
          if (
            statementSpan !== undefined &&
            declaredName !== undefined &&
            declaredName[1] < statementSpan[1]
          )
            typeRegions.push({
              span: [declaredName[1], statementSpan[1]],
              scope,
              sum: head === 'DeclareSumType',
            });
        } else
          // A protocol's members: `name: Pair("function", "⟨signature⟩")`.
          for (const member of operands(operand(node, 2) ?? 'Nothing'))
            if (operator(member) === 'KeyValuePair')
              typeText(operand(operand(member, 2), 2), scope);
        return;
      }

      case 'DeclareConformance': {
        // `type point is Comparable { … }`: the conforming type is a type
        // STRING; the protocols are symbols and the implementations are
        // function literals, walked as usual.
        typeText(operand(node, 1), scope);
        const ops = [...operands(node)];
        for (let i = 1; i < ops.length; i++) walk(ops[i], scope);
        return;
      }

      case 'TypeFrom': {
        // The type operand of a type test (`v is point`, a typed `match`
        // pattern).
        typeText(operand(node, 1), scope);
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
        // The annotation (operand 2) is a STRING naming a type: the
        // annotated expression is walked, the annotation is type text.
        walk(operand(node, 1), scope);
        typeText(operand(node, 2), scope);
        return;
      }

      default: {
        // A CALL carries its callee as the operator — a plain string with no
        // span of its own (`fib(n - 1)` is `["fib", …]`); the node's span
        // starts at the callee, so the name is recovered by spelling it
        // there. Structural heads (`Add` for `x + y`, `If` for `if …`) never
        // spell their span's start and contribute nothing. A head can also
        // be an EXPRESSION (`(f)(x)`), which is walked like any operand.
        if (typeof head === 'string') {
          useHead(node, head, scope);
          for (const op of operands(node)) {
            if (operator(op) !== 'NamedArgument') continue;
            const label = operand(op, 1);
            const name = label === null ? null : stringValue(label);
            const labelSpan = spanOf(label);
            if (
              name !== null &&
              labelSpan !== undefined &&
              spelled(name, labelSpan)
            )
              labels.push({ callee: head, name, span: labelSpan, scope });
          }
        } else walk(head as MathJsonExpression, scope);
        // A binder call (`integrate(x^2, x)`) binds its variables for the
        // whole call, in a scope of its own — but only when the callee is not
        // a name this program binds: a user function that happens to share
        // a binder's name is an ordinary call. The names are read before any
        // operand is walked, since the bound variable may appear before the
        // operand that declares it.
        const span = spanOf(node);
        const bound =
          typeof head === 'string' &&
          options?.binderSites !== undefined &&
          visibleBinding(scope, head, span?.[0] ?? scope.span[0]) === undefined
            ? options.binderSites(node)
            : undefined;
        if (bound !== undefined && bound.length > 0) {
          // One group per variable, shared by every operand scope it is
          // visible in, so a rename edits all of its occurrences together.
          const shared = new Map<string, BindingGroup>();
          [...operands(node)].forEach((op, i) => {
            const visible = bound.filter(
              (site) => site.operands === 'all' || site.operands.includes(i)
            );
            if (visible.length === 0) {
              walk(op, scope);
              return;
            }
            const inner = childScope(span, scope);
            for (const site of visible) {
              const group = shared.get(site.name);
              if (group === undefined)
                shared.set(
                  site.name,
                  ensureBinding(
                    inner,
                    site.name,
                    'parameter',
                    undefined,
                    inner.span[0]
                  )
                );
              else inner.bindings.set(site.name, group);
            }
            walk(op, inner);
          });
          return;
        }
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
      typeText(operand(target, 2), scope);
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

  /**
   * Record the uses of declared type names inside the type text collected
   * during the walk. Each region's SOURCE text is lexed with the language's
   * own lexer — the type grammar shares its tokens — and a name token is a
   * use of a type when:
   *
   * - it is not a LABEL: a name followed by `:` names a tuple field, a
   *   record key or a signature parameter (`tuple<x: number>`,
   *   `(self: Self) -> …`, the `p` of a typed pattern `p: point`);
   * - in a sum-type declaration, it is not a VARIANT name: the first name of
   *   each `|` alternative, outside any bracket;
   * - its span is not already a symbol occurrence (a function header region
   *   contains the parameter names, which the walk bound);
   * - it is not a TYPE VARIABLE of the region: a region that opens with a
   *   generic clause (`<T>(xs: list<T>) -> T`, `<T> = tuple<T, T>`) declares
   *   the names in the clause, and a declared type that happens to share one
   *   of them is a different thing;
   * - it resolves to a `type` binding of this document. Types and values
   *   are separate namespaces, so a same-named VALUE binding on the way out
   *   (the parameter of `(point: point) => …`) does not end the search. A
   *   builtin type name (`number`, `list`) and the words `where` and `is`
   *   resolve to none and are left alone — they never become free groups,
   *   since nothing in this file could be renamed with them.
   *
   * Runs after the walk so that every binding exists and every symbol
   * occurrence is known.
   */
  function resolveTypeRegions(): void {
    /** How a token changes the bracket depth of type text: `()`, `[]`, `{}`
     * and the angle brackets of a type application all nest. The lexer may
     * glue a closing angle bracket to what follows it (`>>`, `>^`, `>?`), so
     * the angle brackets are counted inside the operator's text — except in
     * the arrows `->` and `=>`, whose `>` is not a bracket. */
    const nesting = (token: { type: string; text: string }): number => {
      switch (token.type) {
        case 'OPEN_PAREN':
        case 'OPEN_BRACKET':
        case 'OPEN_BRACE':
          return 1;
        case 'CLOSE_PAREN':
        case 'CLOSE_BRACKET':
        case 'CLOSE_BRACE':
          return -1;
        case 'OPERATOR': {
          if (token.text === '->' || token.text === '=>') return 0;
          let delta = 0;
          for (const c of token.text)
            if (c === '<') delta += 1;
            else if (c === '>') delta -= 1;
          return delta;
        }
        default:
          return 0;
      }
    };

    const occupied = new Set<number>();
    for (const group of groups)
      for (const o of group.occurrences) occupied.add(o.start);

    for (const region of typeRegions) {
      const [from, to] = region.span;
      if (from < 0 || to > text.length || from >= to) continue;
      const tokens = tokenize(text.slice(from, to)).filter(
        (t) => t.type !== 'EOF'
      );
      // The region's type variables. A leading generic clause declares the
      // name that OPENS each of its comma-separated entries
      // (`<T: point, U>` declares `T` and `U`; the bound `point` is a use of
      // a type); a `where` clause declares the name each of its constraints
      // opens with (`where T is Located, U is Comparable`), which is the
      // only place a function written without a generic clause declares
      // them. Brackets nest, so the `>` that ends the clause is the one that
      // returns to depth zero, not the first one (`<T: list<point>, U>`).
      const typeVariables = new Set<string>();
      const isName = (t: (typeof tokens)[number] | undefined): boolean =>
        t?.type === 'SYMBOL' || t?.type === 'VERBATIM_SYMBOL';
      if (tokens[0]?.type === 'OPERATOR' && tokens[0].text === '<') {
        let clauseDepth = 0;
        for (let i = 0; i < tokens.length; i++) {
          const before = clauseDepth;
          clauseDepth += nesting(tokens[i]);
          if (i > 0 && clauseDepth <= 0) break;
          const opensEntry =
            i > 0 &&
            before === 1 &&
            (i === 1 || tokens[i - 1].type === 'COMMA') &&
            isName(tokens[i]);
          if (opensEntry) typeVariables.add(tokens[i].value ?? tokens[i].text);
        }
      }
      const where = tokens.findIndex(
        (t) => t.type === 'SYMBOL' && t.text === 'where'
      );
      if (where >= 0)
        for (let i = where; i < tokens.length - 1; i++)
          if (
            (i === where || tokens[i].type === 'COMMA') &&
            isName(tokens[i + 1])
          )
            typeVariables.add(tokens[i + 1].value ?? tokens[i + 1].text);
      // In a sum declaration the first name after the `=` is the first
      // alternative's variant name.
      let started = !region.sum;
      let variantNext = region.sum;
      let depth = 0;
      tokens.forEach((token, i) => {
        depth += nesting(token);
        if (token.type === 'OPERATOR') {
          if (!started) started = token.text === '=';
          else if (region.sum && depth === 0 && token.text === '|')
            variantNext = true;
          return;
        }
        if (token.type !== 'SYMBOL' && token.type !== 'VERBATIM_SYMBOL') return;
        if (!started) return;
        if (variantNext && depth === 0) {
          variantNext = false;
          return;
        }
        const next = tokens[i + 1];
        if (next?.type === 'OPERATOR' && next.text === ':') return;
        const start = from + token.start;
        if (occupied.has(start)) return;
        const name = token.value ?? token.text;
        if (typeVariables.has(name)) return;
        for (
          let s: Scope | undefined = region.scope;
          s !== undefined;
          s = s.parent
        ) {
          const binding = s.bindings.get(name);
          if (binding === undefined || binding.kind !== 'type') continue;
          binding.occurrences.push({
            start,
            end: from + token.end,
            role: 'read',
          });
          occupied.add(start);
          break;
        }
      });
    }
  }

  /**
   * Record each named-argument label as an occurrence of the parameter it
   * names, so that renaming the parameter rewrites the label with it:
   * `g(a: 2)` binds by the parameter's NAME, and a rename that left the label
   * behind would break the call.
   *
   * A label is resolved only when what it names is certain: the callee is a
   * name this document binds, to exactly ONE function literal, and never
   * writes again — a `function` definition with a single clause, or a
   * `let`/`const`/first assignment of a literal. A multi-clause definition
   * has one parameter list per clause and a reassigned name may hold another
   * function by the time of the call, so their labels stay unresolved, as
   * do the labels of a library or undeclared callee. The language server
   * refuses to rename a parameter while an unresolved label spells its
   * name (`unresolvedLabels`).
   *
   * Runs after the walk: a call may precede the definition of its callee.
   */
  function resolveLabels(): void {
    const candidates = new Map<number, readonly BindingGroup[] | 'any'>();
    for (const label of labels) {
      const callee = visibleBinding(label.scope, label.callee, label.span[0]);
      // A callee this document does not bind (a library or undeclared
      // function) has no parameter here for the label to name.
      if (callee === undefined) {
        candidates.set(label.span[0], []);
        continue;
      }
      const literals = literalsOf.get(callee) ?? [];
      const bindingWrites = callee.occurrences.filter(
        (o) => o.role !== 'read'
      ).length;
      const named = literals.flatMap((literal) => {
        const parameter = parametersOf.get(literal)?.get(label.name);
        return parameter === undefined ? [] : [parameter];
      });
      if (literals.length === 1 && bindingWrites === 1) {
        if (named.length === 1)
          named[0].occurrences.push({
            start: label.span[0],
            end: label.span[1],
            role: 'read',
          });
        else candidates.set(label.span[0], []);
        continue;
      }
      // Several literals: the label names a parameter of one of them. A
      // binding with a write that is not a literal (an alias `f = h`, a
      // parameter that receives a function) may hold any function.
      candidates.set(
        label.span[0],
        literals.length > 0 && bindingWrites === literals.length ? named : 'any'
      );
    }
    LABEL_CANDIDATES.set(groups, candidates);
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
    resolveLabels();
    resolveTypeRegions();
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

/** For the groups array a {@link documentBindings} call returned: per
 * unresolved label (keyed by its start offset), the parameters it could
 * name. Read by {@link unresolvedLabels}. */
const LABEL_CANDIDATES = new WeakMap<
  readonly BindingGroup[],
  Map<number, readonly BindingGroup[] | 'any'>
>();

/** A named-argument label that was not resolved to one parameter, with the
 * parameters it COULD name: those of the same spelling among the callee's
 * function literals, or `'any'` when the callee may hold a function this
 * analysis cannot see (an alias, a parameter, a callee that is not a plain
 * name). An empty list means the label names no parameter of this document
 * (a library or undeclared callee). */
export type UnresolvedLabel = {
  name: string;
  start: number;
  end: number;
  candidates: readonly BindingGroup[] | 'any';
};

/**
 * The named-argument labels in `ast` (`f(x: 3)` has one, at `x`) that
 * {@link documentBindings} — which must have produced `groups` — did NOT
 * resolve to a parameter. A rename of a parameter must be refused while one
 * of them could name it: the label would not be rewritten. The AST is walked
 * here, independently of the resolver, so that a label the resolver never
 * saw is still reported — as one that could name any parameter.
 */
export function unresolvedLabels(
  ast: MathJsonExpression | null,
  groups: readonly BindingGroup[]
): UnresolvedLabel[] {
  const resolved = new Set<number>();
  for (const group of groups)
    if (group.kind === 'parameter')
      for (const o of group.occurrences) resolved.add(o.start);
  const candidates = LABEL_CANDIDATES.get(groups);

  const result: UnresolvedLabel[] = [];
  const visit = (node: MathJsonExpression | null): void => {
    if (node === null || typeof node !== 'object') return;
    if (operator(node) === 'NamedArgument') {
      const label = operand(node, 1);
      const name = label === null ? null : stringValue(label);
      const span =
        label !== null && typeof label === 'object' && !Array.isArray(label)
          ? (label as { sourceOffsets?: [number, number] }).sourceOffsets
          : undefined;
      if (name !== null && (span === undefined || !resolved.has(span[0])))
        result.push({
          name,
          start: span?.[0] ?? -1,
          end: span?.[1] ?? -1,
          candidates:
            (span === undefined ? undefined : candidates?.get(span[0])) ??
            'any',
        });
    }
    const head = operator(node);
    if (typeof head === 'object') visit(head as MathJsonExpression);
    for (const op of operands(node)) visit(op);
  };
  visit(ast);
  return result;
}
