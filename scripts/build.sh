#!/bin/bash

set -e  # exit immediately on error
set -o nounset   # abort on unbound variable
set -o pipefail  # don't hide errors within pipes
# set -x    # for debuging, trace what is being executed.

export BASENAME="\033[40m Compute Engine \033[0;0m " # `basename "$0"`
# export DOT="\033[32m  \033[0m" # Gear
#  export DOT="\033[32m  \033[0m" # Watch 
# export DOT="\033[32m 羽 😀 ⧖⧗⏳⌛️⚙⛭⚙️\033[0;0m" # Hourglass
export DOT="\033[32m ⚙ \033[0;0m" # Gear
export CHECK="\033[32m ✔ \033[0;0m"
export ERROR="\033[31;7m ERROR \033[0;0m"
export LINECLEAR="\033[1G\033[2K" # position to column 1; erase whole line
export DIM="\033[0;2m"
export RESET="\033[0;0m"


# Note on the `sed` command:
# On Linux, the -i switch can be used without an extension argument
# On macOS, the -i switch must be followed by an extension argument (which can be empty)
# On Windows, the argument of the -i switch is optional, but if present it must follow it immediately without a space in between
sedi () {
    sed --version >/dev/null 2>&1 && sed -i -- "$@" || sed -i '' "$@"
}
export -f sedi

cd "$(dirname "$0")/.."
if [ "$#" -gt 1 ]; then
    echo -e "$BASENAME$ERROR Expected at most one argument: 'development' (default), 'watch' or 'production'"
    exit 1
fi

# Check that correct version of npm and node are installed
npx check-node-version --package

# If no "node_modules" directory, do an install first
if [ ! -d "./node_modules" ]; then
    printf "$BASENAME${DOT}Installing dependencies"
    npm install
    echo -e "$LINECLEAR$BASENAME${CHECK}Dependencies installed"
fi

# Read the first argument, set it to "production" if not set
# (Note: we use es-build (via `npm start`) for development builds usually)
export BUILD="${1-production}"

# export TARGETS="math-json cortex compute-engine"
export TARGETS="math-json compute-engine"

# export GIT_VERSION=`git describe --long --dirty`

export SDK_VERSION=$(cat package.json \
| grep version \
| head -1 \
| awk -F: '{ print $2 }' \
| sed 's/[",]//g' \
| tr -d '[[:space:]]')

# Clean output directories
# printf "$BASENAME$DOT${RESET} Cleaning output directories"
rm -rf ./dist
rm -rf ./declarations
rm -rf ./build
rm -rf ./coverage

mkdir -p dist
# echo -e  $LINECLEAR$BASENAME$CHECK${DIM}" Cleaning output directories"$RESET


#
# Build declaration files (.d.ts)
#
printf "$BASENAME$DOT Building TypeScript declaration files (.d.ts)"
# Even though we only generate declaration file, the target must be set high-enough
# to prevent tsc from complaining (!)
if [[ "$TARGETS" == *math-json* ]]; then
  npx tsc --target "es2020" -d --moduleResolution "node" \
    --emitDeclarationOnly --outDir ./dist/types ./src/math-json.ts 
fi
if [[ "$TARGETS" == *compute-engine* ]]; then
  npx tsc --target "es2020" -d --moduleResolution "node" \
    --emitDeclarationOnly --outDir ./dist/types ./src/compute-engine.ts 
fi
if [[ "$TARGETS" == *cortex* ]]; then
  npx tsc --target "es2020" -d --moduleResolution "node" \
    --emitDeclarationOnly --outDir ./dist/types ./src/cortex.ts 
fi
echo -e $LINECLEAR$BASENAME$CHECK$DIM" Building TypeScript declaration files$RESET"

#
# Do build (development or production)
#
printf $BASENAME$DOT$RESET" Making a \033[33m$BUILD\033[0m build"

# To get more details about errors, uncomment the following line
# export NODE_DEBUG=esm
# The '--no-warnings' option is used to suppress a warning about importing
# the package.json file in build.mjs.
node --no-warnings ./scripts/build.mjs


if [ "$BUILD" = "production" ]; then    
    # Linting
    # printf "$BASENAME$DOT Linting"
    # npm run lint
    # echo -e $LINECLEAR$BASENAME$CHECK$DIM" Linting$RESET"

    # Stamp the SDK version number
    find ./dist -type f \( -name '*.js' -o -name '*.mjs' \) -exec bash -c 'sedi s/{{SDK_VERSION}}/$SDK_VERSION/g {}' \;
    find ./dist -type f -name '*.d.ts' -exec bash -c 'sedi "1s/^/\/\* $SDK_VERSION \*\/$(printf '"'"'\r'"'"')/" {}' \;
    find ./dist -type f -name '*.d.ts' -exec bash -c 'sedi "s/{{SDK_VERSION}}/$SDK_VERSION/" {}' \;


    # Run test suite
    # printf "$BASENAME$DOT Running test suite"
    # npx jest --config ./config/jest.config.cjs ./test --silent --reporters jest-silent-reporter
    # echo -e $LINECLEAR$BASENAME$CHECK$DIM" Running test suite$RESET"
fi

echo -e $LINECLEAR$BASENAME$CHECK$DIM" Making a \033[33m$BUILD$DIM build"
