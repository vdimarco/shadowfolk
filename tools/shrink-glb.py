"""Shrink a GLB for the web: re-encode every embedded texture at a smaller size as JPEG.

Run: python3 -I tools/shrink-glb.py in.glb out.glb [max_size]
Geometry is untouched; only image buffer views are replaced and the binary chunk is rebuilt.
"""
import io
import json
import struct
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
max_size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
data = open(src, 'rb').read()
magic, version, _ = struct.unpack_from('<III', data, 0)
assert magic == 0x46546C67, 'not a GLB'
off = 12
chunks = []
while off < len(data):
    length, ctype = struct.unpack_from('<II', data, off)
    chunks.append((ctype, data[off + 8: off + 8 + length]))
    off += 8 + length
gltf = json.loads(chunks[0][1].decode('utf8'))
binary = chunks[1][1]
views = gltf['bufferViews']
image_views = {img['bufferView']: i for i, img in enumerate(gltf.get('images', [])) if 'bufferView' in img}
blobs = []
for vi, v in enumerate(views):
    blob = binary[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
    if vi in image_views:
        im = Image.open(io.BytesIO(blob))
        im.load()
        has_alpha = im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema()[0] < 250
        im.thumbnail((max_size, max_size), Image.LANCZOS)
        out = io.BytesIO()
        if has_alpha:
            im.save(out, 'PNG', optimize=True)
            gltf['images'][image_views[vi]]['mimeType'] = 'image/png'
        else:
            im.convert('RGB').save(out, 'JPEG', quality=86, optimize=True)
            gltf['images'][image_views[vi]]['mimeType'] = 'image/jpeg'
        blob = out.getvalue()
    blobs.append(blob)
# rebuild the binary chunk with 4-byte alignment
new_bin = bytearray()
for v, blob in zip(views, blobs):
    while len(new_bin) % 4:
        new_bin.append(0)
    v['byteOffset'] = len(new_bin)
    v['byteLength'] = len(blob)
    new_bin += blob
while len(new_bin) % 4:
    new_bin.append(0)
gltf['buffers'] = [{'byteLength': len(new_bin)}]
js = json.dumps(gltf, separators=(',', ':')).encode('utf8')
js += b' ' * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(new_bin)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
    f.write(struct.pack('<II', len(new_bin), 0x004E4942) + bytes(new_bin))
print(f'{src} -> {dst}: {len(data) // 1024} KB -> {total // 1024} KB')
