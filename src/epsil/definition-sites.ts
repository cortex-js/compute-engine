import type { MathJsonExpression } from '../math-json/types.js';
import {
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../math-json/utils.js';

/** Where a program binds one name, in source offsets. */
export type DefinitionSite = {
  /** The span of the NAME itself — what a "defined here" excerpt underlines. */
  name: [number, number];
  /**
   * The span to QUOTE when showing the declaration: for a function, its
   * header — everything up to the body, so `function foo(x: string) { … }`
   * quotes as `function foo(x: string)`; for anything else, the whole
   * declaring statement.
   */
  header: [number, number];
  /**
   * The doc comment written immediately before a function definition (`///`
   * lines or a `/** … *\/` block), markers stripped — carried by the
   * definition's attributes operand as `description`. Markdown. Absent for
   * an undocumented definition and for every other declaring form.
   */
  description?: string;
};

/**
 * Where each name this program binds was declared.
 *
 * Read from the raw AST — the only tree carrying source offsets — rather than
 * from the engine's definitions, which record no source location. So it must
 * be collected before anything canonicalizes.
 *
 * The whole tree is walked, not just the top level, so a function defined
 * inside a block is found too; the FIRST binding of a name wins, so a
 * multi-clause definition points at its first clause and a rebinding does not
 * move the site off the original.
 */
export function definitionSites(
  ast: MathJsonExpression
): Map<string, DefinitionSite> {
  const sites = new Map<string, DefinitionSite>();
  collect(ast, (name, site) => {
    if (!sites.has(name)) sites.set(name, site);
  });
  return sites;
}

/** Every declaration site keyed by its written name's source offset. Unlike
 * `definitionSites()`, this preserves shadowing and redeclarations. */
export function definitionSitesByOffset(
  ast: MathJsonExpression
): Map<number, DefinitionSite> {
  const sites = new Map<number, DefinitionSite>();
  collect(ast, (_name, site) => sites.set(site.name[0], site));
  return sites;
}

function collect(
  expr: MathJsonExpression | null,
  visit: (name: string, site: DefinitionSite) => void
): void {
  if (expr === null) return;
  const head = operator(expr);
  if (head === '') return;
  if (head === 'DefineFunction' || head === 'Declare' || head === 'Assign') {
    const target = operand(expr, 1);
    const name = symbol(target);
    const nameRange = nodeOffsets(target);
    const statement = nodeOffsets(expr);
    if (name !== null && nameRange !== undefined) {
      const description =
        head === 'DefineFunction' ? definitionDescription(expr) : undefined;
      visit(name, {
        name: nameRange,
        header: headerRange(expr, head, statement ?? nameRange),
        ...(description !== undefined ? { description } : {}),
      });
    }
  }
  for (const op of operands(expr)) collect(op, visit);
}

/**
 * The declaration's quotable span. A `DefineFunction` holds a `Function`
 * whose FIRST operand is the body (`["Function", body, …params]`), so the
 * header runs from the statement's start to where that body begins —
 * everything the reader wrote about how the function is CALLED, and nothing
 * about what it does. A body without offsets, or any other declaring form,
 * falls back to the whole statement.
 */
function headerRange(
  expr: MathJsonExpression,
  head: string,
  fallback: [number, number]
): [number, number] {
  if (head !== 'DefineFunction') return fallback;
  const body = nodeOffsets(operand(operand(expr, 2), 1));
  return body === undefined ? fallback : [fallback[0], body[0]];
}

/**
 * The `description` attribute of a `DefineFunction` node — its optional third
 * operand is a `Dictionary` of `KeyValuePair`s (the parser's encoding; the
 * `{dict: …}` shorthand of hand-written MathJSON is read too).
 */
function definitionDescription(expr: MathJsonExpression): string | undefined {
  const attrs = operand(expr, 3);
  if (attrs === null) return undefined;
  if (
    typeof attrs === 'object' &&
    !Array.isArray(attrs) &&
    'dict' in attrs &&
    typeof attrs.dict === 'object' &&
    attrs.dict !== null
  ) {
    const d = (attrs.dict as Record<string, unknown>)['description'];
    return typeof d === 'string' ? d : undefined;
  }
  if (operator(attrs) !== 'Dictionary') return undefined;
  for (const entry of operands(attrs)) {
    if (operator(entry) !== 'KeyValuePair') continue;
    const key = symbol(operand(entry, 1)) ?? stringValue(operand(entry, 1));
    if (key !== 'description') continue;
    return stringValue(operand(entry, 2)) ?? undefined;
  }
  return undefined;
}

/** The `sourceOffsets` of a raw AST node, when it carries them. */
function nodeOffsets(
  node: MathJsonExpression | null
): [number, number] | undefined {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
    : undefined;
}
