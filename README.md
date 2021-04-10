<div align="center">
    <img alt="math live" src="assets/math-json.jpg?raw=true">
</div>

<h3><strong>MathJSON</strong></h3>
<h1>A lightweight data interchange format for mathematical
notation</h1>

| Latex                      | MathJSON                                                                  |
| :------------------------- | :------------------------------------------------------------------------ |
| `\frac{a}{1+x}`            | `["Divide", "a", ["Add", 1, "x"]]`                                        |
| `e^{\imaginaryI \pi }+1=0` | `["Eq", ["Power", "E", ["Add", ["Multiply", "Pi", "ImaginaryI"], 1]], 0]` |
| `\sin^{-1}\prime(x)`       | `[["Derivative", 1, ["InverseFunction", "Sin"]], "x"]`                    |

This repo contains the description of the format and a Javascript/Typescript
library to:

- parse Latex to MathJSON
- serialize MathJSON to Latex
- manipulate MathJSON expressions

Reference documentation and guides at
[cortexjs.io/math-json](https://cortexjs.io/math-json/).

## Using MathJSON

```bash
$ npm install --save @cortex-js/math-json
```

```js
import { parse, serialize } from '@cortex-js/math-json';

console.log(parse('\\frac{\\pi}{2}'));
// ➔ ["Divide", "Pi", 2]

console.log(serialize([["InverseFunction", "Sin"], "x"));
// ➔ \sin^{-1}x

```

# More

- [MathJSON format](https://cortexjs.io/guides/math-json-format/)
- [MathJSON API](https://cortexjs.io/docs/mathjson/)
- [MathJSON Default Dictionary](https://cortexjs.io/guides/math-json-dictionary/)
- [Build](BUILD.md) instructions.

## Related Projects

<dl>
  <dt><a href="https://cortexjs.io/mathlive">MathLive</a> (on <a href="https://github.com/arnog/mathlive">GitHub</a>)</dt>
  <dd>A Web Component for math input.</dd>  
  <dt><a href="https://cortexjs.io/compute-engine">Compute Engine</a> (on <a href="https://github.com/cortex-js/math-json/tree/master/src/compute-engine">GitHub</a>)</dt>
  <dd>The CortexJS Compute Engine performs calculations on MathJSON expressions</dd>  
  <dt><a href="https://cortexjs.io/cortex">Cortex</a> (on <a href="https://github.com/cortex-js/math-json/tree/master/src/cortex">GitHub</a>)</dt>
  <dd>A programming language for scientific computing</dd>  
</dl>

## Support the Project

- Star the GitHub repo (it really helps)
- Join our [Gitter community](https://gitter.im/cortex-js/community)
- Drop a line to arno@arno.org

## License

This project is licensed under the [MIT License](LICENSE.txt).
