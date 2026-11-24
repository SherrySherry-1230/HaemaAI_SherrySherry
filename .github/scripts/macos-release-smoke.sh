#!/bin/bash
# @editedBy SherrySherry 2026-11-24
set -euo pipefail
umask 077
if [[ $# != 2 || "$(uname -s)" != Darwin || ! -f "$1" || ! "$2" =~ ^[0-9a-f]{64}$ ]]; then
  echo 'Usage on macOS: bash macos-release-smoke.sh archive.zip sha256' >&2
  exit 2
fi
asset=$1
digest=$(shasum -a 256 < "$asset")
[[ "${digest%% *}" == "$2" ]] || { echo 'Release SHA-256 mismatch.' >&2; exit 1; }
echo "Verified release SHA-256: $2"

case "$(uname -m)" in
  arm64) package_arch=arm64 ;;
  x86_64) package_arch=x64 ;;
  *) echo 'Unsupported Mac CPU.' >&2; exit 1 ;;
esac
if [[ -n "${EXPECTED_NODE_ARCH:-}" && "$package_arch" != "$EXPECTED_NODE_ARCH" ]]; then
  echo 'Runner CPU does not match the requested test.' >&2
  exit 1
fi
scratch=$(mktemp -d "${HAEMA_SMOKE_TEMP:-${TMPDIR:-/tmp}}/haema-mac-smoke.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
mkdir "$scratch/archive"
/usr/bin/ditto -x -k "$asset" "$scratch/archive"
stores=("$scratch/archive"/*)
[[ ${#stores[@]} == 1 && -d "${stores[0]}/.haema" ]] || { echo 'Unexpected archive layout.' >&2; exit 1; }
source_root=${stores[0]}
for entry in 쩜통_연결.command Start.command StartAI.command Stop.command; do
  [[ -x "$source_root/$entry" ]] || { echo 'Launcher command is missing or not executable.' >&2; exit 1; }
  /bin/bash -n "$source_root/$entry"
done
slices=" $(/usr/bin/lipo -archs "$source_root/.haema/mac-web-helper.bin") "
[[ "$slices" == *" arm64 "* && "$slices" == *" x86_64 "* ]] || { echo 'Mac helper is missing a CPU slice.' >&2; exit 1; }
node="$source_root/.haema/node/darwin-$package_arch/bin/node"
[[ -x "$node" && "$("$node" -p 'process.arch')" == "$package_arch" ]]
echo "Testing macOS $(sw_vers -productVersion) $package_arch with bundled Node $("$node" --version)"
"$node" "$(dirname "$0")/macos-release-smoke.mjs" "$source_root" "$scratch"
