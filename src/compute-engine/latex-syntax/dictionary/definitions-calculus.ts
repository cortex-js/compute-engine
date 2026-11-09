import type { MathJsonExpression } from '../../../math-json/types.js';
import {
  operator,
  isDictionaryObject,
  isEmptySequence,
  nops,
  operand,
  operands,
  symbol,
} from '../../../math-json/utils.js';
import { LatexDictionary, Parser, Serializer } from '../types.js';
import { endsTabularCell } from '../tokenizer.js';

/**
 * The parts of an integral that took more differentials than it has signs,
 * keyed by the expression that `parseIntegral()` returned for it.
 *
 * A differential that follows the integrand is read from the token stream,
 * and an integral reads at most one differential per sign: the others stay in
 * the stream for the enclosing integrals (`parseIndexes()`). A differential
 * inside the integrand (`\frac{dx\,dy}{xy}`) is found only after the
 * integrand is parsed, so the innermost integral finds all of them. That
 * integral keeps all of them, and records its parts here. When it is the
 * whole body of an enclosing integral that has no differential of its own
 * (`\int_1^2\int_3^4 \frac{dx\,dy}{xy}`), the enclosing integral makes the
 * inner integral again with one differential per sign and takes the others
 * (`claimExcessDifferentials()`). The enclosing integral also takes them when
 * the inner integral is the last factor of a product or the operand of a
 * negation that is its whole body (`\int_1^2 2\int_3^4 \frac{dx\,dy}{xy}`),
 * and when its body is a sum or a difference that has no differential in its
 * terms and whose last term holds the inner integral
 * (`\int_1^2 1+\int_3^4 \frac{dx\,dy}{xy}`, see
 * `claimExcessDifferentialsInSum()`).
 * When terms follow the integrand of the inner integral
 * (`\int_1^2\int_3^4 \frac{dx\,dy}{xy} + 1`), they are outside both
 * integrals, as in `\int_1^2\int_3^4 \frac{1}{xy}\,dx\,dy + 1`: each
 * integral ends after the term that holds its differentials (see
 * `stopAfterTerm()`), and the parser of the enclosing expression reads the
 * terms after it.
 */
type IntegralParts = {
  command: string;
  fn: MathJsonExpression;
  /** The differentials in the written order, innermost first. */
  indexes: string[];
  subs: MathJsonExpression[];
  sups: MathJsonExpression[];
  nIntegrals: number;
  /** The terms written after the integrand, outside the integral. The list
   * is empty unless these terms are in a brace group with the integrand
   * (`{\frac{dx\,dy}{xy} + 5}`): the body of an integral does not stop
   * inside a group (see `stopAfterTerm()`). */
  rest: SignedTerm[];
  /** The token index where the integrand ends and the terms of `rest`
   * begin. It is used only for diagnostics. */
  integrandEnd: number;
};
/** A term of a sum, with `true` when it is subtracted. */
type SignedTerm = [term: MathJsonExpression, negative: boolean];
const excessDifferentials = new WeakMap<object, IntegralParts>();

/**
 * The results of `parseIntegral()` that are a key of `excessDifferentials`
 * and are a sum (`Add(I, 5)` for `\int_3^4 {\frac{dx\,dy}{xy} + 5}`), keyed
 * by the first operand of the sum. `finishIntegral()` made that operand for
 * this result, so it is the key of one result only. See
 * `claimExcessDifferentialsInSum()`.
 */
const mergedExcessDifferentials = new WeakMap<object, MathJsonExpression>();

/** What an enclosing integral takes from an inner integral that has more
 * differentials than signs: see `claimExcessDifferentials()`. */
type ClaimedDifferentials = {
  fn: MathJsonExpression;
  indexes: string[];
  rest: SignedTerm[];
  integrandEnd: number;
};

// See https://de.wikipedia.org/wiki/Formelsatz
// for a discussion of typographical notation in Germany, Russia and France
// Also DIN 1304 (symbols in formulas) and DIN 1338 (typesetting of formulas)

/**
 * Parse an integral, for example:
 *    `\iint_D f(x, y)\,dx\,dy`
 * to
 *    `["Integrate", f(x, y), ["Tuple", "y", "D", "Nothing"], "x"]`
 *
 * The first limit of `Integrate` is the outermost integral, and the
 * differentials are written innermost first, so their order is reversed
 * (see `makeIntegral()`). Consecutive `\int` signs parse as nested
 * `Integrate` expressions, one for each sign.
 *
 * The number of \int doesn't necessarily match the number of indexes
 * (for examples, `\iint f dxdy`
 *
 * When this function is called, the first `\int` has already been matched.
 *
 * `nIntegrals` is the number of integral signs the matched command stands for
 * (`\int` → 1, `\iint` → 2, `\iiint` → 3, etc.). It bounds how many trailing
 * differentials (`dx dy …`) this level may consume. Without this bound the
 * innermost integral of a nested expression (`\int\int … dx dy`) would greedily
 * swallow *all* the differentials, leaving the outer integrals with no
 * integration variable.
 *
 */
function parseIntegralAt(command: string, nIntegrals = 1) {
  return (parser: Parser): MathJsonExpression | null => {
    // Diagnostics: checkpoint before the whole integral so references to the
    // differential (dummy) variable — in the integrand and in `dx` — can be
    // retroactively un-flagged as `undeclared-symbol`. Bounds (`a`, `b` in
    // `\int_a^b`) are free variables and survive.
    const diagCp = parser._diagnosticsCheckpoint();
    //
    // 1/ Capture the limits of integration
    //
    // A single integral sign carries one set of sub/super-script limits.
    // Consecutive signs are NOT merged into one level here: stacked `\int`s
    // parse as separate, recursively-nested `Integrate`s — each with its own
    // limits and differential (see `nIntegrals`) — while `\iint` / `\iiint`
    // pass nIntegrals=2/3 to bind several differentials to this one level.

    // Skip space or a `\limits` command
    parser.skipVisualSpace();
    parser.match('\\limits');
    parser.skipSpace();

    // Are there some superscripts or subscripts?
    let sup: MathJsonExpression | null = null;
    let sub: MathJsonExpression | null = null;
    while (
      !(sub !== null && sup !== null) &&
      (parser.peek === '_' || parser.peek === '^')
    ) {
      if (parser.match('_')) sub = parser.parseGroup() ?? parser.parseToken();
      else if (parser.match('^')) {
        sup = parser.parseGroup() ?? parser.parseToken();
      }
      parser.skipSpace();
    }
    if (isEmptySequence(sub)) sub = null;
    if (isEmptySequence(sup)) sup = null;

    const subs: MathJsonExpression[] = [sub ?? 'Nothing'];
    const sups: MathJsonExpression[] = [sup ?? 'Nothing'];

    parser.skipVisualSpace();

    //
    // 2/ Capture the body of the integral (the integrand)
    //   and the indexes that follow it.
    //

    // The integrand + differential (`dx`) begin here; the limits (`_x^1`) are
    // already parsed. Pruning the dummy variable only within this body span
    // leaves a same-named *limit* reference flagged, e.g. the lower bound `x`
    // in `\int_x^1 x\,dx` fires while the integrand/differential `x` does not.
    const bodyStartToken = parser.index;
    const bodyDiagCp = parser._diagnosticsCheckpoint();
    // An integration variable spelled as a subscript on an indexed
    // collection (`dn_{0}` when `n` is a list) is the new name `n_0`, and so
    // are its occurrences in the integrand (see `parseIndexes()`)
    const binderName = binderNameFor(parser);

    // The body ends after the term that holds the differential
    // (`\frac{dx}{x} + 1`) or an inner integral whose differentials this
    // integral takes (`\int_3^4 \frac{dx\,dy}{xy} + 1`), and the parser of the
    // enclosing expression reads the terms after it. Otherwise a factor or a
    // minus sign before the integral would also apply to these terms:
    // `2\int_0^1 \frac{dx}{1+x^2} + 1` would be `2(I + 1)`. The body stops at
    // a `+` or a `-` after a term whose tokens can hold a differential (see
    // `stopAfterTerm()`). When the term holds none, the body is parsed again
    // from its start, and does not stop at that sign. The inner integrals are
    // not parsed again (see `parseIntegral()`), and after
    // `MAX_BODY_REPARSES` new parses the body stops at no sign: the cost
    // stays linear in the length of the body.
    const stops: BodyStops = {
      start: bodyStartToken,
      decisions: new Map(),
      lastSign: bodyStartToken - 1,
      excluded: new Set(),
      disabled: false,
      stoppedAt: null,
      cache: new Map(),
      needed: nIntegrals,
    };
    let [fn, indexes] = parseIntegralBody(parser, nIntegrals, stops);
    let reparses = 0;
    while (
      stops.stoppedAt !== null &&
      !holdsIntegrand(fn, indexes, binderName)
    ) {
      reparses += 1;
      stops.excluded.add(stops.stoppedAt);
      stops.disabled = reparses >= MAX_BODY_REPARSES;
      stops.decisions.clear();
      stops.lastSign = bodyStartToken - 1;
      stops.stoppedAt = null;
      parser._rollbackDiagnostics(bodyDiagCp);
      parser.index = bodyStartToken;
      [fn, indexes] = parseIntegralBody(parser, nIntegrals, stops);
    }
    // With no differential of its own, this integral takes the differentials
    // that an inner integral found in its integrand and has no sign for
    // (`\int_1^2\int_3^4 \frac{dx\,dy}{xy}`), when that inner integral is
    // the body, its last factor or its negated operand. The terms after the
    // integrand of the inner integral are not in its result: the parser of
    // the enclosing expression reads them. `rest` holds them only when they
    // are in a brace group with the integrand of the inner integral
    // (`\int_3^4 {\frac{dx\,dy}{xy} + 5}`): the body does not stop inside a
    // group.
    let rest: SignedTerm[] = [];
    let integrandEnd = bodyStartToken;
    if (fn !== null && indexes.length === 0) {
      const claimed = claimExcessDifferentials(fn);
      if (claimed !== null) ({ fn, indexes, rest, integrandEnd } = claimed);
    }
    const rebind = (e: MathJsonExpression) =>
      parser.rebindSubscripts(e, new Set(indexes)) ?? e;

    if (fn && indexes.length === 0) {
      if (operator(fn) === 'Add' || operator(fn) === 'Subtract') {
        // If the function is a sum or a difference, the differential could be
        // inside one of the terms, e.g. `\int 1 - \frac{x\,dx}{2}`: the
        // terms up to and including the one that holds it are the integrand.
        // The body ends after that term (see `stopAfterTerm()`), so no term
        // follows it, except inside a brace group (`\int {\frac{dx}{x} + 1}`):
        // the terms after it (`termRest`) are then added to or subtracted
        // from the integral, with their sign. With no differential in any
        // term, the whole sum is the integrand (`\int \sin x + 1`).
        const [body, termRest, termIndexes] = splitSumAtDifferential(
          fn,
          binderName
        );
        if (termIndexes.length > 0) {
          indexes = termIndexes;
          // The bound variable is bound only in the integrand: a same-named
          // reference in a term after it is free and stays flagged. The
          // integrand span is given as a declaration span. The body start
          // given is the current index: no reference collected so far starts
          // at or after it, so no other reference is pruned. With no term
          // after the integrand, the integrand ends at the current index.
          const termsStart =
            termRest.length === 0
              ? parser.index
              : integrandEndToken(parser, bodyStartToken, parser.index);
          parser._pruneUndeclared(indexes, diagCp, parser.index, [
            [bodyStartToken, termsStart],
          ]);
          // The `d` of the differential. The tokens up to `signEnd` are
          // checked against the integrand only, so that a free `d` in a term
          // after the integrand (`\int \frac{x\,dx}{2} + d`) does not keep
          // the diagnostic of the `d` of the differential. `signEnd` is never
          // after the true end of the integrand, so the tokens after it are
          // checked against the integrand and the terms after it: a free `d`
          // is never hidden.
          const signEnd =
            termRest.length === 0
              ? parser.index
              : firstSignAfterDifferential(
                  parser,
                  bodyStartToken,
                  parser.index
                );
          pruneDifferentialOperators(
            parser,
            diagCp,
            bodyStartToken,
            [body],
            signEnd
          );
          pruneDifferentialOperators(parser, diagCp, signEnd, [
            body,
            ...termRest.map(([term]) => term),
          ]);
          // A body that is only the differential (`\int (dx) + 1`) is the
          // integral of 1, as `\frac{dx}{x}` is the integral of `1/x`.
          return (
            finishIntegral(
              command,
              body === null ? 1 : rebind(body),
              { indexes, subs, sups, nIntegrals },
              termRest,
              termsStart
            ) ?? 'Nothing'
          );
        }
        // With no differential in any term, this integral takes the
        // differentials that an inner integral in a term has no sign
        // for (`\int_1^2 1+\int_3^4 \frac{dx\,dy}{xy}`), as it does above
        // when the inner integral is the whole body. This search comes after
        // the search for a differential in the terms: in
        // `\int_1^2 \frac{dy}{y} + \int_3^4 \frac{dx\,dz}{xz}` the first
        // integral has its own differential and ends before the `+`, so the
        // second integral keeps `dz`.
        const claimed = claimExcessDifferentialsInSum(fn);
        if (claimed !== null) ({ fn, indexes, rest, integrandEnd } = claimed);
      } else if (operator(fn) === 'Divide') {
        // We recognize \frac{dx}{x} as an integral
        let altNumerator: MathJsonExpression | null;
        [altNumerator, indexes] = parseSubintegrand(
          operand(fn, 1)!,
          binderName
        );
        if (altNumerator !== null && indexes !== null) {
          fn = ['Divide', altNumerator, operand(fn, 2)!];
        }
      }
    }

    // Retroactively un-flag references to the differential (dummy) variables
    // within the integrand/differential span only (leaving same-named limits).
    // When an inner integral gave terms that are outside this integral
    // (`rest`), a same-named reference in those terms is free and stays
    // flagged: only the span up to the end of the integrand of the inner
    // integral (`integrandEnd`, which that integral recorded) is given, as a
    // declaration span, as for a sum above. The tokens are not scanned again
    // from `bodyStartToken`: a brace group around the inner integral
    // (`\int_1^2{\int_3^4 \frac{dx\,dy}{xy} + y}`) would change the depth of
    // the `+`. The terms are also given to `pruneDifferentialOperators()`, so
    // that a free `d` in them keeps its diagnostic.
    if (indexes.length > 0) {
      if (rest.length === 0)
        parser._pruneUndeclared(indexes, diagCp, bodyStartToken);
      else
        parser._pruneUndeclared(indexes, diagCp, parser.index, [
          [bodyStartToken, integrandEnd],
        ]);
      pruneDifferentialOperators(parser, diagCp, bodyStartToken, [
        fn,
        ...rest.map(([term]) => term),
      ]);
    }

    if (fn !== null && indexes.length > 0) fn = rebind(fn);

    // A body that is only the differential (`\int dx`, `\int (dx)`) is the
    // integral of 1 (CE-291).
    if (fn === null && indexes.length > 0) fn = 1;

    // With fewer differentials found than integral signs, a differential at
    // the end of a denominator anywhere in the body (`\int 2\frac{3x}{5dx}`,
    // `\int \sin\frac{x}{5dx}`) or in a factor of a product other than the
    // last factor (`\int \frac{dx}{x}\cdot 2`,
    // `\iint \frac{dx}{x}\frac{dy}{y}`) is malformed: that denominator or that
    // factor is replaced by an error.
    //
    // An integral that found one differential for each of its signs is not
    // searched: in its body, a `d` before a variable is the product of the
    // symbol `d` and that variable. `\int_0^1 \frac{ax+by}{cx+dy}\,dx` has
    // `dy` at the end of its denominator, and `\int_0^1 (c+dx)(a+bx)\,dx`
    // has `dx` in a factor before the last one. Both are well formed, with a
    // coefficient named `d`, and the search would replace that denominator
    // and that factor by an error.
    //
    // The consequence is that an integral written with more differentials
    // than signs keeps the `d` of an extra differential as a symbol when
    // that differential is inside a sub-expression:
    // `\int_1^2 \frac{dx}{x}\,dy` is the integral over `y` of `d·x/x`, and
    // its value is `d`. With the `diagnostics` option of `parse()`, that `d`
    // is reported as an `undeclared-symbol` unless `d` is declared (see
    // `pruneDifferentialOperators()`).
    if (fn !== null && indexes.length < nIntegrals)
      fn = markMisplacedDifferentials(fn, binderName);

    //
    // 3/ Put together the limits, the function and the indexes
    //
    return finishIntegral(
      command,
      fn,
      { indexes, subs, sups, nIntegrals },
      rest,
      integrandEnd
    );
  };
}

/**
 * The parselet of an integral command: `parseIntegralAt()`, which also
 * records the token span of the integral (see `integralSpans`).
 *
 * While the body of an enclosing integral is parsed again (see
 * `parseIntegralAt()`), an inner integral at the same token index gives the
 * same result: the result read the first time is used again, with the
 * diagnostics of that reading, and the tokens are not parsed again (see
 * `BodyStops.cache`).
 */
function parseIntegral(command: string, nIntegrals = 1) {
  const parse = parseIntegralAt(command, nIntegrals);
  return (parser: Parser): MathJsonExpression | null => {
    const start = parser.index;
    const enclosing = activeBodies.get(parser)?.at(-1);
    const cached = enclosing?.cache.get(start);
    if (cached !== undefined) {
      parser.index = cached.end;
      parser._replayDiagnostics(cached.diagnostics);
      return cached.result;
    }
    const diagCp = parser._diagnosticsCheckpoint();
    const result = parse(parser);
    // A command that gives no integral, or reads no token, has no span: a
    // span that ends where it starts would stop the token search of
    // `stopAfterTerm()` from going forward.
    if (result === null || parser.index <= start) return result;
    let spans = integralSpans.get(parser);
    if (spans === undefined) {
      spans = new Map();
      integralSpans.set(parser, spans);
    }
    spans.set(start, {
      end: parser.index,
      excess: Array.isArray(result) && excessDifferentials.has(result),
    });
    enclosing?.cache.set(start, {
      result,
      end: parser.index,
      diagnostics: parser._diagnosticsSince(diagCp),
    });
    return result;
  };
}

/**
 * The token spans of the integrals that a parser has read, keyed by the
 * token index after the integral command (`\int`). `end` is the token index
 * after the integral, and `excess` is true when the integral took more
 * differentials than it has signs (see `excessDifferentials`).
 *
 * `stopAfterTerm()` does not search the tokens of an inner integral for a
 * differential: the `d` tokens there belong to the inner integral, except the
 * extra differentials, which `excess` shows. When the parser reads the same
 * tokens again, the entry is replaced.
 */
const integralSpans = new WeakMap<
  Parser,
  Map<number, { end: number; excess: boolean }>
>();

/**
 * The bodies of integrals that a parser is reading, innermost last (see
 * `parseIntegralBody()`).
 */
const activeBodies = new WeakMap<Parser, BodyStops[]>();

/**
 * The most times that the body of one integral is parsed again after a stop
 * at a term that holds no differential (see `parseIntegralAt()`). After that,
 * the body stops at no sign: the terms after the integrand are then in the
 * body, and are added to the integral (see `finishIntegral()`).
 */
const MAX_BODY_REPARSES = 2;

/**
 * Where the body of an integral stops (see `stopAfterTerm()`).
 *
 * - `start`: the token index where the body starts.
 * - `decisions`: the decision made at the token index of each `+` or `-`
 *   that the parser met, at the top level of the body. Several parsers of
 *   the body (the body itself, the right operand of a `+`, the argument of a
 *   function such as `\sin`) ask at the same sign, and get the same answer.
 * - `lastSign`: the greatest token index in `decisions` where the body does
 *   not stop: the term before the next sign starts after it.
 * - `excluded`: the signs where the body does not stop, because the term
 *   before them holds no differential after all.
 * - `disabled`: true when the body stops at no sign (see
 *   `MAX_BODY_REPARSES`).
 * - `stoppedAt`: the sign where the body stopped, or `null`.
 * - `cache`: the inner integrals read in the body, by the token index where
 *   they start, with the diagnostics of their reading, so that a new parse
 *   of the body does not parse them again.
 * - `needed`: the number of integral signs of the integral (see
 *   `nIntegrals` in `parseIntegralAt()`): the body stops only after a
 *   term that holds that many differentials.
 */
type BodyStops = {
  start: number;
  decisions: Map<number, boolean>;
  lastSign: number;
  excluded: Set<number>;
  disabled: boolean;
  stoppedAt: number | null;
  cache: Map<
    number,
    { result: MathJsonExpression; end: number; diagnostics: readonly object[] }
  >;
  needed: number;
};

/**
 * True when the body of an integral should stop at the current token index:
 * the next token, after visual space, is a `+` or a `-`, and the tokens of
 * the term before it (from the previous such sign, or from the start of the
 * body) hold one differential for each integral sign (see
 * `isDifferentialToken()` and `BodyStops.needed`), or an inner integral
 * that took more differentials than it has signs. With fewer differentials
 * (`\iint \frac{dx}{x} + 1\,dy`), the body goes on to the differential
 * after it. The tokens of an inner integral are not searched for a
 * differential (see `integralSpans`).
 *
 * The index does not move. The visual space before the sign is left for the
 * parser of the enclosing expression: it reads the space as spacing after
 * the integral, then the sign as an infix operator.
 *
 * The test reads tokens only. It can find a differential that the parser
 * does not take (`\frac{d}{dx}` in a term before the integrand): the caller
 * then checks the parsed term with `holdsIntegrand()`, and parses the body
 * again without this stop. It can miss a differential that
 * `isDifferentialToken()` does not know (a `d` followed by `\hspace{2pt}`),
 * and a brace group or `MAX_BODY_REPARSES` stops the search: the body then
 * reads the terms after the integrand, and they are added to the integral
 * (see `finishIntegral()`).
 */
function stopAfterTerm(parser: Parser, stops: BodyStops): boolean {
  if (stops.disabled) return false;
  const at = parser.index;
  parser.skipVisualSpace();
  const sign = parser.index;
  const isSign = parser.peek === '+' || parser.peek === '-';
  // Nothing was read after `at`: setting the index back removes no
  // diagnostic.
  parser.index = at;
  if (!isSign) return false;
  let stop = stops.decisions.get(sign);
  if (stop === undefined) {
    let termStart = stops.lastSign + 1;
    if (sign <= stops.lastSign) {
      // A sign before one already decided: the parser went back. The term
      // starts after the closest decided sign before this one.
      termStart = stops.start;
      for (const [index, decided] of stops.decisions)
        if (!decided && index < sign && index + 1 > termStart)
          termStart = index + 1;
    }
    const spans = integralSpans.get(parser);
    let holds = false;
    let differentials = 0;
    for (let i = termStart; i < at && !holds; i++) {
      const span = spans?.get(i);
      if (span !== undefined && span.end > i && span.end <= at) {
        holds = span.excess;
        i = span.end - 1;
        continue;
      }
      if (isDifferentialToken(parser, i, at)) differentials += 1;
      holds = differentials >= stops.needed;
    }
    stop = holds && !stops.excluded.has(sign);
    stops.decisions.set(sign, stop);
    if (!stop && sign > stops.lastSign) stops.lastSign = sign;
  }
  if (stop) stops.stoppedAt = sign;
  return stop;
}

/** The tokens of visual space that `isDifferentialToken()` skips after a
 * `d`: a space, `~`, and the commands that `skipVisualSpace()` skips
 * (`VISUAL_SPACE_COMMANDS` in `latex-syntax/parse.ts`). The commands with
 * an argument (`\hspace{2pt}`, `\kern`) are not in the set. */
const VISUAL_SPACE_TOKENS = new Set([
  '',
  '~',
  '\\ ',
  '\\!',
  '\\,',
  '\\:',
  '\\;',
  '\\enskip',
  '\\enspace',
  '\\space',
  '\\quad',
  '\\qquad',
]);

/**
 * True when the token at index `i` (before `end`) starts a differential:
 * `\differentialD`, or a `d` followed by a variable, also as
 * `\mathrm{d}` or `\operatorname{d}`, as `readDifferential()` reads it. A
 * variable is a letter (also a Unicode letter, `dθ`), a command such as
 * `\theta`, or a brace group (`d{x}`). A `d` followed by a closing brace, a
 * digit or an operator (`\frac{x}{d}`, the `d` of `\mathrm{grad}`) is not a
 * differential. A group that does not hold a variable is a false positive,
 * which the caller of `stopAfterTerm()` removes.
 */
function isDifferentialToken(parser: Parser, i: number, end: number): boolean {
  const token = (k: number) => parser.latex(k, k + 1).trim();
  const t = token(i);
  if (t === '\\differentialD') return true;
  if (t !== 'd') return false;
  let next = i + 1;
  // `\mathrm{d}` and `\operatorname{d}`: the variable follows the brace
  if (
    i >= 2 &&
    token(i - 1) === '{' &&
    (token(i - 2) === '\\mathrm' || token(i - 2) === '\\operatorname')
  ) {
    if (token(next) !== '}') return false;
    next += 1;
  }
  while (next < end && VISUAL_SPACE_TOKENS.has(token(next))) next += 1;
  if (next >= end) return false;
  const v = token(next);
  return v === '{' || /^\p{L}\p{M}*$/u.test(v) || /^\\[a-zA-Z]+$/.test(v);
}

/**
 * True when the body `fn` of an integral, with the differentials `indexes`
 * read after it, holds the differential of the integral: in `indexes`, in a
 * term of a sum (`splitSumAtDifferential()`), or as the extra differentials
 * of an inner integral (`claimExcessDifferentials()`).
 */
function holdsIntegrand(
  fn: MathJsonExpression | null,
  indexes: readonly string[],
  binderName: (expr: MathJsonExpression | null | undefined) => string | null
): boolean {
  if (indexes.length > 0) return true;
  if (fn === null) return false;
  return (
    splitSumAtDifferential(fn, binderName)[2].length > 0 ||
    claimExcessDifferentials(fn) !== null ||
    claimExcessDifferentialsInSum(fn) !== null
  );
}

/**
 * Make the integral of `fn`, then add the terms of `rest` after it (see
 * `addTerms()`). When the integral has more differentials than signs, record
 * its parts on the result (see `excessDifferentials`), so that an enclosing
 * integral can take the extra differentials. `integrandEnd` is the token
 * index where the integrand ends and the terms of `rest` begin. Return
 * `null` when `makeIntegral()` gives no integral and `rest` is empty.
 */
function finishIntegral(
  command: string,
  fn: MathJsonExpression | null,
  limits: {
    indexes: string[];
    subs: MathJsonExpression[];
    sups: MathJsonExpression[];
    nIntegrals: number;
  },
  rest: SignedTerm[],
  integrandEnd: number
): MathJsonExpression | null {
  const { indexes, subs, sups, nIntegrals } = limits;
  // `makeIntegral()` adds entries to `subs` and `sups`: the recorded parts
  // keep copies.
  const parts: IntegralParts | null =
    fn !== null && indexes.length > nIntegrals
      ? {
          command,
          fn,
          indexes,
          subs: [...subs],
          sups: [...sups],
          nIntegrals,
          rest,
          integrandEnd,
        }
      : null;
  const integral = makeIntegral(command, fn, { indexes, subs, sups });
  if (integral === null && rest.length === 0) return null;
  const result = addTerms(integral ?? 'Nothing', rest);
  if (parts !== null && Array.isArray(result)) {
    excessDifferentials.set(result, parts);
    const first = operator(result) === 'Add' ? operand(result, 1) : null;
    if (Array.isArray(first)) mergedExcessDifferentials.set(first, result);
  }
  return result;
}

/**
 * When `body` is an integral that took more differentials than it has signs
 * (see `excessDifferentials`), make it again with one differential per sign,
 * the first ones in the written order. Return it as `fn`, with the other
 * differentials, which belong to the enclosing integral, as `indexes`, the
 * terms that were written after its integrand, which go after the enclosing
 * integral, as `rest`, and the token index where these terms begin as
 * `integrandEnd`. Return `null` otherwise.
 *
 * Such an integral is also found as the last factor of a product
 * (`2\int_3^4 \frac{dx\,dy}{xy}`) or as the operand of a negation, at any
 * depth: `fn` is then the product or the negation with the integral made
 * again in it. A product is searched only at its last factor, as
 * `parseSubintegrand()` searches it for a differential. That factor or that
 * operand can be a sum, from a brace group that the parser does not keep
 * (`2{\int_3^4 \frac{dx\,dy}{xy} + 5}`): it is searched as
 * `claimExcessDifferentialsInSum()` searches a sum.
 */
function claimExcessDifferentials(
  body: MathJsonExpression
): ClaimedDifferentials | null {
  if (!Array.isArray(body)) return null;
  const parts = excessDifferentials.get(body);
  if (parts !== undefined) {
    const inner = makeIntegral(parts.command, parts.fn, {
      indexes: parts.indexes.slice(0, parts.nIntegrals),
      subs: [...parts.subs],
      sups: [...parts.sups],
    });
    if (inner === null) return null;
    return {
      fn: inner,
      indexes: parts.indexes.slice(parts.nIntegrals),
      rest: parts.rest,
      integrandEnd: parts.integrandEnd,
    };
  }
  const h = operator(body);
  const inOperand = (expr: MathJsonExpression) =>
    claimExcessDifferentials(expr) ?? claimExcessDifferentialsInSum(expr);
  if (h === 'Negate' && nops(body) === 1) {
    const claimed = inOperand(operand(body, 1)!);
    if (claimed === null) return null;
    return { ...claimed, fn: ['Negate', claimed.fn] };
  }
  if ((h === 'Multiply' || h === 'InvisibleOperator') && nops(body) >= 2) {
    const args = operands(body);
    const claimed = inOperand(args[args.length - 1]);
    if (claimed === null) return null;
    return { ...claimed, fn: [h, ...args.slice(0, -1), claimed.fn] };
  }
  return null;
}

/**
 * When a term of the sum or the difference `sum` holds an integral that took
 * more differentials than it has signs, make that integral again as
 * `claimExcessDifferentials()` does. Return the sum with that integral as
 * `fn`, and the other parts as that function returns them. Return `null`
 * otherwise.
 *
 * The terms are searched in order, and the first term that holds such an
 * integral is taken. A term can be a product or a negation that holds the
 * integral, or again a sum or a difference (`1 + 2 - I` is
 * `Add(1, Subtract(2, I))`).
 *
 * At the top level of the body of an integral, such an integral is in the
 * last term: the body ends after the term that holds it (see
 * `stopAfterTerm()`). A term can follow it inside a brace group, which the
 * parser does not keep: in `\int_1^2 1-{\int_3^4 \frac{dx\,dy}{xy} + 5}` the
 * body is `Subtract(1, Add(I, 5))`. The enclosing integral takes `dy`, and
 * the 5 stays in its integrand, inside the group that is subtracted.
 *
 * An inner integral whose integrand is a brace group with terms after the
 * differentials (`\int_3^4 {\frac{dx\,dy}{xy} + 5}`) returns `Add(I, 5)`,
 * with the 5 in `rest`. The parser of `+` does not keep a right operand that
 * is a sum: `1 + Add(I, 5)` is `Add(1, I, 5)`, and the recorded result is
 * not an operand. Its operands are the last operands of `sum`, as the same
 * objects, so it is found from its first operand (see
 * `mergedExcessDifferentials`); the integral made again replaces them, and
 * the 5 goes after the enclosing integral.
 */
function claimExcessDifferentialsInSum(
  sum: MathJsonExpression
): ClaimedDifferentials | null {
  const h = operator(sum);
  if ((h !== 'Add' || nops(sum) < 2) && (h !== 'Subtract' || nops(sum) !== 2))
    return null;
  const args = operands(sum);
  for (let i = 0; i < args.length; i++) {
    const merged = Array.isArray(args[i])
      ? mergedExcessDifferentials.get(args[i] as object)
      : undefined;
    if (merged !== undefined) {
      const mergedArgs = operands(merged);
      if (
        mergedArgs.length === args.length - i &&
        mergedArgs.every((arg, k) => arg === args[i + k])
      ) {
        const claimed = claimExcessDifferentials(merged);
        if (claimed !== null)
          return { ...claimed, fn: [h, ...args.slice(0, i), claimed.fn] };
      }
    }
    const claimed =
      claimExcessDifferentials(args[i]) ??
      claimExcessDifferentialsInSum(args[i]);
    if (claimed === null) continue;
    return {
      ...claimed,
      fn: [h, ...args.slice(0, i), claimed.fn, ...args.slice(i + 1)],
    };
  }
  return null;
}

/**
 * Add each term of `terms` to `expr`, or subtract it when it is marked
 * negative, in order: `addTerms(I, [[1, false], [2, true]])` is
 * `Subtract(Add(I, 1), 2)`. Return `expr` itself when `terms` is empty.
 */
function addTerms(
  expr: MathJsonExpression,
  terms: readonly SignedTerm[]
): MathJsonExpression {
  let result = expr;
  for (const [term, negative] of terms) {
    if (negative) result = ['Subtract', result, term];
    else if (operator(result) === 'Add')
      result = ['Add', ...operands(result), term];
    else result = ['Add', result, term];
  }
  return result;
}

function makeIntegral(
  command: string,
  fn: MathJsonExpression | null,
  limits: {
    indexes: string[];
    subs: MathJsonExpression[];
    sups: MathJsonExpression[];
  }
): MathJsonExpression | null {
  if (!fn) return null;

  // The differentials of a multiple integral are written innermost first:
  // in `\iint f\,dx\,dy` the integral over `x` is inside the integral over
  // `y`. The first limit of `Integrate` is the outermost integral (the
  // evaluation and `nIntegrateMultiple()` in `library/calculus.ts` use this
  // order, as `Sum` and `Product` do), so the indexes are reversed:
  // `Integrate(f, y, x)`. The bounds written on the sign (`\iint_D`) stay
  // with the first limit, the outermost integral, as the bounds of the first
  // sign of `\int_a^b\int_c^d f\,dx\,dy` are those of the integral over `y`.
  const outerFirst = [...limits.indexes].reverse();

  //
  // Make the tuples
  //

  if (limits.sups.length === 0 && limits.subs.length === 0) {
    // No limits, just the function
    // if (args.length === 0) return [command, fn];
    return [command, fn, ...outerFirst];
  }

  // Use the provided indexes, or if none, use the arguments of the function
  const indexes =
    outerFirst.length === 0
      ? operator(fn) === 'Function'
        ? operands(fn).slice(1)
        : []
      : outerFirst;

  const count = Math.max(
    limits.sups.length,
    limits.subs.length,
    indexes.length
  );

  if (indexes.length === 0) {
    // If we have no indexes, fill them in
    // e.g. \int_0^1 \sin
    for (let i = 0; i < count; i++) indexes.push('Nothing');
  } else if (indexes.length !== count) {
    // We have more limits than indexes, or more indexes than limits
    // fill the missing indexes with error messages
    for (let i = indexes.length; i < count; i++)
      indexes.push(['Error', "'missing'"]);
  }

  if (limits.subs.length !== count) {
    // We have more indexes than subs.
    for (let i = limits.subs.length; i < count; i++)
      limits.subs.push('Nothing');
  }

  if (limits.sups.length !== count) {
    // We have more indexes than sups.
    for (let i = limits.sups.length; i < count; i++)
      limits.sups.push('Nothing');
  }

  const tuples = indexes.map((idx, i) => {
    const sup = limits.sups[i];
    const sub = limits.subs[i];
    if (sub === 'Nothing' && sup === 'Nothing')
      return idx as MathJsonExpression;

    return ['Tuple', idx, sub, sup] as MathJsonExpression;
  });

  return [command, fn, ...tuples];
}

/**  Parse the body of an integral (up to a relational operator, or the boundary)
 *
 * `maxIndexes` caps how many trailing differentials this integral level
 * consumes (see `parseIntegral`). The remaining differentials are left in the
 * stream for the enclosing integrals of a nested expression.
 *
 * The body also stops at a `+` or a `-` after the term that holds the
 * differential (see `stopAfterTerm()`).
 */
function parseIntegralBody(
  parser: Parser,
  maxIndexes: number,
  stops: BodyStops
): [body: MathJsonExpression | null, indexes: string[]] {
  let found = false;

  // The body also stops at the end of a `cases` or matrix cell
  // (`endsTabularCell`), for an integral with no differential. While it is
  // read, it is the innermost active body: an inner integral records its
  // result in `stops.cache` (see `parseIntegral()`).
  let bodies = activeBodies.get(parser);
  if (bodies === undefined) {
    bodies = [];
    activeBodies.set(parser, bodies);
  }
  bodies.push(stops);
  let fn: MathJsonExpression | null;
  try {
    fn = parser.parseExpression({
      minPrec: 266,
      condition: () => {
        found = atDifferential(parser);
        return (
          found ||
          endsTabularCell(parser.peek) ||
          stopAfterTerm(parser, stops)
        );
      },
    });
  } finally {
    bodies.pop();
  }
  // The integrand is a group: a restriction in it (`\int_0^1 f(x)\{c\}\,dx`)
  // covers the integrand, not the integral.
  if (fn !== null) fn = parser._liftRestrictions(fn);

  // If we didn't get a `\operatorname{d}x` or `dx` at the same level as the
  // expression, perhaps it was in a subexpression, e.g. `\frac{dx}{x}` or `3xdx`
  if (fn !== null && !found)
    return parseSubintegrand(fn, binderNameFor(parser));

  return [fn, parseIndexes(parser, maxIndexes)];
}

/** The name of the variable that an expression read in a binder position
 * names: a symbol, or the joined name of a subscript on an indexed
 * collection (`At(n, 0)` from `n_{0}` names `n_0`, see
 * `Parser.binderSymbol()`). */
function binderNameFor(
  parser: Parser
): (expr: MathJsonExpression | null | undefined) => string | null {
  return (expr) => parser.binderSymbol(expr) ?? symbol(expr);
}

/** Assuming we are at a differential operator, parse one
 * or more indexes that follow it.
 *
 * At most `maxIndexes` indexes are consumed: a single `\int` claims one
 * differential, `\iint` two, etc. Any further differentials belong to the
 * enclosing integral(s) of a nested expression and are left untouched.
 */
function parseIndexes(parser: Parser, maxIndexes: number): string[] {
  const indexes: string[] = [];
  while (indexes.length < maxIndexes) {
    // A `d` with no variable after it (`\iint f\,dx\,d`) is not a
    // differential: it is left in the stream, to be read as a symbol.
    const index = readDifferential(parser);
    if (index === null) break;
    // A variable spelled as a subscript on an indexed collection (`dn_{0}`
    // when `n` is a list) is the new name `n_0`
    indexes.push(parser._takeDeclinedSubscriptJoin?.(index) ?? index);
  }

  return indexes;
}

/** Parse a sub expression that may contain indexes, for example `2xdx` */
function parseSubintegrand(
  expr: MathJsonExpression,
  binderName: (expr: MathJsonExpression | null | undefined) => string | null
): [body: MathJsonExpression | null, indexes: string[]] {
  const h = operator(expr);
  const op1 = operand(expr, 1);
  // `null` means there is no first operand. A literal `0` first operand is a
  // legitimate subintegrand (`\int 0\,dx`) and must not be treated as absent.
  if (op1 === null) return [expr, []];

  if (h === 'Sequence' && nops(expr) === 1)
    return parseSubintegrand(op1, binderName);

  if (h === 'Multiply' || h === 'InvisibleOperator') {
    // Handle the case `3xdx` where the `dx` is the last term of a
    // multiplication (in a subexpression, i.e. `\sin 3xdx`)
    // There could be consecutive `dx` terms, e.g. `3xdxdy`, we
    // want to extract all of them.
    // A space after the last factor (`\frac{dx}{x}\,`) does not stop the
    // search for the differential in that factor.
    const args = withoutFinalSpacing(operands(expr));

    if (args) {
      const [rest, indexes] = parseFinalDiffOperators(args, binderName);
      if (indexes.length === 0 && args.length > 0) {
        // The differential can be at the end of the last factor:
        // `2\frac{dx}{x}` is `InvisibleOperator(2, Divide(...))` and
        // `3(x\,dx)` is `InvisibleOperator(3, Delimiter(...))`. The last
        // factor is searched as if it were the whole body, and the factors
        // before it stay in the product.
        const init = args.slice(0, -1);
        const lastFactor = args[args.length - 1];
        const [last, lastIndexes] = parseSubintegrand(lastFactor, binderName);
        if (lastIndexes.length === 0) return [expr, []];
        // Parentheses that hold only the differential after a symbol
        // (`2f(dx)`) are not taken out: the symbol can be a function, and
        // `f(dx)` its call. Taking them out would leave `2f`.
        if (
          last === null &&
          operator(lastFactor) === 'Delimiter' &&
          init.length > 0 &&
          symbol(init[init.length - 1]) !== null
        )
          return [expr, []];
        const factors = last === null ? init : [...init, last];
        if (factors.length === 0) return [null, lastIndexes];
        if (factors.length === 1) return [factors[0], lastIndexes];
        // An integer and a fraction side by side are a mixed number
        // (`2\frac{1}{3}` is 7/3), but `2\frac{dx}{3}` is the product 2/3:
        // with the differential taken out, the fraction must stay a factor.
        if (
          h === 'InvisibleOperator' &&
          factors.length === 2 &&
          operator(factors[1]) === 'Divide'
        )
          return [['Multiply', ...factors], lastIndexes];
        return [[h, ...factors], lastIndexes];
      }
      // A single factor before the differentials is not wrapped in a product:
      // `f(x\,dx)` must keep the argument `x`, not `InvisibleOperator(x)`.
      if (rest.length === 1) return [rest[0], indexes];
      if (rest.length > 0) return [[h, ...rest], indexes];
      return [null, indexes];
    }
  } else if (h === 'Delimiter') {
    const [fn2, indexes] = parseSubintegrand(op1, binderName);
    if (indexes.length > 0) {
      // `null`, not falsiness: a literal `0` is a body, and reading it as an
      // absent one would drop a parenthesized zero integrand.
      if (fn2 === null) {
        // The indexes were in parens: `\int f (dxdy)`
        return [null, indexes];
      }
      // A subexpression and the indexes were in parens:
      // `\int (3x + 2 dx)`. The body is the first operand of the
      // `Delimiter`, as the parser writes `(a+b)`: `Delimiter(Add(a, b))`.
      // A `Sequence` there would canonicalize to a `Tuple`.
      return [['Delimiter', fn2, ...operands(expr).slice(1)], indexes];
    }
  } else if (h === 'Add') {
    const args = operands(expr);
    if (args.length > 0) {
      const [fn2, indexes] = parseSubintegrand(
        args[args.length - 1],
        binderName
      );
      if (indexes.length > 0) {
        // `null`, not falsiness: a literal `0` term is kept.
        if (fn2 !== null) return [['Add', ...args.slice(0, -1), fn2], indexes];
        if (args.length > 2) return [['Add', ...args.slice(0, -1)], indexes];
        if (args.length === 2) return [args[0], indexes];
      }
    }
  } else if (h === 'Negate') {
    const [fn2, indexes] = parseSubintegrand(op1, binderName);
    // `null`, not falsiness: `-(0\,dx)` is the integral of 0, not of 1.
    if (indexes.length > 0)
      return [fn2 !== null ? ['Negate', fn2] : null, indexes];
  } else if (h === 'Divide') {
    const [fn2, indexes] = parseSubintegrand(op1, binderName);
    if (indexes.length > 0)
      return [['Divide', fn2 ?? 1, operand(expr, 2)!], indexes];
    // A differential at the end of the denominator (`\frac{3x}{5dx}`) is
    // malformed: the denominator is replaced by an error (CE-305.5).
    const denominator = operand(expr, 2);
    if (
      denominator !== null &&
      parseSubintegrand(denominator, binderName)[1].length > 0
    )
      return [['Divide', op1, ['Error', "'unexpected-differential'"]], []];
  } else {
    // Some other function, e.g. trig function, etc...
    const args = operands(expr);
    if (args.length === 1) {
      //If it has a single argument, we'll check if it includes an index
      // e.g. \sin 2xdx
      // An argument that is only the differential (`2\sin(dx)`) is not
      // taken out: the function would be left with no argument.
      const [arg2, indexes] = parseSubintegrand(args[0], binderName);
      if (indexes.length > 0 && arg2 !== null)
        return [[operator(expr), arg2] as MathJsonExpression, indexes];
    }
  }

  return [expr, []];
}

/**
 * Replace by an `unexpected-differential` error each differential in `expr`
 * that cannot be the differential of the integral, at any depth. Call it only
 * when the integral found fewer differentials than it has integral signs:
 * in the body of an integral that has all its differentials, a `d` before a
 * variable is a product (`dy` in `\int_0^1 \frac{ax+by}{cx+dy}\,dx`).
 * Return `expr` itself when there is no such differential.
 *
 * Two places are marked:
 * - the denominator of a `Divide` that ends with a differential
 *   (`\frac{3x}{5dx}`) is replaced by the error. `parseSubintegrand` detects
 *   such a denominator only when the fraction is the whole body; a fraction
 *   inside a product, a sum, a negation, parentheses or a function argument
 *   is found here.
 * - a factor of a product, other than the last factor, that holds a
 *   differential (`\frac{dx}{x}` in `\frac{dx}{x}\cdot 2`) is replaced by the
 *   error. `parseSubintegrand` searches a product for the differential only
 *   at its end and in its last factor. Without the error, the `d` stays a
 *   free symbol, the canonical form takes it as the integration variable, and
 *   `\int_1^2 \frac{dx}{x}\cdot 2` evaluates to 3, not 2 ln 2. Parentheses
 *   that hold only the differential after a symbol (`f(dx)\cdot 2`) are not
 *   marked: the symbol can be a function and the parentheses its call.
 *   `parseSubintegrand` does not take such parentheses out of the last factor
 *   either. Parentheses that hold more (`x(x\,dx)\cdot 2`) are marked.
 */
function markMisplacedDifferentials(
  expr: MathJsonExpression,
  binderName: (expr: MathJsonExpression | null | undefined) => string | null
): MathJsonExpression {
  const h = operator(expr);
  if (!h) return expr;
  const args = operands(expr);
  if (h === 'Divide' && args.length === 2) {
    if (parseSubintegrand(args[1], binderName)[1].length > 0)
      return [
        'Divide',
        markMisplacedDifferentials(args[0], binderName),
        ['Error', "'unexpected-differential'"],
      ];
  }
  const isProduct = h === 'Multiply' || h === 'InvisibleOperator';
  let changed = false;
  const newArgs = args.map((arg, i) => {
    if (isProduct && i < args.length - 1) {
      const [body, indexes] = parseSubintegrand(arg, binderName);
      if (
        indexes.length > 0 &&
        !(
          body === null &&
          operator(arg) === 'Delimiter' &&
          i > 0 &&
          symbol(args[i - 1]) !== null
        )
      ) {
        changed = true;
        return ['Error', "'unexpected-differential'"] as MathJsonExpression;
      }
    }
    const result = markMisplacedDifferentials(arg, binderName);
    if (result !== arg) changed = true;
    return result;
  });
  return changed ? ([h, ...newArgs] as MathJsonExpression) : expr;
}

/**
 * Split a sum or a difference at the term that holds a differential, for
 * example `\int 3x + \frac{x\,dx}{2} - 1`.
 *
 * Return the integrand (the terms before that term and that term, with the
 * differential removed), the terms after it with their sign (`true` when the
 * term is subtracted), and the indexes of the differential. The integrand is
 * `null` when it has no term: `(dx) + 1`. When no term holds a differential,
 * the indexes are empty and the integrand is `expr`.
 *
 * The parser nests a difference in a sum and in a difference (`a - b + c` is
 * `Add(Subtract(a, b), c)`), so each operand that is a sum or a difference is
 * split recursively. A term that is only a differential (`(dx)`) is removed.
 */
function splitSumAtDifferential(
  expr: MathJsonExpression,
  binderName: (expr: MathJsonExpression | null | undefined) => string | null
): [body: MathJsonExpression | null, rest: SignedTerm[], indexes: string[]] {
  const h = operator(expr);
  if (h === 'Subtract' && nops(expr) === 2) {
    const lhs = operand(expr, 1)!;
    const rhs = operand(expr, 2)!;
    const [body, rest, indexes] = splitSumAtDifferential(lhs, binderName);
    if (indexes.length > 0) return [body, [...rest, [rhs, true]], indexes];

    // The differential is in the subtracted operand: `a - (B + R)` is
    // `(a - B) - R`, so the sign of each term after it changes.
    const [rhsBody, rhsRest, rhsIndexes] = splitSumAtDifferential(
      rhs,
      binderName
    );
    if (rhsIndexes.length > 0) {
      return [
        rhsBody === null ? lhs : ['Subtract', lhs, rhsBody],
        rhsRest.map(([term, negative]) => [term, !negative]),
        rhsIndexes,
      ];
    }
    return [expr, [], []];
  }

  if (h === 'Add') {
    const terms = operands(expr);
    for (let i = 0; i < terms.length; i++) {
      const [body, rest, indexes] = splitSumAtDifferential(
        terms[i],
        binderName
      );
      if (indexes.length === 0) continue;
      const bodyTerms = [...terms.slice(0, i)];
      if (body !== null) bodyTerms.push(body);
      return [
        bodyTerms.length === 0
          ? null
          : bodyTerms.length === 1
            ? bodyTerms[0]
            : ['Add', ...bodyTerms],
        [
          ...rest,
          ...terms.slice(i + 1).map((term): SignedTerm => [term, false]),
        ],
        indexes,
      ];
    }
    return [expr, [], []];
  }

  const [body, indexes] = parseSubintegrand(expr, binderName);
  return [body, [], indexes];
}

/**
 * The token index where the integrand ends, when the differential is inside
 * one term of a sum or a difference (`\int \frac{dx}{x} + 1`).
 *
 * This is the first `+` or `-` at the top level of the body (outside braces,
 * parentheses and brackets) after the first differential operator token (`d`
 * or `\differentialD`) at or after `start`. When no `+` or `-` follows it, the
 * integrand ends at `end`. When no differential operator token is found,
 * return `start`: the span is empty.
 *
 * The tokens are read with `parser.latex()`, and `parser.index` does not
 * change: moving the index back would discard the diagnostics of the body.
 * The result is used only for diagnostics, never for the parse output.
 */
function integrandEndToken(parser: Parser, start: number, end: number): number {
  let depth = 0;
  let afterDifferential = false;
  for (let i = start; i < end; i++) {
    const token = parser.latex(i, i + 1).trim();
    if (token === 'd' || token === '\\differentialD') afterDifferential = true;
    else if (token === '{' || token === '(' || token === '[') depth += 1;
    else if (token === '}' || token === ')' || token === ']') depth -= 1;
    else if (
      afterDifferential &&
      depth === 0 &&
      (token === '+' || token === '-')
    )
      return i;
  }
  return afterDifferential ? end : start;
}

/**
 * The token index of the first `+` or `-` at any depth after the first
 * differential operator token (`d` or `\differentialD`) in the tokens from
 * `start` to `end`, when the body of an integral is a sum whose integrand is
 * the terms up to the one that holds the differential. Return `start` when
 * there is no such sign.
 *
 * The result is never after the true end of the integrand: the integrand
 * ends at a `+` or `-` token (the only triggers of `Add` and `Subtract`)
 * that comes after the `d` of its differential, and so after the first `d`
 * token. It can be before it: in `\int \frac{dx}{1+x} + d` it is the `+` of
 * `1+x`. Unlike `integrandEndToken()`, it does not count brackets, which
 * give a wrong depth for a group that the parser does not keep
 * (`\int {\frac{x\,dx}{2} + d}`) or a null delimiter (`\right.`).
 *
 * The tokens are read with `parser.latex()`, and `parser.index` does not
 * change. The result is used only for diagnostics.
 */
function firstSignAfterDifferential(
  parser: Parser,
  start: number,
  end: number
): number {
  let afterDifferential = false;
  for (let i = start; i < end; i++) {
    const token = parser.latex(i, i + 1).trim();
    if (token === 'd' || token === '\\differentialD') afterDifferential = true;
    else if (afterDifferential && (token === '+' || token === '-')) return i;
  }
  return start;
}

/**
 * Remove the `undeclared-symbol` diagnostics of the symbols `d` and
 * `d_upright` (`\mathrm{d}`) in the tokens from `start` to `end` (the
 * current position when `end` is not given), when none of the expressions
 * `parsed` holds one of these symbols. The tokens are the integrand and its
 * differentials, or, for a sum, the terms after the integrand, and `parsed`
 * is the MathJSON that the parser made of these tokens after it took out the
 * differentials.
 *
 * A differential at the top level of the integrand (`\int x\,dx`) is read by
 * `matchDifferentialOperator()`: its `d` is not a symbol and has no
 * diagnostic. A differential inside a sub-expression (`\int \frac{dx}{x}`) is
 * first read as the product of the symbol `d` and the variable, which records
 * a diagnostic for `d`, and `parseSubintegrand()` then takes it out of the
 * product. When `parsed` holds no `d`, every `d` read in these tokens was a
 * differential, and its diagnostic is removed.
 *
 * When `parsed` holds a `d`, the MathJSON does not show which `d` token
 * is the free symbol, so every diagnostic stays: in `\int \frac{d\,dx}{x}`
 * both `d` fire, also the `d` of the differential. A false report is
 * accepted, and a free `d` is never hidden. Diagnostics only: the parse
 * result does not change.
 */
function pruneDifferentialOperators(
  parser: Parser,
  checkpoint: number,
  start: number,
  parsed: ReadonlyArray<MathJsonExpression | null>,
  end?: number
): void {
  if (parsed.some((expr) => holdsSymbol(expr, DIFFERENTIAL_SYMBOLS))) return;
  if (end === undefined)
    parser._pruneUndeclared(DIFFERENTIAL_SYMBOLS, checkpoint, start);
  // The body start given is the current index: no diagnostic collected so
  // far starts at or after it, so only the span from `start` to `end` is
  // pruned.
  else
    parser._pruneUndeclared(DIFFERENTIAL_SYMBOLS, checkpoint, parser.index, [
      [start, end],
    ]);
}

/** The symbols that a differential operator read inside a sub-expression of
 * an integrand becomes: `d` for `d` and `\operatorname{d}`, `d_upright` for
 * `\mathrm{d}`. */
const DIFFERENTIAL_SYMBOLS: ReadonlySet<string> = new Set(['d', 'd_upright']);

/** True when `expr` holds one of the symbols `names`, as a symbol or as the
 * name of a function, at any depth. A dictionary counts as holding them,
 * because its values are not walked. */
function holdsSymbol(
  expr: MathJsonExpression | null,
  names: ReadonlySet<string>
): boolean {
  if (expr === null) return false;
  const name = symbol(expr);
  if (name !== null) return names.has(name);
  if (isDictionaryObject(expr)) return true;
  if (names.has(operator(expr))) return true;
  return operands(expr).some((arg) => holdsSymbol(arg, names));
}

function serializeIntegral(command: string) {
  return (serializer: Serializer, expr: MathJsonExpression): string => {
    // Test for ABSENCE, not for falsiness: `operand()` answers `null` when the
    // operand is missing, but the literal `0` is its own falsy MathJSON, so a
    // truthiness test discards the integrand and `\int 0\,dx` serializes to a
    // bare `\int`.
    if (operand(expr, 1) === null) return command;

    // The arguments of the Integrate command are:
    // - the integrand (a function to integrate) as a function literal:
    //    - either a ["Function", body, arg1, arg2] expression
    //    - or a symbol (e.g. "Sin")
    //    - or a shorthand function literal
    // - one or more limits of the form
    //    - limits(index, lower, upper) (the index must match the arguments  of the function)
    //    - limits(lower, upper)
    //    - tuple(index, lower, upper) or range(lower, upper)
    //    - index: symbol (an unknown, that must be an argument of the function)

    let body = operand(expr, 1);
    let args: ReadonlyArray<MathJsonExpression> = [];
    if (operator(body) === 'BuiltInFunction') {
      args = ['x'];
      body = [operand(body, 1) as string, 'x'];
    } else if (operator(body) === 'Function') {
      args = operands(body).slice(1);
      body = operand(body, 1);
    } else if (symbol(body)) {
      // A function literal, e.g. `\sin`, keep it as `\sin`
      args = [];
    } else {
      // A shorthand function literal, e.g. `\sin(x)`, keep the body as is.
      args = [];
    }

    // An integral with no limit (the canonical form drops a limit with four
    // elements) takes its variables from the parameters of the integrand: one
    // integral sign and one differential for each parameter, so that a parse
    // of the LaTeX gets the variables back. An integrand with no parameter
    // (a function name such as `\sin`) gets one sign and no differential.
    let limits: ReadonlyArray<MathJsonExpression> = operands(expr).slice(1);
    if (limits.length === 0) limits = args.length > 0 ? args : ['Nothing'];

    // We're going to build the prefix: the '\int' commands with limits, and the suffix, the dx, then put it all together
    const indexes: string[] = [];

    const prefix = limits.map((limit, i) => {
      if (symbol(limit) === 'Nothing') {
        indexes.push(symbol(args[i]) ?? 'Nothing');
        return '';
      }

      if (symbol(limit)) {
        indexes.push(symbol(limit) ?? 'Nothing');
        return '';
      }

      const h = operator(limit);
      // A 3-element `Tuple` limit serializes to MathJSON as `Triple` (see
      // serialize.ts arity mapping), so it must be recognized here too —
      // otherwise `CircularIntegrate`'s `Triple` limits fall through and emit
      // `\ointundefined`.
      if (
        h === 'Tuple' ||
        h === 'Triple' ||
        h === 'Pair' ||
        h === 'Limits' ||
        h === 'Range'
      ) {
        if (nops(limit) === 3) {
          const index = operand(limit, 1);
          indexes.push(symbol(index) ?? 'Nothing');
          let lower = operand(limit, 2);
          let upper = operand(limit, 3);
          if (symbol(lower) === 'Nothing') lower = null;
          if (symbol(upper) === 'Nothing') upper = null;

          if (lower !== null && upper !== null)
            return `_{${serializer.serialize(lower)}}^{${serializer.serialize(
              upper
            )}}`;
          if (lower !== null) return `_{${serializer.serialize(lower)}}`;
          if (upper !== null) return `^{${serializer.serialize(upper)}}`;
          return '';
        }
        return `_{${serializer.serialize(limit)}}`;
      }
      if (nops(limit) === 2) {
        if (symbol(operand(limit, 1))) {
          // Tuple["x", 1]
          indexes.push(symbol(operand(limit, 1)) ?? 'Nothing');
          const lower = operand(limit, 2);
          if (symbol(lower) === 'Nothing') return '';
          return `_{${serializer.serialize(lower)}}`;
        }
        // Tuple[1, 2]
        indexes.push(symbol(args[i]) ?? 'Nothing');

        let lower = operand(limit, 1);
        let upper = operand(limit, 2);
        if (symbol(lower) === 'Nothing') lower = null;
        if (symbol(upper) === 'Nothing') upper = null;

        if (lower !== null && upper !== null)
          return `_{${serializer.serialize(lower)}}^{${serializer.serialize(
            upper
          )}}`;
        if (lower !== null) return `_{${serializer.serialize(lower)}}`;
        if (upper !== null) return `^{${serializer.serialize(upper)}}`;
      } else {
        indexes.push(symbol(args[i]) ?? 'Nothing');
      }
    });

    // The first limit is the outermost integral, and the differentials are
    // written innermost first: `Integrate(f, y, x)` is `\iint f\,dx\,dy`.
    let suffix = indexes
      .reverse()
      .filter((x) => symbol(x) !== 'Nothing')
      .map((arg) => `\\mathrm{d}${serializer.serialize(symbol(arg) ?? 'x')}`);
    if (suffix.length > 0) suffix = ['\\,', ...suffix];

    // A flat, single-level multiple integral (`["Integrate", f, limitsX,
    // limitsY]`, as produced by `\iint` / `\iiint`) serializes back to the
    // compact `\iint` / `\iiint` (or `\oiint` / `\oiiint`) sign rather than a
    // stack of `\int`s, so it round-trips to the same structure.
    const compactSign = compactMultiIntegralSign(command, prefix);
    if (compactSign !== null)
      return (
        compactSign + '\\!' + serializer.serialize(body) + suffix.join(' ')
      );

    // The first limit is the outermost integral, so its sign is written
    // first: `Integrate(f, Limits(y, a, b), Limits(x, c, d))` is
    // `\int_a^b\int_c^d f\,dx\,dy`
    return (
      prefix.map((x) => `${command}${x}`).join('') +
      '\\!' +
      serializer.serialize(body) +
      suffix.join(' ')
    );
  };
}

/** The compact multi-sign command (`\iint` / `\iiint` / `\oiint` / `\oiiint`)
 * for a flat 2- or 3-limit integral whose extra limits are bare, or `null` to
 * fall back to the iterated `\int…\int…` serialization. Those signs carry a
 * single region subscript, so every limit past the first must be bare —
 * otherwise the compact form would lose or garble per-variable bounds. (Nested
 * integrals serialize one limit per level and never reach here.) */
function compactMultiIntegralSign(
  command: string,
  prefix: ReadonlyArray<string | undefined>
): string | null {
  const n = prefix.length;
  if (n !== 2 && n !== 3) return null;
  const variants: Record<string, [twofold: string, threefold: string]> = {
    '\\int': ['\\iint', '\\iiint'],
    '\\oint': ['\\oiint', '\\oiiint'],
  };
  const variant = variants[command];
  if (!variant) return null;
  if (prefix.slice(1).some((p) => p)) return null;
  return variant[n - 2] + (prefix[0] ?? '');
}
export const DEFINITIONS_CALCULUS: LatexDictionary = [
  {
    kind: 'expression',
    name: 'Integrate',
    latexTrigger: ['\\int'],

    parse: parseIntegral('Integrate'),
    serialize: serializeIntegral('\\int'),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\iint'],
    parse: parseIntegral('Integrate', 2),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\iiint'],
    parse: parseIntegral('Integrate', 3),
  },
  {
    kind: 'expression',
    name: 'CircularIntegrate',
    latexTrigger: ['\\oint'],
    parse: parseIntegral('CircularIntegrate'),
    serialize: serializeIntegral('\\oint'),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\oiint'],
    parse: parseIntegral('CircularIntegrate', 2),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\oiiint'],
    parse: parseIntegral('CircularIntegrate', 3),
  },

  //
  // Series expansion, the inert `BigO` remainder, and `Normal`.
  //
  // An unevaluated `Series(...)` and `Normal(...)` serialize with
  // `\operatorname{…}` (and round-trip through the default `\operatorname`
  // parsing). `BigO(u)` serializes as `O\left(u\right)`; it is parsed from
  // `\mathcal{O}(…)` and `\operatorname{O}(…)` (there is deliberately no bare
  // `O(` capture).
  //
  {
    kind: 'expression',
    name: 'Series',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      '\\operatorname{Series}' + serializer.wrapArguments(expr),
  },
  {
    kind: 'expression',
    name: 'Normal',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      '\\operatorname{Normal}' + serializer.wrapArguments(expr),
  },
  {
    // The dense-output data table of an `InterpolatingFunction` (produced by
    // `NDSolveFunction`) is elided in LaTeX: only the covered interval (and
    // the applied argument, if any) is displayed. The full data round-trips
    // through MathJSON, not LaTeX.
    kind: 'expression',
    name: 'InterpolatingFunction',
    serialize: (serializer: Serializer, expr: MathJsonExpression): string => {
      const data = operand(expr, 1);
      // data = List of rows [x, h, r1..r5]: the domain is the first row's x
      // to the last row's x + h.
      let domain = '';
      if (operator(data) === 'List' && nops(data) > 0) {
        const rows = operands(data);
        const firstRow = rows[0];
        const lastRow = rows[rows.length - 1];
        const toNum = (e: MathJsonExpression | null): number | null => {
          if (typeof e === 'number') return e;
          if (e !== null && typeof e === 'object' && 'num' in e)
            return parseFloat(e.num);
          return null;
        };
        const x0 = toNum(operand(firstRow, 1));
        const xLast = toNum(operand(lastRow, 1));
        const hLast = toNum(operand(lastRow, 2));
        if (x0 !== null && xLast !== null && hLast !== null) {
          const fmt = (v: number): string =>
            serializer.serialize(Math.round(v * 1e6) / 1e6);
          domain = `\\left[${fmt(x0)}, ${fmt(xLast + hLast)}\\right]`;
        }
      }
      const arg = nops(expr) > 1 ? operand(expr, 2) : null;
      const argLatex =
        arg === null ? '' : `\\left(${serializer.serialize(arg)}\\right)`;
      return `\\operatorname{InterpolatingFunction}_{${domain}}${argLatex}`;
    },
  },
  {
    kind: 'expression',
    name: 'BigO',
    latexTrigger: ['\\mathcal', '<{>', 'O', '<}>'],
    parse: parseBigO,
    serialize: (serializer: Serializer, expr: MathJsonExpression): string =>
      'O\\left(' + serializer.serialize(operand(expr, 1)) + '\\right)',
  },
  {
    kind: 'expression',
    latexTrigger: ['\\operatorname', '<{>', 'O', '<}>'],
    parse: parseBigO,
  },

  //
  // Mathematica-style `D(f, x, …)` differential operator.
  //
  // Applied to an argument list, `\mathrm{D}` / `\operatorname{D}` is the
  // derivative operator `D`. The bare (no argument list) forms keep their
  // pre-existing meanings, which differ: `\mathrm{D}` is the `D_upright`
  // glyph (a plain symbol), while `\operatorname{D}` is the `D` operator
  // symbol itself (usable as a pipeline stage: `x^2 \rhd \operatorname{D}`).
  //
  {
    kind: 'expression',
    latexTrigger: ['\\mathrm', '<{>', 'D', '<}>'],
    parse: (parser: Parser) => parseUprightD(parser, 'D_upright'),
  },
  {
    kind: 'expression',
    latexTrigger: ['\\operatorname', '<{>', 'D', '<}>'],
    parse: (parser: Parser) => parseUprightD(parser, 'D'),
  },
];

function parseBigO(parser: Parser): MathJsonExpression {
  const args = parser.parseArguments();
  return args === null ? 'BigO' : ['BigO', ...args];
}

function parseUprightD(
  parser: Parser,
  bareForm: MathJsonExpression
): MathJsonExpression {
  const args = parser.parseArguments();
  // With no argument list, keep the trigger's pre-existing bare meaning
  // (`D_upright` glyph for `\mathrm{D}`, the `D` operator symbol for
  // `\operatorname{D}`). Applied to arguments, it is the differential
  // operator `D`.
  if (args === null || args.length === 0) return bareForm;
  return ['D', ...args];
}

/**
 * Read a differential at the index: a differential operator (`d`,
 * `\mathrm{d}`, `\differentialD`, after an optional `\cdot` or space)
 * followed by a variable. Return the name of the variable, with the index
 * after it. When the tokens are not a differential, return `null`, and the
 * index does not move.
 *
 * A `d` with no variable after it (`1 \cdot d`, `x\,d`) is not a
 * differential, and neither is a `d` with a subscript or a superscript
 * (`d_1`, `d^2`): the symbol parser would read the `_` or the `^` as a
 * variable named `_` or `^`.
 */
function readDifferential(parser: Parser): string | null {
  const start = parser.index;
  if (matchDifferentialOperator(parser)) {
    parser.skipVisualSpace();
    if (parser.peek !== '_' && parser.peek !== '^') {
      const index = symbol(parser.parseSymbol());
      if (index !== null) return index;
    }
  }
  parser.index = start;
  return null;
}

/**
 * True when the tokens at the index are a differential (see
 * `readDifferential()`). The index does not move, and the diagnostics that
 * reading the variable records are removed: `parseIndexes()` reads the
 * variable again.
 *
 * The body of an integral stops at a differential. A `d` that is not a
 * differential is a symbol, and the body continues past it: in
 * `\int_0^1 \frac{x\,dx}{2} + 1 \cdot d` the body is
 * `\frac{x\,dx}{2} + 1 \cdot d`, whose last term `1 \cdot d` is added to the
 * integral.
 */
function atDifferential(parser: Parser): boolean {
  const start = parser.index;
  const checkpoint = parser._diagnosticsCheckpoint();
  const result = readDifferential(parser) !== null;
  parser._rollbackDiagnostics(checkpoint);
  parser.index = start;
  return result;
}

function matchDifferentialOperator(parser: Parser): boolean {
  const start = parser.index;

  // Skip \cdot (not correct, but used in the wild) and \, (thin space)
  while (parser.match('\\cdot') || parser.skipVisualSpace()) {}

  if (
    parser.matchAll(['\\mathrm', '<{>', 'd', '<}>']) ||
    parser.matchAll(['\\operatorname', '<{>', 'd', '<}>']) ||
    parser.match('d') ||
    parser.match('\\differentialD')
  ) {
    return true;
  }

  parser.index = start;
  return false;
}

function parseFinalDiffOperators(
  xs: ReadonlyArray<MathJsonExpression>,
  binderName: (expr: MathJsonExpression | null | undefined) => string | null
): [rest: ReadonlyArray<MathJsonExpression>, indexes: string[]] {
  let rest: ReadonlyArray<MathJsonExpression> = [...xs];
  const indexes: string[] = [];

  // The differentials are read from the last one, and each one is put at the
  // start of `indexes`, so that `indexes` has the written order (`3xdxdy`
  // gives `['x', 'y']`), as the differentials that follow the integrand do.
  // `makeIntegral()` then makes the last differential the first limit.
  // A space command between the differentials, or after the last one, is
  // skipped (`\frac{dx\,dy}{xy}` parses its numerator as
  // `InvisibleOperator(d, x, HorizontalSpacing(3), d, y)`), as
  // `matchDifferentialOperator()` skips it before a differential that follows
  // the integrand. A space before the first differential stays in the
  // integrand (`x\,dx` gives the integrand `InvisibleOperator(x,
  // HorizontalSpacing(3))`), which the canonical form removes.
  while (rest.length > 0) {
    const [before, index] = parseFinalDiffOperator(
      withoutFinalSpacing(rest),
      binderName
    );
    if (!index) break;
    indexes.unshift(index);
    rest = before;
  }

  return [rest, indexes];
}

/** `xs` without the `HorizontalSpacing` operands at its end. */
function withoutFinalSpacing(
  xs: ReadonlyArray<MathJsonExpression>
): ReadonlyArray<MathJsonExpression> {
  let end = xs.length;
  while (end > 0 && operator(xs[end - 1]) === 'HorizontalSpacing') end -= 1;
  return end === xs.length ? xs : xs.slice(0, end);
}

function parseFinalDiffOperator(
  expr: ReadonlyArray<MathJsonExpression>,
  binderName: (expr: MathJsonExpression | null | undefined) => string | null
): [rest: ReadonlyArray<MathJsonExpression>, index: string] {
  // If the second to last term is a differential operator, we capture the last term as the index

  if (expr.length < 2) return [expr, ''];

  const op = expr[expr.length - 2];

  if (op === 'd' || op === 'd_upright') {
    const index = binderName(expr[expr.length - 1]);
    if (index) return [expr.slice(0, -2), index];
  }
  return [expr, ''];
}
