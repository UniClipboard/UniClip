#!/bin/sh
set -eu

if [ "$#" -lt 6 ] || [ "$#" -gt 7 ]; then
  echo "Usage: $0 <screenshot> <x> <top-y> <root-top-y> <root-bottom-y> <bottom-y> [max-channel-delta]" >&2
  exit 64
fi

image=$1
x=$2
top_y=$3
root_top_y=$4
root_bottom_y=$5
bottom_y=$6
max_delta=${7:-2}

if [ ! -f "$image" ]; then
  echo "Screenshot not found: $image" >&2
  exit 66
fi

sample_rgb() {
  magick "$image" -format \
    "%[fx:round(255*p{$x,$1}.r)] %[fx:round(255*p{$x,$1}.g)] %[fx:round(255*p{$x,$1}.b)]" info:
}

top_rgb=$(sample_rgb "$top_y")
root_top_rgb=$(sample_rgb "$root_top_y")
root_bottom_rgb=$(sample_rgb "$root_bottom_y")
bottom_rgb=$(sample_rgb "$bottom_y")

set -- $top_rgb
top_r=$1
top_g=$2
top_b=$3
set -- $root_top_rgb
root_top_r=$1
root_top_g=$2
root_top_b=$3
set -- $root_bottom_rgb
root_bottom_r=$1
root_bottom_g=$2
root_bottom_b=$3
set -- $bottom_rgb
bottom_r=$1
bottom_g=$2
bottom_b=$3

awk \
  -v top_r="$top_r" -v top_g="$top_g" -v top_b="$top_b" \
  -v root_top_r="$root_top_r" -v root_top_g="$root_top_g" -v root_top_b="$root_top_b" \
  -v root_bottom_r="$root_bottom_r" -v root_bottom_g="$root_bottom_g" -v root_bottom_b="$root_bottom_b" \
  -v bottom_r="$bottom_r" -v bottom_g="$bottom_g" -v bottom_b="$bottom_b" \
  -v max_delta="$max_delta" '
  function abs(value) { return value < 0 ? -value : value }
  BEGIN {
    top_delta_r = abs(top_r - root_top_r)
    top_delta_g = abs(top_g - root_top_g)
    top_delta_b = abs(top_b - root_top_b)
    bottom_delta_r = abs(root_bottom_r - bottom_r)
    bottom_delta_g = abs(root_bottom_g - bottom_g)
    bottom_delta_b = abs(root_bottom_b - bottom_b)
    largest_delta = top_delta_r
    if (top_delta_g > largest_delta) largest_delta = top_delta_g
    if (top_delta_b > largest_delta) largest_delta = top_delta_b
    if (bottom_delta_r > largest_delta) largest_delta = bottom_delta_r
    if (bottom_delta_g > largest_delta) largest_delta = bottom_delta_g
    if (bottom_delta_b > largest_delta) largest_delta = bottom_delta_b
    printf "top=rgb(%d,%d,%d) root-top=rgb(%d,%d,%d) root-bottom=rgb(%d,%d,%d) bottom=rgb(%d,%d,%d) max-channel-delta=%d threshold=%d\n", top_r, top_g, top_b, root_top_r, root_top_g, root_top_b, root_bottom_r, root_bottom_g, root_bottom_b, bottom_r, bottom_g, bottom_b, largest_delta, max_delta
    exit largest_delta > max_delta
  }
'
