# Build

## NPM Scripts

After cloning the repo:

- `npm install` to install all the necessary modules, then:
- `npm start` to do a `build watch` and launch a local server

| `npm run`         |                                                                            |
| ----------------- | -------------------------------------------------------------------------- |
| `clean`           | Delete output directories (`/build`, `/dist`)                              |
| `build [dev]`     | Make a development build in `/build`                                       |
| `build watch`     | Make a development build in `/build` and watch for changes until ctrl-C    |
| `build prod`      | Make a production build in `/dist`                                         |
| `test [coverage]` | Run all the tests and generate code coverage data in `/coverage` directory |
| `test snapshot`   | Update the test snapshots                                                  |
