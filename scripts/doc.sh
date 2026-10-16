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
sedi () {
    sed --version >/dev/null 2>&1 && sed -i -- "$@" || sed -i '' "$@"
}

printf $BASENAME$DOT$RESET" Building api.md"


rm -rf ./temp-docs

# Config is in ./typedoc.json

# logLevel: string
# - Verbose - Print all log messages, may include debugging information intended for TypeDoc developers
# - Info - Print informational log messages along with warning and error messages
# - Warn - Print warning and error messages
# - Error - Print only error messages
# - None - Print no messages.

npx typedoc --logLevel Warn

# Rename directories so they can be ordered in the api.md
rm ./temp-docs/README.md
mv ./temp-docs/compute-engine ./temp-docs/01 
mv ./temp-docs/math-json ./temp-docs/02 
mv ./temp-docs/common ./temp-docs/03

# https://github.com/ozum/concat-md
# Write to a temporary file first: the shell truncates the redirect target
# before concat-md runs, so a direct redirect would leave an EMPTY
# src/api.md when concat-md fails (for example when one of its dependencies
# is missing). The move happens only on success. The temporary file must not
# be inside ./temp-docs, which concat-md reads as its input.
# mktemp creates the file owner-only (mode 0600) and mv keeps that mode, so
# the mode is set to the usual 0644 before the move. The trap removes the
# temporary file when concat-md fails; after a successful move it does nothing.
API_TMP=$(mktemp)
trap 'rm -f "$API_TMP"' EXIT
npx concat-md --decrease-title-levels --dir-name-as-title --hide-anchor-links ./temp-docs > "$API_TMP"
chmod 644 "$API_TMP"
mv "$API_TMP" ./src/api.md

# Remove `# 01`, `# 02`, `# 03` from the api.md
sedi 's/# 01//g' ./src/api.md
sedi 's/# 02//g' ./src/api.md
sedi 's/# 03//g' ./src/api.md

#rm -rf ./temp-docs

echo -e $LINECLEAR$BASENAME$CHECK$DIM" Building api.md"

printf $BASENAME$DOT$RESET" Building errors.md"
npx tsx scripts/build-error-docs.ts > /dev/null
echo -e $LINECLEAR$BASENAME$CHECK$DIM" Building errors.md"

printf $BASENAME$DOT$RESET" Building library.md"
npx tsx scripts/build-library-docs.ts > /dev/null
echo -e $LINECLEAR$BASENAME$CHECK$DIM" Building library.md"

printf $BASENAME$DOT$RESET" Building reference/"
npx tsx scripts/build-library-reference.ts > /dev/null
echo -e $LINECLEAR$BASENAME$CHECK$DIM" Building reference/"
