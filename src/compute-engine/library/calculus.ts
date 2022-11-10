import { SymbolTable } from '../public';

export const CALCULUS_LIBRARY: SymbolTable[] = [
  {
    //
    // Functions
    //
    functions: [
      {
        name: 'Integrate',
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
          canonical: (ce, ops) => ce._fn('Integrate', ops),
        },
      },
    ],
  },
];
