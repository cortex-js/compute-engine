<div align="center">
    <img alt="math live" src="assets/compute-engine.jpg?raw=true">
</div>

<h3><strong>Cortex Compute Engine</strong></h3>
<h1>Symbolic manipulation and numeric evaluation of MathJSON expressions</h1>

[MathJSON](https://cortexjs.io/math-json/) is a lightweight data interchange
format for mathematical notation, based on JSON.

The Cortex Compute Engine can parse Latex to MathJSON, serialize MathJSON to
Latex, format, simplify and evaluate MathJSON expressions.

Reference documentation and guides at
[cortexjs.io/compute-engine](https://cortexjs.io/compute-engine/).

## Using Compute Engine

```bash
$ npm install --save @cortex-js/compute-engine
```

```js
import { parse, evaluate } from '@cortex-js/compute-engine';

const expr = parse('2^{11}-1 \\in \\P');

console.log(expr);
// ➔ ["Element", ["Subtract", ["Power", 2, 11] , 1], "PrimeNumber"]

console.log(evaluate(expr));
// ➔ "False"
```

## More

- [Build](BUILD.md) instructions

## Related Projects

<dl>
  <dt><a href="https://cortexjs.io/math-json/">MathJSON</a></dt>
  <dd>A lightweight data interchange format for mathematical notation</dd>  
  <dt><a href="https://cortexjs.io/mathlive">MathLive</a> (on <a href="https://github.com/arnog/mathlive">GitHub</a>)</dt>
  <dd>A Web Component for math input.</dd>  
  <dt><a href="https://cortexjs.io/cortex">Cortex</a> (on <a href="https://github.com/cortex-js/compute-engine/tree/master/src/cortex">GitHub</a>)</dt>
  <dd>A programming language for scientific computing</dd>  
</dl>

## Support the Project

- <span style='font-size:1.5em'>🌟</span> Star the GitHub repo (it really helps)
- <span style='font-size:1.5em'>💬</span> Join our
  [Gitter community](https://gitter.im/cortex-js/community)
- <span style='font-size:1.5em'>📨</span> Drop a line to arno@arno.org

## License

This project is licensed under the [MIT License](LICENSE.txt).
