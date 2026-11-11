"""Join two opening shots in front of the captured gameplay and rebuild the soundtrack.

Usage: python3 tools/assemble-video.py <shotA.mp4> <shotB.mp4> <frames-dir> <out.mp4>
The frames dir comes from tools/capture-video.ts (f00000.jpg ... and events.json).
"""
import json, subprocess, sys, tempfile, os

a, b, frames, out = sys.argv[1:5]
FONT = '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf'
SHOT, XF1, XF2 = 5.0, 0.6, 0.8
tmp = tempfile.mkdtemp()

def esc(t):
    return t.replace('\\', '\\\\').replace(':', '\\:').replace("'", "’")

def shot(src, dst, caption, fade_in):
    vf = [
        'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos', 'crop=1920:1080', 'fps=30',
        f'trim=0:{SHOT}', 'setpts=PTS-STARTPTS',
        # caption in the lower third, the same look as the gameplay captions
        f"drawtext=fontfile={FONT}:text='{esc(caption)}':fontsize=54:fontcolor=0xf6e4c2:"
        "x=(w-text_w)/2:y=h*0.84:shadowcolor=black@0.85:shadowx=0:shadowy=3:"
        "alpha='if(lt(t,0.5),0,min(1,(t-0.5)/0.5))'",
    ]
    if fade_in:
        vf.append('fade=t=in:st=0:d=0.8')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-an', '-vf', ','.join(vf),
                    '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', dst], check=True)

shot(a, f'{tmp}/a.mp4', 'Hand shadows: the oldest game you play with your hands.', True)
shot(b, f'{tmp}/b.mp4', 'Shadowfolk brings them to Meta Quest.', False)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', f'{frames}/f%05d.jpg',
                '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', f'{tmp}/g.mp4'], check=True)

ev = json.load(open(f'{frames}/events.json'))
game_len = ev['frames'] / ev['fps']
offset = 2 * SHOT - XF1 - XF2
total = offset + game_len

# soundtrack: the same generator, events shifted to where the gameplay now starts
shifted = {'fps': 30, 'frames': int(round(total * 30)),
           'events': [{'t': 2.2, 'type': 'tap'}] + [{'t': e['t'] + offset, 'type': e['type']} for e in ev['events']]}
json.dump(shifted, open(f'{tmp}/events.json', 'w'))
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run(['npx', 'tsx', f'{here}/soundtrack.ts', f'{tmp}/events.json', f'{tmp}/sound.wav'], check=True)

fc = (f'[0:v][1:v]xfade=transition=fade:duration={XF1}:offset={SHOT - XF1}[ab];'
      f'[ab][2:v]xfade=transition=fadeblack:duration={XF2}:offset={2 * SHOT - XF1 - XF2}[v]')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{tmp}/a.mp4', '-i', f'{tmp}/b.mp4', '-i', f'{tmp}/g.mp4',
                '-i', f'{tmp}/sound.wav', '-filter_complex', fc, '-map', '[v]', '-map', '3:a',
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], check=True)
print(f'wrote {out}: {total:.1f}s, gameplay starts at {offset:.1f}s')
