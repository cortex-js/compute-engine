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
`npm install -g @cortex-js/epsil` to put `epsil` on your PATH. Once the next
`@cortex-js/compute-engine` release ships the `epsil` binary, the launcher
forwards to it directly; until then it prints the instructions above.

> The bare npm name `epsil` is currently blocked by the registry's
> name-similarity check (vs. `psl`); a manual-review request is the path to
> claiming it. The same check prevents anyone else from claiming it.
