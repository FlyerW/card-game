#!/usr/bin/env python3
"""卡包的主視覺：每個系列一張直式插圖，存成 packages/web/public/art/booster-<系列>.webp（300×450）。

用法：python3 packages/web/scripts/pack-art.py [系列 ...]   不給就畫還沒有圖的
服務跟卡圖一樣（pollinations.ai），風格照 docs/art.md；想換一張就刪掉舊的 webp、改下面的描述。
"""
import io
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from art import OUT, trim_frame  # noqa: E402

STYLE = ('painterly fantasy trading card game booster pack key art, epic composition, rich dramatic lighting, '
         'vertical poster, no text, no letters, no logo, no border, no frame, no watermark')
PACKS = {
    'core': 'five radiant heroes standing together on a cliff at sunrise, each glowing with a different magic: white holy light, blue water, purple shadow, red fire and green nature, colorful sky',
    'awakening': 'a colossal dragon awakening and spreading its wings above glowing ley lines of the earth, golden and crimson light',
    'celestial': 'a floating celestial temple of brass gears and marble in the clouds, angels and clockwork machines around it, golden light',
}
WIDTH, HEIGHT = 300, 450


def fetch(set_id):
    prompt = f'{STYLE}, {PACKS[set_id]}'
    url = 'https://image.pollinations.ai/prompt/' + urllib.parse.quote(prompt) + f'?width=512&height=800&nologo=true&seed={sum(map(ord, set_id))}'
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                image = Image.open(io.BytesIO(response.read())).convert('RGB')
            w, h = image.size
            # 切掉右下角的浮水印與邊框：取上面 2:3 的一塊
            crop_w = int(w * 0.92)
            crop_h = crop_w * 3 // 2
            left = (w - crop_w) // 2
            top = int(h * 0.04)
            image = image.crop((left, top, left + crop_w, top + min(crop_h, h - top - int(h * 0.06))))
            image = image.resize((WIDTH, HEIGHT), Image.LANCZOS)
            image.save(OUT / f'booster-{set_id}.webp', 'WEBP', quality=82, method=6)
            return None
        except Exception as error:  # 服務偶爾會失敗或太忙，等一下再試
            last = error
            time.sleep(20 * (attempt + 1))
    return str(last)


if __name__ == '__main__':
    wanted = sys.argv[1:] or [s for s in PACKS if not (OUT / f'pack-{s}.webp').exists()]
    for set_id in wanted:
        error = fetch(set_id)
        print(('失敗 ' + set_id + '：' + error) if error else ('完成 ' + set_id), flush=True)
