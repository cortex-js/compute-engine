// const path = require('path');
module.exports = {
  root: true,
  extends: [
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    // Uses the recommended rules for TypeScript
    'plugin:@typescript-eslint/recommended',
    // Disable rules that conflict with prettier
    // See https://prettier.io/docs/en/integrating-with-linters.html
    'plugin:prettier/recommended',
  ],
  // Use the TypeScript parser:
  parser: '@typescript-eslint/parser',
  parserOptions: {
    // Use a custom project that includes test files, etc...
    // otherwise, lint gives errors on those files because they are
    // not part of the regular tsconfig build target
    project: './tsconfig.eslint.json',

    // Configure the parser with the tsconfig file in the root project
    // (not the one in the local workspace)
    // tsconfigRootDir: path.resolve(__dirname, './src/'),

    // Allows for the parsing of modern ECMAScript features
    ecmaVersion: 2018,
    // Allows for the use of module imports
    sourceType: 'module',
    //     ecmaFeatures:  {
    //         jsx:  true,  // Allows for the parsing of JSX
    //     },
  },
  env: {
    es6: true,
    node: true,
  },
  rules: {
    'import/no-unresolved': 'error',
    'import/named': 'error',
    'import/no-absolute-path': 'error',
    'import/no-cycle': 'error',
    'import/no-useless-path-segments': 'error',
    'import/no-relative-parent-imports': 'off',

    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: false,
        optionalDependencies: false,
      },
    ],
    'import/no-unused-modules': 'error',

    'import/no-duplicates': 'error',
    'import/no-namespace': 'error',
    'import/order': 'off',

    // Enforce layered architecture: lower layers must not import from higher layers.
    //
    // Layer order (low → high):
    //   common/              (type system utilities, no compute-engine imports)
    //   math-json/           (JSON interchange format, depends on common only)
    //   numerics/            (pure numeric algorithms, no boxing)
    //   numeric-value/       (NumericValue wrapper, depends on numerics)
    //   types-*.ts           (type definitions — may `import type` from lower layers
    //                         but must not import implementation code)
    //   latex-syntax/        (LaTeX ↔ MathJSON, depends on math-json)
    //   boxed-expression/    (core expression types and operations)
    //   tensor/              (peer of boxed-expression, tensor field ops)
    //   interval/            (peer of boxed-expression, interval arithmetic)
    //   symbolic/            (simplification rules, derivatives, etc.)
    //   library/             (mathematical function definitions)
    //   compilation/         (code generation targets)
    //   engine (root .ts)    (ComputeEngine facade, can import from all)
    'import/no-restricted-paths': [
      'error',
      {
        zones: [
          // common/ cannot import from any compute-engine layer
          {
            target: './src/common/**',
            from: './src/compute-engine/**',
            message:
              'common/ is a lower layer and must not import from compute-engine/.',
          },

          // numerics/ cannot import from numeric-value, latex-syntax, boxed-expression, symbolic, library, compilation
          {
            target: './src/compute-engine/numerics/**',
            from: './src/compute-engine/numeric-value/**',
            message:
              'numerics/ is a lower layer and must not import from numeric-value/.',
          },
          {
            target: './src/compute-engine/numerics/**',
            from: './src/compute-engine/latex-syntax/**',
            message:
              'numerics/ is a lower layer and must not import from latex-syntax/.',
          },
          {
            target: './src/compute-engine/numerics/**',
            from: './src/compute-engine/boxed-expression/**',
            message:
              'numerics/ is a lower layer and must not import from boxed-expression/.',
          },
          {
            target: './src/compute-engine/numerics/**',
            from: './src/compute-engine/symbolic/**',
            message:
              'numerics/ is a lower layer and must not import from symbolic/.',
          },
          {
            target: './src/compute-engine/numerics/**',
            from: './src/compute-engine/library/**',
            message:
              'numerics/ is a lower layer and must not import from library/.',
          },
          {
            target: './src/compute-engine/numerics/**',
            from: './src/compute-engine/compilation/**',
            message:
              'numerics/ is a lower layer and must not import from compilation/.',
          },

          // numeric-value/ cannot import from latex-syntax, boxed-expression, symbolic, library, compilation
          {
            target: './src/compute-engine/numeric-value/**',
            from: './src/compute-engine/latex-syntax/**',
            message:
              'numeric-value/ is a lower layer and must not import from latex-syntax/.',
          },
          {
            target: './src/compute-engine/numeric-value/**',
            from: './src/compute-engine/boxed-expression/**',
            message:
              'numeric-value/ is a lower layer and must not import from boxed-expression/.',
          },
          {
            target: './src/compute-engine/numeric-value/**',
            from: './src/compute-engine/symbolic/**',
            message:
              'numeric-value/ is a lower layer and must not import from symbolic/.',
          },
          {
            target: './src/compute-engine/numeric-value/**',
            from: './src/compute-engine/library/**',
            message:
              'numeric-value/ is a lower layer and must not import from library/.',
          },
          {
            target: './src/compute-engine/numeric-value/**',
            from: './src/compute-engine/compilation/**',
            message:
              'numeric-value/ is a lower layer and must not import from compilation/.',
          },

          // latex-syntax/ cannot import from boxed-expression/, symbolic/, library/, compilation/
          {
            target: './src/compute-engine/latex-syntax/**',
            from: './src/compute-engine/boxed-expression/**',
            message:
              'latex-syntax/ is a lower layer and must not import from boxed-expression/.',
          },
          {
            target: './src/compute-engine/latex-syntax/**',
            from: './src/compute-engine/symbolic/**',
            message:
              'latex-syntax/ is a lower layer and must not import from symbolic/.',
          },
          {
            target: './src/compute-engine/latex-syntax/**',
            from: './src/compute-engine/library/**',
            message:
              'latex-syntax/ is a lower layer and must not import from library/.',
          },
          {
            target: './src/compute-engine/latex-syntax/**',
            from: './src/compute-engine/compilation/**',
            message:
              'latex-syntax/ is a lower layer and must not import from compilation/.',
          },

          // boxed-expression/ cannot import from symbolic/, library/, compilation/
          {
            target: './src/compute-engine/boxed-expression/**',
            from: './src/compute-engine/symbolic/**',
            message:
              'boxed-expression/ is a lower layer and must not import from symbolic/.',
          },
          {
            target: './src/compute-engine/boxed-expression/**',
            from: './src/compute-engine/library/**',
            message:
              'boxed-expression/ is a lower layer and must not import from library/.',
          },
          {
            target: './src/compute-engine/boxed-expression/**',
            from: './src/compute-engine/compilation/**',
            message:
              'boxed-expression/ is a lower layer and must not import from compilation/.',
          },

          // tensor/ cannot import from symbolic/, library/, compilation/
          {
            target: './src/compute-engine/tensor/**',
            from: './src/compute-engine/symbolic/**',
            message:
              'tensor/ must not import from symbolic/.',
          },
          {
            target: './src/compute-engine/tensor/**',
            from: './src/compute-engine/library/**',
            message:
              'tensor/ must not import from library/.',
          },
          {
            target: './src/compute-engine/tensor/**',
            from: './src/compute-engine/compilation/**',
            message:
              'tensor/ must not import from compilation/.',
          },

          // interval/ cannot import from symbolic/, library/, compilation/
          {
            target: './src/compute-engine/interval/**',
            from: './src/compute-engine/symbolic/**',
            message:
              'interval/ must not import from symbolic/.',
          },
          {
            target: './src/compute-engine/interval/**',
            from: './src/compute-engine/library/**',
            message:
              'interval/ must not import from library/.',
          },
          {
            target: './src/compute-engine/interval/**',
            from: './src/compute-engine/compilation/**',
            message:
              'interval/ must not import from compilation/.',
          },

          // Type definition files (types-*.ts) cannot import from implementation layers
          {
            target: './src/compute-engine/types-*.ts',
            from: './src/compute-engine/boxed-expression/**',
            message:
              'Type definition files must not import from boxed-expression/ implementation.',
          },
          {
            target: './src/compute-engine/types-*.ts',
            from: './src/compute-engine/symbolic/**',
            message:
              'Type definition files must not import from symbolic/ implementation.',
          },
          {
            target: './src/compute-engine/types-*.ts',
            from: './src/compute-engine/library/**',
            message:
              'Type definition files must not import from library/ implementation.',
          },
          {
            target: './src/compute-engine/types-*.ts',
            from: './src/compute-engine/compilation/!(types).ts',
            message:
              'Type definition files must not import from compilation/ implementation (compilation/types.ts is allowed).',
          },
          {
            target: './src/compute-engine/types-*.ts',
            from: './src/compute-engine/tensor/**',
            message:
              'Type definition files must not import from tensor/ implementation.',
          },
          {
            target: './src/compute-engine/types-*.ts',
            from: './src/compute-engine/interval/**',
            message:
              'Type definition files must not import from interval/ implementation.',
          },

          // symbolic/ cannot import from library/, compilation/
          {
            target: './src/compute-engine/symbolic/**',
            from: './src/compute-engine/library/**',
            message:
              'symbolic/ is a lower layer and must not import from library/.',
          },
          {
            target: './src/compute-engine/symbolic/**',
            from: './src/compute-engine/compilation/**',
            message:
              'symbolic/ is a lower layer and must not import from compilation/.',
          },

          // library/ cannot import from compilation/
          {
            target: './src/compute-engine/library/**',
            from: './src/compute-engine/compilation/**',
            message:
              'library/ is a lower layer and must not import from compilation/.',
          },
        ],
      },
    ],

    'no-unused-vars': ['off'],
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': ['off'],
    '@typescript-eslint/no-var-requires': ['off'],
    '@typescript-eslint/no-use-before-define': ['off'],
    '@typescript-eslint/no-non-null-assertion': 'off',

    'no-restricted-globals': [
      'error',
      'postMessage',
      'blur',
      'focus',
      'close',
      'frames',
      'self',
      'parent',
      'opener',
      'top',
      'length',
      'closed',
      'location',
      'origin',
      'name',
      'locationbar',
      'menubar',
      'personalbar',
      'scrollbars',
      'statusbar',
      'toolbar',
      'status',
      'frameElement',
      'navigator',
      'customElements',
      'external',
      'screen',
      'innerWidth',
      'innerHeight',
      'scrollX',
      'pageXOffset',
      'scrollY',
      'pageYOffset',
      'screenX',
      'screenY',
      'outerWidth',
      'outerHeight',
      'devicePixelRatio',
      'clientInformation',
      'screenLeft',
      'screenTop',
      'defaultStatus',
      'defaultstatus',
      'styleMedia',
      'onanimationend',
      'onanimationiteration',
      'onanimationstart',
      'onsearch',
      'ontransitionend',
      'onwebkitanimationend',
      'onwebkitanimationiteration',
      'onwebkitanimationstart',
      'onwebkittransitionend',
      'isSecureContext',
      'onabort',
      'onblur',
      'oncancel',
      'oncanplay',
      'oncanplaythrough',
      'onchange',
      'onclick',
      'onclose',
      'oncontextmenu',
      'oncuechange',
      'ondblclick',
      'ondrag',
      'ondragend',
      'ondragenter',
      'ondragleave',
      'ondragover',
      'ondragstart',
      'ondrop',
      'ondurationchange',
      'onemptied',
      'onended',
      'onerror',
      'onfocus',
      'oninput',
      'oninvalid',
      'onkeydown',
      'onkeypress',
      'onkeyup',
      'onload',
      'onloadeddata',
      'onloadedmetadata',
      'onloadstart',
      'onmousedown',
      'onmouseenter',
      'onmouseleave',
      'onmousemove',
      'onmouseout',
      'onmouseover',
      'onmouseup',
      'onmousewheel',
      'onpause',
      'onplay',
      'onplaying',
      'onprogress',
      'onratechange',
      'onreset',
      'onresize',
      'onscroll',
      'onseeked',
      'onseeking',
      'onselect',
      'onstalled',
      'onsubmit',
      'onsuspend',
      'ontimeupdate',
      'ontoggle',
      'onvolumechange',
      'onwaiting',
      'onwheel',
      'onauxclick',
      'ongotpointercapture',
      'onlostpointercapture',
      'onpointerdown',
      'onpointermove',
      'onpointerup',
      'onpointercancel',
      'onpointerover',
      'onpointerout',
      'onpointerenter',
      'onpointerleave',
      'onafterprint',
      'onbeforeprint',
      'onbeforeunload',
      'onhashchange',
      'onlanguagechange',
      'onmessage',
      'onmessageerror',
      'onoffline',
      'ononline',
      'onpagehide',
      'onpageshow',
      'onpopstate',
      'onrejectionhandled',
      'onstorage',
      'onunhandledrejection',
      'onunload',
      'performance',
      'stop',
      'open',
      'print',
      'captureEvents',
      'releaseEvents',
      'getComputedStyle',
      'matchMedia',
      'moveTo',
      'moveBy',
      'resizeTo',
      'resizeBy',
      'getSelection',
      'find',
      'createImageBitmap',
      'scroll',
      'scrollTo',
      'scrollBy',
      'onappinstalled',
      'onbeforeinstallprompt',
      'crypto',
      'ondevicemotion',
      'ondeviceorientation',
      'ondeviceorientationabsolute',
      'indexedDB',
      'webkitStorageInfo',
      'chrome',
      'visualViewport',
      'speechSynthesis',
      'webkitRequestFileSystem',
      'webkitResolveLocalFileSystemURL',
      'openDatabase',
    ],
    'indent': 'off',
    'no-use-before-define': [
      'off',
      {
        functions: false,
        classes: false,
      },
    ],
  },
};
