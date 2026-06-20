# SOURCE this (don't execute it) to use `pb` in the CURRENT shell only:
#
#   source scripts/dev-cli.sh             # build the CLI + define a `pb` function
#   source scripts/dev-cli.sh emulator    # also point pb at the local emulator + seed a token
#
# Works from ANY directory: source it by path (e.g.
# `source ~/Projects/Paper-Baker/scripts/dev-cli.sh`) and the `pb` function then
# runs in whatever directory you're in, creating its `paperbaker/` project there.
# Nothing is installed on your system — open a new shell (or `unset -f pb
# paperbaker`) to drop the functions. A `pnpm` command can't do this (a child
# process can't change your shell), which is why this must be sourced.

# Resolve THIS script's own location even when sourced, so the repo root is found
# regardless of your current directory: bash exposes $BASH_SOURCE, zsh exposes %x.
if [ -n "${BASH_SOURCE:-}" ]; then
  _pb_src="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  _pb_src="${(%):-%x}"
else
  _pb_src="$0"
fi
_pb_repo="$(cd "$(dirname "$_pb_src")/.." && pwd)"

echo "Building the CLI…"
if ! (cd "$_pb_repo" && pnpm --filter @paper-baker/cli build >/dev/null); then
  echo "Build failed." >&2
  return 1 2>/dev/null || exit 1
fi

# Functions (not aliases) so they work in any shell, forward args, and keep your cwd.
pb()         { node "$_pb_repo/apps/cli/dist/index.js" "$@"; }
paperbaker() { node "$_pb_repo/apps/cli/dist/index.js" "$@"; }
echo "✓ pb is ready in this shell — run it from any directory."
echo "  (after CLI changes, rebuild: pnpm --dir \"$_pb_repo\" --filter @paper-baker/cli build)"

if [ "${1:-}" = "emulator" ]; then
  export PAPERBAKER_EMULATOR=1
  if curl -sf "http://127.0.0.1:8080/" >/dev/null 2>&1; then
    PAPERBAKER_TOKEN="$(FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node "$_pb_repo/scripts/seed-cli-token.mjs" "${2:-alice-uid}" 2>/dev/null)"
    export PAPERBAKER_TOKEN
    echo "✓ PAPERBAKER_EMULATOR=1 and PAPERBAKER_TOKEN seeded for uid '${2:-alice-uid}'."
  else
    export PAPERBAKER_EMULATOR=1
    echo "! Firestore emulator not running on :8080 — start it (pnpm emulators:all),"
    echo "  then: export PAPERBAKER_TOKEN=\$(pnpm -s seed-cli-token alice-uid)"
  fi
fi
