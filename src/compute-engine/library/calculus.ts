import { validateArgument } from '../boxed-expression/validate';
import { BoxedExpression, IdTable } from '../public';

export const CALCULUS_LIBRARY: IdTable[] = [
  {
    //
    // Functions
    //
    Integrate: {
      wikidata: 'Q80091',
      hold: 'all',
      signature: {
        domain: [
          'Function',
          'Anything',
          ['Union', 'Nothing', 'Tuple', 'Symbol'],
          // ['Tuple', 'Symbol', ['Maybe', 'Integer'], ['Maybe', 'Integer']],
          'Number',
        ],
        canonical: (ce, ops) => {
          const body = ops[0] ?? ce.error(['missing', 'Function']); // @todo not exactly a function, more like a 'NumericExpression'

          let range = ops[1];
          let index: BoxedExpression | null = null;
          let lower: BoxedExpression | null = null;
          let upper: BoxedExpression | null = null;
          if (
            range &&
            range.head !== 'Tuple' &&
            range.head !== 'Triple' &&
            range.head !== 'Pair' &&
            range.head !== 'Single'
          ) {
            index = range;
          } else if (range) {
            // Don't canonicalize the index. Canonicalization as the
            // side effect of declaring the symbol, here we're using
            // it to do a local declaration
            index = range.ops?.[0] ?? null;
            lower = range.ops?.[1]?.canonical ?? null;
            upper = range.ops?.[2]?.canonical ?? null;
          }
          // The index, if present, should be a symbol
          if (index && index.head === 'Hold') index = index.op1;
          if (index && index.head === 'ReleaseHold')
            index = index.op1.evaluate();
          index ??= ce.symbol('Nothing');
          if (!index.symbol)
            index = ce.error(['incompatible-domain', 'Symbol', index.domain]);

          // The range bounds, if present, should be numbers
          if (lower) lower = validateArgument(ce, lower, 'Number');
          if (upper) upper = validateArgument(ce, upper, 'Number');
          if (lower && upper) range = ce.tuple([index, lower, upper]);
          else if (upper)
            range = ce.tuple([index, ce._NEGATIVE_INFINITY, upper]);
          else if (lower) range = ce.tuple([index, lower]);
          else range = index;

          return ce._fn('Integrate', [body, range]);
        },
      },
    },
  },
];
