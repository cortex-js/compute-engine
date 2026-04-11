import type {
  EvaluateOptions,
  Expression,
  ExpressionInput,
  FormOption,
  ReplaceOptions,
  Rule,
  RuleConditionFunction,
  RuleFunction,
  RuleReplaceFunction,
  TransformOptions,
} from '../global-types';
import type { LatexString } from '../types';

export function transform(
  expr: Expression,
  options: TransformOptions
): Expression | null {
  const { engine: ce } = expr;
  const { type, match } = options;
  let { targets } = options;

  // In absence of any matching spec., set the target as this *expr*
  if (match === undefined && targets === undefined) targets = expr;
  if (match !== undefined && targets !== undefined)
    throw new Error('Cannot specify both `match` and `targets`');

  // if (options.type === 'replace') options.replace

  /*
   * All transformations take place through the match->replace mechanism of 'replace()', using a single rule
   * Bundle the components to construct the rule.
   */
  let replace: LatexString | Expression | RuleReplaceFunction | RuleFunction;

  // First, generate the 'replace' component; dependent upon transformation
  // ------------------------------

  switch (type) {
    case 'replace':
      if (options.replace === undefined)
        throw new Error(
          `Expected 'replace' option for transformation 'replace'`
        );
      // @todo: ensure wrapped in a 'RuleFunction' for consistency?
      replace = options.replace;
      break;

    case 'structural':
      replace = ((expr) =>
        expr.isStructural ? undefined : expr.structural) satisfies RuleFunction;
      break;

    case 'canonical':
      // 'canonical' must have a degree: i.e. either 'true' or 'CanonicalForm | CanonicalForm[]'
      if (!options.canonical)
        throw new Error(
          `Expected 'canonical' option for transformation 'canonical'`
        );
      replace = ((expr) =>
        expr.isCanonical
          ? undefined
          : ce.expr(expr, {
              form:
                options.canonical === true
                  ? 'canonical'
                  : options.canonical /* CanonicalForm */,
            })) satisfies RuleFunction;
      break;

    case 'evaluate':
    case 'N':
      const evalOptions: Partial<EvaluateOptions> = {
        ...(options.evalOptions ?? {}),
        numericApproximation: type === 'N' ? true : false,
      };
      replace = ((expr) => {
        const result = expr.canonical.evaluate(evalOptions);
        if (result.isSame(expr)) return undefined;
        return result;
      }) satisfies RuleFunction;
      break;
    case 'simplify':
      replace = ((expr) => {
        const result = expr.simplify(options.simplifyOptions);
        if (result.isSame(expr)) return undefined;
        return result;
      }) satisfies RuleFunction;
      break;
    default:
      throw new TypeError(`Unknown transform type: '${type}'`);
  }

  /*
   * Build the rule (and 'match' component based on strategy).
   *
   */
  let rule: Rule;
  // The only case where recursivity is _not_ to apply.
  const directOnly =
    targets &&
    (targets === expr ||
      (Array.isArray(targets) && targets.length === 1 && targets[0] === expr));
  const replaceOptions: Partial<ReplaceOptions> = {
    recursive: directOnly ? false : true,
    direction: options.direction,
    // @note: do not supply 'form' here, since this will undesirably apply to the entire input.
    // Instead, apply this in the replacement `RuleFunction`
  };

  // For select transformations, a 'form' definition may be supplied.
  // (Notably, all others - with exception of 'structural' - by definition produce canonical
  // (output))
  if (type === 'replace') replaceOptions.form = options.form;

  // Standard pattern-matching route
  // -----------------------------------
  if (match !== undefined) {
    let pattern: LatexString | ExpressionInput;
    let condition: LatexString | RuleConditionFunction | undefined;

    // Pattern bundled with match-options/condition
    if (typeof match === 'object' && 'pattern' in match) {
      if (match.useVariations)
        replaceOptions.useVariations = match.useVariations;
      if (match.matchPermutations)
        replaceOptions.matchPermutations = match.matchPermutations;
      // @fix?: 'matchMissingTerms' is not currently utilized in a 'replace()' context (i.e., is not
      // forwarded for internal matching).
      // if (match.matchMissingTerms)
      //   replaceOptions.matchMissingTerms = match.matchMissingTerms;

      pattern = match.pattern;
      condition = match.condition;
    } else {
      // Str
      pattern = match;
    }

    rule = {
      match: pattern,
      replace,
      condition,
    };
  } else {
    // Targeted transformation ('targets')
    // -----------------------------------
    // (In contrast to 'match', permit allow exact/referential expression-based, and predicate-based
    // matching)
    const replacementForm: FormOption = replaceOptions.form ?? 'canonical'; // For all
    // transformations where 'form' not specifiable, the output is always [to be] made canonical

    // Proceed by way of a 'RuleFunction' to emulate exact matching (with standard match patterns
    // neither permiting matching via expr.-identity nor predicate.)
    rule = (expr) => {
      if (!directOnly) {
        // Instead of matching via 'rule.match', 'targets' replicates this through either
        // referential-identity and/or predicate-based matching.
        if (typeof targets === 'function') {
          if (!targets(expr)) return undefined;
        } else {
          const targetExprs = Array.isArray(targets) ? targets : [targets];
          if (!targetExprs.some((target) => target === expr)) return undefined;
        }
      }

      // With exception of a 'replace' transformation - which may specify its replacement
      // 'replace' will take the form of a RuleFunction (according to the transformation)
      return replace instanceof Function
        ? (replace as RuleFunction)(expr)
        : ce.expr(replace, {
            form: replacementForm,
          });
    };
  }

  // Transformations ultimately apply via single-Rule application with `replace()`
  return expr.replace(rule, replaceOptions);
}
