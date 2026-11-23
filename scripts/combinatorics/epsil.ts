// Epsil source to MathJSON for the combinatorics tables. The library itself
// never parses Epsil: generate.ts writes the result to compiled.ts.

import type { MathJsonExpression } from '../../src/math-json/types';
import { parseEpsil } from '../../src/epsil/parse-epsil';

/** Drop the source offsets the Epsil parser attaches to each node. */
function plain(node: unknown): MathJsonExpression {
  if (Array.isArray(node))
    return node.map(plain) as unknown as MathJsonExpression;
  if (node !== null && typeof node === 'object') {
    const n = node as { fn?: unknown[]; sym?: string; num?: string };
    if (n.fn) return n.fn.map(plain) as unknown as MathJsonExpression;
    if (n.sym !== undefined) return n.sym;
    if (n.num !== undefined) return Number(n.num);
  }
  return node as MathJsonExpression;
}

/**
 * The MathJSON function literal of an Epsil definition (`p => …`). Throws when
 * the source does not parse or is not a single function literal.
 */
export function compileEpsil(source: string): MathJsonExpression {
  const [program, diagnostics] = parseEpsil(source);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0)
    throw new Error(
      `Epsil error in "${source}": ${JSON.stringify(errors[0].message)}`
    );
  const statements = plain(program) as unknown as unknown[];
  const literal = statements[1];
  if (
    statements[0] !== 'Program' ||
    statements.length !== 2 ||
    !Array.isArray(literal) ||
    literal[0] !== 'Function'
  )
    throw new Error(
      `Epsil definition is not one function literal: "${source}"`
    );
  return literal as unknown as MathJsonExpression;
}
