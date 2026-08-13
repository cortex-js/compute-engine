import type { MathJsonExpression } from '../math-json/types.js';
import { operand, operands, operator, symbol } from '../math-json/utils.js';

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
  collect(ast, sites);
  return sites;
}

function collect(
  expr: MathJsonExpression | null,
  sites: Map<string, DefinitionSite>
): void {
  if (expr === null) return;
  const head = operator(expr);
  if (head === '') return;
  if (head === 'DefineFunction' || head === 'Declare' || head === 'Assign') {
    const target = operand(expr, 1);
    const name = symbol(target);
    const nameRange = nodeOffsets(target);
    const statement = nodeOffsets(expr);
    if (name !== null && nameRange !== undefined && !sites.has(name))
      sites.set(name, {
        name: nameRange,
        header: headerRange(expr, head, statement ?? nameRange),
      });
  }
  for (const op of operands(expr)) collect(op, sites);
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

/** The `sourceOffsets` of a raw AST node, when it carries them. */
function nodeOffsets(
  node: MathJsonExpression | null
): [number, number] | undefined {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
    ? (node as { sourceOffsets?: [number, number] }).sourceOffsets
    : undefined;
}
