"""Join the opening shots in front of the captured gameplay and rebuild the soundtrack.

Usage: python3 tools/assemble-video.py <shotA.mp4> <shotB.mp4> [<shotC.mp4>] <frames-dir> <out.mp4> [score.wav]
The frames dir comes from tools/capture-video.ts (f00000.jpg ... and events.json).
With three shots, the opening is the Higgsfield film (animated from real game frames).
"""
import json, subprocess, sys, tempfile, os

args = sys.argv[1:]
shots = [x for x in args if x.endswith('.mp4')][:-1]
frames = next(x for x in args if os.path.isdir(x))
out = [x for x in args if x.endswith('.mp4')][-1]
# optional: a finished soundtrack WAV (for example the game's own score from
# tools/render-score.mts); without it the synth in tools/soundtrack.ts is used
music = next((x for x in args if x.endswith('.wav')), None)
FONT = '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf'
SHOT, XF1, XF2 = 5.0, 0.6, 0.8
tmp = tempfile.mkdtemp()

def esc(t):
    return t.replace('\\', '\\\\').replace(':', '\\:').replace("'", "’")

CAPTIONS = {
    2: ['Hand shadows: the oldest game you play with your hands.', 'Shadowfolk brings them to Meta Quest.'],
    3: ['Hand shadows: the oldest game you play with your hands.',
        'In Shadowfolk, every shadow you make comes alive.',
        'Wake every creature. Then face the Ink Wolf.'],
}[len(shots)]
# the three-shot opening is AI animation of real game frames: say so on screen
NOTE = 'Opening animated with AI from game frames. Gameplay follows.' if len(shots) == 3 else ''

def shot(src, dst, caption, fade_in):
    vf = [
        'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos', 'crop=1920:1080', 'fps=30',
        f'trim=0:{SHOT}', 'setpts=PTS-STARTPTS',
        # caption in the lower third, the same look as the gameplay captions
        f"drawtext=fontfile={FONT}:text='{esc(caption)}':fontsize=54:fontcolor=0xf6e4c2:"
        "x=(w-text_w)/2:y=h*0.84:shadowcolor=black@0.85:shadowx=0:shadowy=3:box=1:boxcolor=0x140a1e@0.55:boxborderw=16:"
        "alpha='if(lt(t,0.5),0,min(1,(t-0.5)/0.5))'",
    ]
    if NOTE:
        vf.append(f"drawtext=fontfile={FONT}:text='{esc(NOTE)}':fontsize=24:fontcolor=0xf6e4c2@0.7:"
                  "x=w-text_w-36:y=30:shadowcolor=black@0.8:shadowx=0:shadowy=2")
    if fade_in:
        vf.append('fade=t=in:st=0:d=0.8')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-an', '-vf', ','.join(vf),
                    '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', dst], check=True)

for i, src in enumerate(shots):
    shot(src, f'{tmp}/s{i}.mp4', CAPTIONS[i], i == 0)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', f'{frames}/f%05d.jpg',
                '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', f'{tmp}/g.mp4'], check=True)

ev = json.load(open(f'{frames}/events.json'))
game_len = ev['frames'] / ev['fps']
n = len(shots)
offset = n * SHOT - (n - 1) * XF1 - XF2
total = offset + game_len

# soundtrack: the same generator, events shifted to where the gameplay now starts
shifted = {'fps': 30, 'frames': int(round(total * 30)),
           'events': [{'t': 2.2, 'type': 'tap'}] + [{'t': e['t'] + offset, 'type': e['type']} for e in ev['events']]}
json.dump(shifted, open(f'{tmp}/events.json', 'w'))
here = os.path.dirname(os.path.abspath(__file__))
if music:
    subprocess.run(['cp', music, f'{tmp}/sound.wav'], check=True)
else:
    subprocess.run(['npx', 'tsx', f'{here}/soundtrack.ts', f'{tmp}/events.json', f'{tmp}/sound.wav'], check=True)

fc, prev = [], '0:v'
for i in range(1, n):
    fc.append(f'[{prev}][{i}:v]xfade=transition=fade:duration={XF1}:offset={i * (SHOT - XF1)}[x{i}]')
    prev = f'x{i}'
fc.append(f'[{prev}][{n}:v]xfade=transition=fadeblack:duration={XF2}:offset={offset}[v]')
inputs = sum([['-i', f'{tmp}/s{i}.mp4'] for i in range(n)], []) + ['-i', f'{tmp}/g.mp4', '-i', f'{tmp}/sound.wav']
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *inputs, '-filter_complex', ';'.join(fc), '-map', '[v]', '-map', f'{n + 1}:a',
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], check=True)
print(f'wrote {out}: {total:.1f}s, gameplay starts at {offset:.1f}s')
