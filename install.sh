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
#   PB_VERSION       release tag to install (default: latest)
#   PB_INSTALL_DIR   install directory     (default: $HOME/.local/bin)
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

if command -v curl >/dev/null 2>&1; then
  curl -fSL "$url" -o "$tmp"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp" "$url"
else
  echo "error: need curl or wget to download" >&2
  exit 1
fi

chmod +x "$tmp"
mv "$tmp" "$INSTALL_DIR/$BIN_NAME"

echo "✓ Installed to $INSTALL_DIR/$BIN_NAME"

# --- PATH guidance ---------------------------------------------------------
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "Add $INSTALL_DIR to your PATH:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

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
