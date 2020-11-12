const path = require('path');
module.exports = {
    root: true,
    // Use the Typescript parser:
    parser: '@typescript-eslint/parser',
    extends: [
        // Uses the recommended rules for Typescript
        'plugin:@typescript-eslint/recommended',
        // Disable rules that conflict with prettier
        // See https://prettier.io/docs/en/integrating-with-linters.html
        'plugin:prettier/recommended',
    ],
    parserOptions: {
        "project": "./tsconfig.json",
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
        '@typescript-eslint/no-unused-vars': [
            'warn',
            { argsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-explicit-any': ['off'],
        '@typescript-eslint/no-var-requires': ['off'],
        '@typescript-eslint/no-use-before-define': ['off'],

        indent: 'off',
        'no-use-before-define': [
            'off',
            {
                functions: false,
                classes: false,
            },
        ],
    },
};
