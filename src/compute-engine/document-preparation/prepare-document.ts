import { checkDeadline, isThenable } from '../../common/interruptible.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import { typeToString } from '../../common/type/serialize.js';
import type {
  BoxedValueDefinition,
  Expression,
  IComputeEngine,
  InspectableScope,
  Scope,
} from '../global-types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { operands, operator, symbol } from '../../math-json/utils.js';
import { LatexSyntax } from '../latex-syntax/latex-syntax.js';
import type { ParseLatexOptions } from '../latex-syntax/types.js';
import { tokenize } from '../latex-syntax/tokenizer.js';
import type { DiscardedComment } from '../latex-syntax/tokenizer.js';
import {
  signatureEffects,
  withArrowEffects,
} from '../boxed-expression/effects-inference.js';
import {
  preparedContractDeclaration,
  widenLocalType,
} from '../boxed-expression/boxed-value-definition.js';
import { sealPreparedNamespace } from '../boxed-expression/prepared-import-binding.js';
import { oneElementTypeOf } from '../boxed-expression/box.js';
import { draftReferences } from '../boxed-expression/abstract-boxed-expression.js';
import {
  preparedCalls,
  provisionalLiteral,
} from '../boxed-expression/provisional-application.js';
import { demandComponents } from './demand-components.js';
import { makePreparedValuePass } from './value-pass.js';
import { isLibraryDefinition } from '../boxed-expression/implicit-variable-rule.js';

type Head = { name: string; params: readonly string[] };
type Role = 'function' | 'value';
type Recognition = { role: Role; head: Head };
type Source = { head: string; body: string };
export type DocumentSourceRow = {
  id: string;
  latex: string;
  formalTypes?: Readonly<Record<string, string>>;
  resultType?: string;
  valueType?: string;
  effects?: 'pure' | 'random';
};
export interface PreparedDocumentDefinition {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly params: readonly string[];
  readonly rawBody: MathJsonExpression;
  readonly body: Expression;
  readonly references: readonly string[];
  readonly fieldParameters?: readonly string[];
}

export interface PreparedDocumentValuePass {
  /** Run a synchronous read. Several calls share the same samples within
   * a redraw. Create a new pass after writing any inputs. A callback that
   * returns a promise or thenable is refused. */
  run<T>(evaluate: () => T): T;
  retain(name: string, view: Expression, result: Expression): void;
}

export interface PreparedDocumentRevision {
  /**
   * Scope for prepared reads and writes to declared input or writable row
   * values. Treat the binding map as read-only. Edit the source and prepare
   * a new revision to change definitions.
   */
  readonly scope: InspectableScope;
  readonly rawRows: ReadonlyMap<string, MathJsonExpression>;
  readonly rowReferences: ReadonlyMap<string, readonly string[]>;
  readonly rowErrors: ReadonlyMap<string, Expression>;
  readonly definitions: readonly PreparedDocumentDefinition[];
  /** Start after input writes. Use this pass only for the current redraw. */
  createValuePass(names: ReadonlySet<string>): PreparedDocumentValuePass;
  collectionWriteError(name: string, value: Expression): string | undefined;
  /** Close revision operations and release its import lease. */
  dispose(): void;
}

type DraftRow = DocumentSourceRow & { role: 'formula' | Role };
export interface DocumentSyntax {
  split(source: string): Source | undefined;
  /** `raw`, when present, is the definition entry from the fast definition
   * path after `normalize()`. Its head is the parse candidate form and does
   * not go through `resolveApplication`: `f(x)` arrives as
   * `["InvisibleOperator", "f", ["Delimiter", "x"]]`. */
  recognize(
    row: DocumentSourceRow,
    names: ReadonlyMap<string, unknown>,
    raw?: MathJsonExpression
  ):
    | (Recognition & {
        body?: string;
        rawEntry?: MathJsonExpression;
        bodyJson?: MathJsonExpression;
      })
    | undefined;
  normalize(raw: MathJsonExpression): MathJsonExpression;
  lowerBody?(
    body: MathJsonExpression,
    row: DocumentSourceRow
  ): MathJsonExpression;
  resolveApplication?: ParseLatexOptions['resolveApplication'];
  fieldAxes?: ReadonlySet<string>;
  /** Names in the import scope that take precedence over row declarations. */
  reservedImportNames?: ReadonlySet<string>;
  ownValueSubscripts?: 'real';
  /** The host treats a formal followed by parentheses as a factor unless
   * its written type is callable. */
  formalsAreFactors?: boolean;
}
function sameHead(
  expected: Recognition,
  actual: Recognition | undefined
): boolean {
  return (
    actual !== undefined &&
    actual.role === expected.role &&
    actual.head.name === expected.head.name &&
    actual.head.params.length === expected.head.params.length &&
    actual.head.params.every((name, i) => name === expected.head.params[i])
  );
}
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function lex(source: string, numberLexemes = new Map<string, string[]>()) {
  const inputText = new Map<number, string>();
  const tildes = new Set<number>();
  const comments: DiscardedComment[] = [];
  return {
    tokens: tokenize(source, [], comments, inputText, tildes),
    inputText,
    tildes,
    comments,
    numberLexemes,
  };
}
function hasRowBoundary(source: string): boolean {
  const directionalFence =
    /\\(left|right)(?![A-Za-z])\s*(?:\\(?:[A-Za-z]+|.)|.)?/y;
  let depth = 0,
    braces = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      directionalFence.lastIndex = i;
      const fence = directionalFence.exec(source);
      if (fence) {
        depth += fence[1] === 'left' ? 1 : -1;
        i += fence[0].length - 1;
      } else {
        if (
          depth === 0 &&
          /^\\(?:coloneqq?|colon=)(?![A-Za-z])/.test(source.slice(i))
        )
          return true;
        i++;
      }
      continue;
    }
    // Bare TeX braces can be transparent to the expression parser.
    // Keep their balance, but do not let them hide an ambiguous separator.
    if (c === '{') braces++;
    if (c === '}') braces--;
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    // A dotted member can change the assignment tree in the full parser.
    if (depth === 0 && c === '.' && /[A-Za-z\\]/.test(source[i + 1] ?? ''))
      return true;
    if (
      c === '%' ||
      braces < 0 ||
      depth < 0 ||
      (depth === 0 && (c === ',' || c === ';' || c === '='))
    )
      return true;
  }
  return depth !== 0 || braces !== 0;
}

type DefinitionRow = { row: DraftRow; head: Head };

/**
 * A proof of the outer list kind for a recursive component. Each return arm
 * must have a list-producing constructor. A recursive edge may supply a
 * spread operand only when it is a saturated, unshadowed call in the same
 * component. The component is checked under the resulting contracts once.
 */
function hasListReturn(
  expr: MathJsonExpression,
  arities: ReadonlyMap<string, number>,
  formals: ReadonlySet<string>,
  isBuiltin: (name: string) => boolean
): boolean {
  const terms: { expr: MathJsonExpression; allowComponentCall: boolean }[] = [
    { expr, allowComponentCall: false },
  ];
  while (terms.length > 0) {
    const term = terms.pop()!;
    const head = operator(term.expr);
    if (!head || formals.has(head)) return false;
    const args = operands(term.expr);
    if (
      term.allowComponentCall &&
      arities.get(head) === args.length &&
      args.every(
        (arg) => operator(arg) !== 'Spread' && operator(arg) !== 'Sequence'
      )
    )
      continue;
    if (!isBuiltin(head)) return false;
    if (head === 'List') {
      // A spread can make the whole list absent. A matrix layout can
      // canonicalize to a different constructor.
      if (
        args.some(
          (arg) => operator(arg) === 'Spread' || operator(arg) === 'Matrix'
        )
      )
        return false;
      continue;
    }
    if (head === 'ListJoin') {
      for (const arg of args)
        terms.push({ expr: arg, allowComponentCall: true });
      continue;
    }
    if (
      head === 'Which' &&
      args.length >= 2 &&
      args.length % 2 === 0 &&
      symbol(args[args.length - 2]) === 'True' &&
      !formals.has('True') &&
      isBuiltin('True')
    ) {
      for (let i = 1; i < args.length; i += 2)
        terms.push({ expr: args[i], allowComponentCall: false });
      continue;
    }
    return false;
  }
  return true;
}

export function prepareDocument(
  ce: IComputeEngine,
  parent: Scope,
  input: readonly DocumentSourceRow[],
  syntax: DocumentSyntax,
  writableNames?: ReadonlySet<string>,
  releaseImports?: () => void
): PreparedDocumentRevision {
  const ids = new Set<string>();
  const rows: DraftRow[] = input.map((row) => {
    if (ids.has(row.id))
      throw new Error('Duplicate Document row ID: ' + row.id);
    ids.add(row.id);
    return { ...row, role: 'formula' };
  });
  const writableSlots =
    writableNames === undefined ? undefined : new Set(writableNames);
  const parseOptions = ce.latexOptions;
  const instance = ce.latexSyntax;
  if (!(instance instanceof LatexSyntax))
    throw new Error('Document needs the CE LaTeX parser');
  const latex = instance;
  const scope = ce.createScope({}, parent);
  const callPhase = { preparing: true };
  try {
    return ce._inScope(scope, () => {
      const numberLexemes = new Map<string, string[]>();
      const sources = new Map(rows.map((row) => [row.id, row.latex]));
      const declarations = new Map<string, DefinitionRow>();
      const cursors = new Map<string, () => MathJsonExpression>();
      const parsed = new Map<string, MathJsonExpression>();
      const rawRows = new Map<string, MathJsonExpression>();
      const bodies = new Map<string, ReturnType<typeof ce.box>>();
      const fieldParameters = new Map<string, readonly string[]>();
      const rowReferences = new Map<string, readonly string[]>();
      const rowErrors = new Map<string, Expression>();

      function rowOptions(
        row: DraftRow,
        inBody: () => boolean,
        formals: () => readonly string[]
      ) {
        return {
          ...parseOptions,
          resolveApplication: syntax.resolveApplication,
          _prepareIndexedBase: (name: string) => {
            if (!inBody() || formals().includes(name)) return;
            const declaration = declarations.get(name);
            if (declaration?.row.role !== 'value' || bodies.has(name)) return;
            // With this document dialect, an atomic subscript in the base's
            // own initializer is a name. Explicit indexing still reads the base.
            if (
              syntax.ownValueSubscripts !== undefined &&
              declaration.row === row
            )
              return;
            graph.prepare(name);
            if (!bodies.has(name))
              throw new Error(
                'Indexed base needs unfinished declaration: ' + name
              );
          },
          resolveSymbol: (name: string) => {
            if (inBody() && formals().includes(name))
              return { type: row.formalTypes?.[name] ?? 'unknown' };
            const declaration = declarations.get(name);
            if (!inBody() || declaration === undefined || bodies.has(name))
              return (
                ce._resolveSymbolFromScope(name) ??
                parseOptions.resolveSymbol?.(name)
              );
            return {
              type: declaration.row.role === 'function' ? 'function' : 'value',
            };
          },
          isLibraryFunction: (name: string) =>
            !formals().includes(name) && ce._isLibraryFunction(name),
        };
      }

      for (const row of rows) {
        checkDeadline(ce._deadlineFrame);
        const proposed = syntax.split(row.latex);
        if (proposed === undefined) continue;
        let recognized: Recognition | undefined;
        if (
          proposed.body &&
          !hasRowBoundary(proposed.head) &&
          !hasRowBoundary(proposed.body)
        ) {
          let active = false;
          let params: readonly string[] = [];
          const state = latex._startDefinitionRow(
            lex(row.latex, numberLexemes),
            rowOptions(
              row,
              () => active,
              () => params
            )
          );
          if (state !== undefined) {
            const initial = syntax.recognize(
              row,
              declarations,
              syntax.normalize([state.operator, state.head, 0])
            );
            if (initial !== undefined) {
              recognized = initial;
              params = initial.head.params;
              cursors.set(row.id, () => {
                active = true;
                const body = state.finish(
                  new Map(
                    params.map((param) => [
                      param,
                      row.formalTypes?.[param] ?? 'unknown',
                    ])
                  ),
                  syntax.formalsAreFactors
                );
                invariant(body !== null, 'Empty definition body: ' + row.id);
                const entry = syntax.normalize([
                  state.operator,
                  state.head,
                  body,
                ]);
                const confirmed = syntax.recognize(row, declarations, entry);
                invariant(
                  sameHead(initial, confirmed),
                  'Definition head changed: ' + row.id
                );
                rawRows.set(row.id, entry);
                return syntax.normalize(body);
              });
            }
          }
        } else {
          const fallback = syntax.recognize(row, declarations);
          if (fallback !== undefined) {
            recognized = fallback;
            sources.set(row.id, fallback.body ?? proposed.body);
            if (fallback.rawEntry !== undefined)
              rawRows.set(row.id, fallback.rawEntry);
            if (fallback.bodyJson !== undefined)
              parsed.set(
                row.id,
                syntax.lowerBody?.(fallback.bodyJson, row) ?? fallback.bodyJson
              );
          }
        }
        if (recognized === undefined) continue;
        const head = recognized.head;
        if (
          declarations.has(head.name) ||
          syntax.reservedImportNames?.has(head.name)
        ) {
          const diagnostic = ce.error(['variable-redeclaration', head.name]);
          rowErrors.set(row.id, diagnostic);
          // Keep the first binding. The rejected row still occupies its own
          // position in the prepared result.
          cursors.delete(row.id);
          rawRows.set(row.id, diagnostic.json);
          parsed.set(row.id, diagnostic.json);
          continue;
        }
        row.role = recognized.role;
        declarations.set(head.name, { row, head });
      }

      function readRow(row: DraftRow, params: readonly string[] = []) {
        checkDeadline(ce._deadlineFrame);
        if (parsed.has(row.id)) return parsed.get(row.id)!;
        const source = sources.get(row.id)!;
        const resume = cursors.get(row.id);
        cursors.delete(row.id);
        let raw: MathJsonExpression;
        if (resume !== undefined) raw = resume();
        else {
          const options = {
            ...rowOptions(
              row,
              () => true,
              () => params
            ),
            _preparedTokens: lex(source, numberLexemes),
          };
          const parsedSource = latex.parse(source, options);
          invariant(parsedSource !== null, 'Empty formula: ' + row.id);
          raw = syntax.normalize(parsedSource);
        }
        raw = syntax.lowerBody?.(raw, row) ?? raw;
        if (row.role === 'formula') rawRows.set(row.id, raw);
        parsed.set(row.id, raw);
        return raw;
      }

      // An accepted head shadows the inherited axis of the same spelling.
      const fieldAxes = new Set(
        [...(syntax.fieldAxes ?? [])].filter((name) => !declarations.has(name))
      );
      const references = new Map<string, readonly string[]>();
      const names = {
        values: new Set([
          ...declarations.keys(),
          ...(writableSlots ?? []),
          ...fieldAxes,
        ]),
        callables: new Set(
          [...declarations]
            .filter(([, item]) => item.row.role === 'function')
            .map(([name]) => name)
        ),
      };
      function rawReferences(expression: MathJsonExpression) {
        return draftReferences(ce.box(expression, { form: 'raw' }), names);
      }

      function formals(
        parameters: readonly string[],
        row: DraftRow,
        fixed: boolean
      ) {
        return parameters.map((param): MathJsonExpression => {
          const type =
            row.formalTypes?.[param] ?? (fixed ? 'unknown' : undefined);
          return type === undefined
            ? param
            : ['Typed', param, "'" + type + "'"];
        });
      }

      function installClosedType(
        name: string,
        type: string | ReturnType<typeof ce.type>,
        statedEffects: boolean
      ) {
        const definition = {
          type,
          effectsDeclared: statedEffects,
          [preparedContractDeclaration]: true as const,
        };
        ce._declareSymbolValue(name, definition, scope);
        const binding = scope.bindings.get(name);
        invariant(
          binding && 'value' in binding,
          'Expected a value binding: ' + name
        );
        return binding;
      }
      function rejectComponent(
        group: readonly string[],
        failed: string,
        invalid: Expression
      ) {
        const error =
          invalid.errors[0] ?? ce.error('invalid-document-definition');
        for (const name of group) {
          const { row, head } = declarations.get(name)!;
          const diagnostic =
            name === failed
              ? error
              : ce.error(['invalid-document-dependency', failed]);
          // A recursive component may have unpublished signature slots.
          // Keep its names in this scope so readers cannot see outer bindings.
          scope.bindings.delete(name);
          if (row.role === 'function') {
            const parameters = head.params.map(() => 'unknown');
            ce.declare(name, {
              signature: '(' + parameters.join(', ') + ') -> error',
              evaluate: () => diagnostic,
            });
          } else {
            ce.declare(name, { type: 'error', value: diagnostic });
          }
          rowErrors.set(row.id, diagnostic);
          bodies.set(name, diagnostic);
        }
      }
      const graph = demandComponents(
        (name) => {
          const { row, head } = declarations.get(name)!;
          const rhs = readRow(row, head.params);
          const expression: MathJsonExpression =
            row.role === 'function' ? ['Function', rhs, ...head.params] : rhs;
          const refs = rawReferences(expression);
          if (row.role === 'value' && syntax.ownValueSubscripts !== undefined) {
            const prefix = name + '_';
            for (const reference of refs) {
              if (
                !reference.startsWith(prefix) ||
                reference.length === prefix.length
              )
                continue;
              if (
                declarations.has(reference) ||
                ce.lookupDefinition(reference) !== undefined
              )
                continue;
              installClosedType(reference, syntax.ownValueSubscripts, false);
            }
          }
          references.set(name, refs);
          return refs.filter((ref) => declarations.has(ref));
        },
        (group, cyclic) => {
          for (const name of group) {
            const invalid = references.get(name)!.find((ref) => {
              const declaration = declarations.get(ref);
              return (
                declaration !== undefined && rowErrors.has(declaration.row.id)
              );
            });
            if (invalid !== undefined)
              return rejectComponent(
                group,
                name,
                ce.error(['invalid-document-dependency', invalid])
              );
          }
          const first = declarations.get(group[0])!;
          const groupHasValue = group.some(
            (name) => declarations.get(name)!.row.role === 'value'
          );
          if (cyclic && groupHasValue) {
            const diagnostic = ce.error(
              'Value initialization cycle: ' + group.join(', ')
            );
            return rejectComponent(group, group[0], diagnostic);
          }
          if (groupHasValue) {
            const axes = new Set<string>();
            if (fieldAxes.size > 0 && !writableSlots?.has(group[0])) {
              for (const ref of references.get(group[0])!) {
                if (fieldAxes.has(ref)) axes.add(ref);
                const binding = scope.bindings.get(ref);
                const macro =
                  binding !== undefined && 'value' in binding
                    ? binding.value.macro
                    : undefined;
                if (Array.isArray(macro))
                  for (const operand of macro.slice(1)) {
                    if (typeof operand === 'string' && fieldAxes.has(operand))
                      axes.add(operand);
                  }
              }
            }
            if (axes.size > 0) {
              const name = group[0];
              const body = parsed.get(first.row.id)!;
              const parameters = [...fieldAxes].filter((axis) =>
                axes.has(axis)
              );
              const helper = ce.temporaryName(
                'cePreparedField',
                names.values,
                names.callables
              );
              const literal = ce.box([
                'Function',
                body,
                ...parameters.map((axis): MathJsonExpression => [
                  'Typed',
                  axis,
                  "'real'",
                ]),
              ]);
              if (!literal.isValid)
                return rejectComponent(group, name, literal);
              const field = literal.type.type;
              if (
                first.row.valueType !== undefined &&
                typeof field === 'object' &&
                field.kind === 'signature' &&
                !ce.type(field.result).matches(first.row.valueType)
              )
                throw new Error(
                  name + ': initializer does not match ' + first.row.valueType
                );
              const helperBinding = installClosedType(
                helper,
                literal.type,
                true
              );
              preparedCalls.set(helperBinding.value, null);
              ce.assign(helper, literal);
              ce.declare(name, { macro: [helper, ...parameters] });
              fieldParameters.set(name, parameters);
              bodies.set(name, ce.box(body, { form: 'raw' }));
              return;
            }
            const expr = ce.box(parsed.get(first.row.id)!);
            if (!expr.isValid) return rejectComponent(group, group[0], expr);
            // This is the checked type of a formula result. It can contain
            // Missing even though host-written binding annotations cannot.
            const writable = writableSlots?.has(group[0]) === true;
            const type =
              first.row.valueType ??
              (writable ? widenLocalType(ce, expr.type.type) : expr.type);
            if (
              first.row.valueType !== undefined &&
              !expr.type.matches(first.row.valueType)
            )
              throw new Error(
                group[0] + ': initializer does not match ' + first.row.valueType
              );
            const definition = {
              type,
              inferred: !writable,
              value: expr,
              [preparedContractDeclaration]: true as const,
            };
            ce._declareSymbolValue(group[0], definition, scope);
            bodies.set(group[0], expr);
            return;
          }
          let inferListResult = false;
          if (
            cyclic &&
            group.every(
              (name) => declarations.get(name)!.row.resultType === undefined
            )
          ) {
            const arities = new Map(
              group.map((name) => [
                name,
                declarations.get(name)!.head.params.length,
              ])
            );
            const isBuiltin = (name: string) =>
              !declarations.has(name) &&
              isLibraryDefinition(ce, name, ce.lookupDefinition(name));
            inferListResult = group.every((name) => {
              const { row, head } = declarations.get(name)!;
              return hasListReturn(
                parsed.get(row.id)!,
                arities,
                new Set(head.params),
                isBuiltin
              );
            });
          }
          const checked = group.map(
            (
              name
            ): {
              name: string;
              contract?: BoxedType;
              binding?: ReturnType<typeof installClosedType>;
              body?: Expression;
            } => ({ name })
          );
          for (const member of checked) {
            const { name } = member;
            const { row, head } = declarations.get(name)!;
            const typed =
              row.resultType !== undefined &&
              head.params.every((param) => row.formalTypes?.[param]);
            if (!cyclic && !typed) continue;
            const parameters = head.params.map(
              (param) => row.formalTypes?.[param] ?? 'unknown'
            );
            const effects = row.effects ?? 'any';
            const signature =
              '(' +
              parameters.join(', ') +
              ') ' +
              effects +
              ' -> ' +
              (row.resultType ?? (inferListResult ? 'list<any>' : 'unknown'));
            member.contract = ce.type(signature);
            if (cyclic) {
              const binding = installClosedType(name, member.contract, true);
              preparedCalls.set(binding.value, null);
              member.binding = binding;
            }
          }
          for (const member of checked) {
            const { name } = member;
            let { contract } = member;
            const { row, head } = declarations.get(name)!;
            const rhs = parsed.get(row.id)!;
            const parameters = formals(
              head.params,
              row,
              contract !== undefined
            );
            let body = ce.box(['Function', rhs, ...parameters]);
            if (!body.isValid) return rejectComponent(group, name, body);
            // Read-only position evidence can guide a stable input contract
            // without committing the draft to a specific tuple width.
            const inferred = body.type.type;
            if (
              contract === undefined &&
              row.resultType === undefined &&
              typeof inferred === 'object' &&
              inferred.kind === 'signature'
            ) {
              let changed = false;
              const normalized = parameters.map(
                (parameter, i): MathJsonExpression => {
                  const slot = inferred.args?.[i]?.type;
                  if (typeof parameter !== 'string' || slot === undefined)
                    return parameter;
                  const open = oneElementTypeOf(slot);
                  if (open === slot) return parameter;
                  changed = true;
                  return ['Typed', parameter, "'" + typeToString(open) + "'"];
                }
              );
              if (changed) {
                body = ce.box(['Function', rhs, ...normalized]);
                if (!body.isValid) return rejectComponent(group, name, body);
              }
            }
            const actual = body.type;
            // A stated result type or effect is checked even when some
            // formals are unannotated: the inferred signature, with its
            // parameter names, fills the rest of the contract. A stated
            // result is a promise, refused only when disjoint from the
            // inferred result.
            let partial = false;
            const sig = actual.type;
            if (
              contract === undefined &&
              (row.resultType !== undefined || row.effects !== undefined) &&
              typeof sig === 'object' &&
              sig.kind === 'signature'
            ) {
              const mismatch = (stated: BoxedType) =>
                new Error(
                  name +
                    ': ' +
                    String(actual) +
                    ' does not match ' +
                    String(stated)
                );
              const effects =
                row.effects === undefined
                  ? sig.effects
                  : (signatureEffects(
                      ce.type('() ' + row.effects + ' -> any').type
                    ) ?? []);
              if (row.effects !== undefined) {
                const stated = ce.type(withArrowEffects(sig, effects ?? []));
                if (!actual.matches(stated)) throw mismatch(stated);
              }
              const result =
                row.resultType === undefined
                  ? sig.result
                  : ce.type(row.resultType).type;
              contract = ce.type({
                ...sig,
                args: sig.args?.map((arg, i) => {
                  const stated = row.formalTypes?.[head.params[i]];
                  return stated === undefined
                    ? arg
                    : { ...arg, type: ce.type(stated).type };
                }),
                result,
                ...(row.effects === undefined ? {} : { effects }),
              });
              if (
                row.resultType !== undefined &&
                ce.type(sig.result).isDisjointFrom(result)
              )
                throw mismatch(contract);
              partial = true;
            }
            if (contract !== undefined && !partial && !actual.matches(contract))
              throw new Error(
                name +
                  ': ' +
                  String(actual) +
                  ' does not match ' +
                  String(contract)
              );
            if (member.binding === undefined) {
              const closed =
                contract === undefined
                  ? actual
                  : row.effects === undefined
                    ? ce.type(
                        withArrowEffects(
                          contract.type,
                          signatureEffects(actual.type) ?? []
                        )
                      )
                    : contract;
              const binding = installClosedType(name, closed, true);
              preparedCalls.set(binding.value, null);
              member.binding = binding;
            }
            const provisional = provisionalLiteral(body);
            if (provisional !== undefined)
              throw new Error(
                name +
                  ': provisional heads ' +
                  [...provisional.heads].join(', ')
              );
            member.body = body;
          }
          // No callable receives its body until every body in the group is checked.
          for (const { name, binding, body } of checked) {
            invariant(
              binding !== undefined && body !== undefined,
              'Unchecked callable: ' + name
            );
            ce.assign(name, body);
            invariant(
              scope.bindings.get(name) === binding,
              'Binding changed: ' + name
            );
            if (!cyclic && declarations.get(name)!.row.resultType === undefined)
              preparedCalls.set(binding.value, callPhase);
            bodies.set(name, body);
          }
        }
      );
      for (const name of declarations.keys()) graph.prepare(name);
      for (const row of rows) {
        if (row.role !== 'formula') continue;
        const raw = readRow(row);
        rowReferences.set(row.id, rawReferences(raw));
      }
      for (const [name, { row }] of declarations)
        rowReferences.set(row.id, references.get(name)!);
      invariant(
        parsed.size === rows.length &&
          rowReferences.size === rows.length &&
          bodies.size === declarations.size &&
          cursors.size === 0,
        'Document preparation lost a row'
      );
      const preparedDefinitions: PreparedDocumentDefinition[] = [
        ...declarations,
      ].map(([name, item]) => ({
        id: item.row.id,
        name,
        role: item.row.role as Role,
        params: [...item.head.params],
        rawBody: parsed.get(item.row.id)!,
        body: bodies.get(name)!,
        references: references.get(name)!,
        ...(fieldParameters.has(name)
          ? { fieldParameters: fieldParameters.get(name)! }
          : {}),
      }));
      function isWritableRow(name: string): boolean {
        const row = declarations.get(name)?.row;
        return (
          row?.role === 'value' &&
          writableSlots?.has(name) === true &&
          !rowErrors.has(row.id) &&
          !fieldParameters.has(name)
        );
      }
      checkDeadline(ce._deadlineFrame);
      sealPreparedNamespace(scope, isWritableRow);
      let disposed = false;
      return {
        scope,
        rawRows,
        rowReferences,
        rowErrors,
        definitions: preparedDefinitions,
        /** Read selected value rows after the caller has finished input writes.
         * Run and consume results synchronously before the next input change. */
        createValuePass(names: ReadonlySet<string>) {
          if (disposed) throw new Error('Document revision is disposed');
          const owned = new Map<BoxedValueDefinition, Expression>();
          for (const row of preparedDefinitions) {
            if (
              row.role !== 'value' ||
              !names.has(row.name) ||
              row.fieldParameters !== undefined ||
              rowErrors.has(row.id)
            )
              continue;
            const binding = scope.bindings.get(row.name);
            if (binding !== undefined && 'value' in binding)
              owned.set(binding.value, row.body);
          }
          const pass = makePreparedValuePass(ce, owned);
          return {
            run<T>(evaluate: () => T): T {
              if (disposed) throw new Error('Document revision is disposed');
              return pass.run(() => {
                const result = evaluate();
                if (!isThenable(result)) return result;
                void Promise.resolve(result).catch(() => {});
                throw new TypeError(
                  'Document value pass reads must be synchronous'
                );
              });
            },
            retain(name: string, view: Expression, result: Expression): void {
              if (disposed) throw new Error('Document revision is disposed');
              const binding = scope.bindings.get(name);
              if (binding !== undefined && 'value' in binding)
                pass.retain(binding.value, view, result);
            },
          };
        },
        collectionWriteError(
          name: string,
          value: Expression
        ): string | undefined {
          if (disposed) throw new Error('Document revision is disposed');
          const binding = scope.bindings.get(name);
          if (rowErrors.has(declarations.get(name)?.row.id ?? ''))
            return name + ' has an invalid initializer';
          if (
            !isWritableRow(name) ||
            binding === undefined ||
            !('value' in binding)
          )
            return name + ' has no prepared writable slot';
          const contract = binding.value.declaredType;
          if (
            value.engine !== ce ||
            !value.isValid ||
            !value.type.matches(contract)
          )
            return name + ' expects ' + contract.toString();
          return undefined;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          rawRows.clear();
          rowReferences.clear();
          rowErrors.clear();
          preparedDefinitions.length = 0;
          declarations.clear();
          try {
            scope.dispose();
          } finally {
            releaseImports?.();
          }
        },
      };
    });
  } catch (error) {
    scope.dispose();
    throw error;
  } finally {
    callPhase.preparing = false;
  }
}
