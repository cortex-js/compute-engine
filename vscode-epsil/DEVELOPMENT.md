# Developing the Epsil extension

This extension lives inside the `compute-engine` repository, under
`vscode-epsil/`, and the language server **bundles the engine straight from
`../src`** — there is no dependency on a published `@cortex-js/compute-engine`
package. A change to the parser or the type checker shows up in the editor as
soon as the extension is rebuilt.

```sh
cd vscode-epsil
npm install
npm run build      # or: npm run watch
```

Then press <kbd>F5</kbd> to launch an **Extension Development Host** — a second
VS Code window with the extension loaded. Open a `.epsil` file there to exercise
highlighting, diagnostics and the run command.

Useful commands:

| Command                            | What it does                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run build`                    | Bundle the extension, language server, debug adapter/worker and inline runner into `dist/`. |
| `npm run watch`                    | Same, rebuilding on change.                                                                 |
| `npm test`                         | Build, then run the end-to-end DAP test suite (`test/dap.test.mjs`).                        |
| `./node_modules/.bin/tsc --noEmit` | Type-check the extension (esbuild does the emit).                                           |

The server is transport-agnostic (`vscode-languageserver` picks its transport
from the command line), so it can also be driven directly for debugging:

```sh
node dist/server.js --stdio
```
