"""產生 docs/board.svg：遊戲王式配置，由中線往外是 生物區 → 能量區（費用）→ 英雄。
每人有自己的場地區，在自己生物區的左邊；牌庫與棄牌在右邊。
對手那一側整個轉 180°，所以從你這邊看，對手的牌庫、棄牌在左邊，場地區在右邊。
生物區的編號以欄位計，正對面永遠是同一個號碼。

用法：python3 scripts/board-svg.py
"""
from pathlib import Path

ZW, ZH, GAP = 92, 104, 14
SIDE, EDGE = 110, 26                      # 左右兩側欄位的寬度、到圖邊緣的距離
X0 = EDGE + SIDE + 14                     # 第一格生物區的 x
W, H = 2 * X0 + 5 * ZW + 4 * GAP, 660     # 左右對稱
xs = [X0 + i * (ZW + GAP) for i in range(5)]
ROW_W = 5 * ZW + 4 * GAP
MID = H // 2
FONT = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif"
HERO_Y, HERO_H = 28, 54
EN_Y, EN_H = 96, 46
CR_Y = MID - 66 - ZH

out: list[str] = []
a = out.append


def mirror(y: float, h: float) -> float:
    """上半部（對手）的 y 對稱到下半部（你）。"""
    return H - y - h


def text(x, y, s, size=15, color="#e6edf2", weight=400, anchor="middle"):
    a(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" '
      f'text-anchor="{anchor}" dominant-baseline="central">{s}</text>')


def side(top: bool):
    who = "對手" if top else "你"
    hy = HERO_Y if top else mirror(HERO_Y, HERO_H)
    ey = EN_Y if top else mirror(EN_Y, EN_H)
    cy = CR_Y if top else mirror(CR_Y, ZH)
    cx = X0 + ROW_W / 2
    # 英雄
    a(f'<rect x="{cx - 110}" y="{hy}" width="220" height="{HERO_H}" rx="10" fill="#3a3024" stroke="#d4a24c" stroke-width="2"/>')
    text(cx, hy + HERO_H / 2, f"{who}的英雄", 17, "#f3dcae", 700)
    # 能量區：一整排能量池，最高 12
    a(f'<rect x="{X0}" y="{ey}" width="{ROW_W}" height="{EN_H}" rx="8" fill="#1c3340" stroke="#4fb3c8" stroke-width="1.5"/>')
    text(X0 + 16, ey + EN_H / 2, "能量區（費用）", 14, "#9fdcea", 700, "start")
    for i in range(12):
        filled = i < 7
        a(f'<circle cx="{X0 + 170 + i * 27}" cy="{ey + EN_H / 2}" r="8" fill="{"#6fd3e6" if filled else "none"}" '
          f'stroke="#4fb3c8" stroke-width="1.5"/>')
    # 生物區 ①–⑤
    for i, x in enumerate(xs):
        a(f'<rect x="{x}" y="{cy}" width="{ZW}" height="{ZH}" rx="8" fill="#273744" stroke="#7f9bb0" stroke-width="1.5"/>')
        text(x + ZW / 2, cy + ZH / 2 - 8, "①②③④⑤"[i], 26, "#cfe0ec")
        text(x + ZW / 2, cy + ZH / 2 + 24, "生物區", 11, "#8fa6b8")
    # 場地區在擁有者的左邊，牌庫與棄牌在擁有者的右邊；對手轉了 180°，左右相反
    left, right = EDGE, X0 + ROW_W + 14
    fx, fw = (right if top else left), SIDE
    a(f'<rect x="{fx}" y="{cy}" width="{fw}" height="{ZH}" rx="8" fill="#26361f" stroke="#8fbf6a" stroke-width="1.5"/>')
    text(fx + fw / 2, cy + ZH / 2 - 10, "場地區", 13, "#cde6b3", 700)
    text(fx + fw / 2, cy + ZH / 2 + 12, f"{who}的", 11, "#a9c98c")
    rx = (left if top else right) + (SIDE - 64) / 2
    for label, y in (("棄牌", cy + (ZH - 70) / 2), ("牌庫", ey - 12)):
        dash = "4 3" if label == "棄牌" else "none"
        a(f'<rect x="{rx}" y="{y}" width="64" height="70" rx="6" fill="#273744" stroke="#7f9bb0" '
          f'stroke-width="1.5" stroke-dasharray="{dash}"/>')
        text(rx + 32, y + 35, label, 13, "#cfe0ec")


a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="{FONT}">')
a('<title>場上配置</title>')
a('<desc>由中線往外：生物區、能量區（費用）、英雄。每人的場地區在自己生物區左邊，牌庫與棄牌在右邊。</desc>')
a(f'<rect x="8" y="8" width="{W - 16}" height="{H - 16}" rx="18" fill="#1d2830" stroke="#3a4a57" stroke-width="2"/>')
side(True)
side(False)
a(f'<line x1="{X0}" y1="{MID}" x2="{X0 + ROW_W}" y2="{MID}" stroke="#7f9bb0" stroke-width="1.5" stroke-dasharray="6 6"/>')

# 位置技能示意：你的 ③ → 對手的 ③（正對面）與 ②④（斜對角）
my_top, opp_bottom = H - CR_Y - ZH, CR_Y + ZH
sx = xs[2] + ZW / 2
for i in (1, 2, 3):
    color = "#f0b35a" if i == 2 else "#e39a6b"
    a(f'<line x1="{sx}" y1="{my_top}" x2="{xs[i] + ZW / 2}" y2="{opp_bottom}" stroke="{color}" '
      f'stroke-width="2" stroke-dasharray="5 4" opacity="0.85"/>')
for i, label in ((1, "斜對角"), (2, "正對面"), (3, "斜對角")):
    lx = (sx + xs[i] + ZW / 2) / 2 + (0 if i == 2 else (-26 if i == 1 else 26))
    a(f'<rect x="{lx - 26}" y="{MID - 34}" width="52" height="20" rx="4" fill="#1d2830"/>')
    text(lx, MID - 24, label, 11, "#f0b35a" if i == 2 else "#e39a6b", 700)
a('</svg>')

Path(__file__).resolve().parent.parent.joinpath('docs/board.svg').write_text('\n'.join(out) + '\n', encoding='utf-8')
print('docs/board.svg')
