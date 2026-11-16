#!/usr/bin/env bash
# Build TINY 2.1 (WollyMonjac/Tiny-2.1) for the browser and deploy it.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: ./build.sh [--help]

Compiles upstream/TINY.C (unchanged) together with shim/shim.c to WebAssembly,
writes the site to dist/ and installs it to $DEPLOY_DIR.

Environment:
  BUILD_ONLY=1     build dist/ only, do not install
  DEPLOY_DIR       install target (default /var/www/gottz.tiny)
  EMSDK_IMAGE      compiler image (default emscripten/emsdk:6.0.13)
  FONT             PSF2 8x16 console font with a Unicode table
                   (default /usr/share/kbd/consolefonts/default8x16.psfu.gz)

upstream/ is a checkout of https://github.com/WollyMonjac/Tiny-2.1 at the commit
pinned below (cloned on first run, not part of this repository); change the pin
on purpose when taking a new version.
EOF
}

case "${1:-}" in
    -h|--help) usage; exit 0 ;;
    "") ;;
    *) usage >&2; exit 2 ;;
esac

UPSTREAM_URL=https://github.com/WollyMonjac/Tiny-2.1
UPSTREAM_COMMIT=1d5cf54677addf188a090ca1c91acb3d02989a1d
EMSDK_IMAGE=${EMSDK_IMAGE:-emscripten/emsdk:6.0.13}
DEPLOY_DIR=${DEPLOY_DIR:-/var/www/gottz.tiny}
FONT=${FONT:-/usr/share/kbd/consolefonts/default8x16.psfu.gz}

cd "$(dirname "$0")"

if [ ! -d upstream/.git ]; then
    git clone -q "$UPSTREAM_URL" upstream
    git -C upstream checkout -q "$UPSTREAM_COMMIT"
fi
have=$(git -C upstream rev-parse HEAD)
if [ "$have" != "$UPSTREAM_COMMIT" ]; then
    echo "upstream/ is at $have, expected $UPSTREAM_COMMIT" >&2
    exit 1
fi
if [ -n "$(git -C upstream status --porcelain)" ]; then
    echo "upstream/ has local changes; TINY.C must be built unchanged" >&2
    exit 1
fi

rm -rf dist build
mkdir -p dist build

# TINY.C takes its Turbo C path (-D__TURBOC__); its main() becomes tiny_main()
# so shim.c can set up the screen first and report the exit afterwards.
docker run --rm -v "$PWD":/src -w /src "$EMSDK_IMAGE" sh -euc '
    # -x c: the upper-case .C extension would otherwise mean C++
    emcc -O2 -c -x c -Ishim -D__TURBOC__=0x0200 -Dmain=tiny_main -o build/tiny.o upstream/TINY.C
    emcc -O2 -c -Ishim -Wall -Wextra -o build/shim.o shim/shim.c
    emcc -O2 build/tiny.o build/shim.o -o dist/tiny.js \
        --embed-file upstream/TINY.BIN@/TINY.BIN \
        -sASYNCIFY -sASYNCIFY_STACK_SIZE=16384 \
        -sMODULARIZE -sEXPORT_NAME=createTiny -sENVIRONMENT=web \
        -sINVOKE_RUN=0 -sEXIT_RUNTIME=1 \
        -sEXPORTED_FUNCTIONS=_main,_shim_screen,_shim_palette,_shim_state \
        -sEXPORTED_RUNTIME_METHODS=callMain,HEAPU8
    chown -R "$(stat -c %u:%g /src)" build dist
'

python3 tools/mkfont.py "$FONT" > dist/font.js
cp web/index.html web/style.css web/app.js web/favicon.svg dist/
git -C upstream rev-parse HEAD > dist/UPSTREAM_COMMIT

for f in index.html style.css app.js favicon.svg font.js tiny.js tiny.wasm; do
    [ -s "dist/$f" ] || { echo "missing dist/$f" >&2; exit 1; }
done
ls -l dist

if [ "${BUILD_ONLY:-0}" = 1 ]; then
    echo "built dist/ (not installed)"
    exit 0
fi

install -d -m 755 "$DEPLOY_DIR"
install -m 644 dist/* "$DEPLOY_DIR"/
echo "installed to $DEPLOY_DIR"
