import type { MathJsonExpression } from '../../math-json/types.js';
import { operator, operands } from '../../math-json/utils.js';
import type { Serializer } from './types.js';

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

/**
 * The links of `expr` when `expr` is an `And` that the LaTeX parser reads
 * back from the chain spelling, else `null`. The serializer writes such an
 * `And` as a chain: `["And", ["Less", 0, "M"], ["LessEqual", "M", 5]]` is
 * `0\lt M\le5`, not `0\lt M\land M\le5`.
 *
 * Conditions, so that the chain spelling parses back to the same MathJSON:
 * - every operand is a comparison of `CHAINABLE_COMPARISONS` with two or
 *   more operands, or of `NEGATED_COMPARISONS` with exactly two (a `Not` of
 *   a link has no chain spelling here);
 * - each link starts with the term that the previous link ends with;
 * - two adjacent links have different operators, except for a negated
 *   head. The parser joins a run of the same operator into one n-ary
 *   comparison, so `a < b \land b < c` (an `And` of two `Less`) does not
 *   come back from `a < b < c` (one `Less`). A run of a negated head stays
 *   a run of pairs (see `NEGATED_COMPARISONS`).
 */
export function comparisonChainLinks(
  expr: MathJsonExpression
): ReadonlyArray<MathJsonExpression> | null {
  if (operator(expr) !== 'And') return null;
  const links = operands(expr);
  if (links.length < 2) return null;
  for (let k = 0; k < links.length; k++) {
    const op = operator(links[k]);
    const count = operands(links[k]).length;
    if (!isChainingComparison(op) || count < 2) return null;
    // The parser never makes an n-ary negated link: `a \nless b \nless c`
    // is two `NotLess` pairs.
    if (NEGATED_COMPARISONS.has(op) && count > 2) return null;
    if (k === 0) continue;
    const previous = links[k - 1];
    if (op === operator(previous) && !NEGATED_COMPARISONS.has(op)) return null;
    const boundary = operands(previous);
    if (
      JSON.stringify(boundary[boundary.length - 1]) !==
      JSON.stringify(operands(links[k])[0])
    )
      return null;
  }
  return links;
}

/**
 * The LaTeX of the operand `val` of a comparison whose operator has the
 * precedence `prec`. A comparison operand is always wrapped:
 * `LessEqual(Less(a, b), c)` is `(a\lt b)\le c`, since `a\lt b\le c`
 * parses back as a chain. Other operands are wrapped when their precedence
 * is not above `prec`.
 */
export function wrapComparisonOperand(
  serializer: Serializer,
  val: MathJsonExpression,
  prec: number
): string {
  return isChainingComparison(operator(val))
    ? serializer.wrap(val, Infinity)
    : serializer.wrap(val, prec + 1);
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
