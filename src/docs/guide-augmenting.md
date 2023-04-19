---
title: Defining New Symbols
permalink: /compute-engine/guides/augmenting/
layout: single
date: Last Modified
sidebar:
  - nav: 'universal'
toc: true
---

Let's say you want to define a new `"Smallfrac"` function for use with 
the Compute Engine.

## Parsing

If you want to use this function from a LaTeX string, using `ce.parse()`,
you must augment the LaTeX dictionary of the Compute Engine with your new function. You can do this by providing a custom LaTeX dictionary to the constructor of `ComputeEngine`.

The `triger` property indicates that when the `\\smallfrac` command
is encountered, the `parse` handler should be called. The `parse` handler
constructs a MathJSON expression from the LaTeX string, by reading the 
two arguments using `matchRequiredLatexArgument()`.

```js
const ce = new ComputeEngine({
  latexDictionary: [
    ...ComputeEngine.getLatexDictionary(),
    {
      trigger: ['\\smallfrac'],
      parse: (parser) => {
        return [
          'Smallfrac',
          parser.matchRequiredLatexArgument() ?? ['Error', "'missing'"],
          parser.matchRequiredLatexArgument() ?? ['Error', "'missing'"],
        ];
      },
    },
  ],
});
```

```js
console.log(ce.parse('\\smallfrac{1}{2}').json);
// -> ["Smallfrac", 1, 2]
```

## Evaluation

The above is sufficient to be able to parse LaTeX, but if you want to be able to evaluate the function, you will also need to define how to do so.

You can define new functions for the Compute Engine to evaluate using
`ce.defineFunction()`.

Note that the first argument to `defineFunction` is the name of the 
MathJSON function, i.e. the one that we returned from the `parse` handler above. It is not the name of the LaTeX command (`\smallfrac`).


```js
ce.defineFunction('Smallfrac', {
  signature: {
    domain: 'NumericFunction',
    evaluate: (ce, args) => ce.box(args[0].N() / args[1].N()),
  },
});
```


```js
console.log(ce.parse('\\smallfrac{1}{2}').N());
// -> 0.5
```

## Using a New Function with a Mathfield

You may also want to use your new function with a mathfield.

First you need to define a LaTeX macro so that the mathfield knows
how to render this command.

```js
const mfe = document.querySelector('math-field');

mfe.macros = {
  ...mfe.macros,
  smallfrac: {
    args: 2,
    def: '{}^{#1}\\!\\!/\\!{}_{#2}'
  },
};
```

Use the `#1` token to reference the first argument and `#2` the second one. The content of the `def` property is a LaTeX fragment that will
be used to render the `\\smallfrac` command.


You may also want to define an inline shortcut to make it easier 
to input the command. With the code below, we define a shortcut "smallfrac". When typed, the shortcut is replaced with the indicated latex. The `#@` token represents the argument to the left of shortcut, and the `#?` represents a placeholder to be filled by the user.

```js
mfe.inlineShortcuts = {
  ...mfe.inlineShortcuts,
  smallfrac:'\\smallfrac{#@}{#?}'
};
```

