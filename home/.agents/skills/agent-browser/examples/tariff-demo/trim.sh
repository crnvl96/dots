#!/usr/bin/env bash
# Cut every still stretch in v2-raw.mp4 down to KEEP seconds -> v2-final.mp4, plus a 4x4 contact sheet.
set -euo pipefail
cd "$(dirname "$0")"
KEEP=${KEEP:-2.5}
# -90 dB: at -60 dB the moving 24 px pointer counts as "still", so cuts ate the glide into each click.
NOISE=${NOISE:--90dB}
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 v2-raw.mp4)
ffmpeg -hide_banner -i v2-raw.mp4 -vf "freezedetect=n=$NOISE:d=$KEEP" -map 0:v -f null - 2>&1 | grep -oE 'freeze_(start|end): [0-9.]+' > v2-freezes.txt || true
EXPR=$(python3 - "$KEEP" "$DUR" <<'PY'
import sys,re
keep,dur=float(sys.argv[1]),float(sys.argv[2])
starts,ends=[],[]
for l in open('v2-freezes.txt'):
    k,v=l.split(': '); (starts if 'start' in k else ends).append(float(v))
if len(ends)<len(starts): ends.append(dur)   # freeze running to the end
cuts=[(s+keep,e) for s,e in zip(starts,ends) if e-s>keep]
print('+'.join(f'between(t,{a:.3f},{b:.3f})' for a,b in cuts) or '0')
PY
)
echo "cutting: $EXPR"
ffmpeg -v error -y -i v2-raw.mp4 -vf "select='not($EXPR)',setpts=N/FRAME_RATE/TB" -an -c:v libx264 -pix_fmt yuv420p -r 30 v2-final.mp4
FD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 v2-final.mp4)
echo "raw=${DUR}s final=${FD}s"
FPS=$(python3 -c "print(16/$FD)")
ffmpeg -v error -y -i v2-final.mp4 -vf "fps=$FPS,scale=640:-1,tile=4x4" -frames:v 1 v2-final.contact-sheet.png
