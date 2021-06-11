<div align="center">
    <img alt="math live" src="assets/compute-engine.jpg?raw=true">
</div>

<h3><strong>Cortex Compute Engine</strong></h3>
<h1>An engine for symbolic manipulation and numeric evaluation of math formulas expressed with MathJSONn</h1>

Reference documentation and guides at
[cortexjs.io/compute-engine](https://cortexjs.io/compute-engine/).

## Using Compute Engine

```bash
$ npm install --save @cortex-js/compute-engine
```

```js
import { evaluate } from '@cortex-js/compute-engine';

console.log(evaluate(["MemberOf", ["Subtract", ["Power", 2, 11] , 1], "PrimeNumber"]);
// ➔ "False"

```

## More

- [Build](BUILD.md) instructions.

## Related Projects

<dl>
  <dt><a href="https://cortexjs.io/math-json/">MathJSON</a></dt>
  <dd>A lightweight data interchange format for mathematical notation</dd>  
  <dt><a href="https://cortexjs.io/mathlive">MathLive</a> (on <a href="https://github.com/arnog/mathlive">GitHub</a>)</dt>
  <dd>A Web Component for math input.</dd>  
  <dt><a href="https://cortexjs.io/cortex">Cortex</a> (on <a href="https://github.com/cortex-js/math-json/tree/master/src/cortex">GitHub</a>)</dt>
  <dd>A programming language for scientific computing</dd>  
</dl>

## Support the Project

- Star the GitHub repo (it really helps)
- Join our [Gitter community](https://gitter.im/cortex-js/community)
- Drop a line to arno@arno.org

## License

This project is licensed under the [MIT License](LICENSE.txt).
