# epsil

Launcher for the **Epsil** language CLI.

Epsil is a programming language for scientific computing — exact arithmetic
and symbolic computation — built on the
[Compute Engine](https://cortexjs.io/compute-engine/). The CLI (file runner,
REPL, `check` validator, and MCP server) ships with the
[`@cortex-js/compute-engine`](https://www.npmjs.com/package/@cortex-js/compute-engine)
package.

To use Epsil in a project:

```sh
npm install @cortex-js/compute-engine
npx epsil program.epsil
```

Documentation: [cortexjs.io/epsil](https://cortexjs.io/epsil/)

This launcher can also be used standalone — `npx @cortex-js/epsil`, or
`npm install -g @cortex-js/epsil` to put `epsil` on your PATH. It forwards
directly to the CLI that ships with `@cortex-js/compute-engine`.

> The bare npm name `epsil` is permanently blocked by the registry's
> name-similarity check (vs. `psl`); npm support confirmed there is no
> override. The same check prevents anyone else from claiming it.
