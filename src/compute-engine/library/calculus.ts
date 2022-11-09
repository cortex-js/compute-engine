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
        signature: {
          domain: [
            'Function',
            'Anything',
            ['Union', 'Nothing', 'Tuple', 'Symbol'],
            // ['Tuple', 'Symbol', ['Maybe', 'Integer'], ['Maybe', 'Integer']],
            'Number',
          ],
        },
      },
    ],
  },
];
