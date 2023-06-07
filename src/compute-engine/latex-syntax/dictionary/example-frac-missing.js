const { stringify } = require('querystring');

something = {
  latex: '\\left(\\frac{1}{}\\right)',
  sourceOffsets: [0, 23],
  fn: [
    'Delimiter',
    {
      latex: '\\frac{1}{}',
      sourceOffsets: [6, 16],
      fn: [
        'Divide',
        {
          num: '1',
          latex: '1',
          sourceOffsets: [12, 13],
        },
        {
          sourceOffsets: [15, 15],
          // This string: '\frac' is probably not what what it will really look like
          fn: ['Error', { str: 'missing' }, ['Latex', { str: '\frac' }]],
        },
        // This is the old error element
        // [
        //   "Error",
        //   "'missing'"
        // ]
      ],
    },
  ],
};

something.latex;

if ('fn' in something) {
  for (i = 1; i < something.fn.length; i++) {
    arg = something.fn[i];
    arg.sourceOffsets;
  }
}

'left(' + processFunctionArg(arg1) + '\right)';
'\frac{' + processFunctionArg(arg1) + '}{' + processFunctionArg(arg2) + '}';
