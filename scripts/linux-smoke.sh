#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Gailleur Labs
#
# Drives an installed mdwisp inside a virtual X display: opens a document,
# checks the process stays up, screenshots the window, then walks the Help
# menu with the keyboard to run "Check for Updates…" and screenshots the
# result. Meant for linux-smoke.yml, run under xvfb-run:
#
#   xvfb-run -a -s "-screen 0 1280x800x24" scripts/linux-smoke.sh <binary> <file.md> <out-dir>
#
# Exits non-zero if the app dies or never shows a window.
set -euo pipefail

bin=$1
doc=$2
out=$3
mkdir -p "$out"

# A window manager so the window gets focus and keyboard events land in it.
openbox >/dev/null 2>&1 &
sleep 1

# WebKitGTK falls over on a display without GL; these keep it on software paths.
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

# A session bus, as on any desktop: the single-instance plugin registers on
# it and WebKitGTK looks for the accessibility bus there.
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
  eval "$(dbus-launch --sh-syntax)"
  export DBUS_SESSION_BUS_ADDRESS
fi

"$bin" "$doc" >"$out/app.log" 2>&1 &
app=$!

# Wait up to a minute for a mapped window; the runners are slow.
win=""
for _ in $(seq 1 30); do
  sleep 2
  if ! kill -0 "$app" 2>/dev/null; then
    echo "app exited early"; cat "$out/app.log"; exit 1
  fi
  win=$(xdotool search --onlyvisible --name '^mdwisp' 2>/dev/null | head -1 || true)
  [ -n "$win" ] && break
done
import -window root "$out/0-startup.png"
if [ -z "$win" ]; then
  echo "no mapped window after 60 s; window tree:"
  xwininfo -root -tree | head -40
  for w in $(xdotool search --name '^mdwisp'); do
    echo "--- unmapped candidate $w"; xwininfo -id "$w" | grep -E 'Map State|geometry|Width|Height'
  done
  echo "--- process tree"; pstree -p "$app" || true
  echo "--- threads"; ls "/proc/$app/task" | wc -l
  echo "--- main thread"; sudo gdb -p "$app" -batch -ex 'thread 1' -ex 'bt 40' 2>/dev/null | grep -E '^#'
  echo "--- all threads"; sudo gdb -p "$app" -batch -ex 'thread apply all bt 8' 2>/dev/null | grep -E '^#|^Thread' | head -200
  cat "$out/app.log"; exit 1
fi
xdotool windowactivate --sync "$win" || true
xdotool windowsize "$win" 1200 760 || true
sleep 2
import -window root "$out/1-document.png"

# Help menu: F10 opens the first menu, Left wraps to Help, Down skips
# "mdwisp Help", Return runs "Check for Updates…".
xdotool key --window "$win" F10
sleep 1
xdotool key Left
sleep 1
import -window root "$out/2-help-menu.png"
xdotool key Down
sleep 0.5
xdotool key Return
sleep 12
import -window root "$out/3-after-check.png"

if ! kill -0 "$app" 2>/dev/null; then
  echo "app died during the update check"; cat "$out/app.log"; exit 1
fi

# If an update was offered the banner's first button is "install"; click it
# and give the installer time. On a .deb this runs the package manager.
if [ "${TRY_INSTALL:-}" = "1" ]; then
  eval "$(xdotool getwindowgeometry --shell "$win")"
  # The banner sits at the top of the window; its buttons follow the text.
  xdotool mousemove $((X + ${INSTALL_X:-430})) $((Y + ${INSTALL_Y:-24})) click 1
  sleep 40
  import -window root "$out/4-after-install.png"
fi

kill "$app" 2>/dev/null || true
echo "--- app.log"; cat "$out/app.log"
