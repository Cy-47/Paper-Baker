#!/bin/sh
# Paper Baker CLI installer.
#
#   curl -LsSf https://paper-baker.web.app/install.sh | sh
#
# (Fallback before the web app is deployed:
#   curl -LsSf https://raw.githubusercontent.com/Cy-47/Paper-Baker/main/install.sh | sh )
#
# Downloads a self-contained `pb` binary (no Node required) for your platform
# from GitHub Releases and installs it into ~/.local/bin.
#
# Environment overrides:
#   PB_VERSION          release tag to install (default: latest)
#   PB_INSTALL_DIR      install directory     (default: $HOME/.local/bin)
#   PB_NO_MODIFY_PATH   set to 1 to skip editing shell rc files for PATH
set -eu

REPO="Cy-47/Paper-Baker"
BIN_NAME="pb"
VERSION="${PB_VERSION:-latest}"
INSTALL_DIR="${PB_INSTALL_DIR:-$HOME/.local/bin}"

# --- detect platform -------------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *) echo "error: unsupported OS '$os' (use the npm install instead)" >&2; exit 1 ;;
esac

case "$arch" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64)  arch="x64" ;;
  *) echo "error: unsupported architecture '$arch'" >&2; exit 1 ;;
esac

asset="pb-${os}-${arch}"

# --- resolve download URL --------------------------------------------------
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

# --- download --------------------------------------------------------------
echo "Installing Paper Baker CLI ($asset, $VERSION)..."
mkdir -p "$INSTALL_DIR"
tmp="$(mktemp)"
sum_tmp="$(mktemp)"

# fetch <url> <out>: download with curl or wget, nonzero exit on HTTP failure.
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    echo "error: need curl or wget to download" >&2
    exit 1
  fi
}

fetch "$url" "$tmp"

# --- verify checksum -------------------------------------------------------
# Each release publishes <asset>.sha256 alongside the binary. Verify when both
# the checksum file and a sha256 tool are present; a mismatch is FATAL. Releases
# without a published checksum (or hosts lacking sha256sum/shasum) fall back to
# transport (TLS) integrity only, with a note.
if fetch "${url}.sha256" "$sum_tmp" 2>/dev/null; then
  expected="$(awk '{print $1}' "$sum_tmp")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp" | awk '{print $1}')"
  else
    actual=""
  fi
  if [ -z "$actual" ]; then
    echo "note: no sha256 tool found; skipping checksum verification" >&2
  elif [ "$expected" = "$actual" ]; then
    echo "✓ Checksum verified"
  else
    echo "error: checksum mismatch for $asset" >&2
    echo "  expected: $expected" >&2
    echo "  actual:   $actual" >&2
    rm -f "$tmp" "$sum_tmp"
    exit 1
  fi
else
  echo "note: no published checksum for this release; skipping verification" >&2
fi
rm -f "$sum_tmp"

chmod +x "$tmp"
mv "$tmp" "$INSTALL_DIR/$BIN_NAME"

echo "✓ Installed to $INSTALL_DIR/$BIN_NAME"

# --- PATH setup (uv-style) -------------------------------------------------
# Write an `env` script next to the binary that prepends INSTALL_DIR to PATH,
# then source it from the user's shell rc files so new shells pick up `pb`
# automatically. Idempotent: re-running never duplicates a line. The grep guard
# in the env script also makes the PATH prepend itself a no-op if it's already
# there. Opt out with PB_NO_MODIFY_PATH=1 to get the manual hint instead.

# Append `line` to `file` only if it's not already present. Creates the file
# (and its parent dir) when `create` is non-empty.
add_line_once() {
  file="$1"; line="$2"; create="${3:-}"
  if [ ! -f "$file" ] && [ -z "$create" ]; then
    return 0
  fi
  mkdir -p "$(dirname "$file")"
  if [ ! -f "$file" ] || ! grep -qF "$line" "$file" 2>/dev/null; then
    printf '\n%s\n' "$line" >> "$file"
    echo "  configured $file"
  fi
}

already_on_path=0
case ":$PATH:" in
  *":$INSTALL_DIR:"*) already_on_path=1 ;;
esac

if [ "${PB_NO_MODIFY_PATH:-0}" = "1" ] || [ "$already_on_path" = "1" ]; then
  # Either the user opted out, or the dir is already on PATH — just hint.
  if [ "$already_on_path" = "0" ]; then
    echo ""
    echo "Add $INSTALL_DIR to your PATH:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  fi
else
  # POSIX/bash/zsh env script.
  cat > "$INSTALL_DIR/env" <<EOF
#!/bin/sh
# Added by the Paper Baker installer. Prepend the install dir to PATH.
case ":\${PATH}:" in
    *:"$INSTALL_DIR":*) ;;
    *) export PATH="$INSTALL_DIR:\$PATH" ;;
esac
EOF
  # fish env script.
  cat > "$INSTALL_DIR/env.fish" <<EOF
# Added by the Paper Baker installer. Prepend the install dir to PATH.
if not contains "$INSTALL_DIR" \$PATH
    set -x PATH "$INSTALL_DIR" \$PATH
end
EOF

  echo ""
  echo "Configuring PATH (set PB_NO_MODIFY_PATH=1 to skip):"
  posix_src=". \"$INSTALL_DIR/env\""
  # .profile is the universal POSIX login file; .bashrc/.zshrc cover the two
  # common interactive shells. Created if missing so a fresh shell works.
  add_line_once "$HOME/.profile" "$posix_src" create
  add_line_once "$HOME/.bashrc"  "$posix_src" create
  add_line_once "$HOME/.zshrc"   "$posix_src" create
  # macOS bash login shells read .bash_profile; only touch it if it exists.
  add_line_once "$HOME/.bash_profile" "$posix_src"
  # fish, only if the user actually has a fish config dir.
  if [ -d "$HOME/.config/fish" ]; then
    add_line_once "$HOME/.config/fish/conf.d/pb.fish" "source \"$INSTALL_DIR/env.fish\"" create
  fi

  echo ""
  echo "Restart your shell, or run this to use pb now:"
  echo "  source \"$INSTALL_DIR/env\""

  # Put it on PATH for the rest of THIS script (so `pb login` below works).
  export PATH="$INSTALL_DIR:$PATH"
fi

PB="$INSTALL_DIR/$BIN_NAME"

# --- offer sign-in ---------------------------------------------------------
# Login is optional — the CLI works locally without an account. Only prompt when
# we have a real terminal; `curl | sh` has a piped stdin, so there we just hint.
echo ""
if [ -t 0 ] && [ -t 1 ]; then
  printf "Sign in to sync with your account now? [Y/n] "
  read -r answer
  case "$answer" in
    [Nn]*) echo "Skipped. Run 'pb login' whenever you're ready." ;;
    *) "$PB" login || echo "Login didn't complete. Run 'pb login' to try again." ;;
  esac
else
  echo "Optional: run 'pb login' to sync with your account (works locally without it)."
fi

echo ""
echo "Run 'pb --help' to get started."
