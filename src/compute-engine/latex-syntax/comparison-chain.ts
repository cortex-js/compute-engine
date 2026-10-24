import type { MathJsonExpression } from '../../math-json/types.js';
import { operator, operands } from '../../math-json/utils.js';

/**
 * The comparison operators that the LaTeX parser reads as a chain when they
 * follow each other without parentheses: `a \le b < c` means
 * `a \le b \land b < c`.
 *
 * Only the parser makes a chain. In MathJSON, a comparison whose operand is
 * another comparison compares the truth values of its operands:
 * `["Equal", ["LessEqual", "a", 0], ["LessEqual", "b", 0]]` is true when the
 * two conditions are both true or both false. So the parser must write a
 * chain in a form that does not nest one comparison in another: a single
 * n-ary comparison when every link has the same operator
 * (`a = b = c` is `["Equal", "a", "b", "c"]`), else an `And` of the links,
 * where adjacent links share their boundary term
 * (`a \le b > c` is `["And", ["LessEqual", "a", "b"], ["Greater", "b", "c"]]`).
 * A parenthesized comparison is an operand, not a link: `(a \le 0) = (b \le 0)`
 * arrives here with each side wrapped in a `Delimiter`.
 */
export const CHAINABLE_COMPARISONS: ReadonlySet<string> = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'IdenticallyEqual',
]);

/**
 * The negated comparison operators that have their own head (`a \nless b`
 * is `["NotLess", "a", "b"]`). They chain like the operators of
 * `CHAINABLE_COMPARISONS` (`a < b \nless c` is
 * `["And", ["Less", "a", "b"], ["NotLess", "b", "c"]]`), but a run of them
 * is never one n-ary node: the canonical form of `NotLess(a, b, c)` is
 * `Not(Less(a, b, c))`, which negates the whole chain, so each link stays a
 * pair.
 */
export const NEGATED_COMPARISONS: ReadonlySet<string> = new Set([
  'NotLess',
  'NotGreater',
  'NotLessNotEqual',
  'NotGreaterNotEqual',
]);

/**
 * The expressions that `chainComparison()` made and that a later comparison
 * operator must read as part of the chain, not as a truth value:
 * - an `And` of the links of a chain with more than one operator;
 * - a `Not` of a link, for a negated relation without its own head
 *   (`a \not\le b` is `["Not", ["LessEqual", "a", "b"]]`).
 *
 * An `And` or a `Not` that the person wrote (`\lnot(a \le b)`,
 * `\operatorname{And}(…)`) is not in this set, so it stays an operand.
 */
const CHAIN_NODES = new WeakSet<object>();

/** The prefix of a link that is the negation of a comparison operator: the
 * link `Not:LessEqual` is written `["Not", ["LessEqual", x, y]]`. */
const NEGATED_LINK = 'Not:';

/** The terms of a chain and the operators between them, in reading order.
 * `terms.length === links.length + 1`. */
type Chain = { terms: MathJsonExpression[]; links: string[] };

function isChainNode(expr: MathJsonExpression): boolean {
  return typeof expr === 'object' && expr !== null && CHAIN_NODES.has(expr);
}

/** Whether `op` is a comparison operator that the LaTeX parser chains
 * (`CHAINABLE_COMPARISONS` or `NEGATED_COMPARISONS`). */
export function isChainingComparison(op: string): boolean {
  return CHAINABLE_COMPARISONS.has(op) || NEGATED_COMPARISONS.has(op);
}

/** Read `expr` as a chain: a comparison written without parentheses, or a
 * chain that `chainComparison()` made. Return `null` for any other operand. */
function readChain(expr: MathJsonExpression): Chain | null {
  const op = operator(expr);
  if (isChainingComparison(op)) {
    const terms = [...operands(expr)];
    if (terms.length < 2) return null;
    return { terms, links: terms.slice(1).map(() => op) };
  }
  if (op === 'Not' && isChainNode(expr)) {
    const link = operands(expr)[0];
    return {
      terms: [...operands(link)],
      links: [NEGATED_LINK + operator(link)],
    };
  }
  if (op === 'And' && isChainNode(expr)) {
    const terms: MathJsonExpression[] = [];
    const links: string[] = [];
    for (const segment of operands(expr)) {
      const sub = readChain(segment)!;
      // Adjacent segments share their boundary term: keep it once.
      terms.push(...(terms.length === 0 ? sub.terms : sub.terms.slice(1)));
      links.push(...sub.links);
    }
    return { terms, links };
  }
  return null;
}

/** Whether `expr` is a link of a chain (see `CHAINABLE_COMPARISONS`). */
export function isComparisonChainLink(expr: MathJsonExpression): boolean {
  return readChain(expr) !== null;
}

/**
 * Join `lhs` and `rhs` with the comparison operator `op`, or with its
 * negation when `negated` is true (`a \not\le b` is
 * `["Not", ["LessEqual", "a", "b"]]`). When `lhs` or `rhs` is itself a
 * comparison written without parentheses, the result is the chain, in the
 * form that `CHAINABLE_COMPARISONS` describes:
 * `a < b \not\le c` is `["And", ["Less", "a", "b"], ["Not", ["LessEqual", "b", "c"]]]`.
 * Maximal runs of the same operator become one n-ary comparison. A run of
 * `NotEqual` stays n-ary too: the canonical form of an n-ary `NotEqual`
 * compares the adjacent pairs only (`a \ne b \ne c` is
 * `a \ne b \land b \ne c`). A negated link is always a pair.
 */
export function chainComparison(
  op: string,
  lhs: MathJsonExpression,
  rhs: MathJsonExpression,
  negated = false
): MathJsonExpression {
  const left = readChain(lhs) ?? { terms: [lhs], links: [] };
  const right = readChain(rhs) ?? { terms: [rhs], links: [] };
  const terms = [...left.terms, ...right.terms];
  const links = [
    ...left.links,
    negated ? NEGATED_LINK + op : op,
    ...right.links,
  ];

  const segments: MathJsonExpression[] = [];
  let i = 0;
  while (i < links.length) {
    const link = links[i];
    if (link.startsWith(NEGATED_LINK)) {
      const negation: MathJsonExpression = [
        'Not',
        [link.slice(NEGATED_LINK.length), terms[i], terms[i + 1]],
      ];
      CHAIN_NODES.add(negation as object);
      segments.push(negation);
      i += 1;
      continue;
    }
    let j = i;
    if (!NEGATED_COMPARISONS.has(link))
      while (j + 1 < links.length && links[j + 1] === link) j++;
    segments.push([link, ...terms.slice(i, j + 2)]);
    i = j + 1;
  }
  if (segments.length === 1) return segments[0];
  const result: MathJsonExpression = ['And', ...segments];
  CHAIN_NODES.add(result as object);
  return result;
}
