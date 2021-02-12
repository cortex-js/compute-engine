# Math-JSON

The MathJSON format is a lightweight data interchange format for mathematical
notation.

| Latex                      | mathJSON                                                                  |
| :------------------------- | :------------------------------------------------------------------------ |
| `\frac{a}{1+x}`            | `["Divide", "a", ["Add", 1, "x"]]`                                        |
| `e^{\imaginaryI \pi }+1=0` | `["Eq", ["Power", "E", ["Add", ["Multiply", "Pi", "ImaginaryI"], 1]], 0]` |
| `\sin^{-1}\prime(x)`       | `[["Derivative", 1, ["InverseFunction", "Sin"]], "x"]`                    |

This repo contains the description of the format and a Javascript/Typescript
library that can be used to manipulate MathJSON expressions.

```js
import { parse, serialize } from 'math-json';

console.log(parse('\\frac{\\pi}{2}'));
// -> ["Divide", "Pi", 2]

console.log(serialize([["InverseFunction", "Sin"], "x"));
// -> \sin^{-1}x

```

# More

- [MathJSON format](./src/README.md)
- [MathJSON API](./src/API.md)
- [MathJSON Default Dictionary](./src/dictionary/README.md)
- [Build](BUILD.md) instructions.
