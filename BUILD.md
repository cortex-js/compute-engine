# Build

## NPM Scripts

After cloning the repo:

- `npm install` to install all the necessary modules, then:
- `npm start` to do a `build watch` and launch a local server

| `npm run`         |                                                                            |
| ----------------- | -------------------------------------------------------------------------- |
| `clean`           | Delete output directories (`/build`, `/dist`)                              |
| `clean`           | Delete output directories (`/build`, `/dist`)                              |
| `typecheck`       | Run TypeScript type checking on the source files                           |
| `lint`            | Run ESLint and Prettier to check and fix code style issues                 |
| `build watch`     | Make a development build in `/build` and watch for changes until ctrl-C    |
| `build prod`      | Make a production build in `/dist`                                         |
| `test [coverage]` | Run all the tests and generate code coverage data in `/coverage` directory |
| `test snapshot`   | Update the test snapshots                                                  |

## Releasing to npm

This project uses GitHub Actions to automatically publish to npm when a release
is created.

### Publishing a new version

1. Update the version in `package.json`
2. Commit the version change: `git commit -am "Bump version to x.y.z"`
3. Push to main: `git push origin main`
4. Create a GitHub release:
   - Go to your repository → Releases → "Create a new release"
   - Create a new tag matching the version (e.g., `v0.30.3`)
   - Fill in the release title and notes
   - Click "Publish release"

The workflow will automatically:

- Run all tests
- Build the production bundle
- Publish to npm
