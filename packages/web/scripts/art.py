#!/usr/bin/env python3
"""用 AI 繪圖服務（pollinations.ai）產生卡圖，存成 packages/web/public/art/<id>.webp。

用法：python3 packages/web/scripts/art.py [id ...]   不給 id 就產生所有還沒有圖的卡
　　　python3 packages/web/scripts/art.py --trim      把已經有的圖邊緣的亮邊、黑邊切掉（不用重新產圖）
風格與每個顏色的色調照 docs/art.md；每張卡的畫面描述在 packages/web/art/subjects.json。
同一張卡用固定的 seed，重跑會得到同一張圖；想換一張就把舊的 webp 刪掉、改 subjects.json 的描述。
這個服務的圖會在右下角加浮水印，裁切時會切掉。正式上線前請改用有商業授權的繪圖服務。
"""
import concurrent.futures
import hashlib
import io
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'packages/web/public/art'
SUBJECTS = json.loads((ROOT / 'packages/web/art/subjects.json').read_text())

STYLE = ('painterly fantasy trading card illustration, rich but soft lighting, clear silhouette, '
         'single focal subject, dark atmospheric background, detailed but readable at small size, '
         'no text, no letters, no border, no frame, no watermark')
MOODS = {
    'white': 'ivory and gold palette, warm backlight and glow',
    'blue': 'deep blue and cyan palette, cold misty light',
    'black': 'purple-black and sickly green palette, low light with rim light',
    'red': 'orange-red and ember palette, strong firelight',
    'green': 'moss green and amber palette, dappled forest light',
}
NEUTRAL = 'grey-brown and metallic palette, neutral light'
WIDTH, HEIGHT = 320, 240  # 卡面的插圖框是 4:3


def edge_lines(gray, side, limit):
    """圖的某一邊有幾排是邊框（跟往內幾排的亮度差很多）：AI 產的圖常在邊緣留 1–3 排白邊或黑邊。"""
    w, h = gray.size

    def mean(i):
        if side in ('left', 'right'):
            x = i if side == 'left' else w - 1 - i
            return sum(gray.getpixel((x, y)) for y in range(0, h, 3)) / len(range(0, h, 3))
        y = i if side == 'top' else h - 1 - i
        return sum(gray.getpixel((x, y)) for x in range(0, w, 3)) / len(range(0, w, 3))

    inner = mean(limit + 2)
    count = 0
    while count < limit and abs(mean(count) - inner) > 25:
        count += 1
    return count + 1 if count else 0


def trim_frame(image, limit):
    """切掉四邊的邊框，再從中間取 4:3 縮成卡圖的大小。"""
    gray = image.convert('L')
    w, h = image.size
    left, right = edge_lines(gray, 'left', limit), edge_lines(gray, 'right', limit)
    top, bottom = edge_lines(gray, 'top', limit), edge_lines(gray, 'bottom', limit)
    box_w, box_h = w - left - right, h - top - bottom
    if box_w * 3 > box_h * 4:
        extra = box_w - box_h * 4 // 3
        left, box_w = left + extra // 2, box_w - extra
    else:
        extra = box_h - box_w * 3 // 4
        top, box_h = top + extra // 2, box_h - extra
    return image.crop((left, top, left + box_w, top + box_h)).resize((WIDTH, HEIGHT), Image.LANCZOS)


def trim_existing():
    """已經有的圖：有邊框的才重存。"""
    for path in sorted(OUT.glob('*.webp')):
        image = Image.open(path).convert('RGB')
        gray = image.convert('L')
        if not any(edge_lines(gray, side, 6) for side in ('left', 'right', 'top', 'bottom')):
            continue
        trim_frame(image, 6).save(path, 'WEBP', quality=82, method=6)
        print('切掉邊框', path.name, flush=True)


def manifest():
    out = subprocess.run(['npx', 'tsx', 'packages/web/scripts/art-manifest.ts'], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


def prompt(card, subject):
    moods = [MOODS[c] for c in card['colors']] or [NEUTRAL]
    return f'{STYLE}, {subject}, {"; ".join(moods[:2])}'


def seed(card_id):
    return int(hashlib.sha256(card_id.encode()).hexdigest()[:8], 16) % 1_000_000


def fetch(card_id, card):
    url = 'https://image.pollinations.ai/prompt/' + urllib.parse.quote(prompt(card, SUBJECTS[card_id]))
    url += f'?width=512&height=640&nologo=true&seed={seed(card_id)}'
    last = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                data = response.read()
            image = Image.open(io.BytesIO(data)).convert('RGB')
            w, h = image.size
            # 切掉邊框與右下角的浮水印：取上面 4:3 的一塊。
            crop_w = int(w * 0.92)
            crop_h = crop_w * 3 // 4
            left = (w - crop_w) // 2
            top = int(h * 0.1)
            image = trim_frame(image.crop((left, top, left + crop_w, top + crop_h)), 10)
            image.save(OUT / f'{card_id}.webp', 'WEBP', quality=78, method=6)
            return card_id, None
        except Exception as error:  # 服務偶爾會失敗或太忙（429），等一下再試
            last = error
            time.sleep(20 * (attempt + 1))
    return card_id, str(last)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cards = manifest()
    missing = [cid for cid in SUBJECTS if cid not in cards]
    if missing:
        sys.exit(f'subjects.json 裡有不存在的卡：{missing}')
    wanted = sys.argv[1:] or [cid for cid in cards if not (OUT / f'{cid}.webp').exists()]
    no_subject = [cid for cid in wanted if cid not in SUBJECTS]
    if no_subject:
        sys.exit(f'這些卡還沒有畫面描述，先加進 subjects.json：{no_subject}')
    print(f'要畫 {len(wanted)} 張')
    # 這個服務一次只接一個請求，多了會回 429。
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        for card_id, error in pool.map(lambda cid: fetch(cid, cards[cid]), wanted):
            print(('失敗 ' + card_id + '：' + error) if error else ('完成 ' + card_id), flush=True)


if __name__ == '__main__':
    trim_existing() if sys.argv[1:] == ['--trim'] else main()
