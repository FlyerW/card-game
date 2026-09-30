// 關鍵字（例如「聖盾」）的說明框：滑鼠移上去或點一下（手機）才出現。
// 用一個固定在畫面上的框，位置夾在畫面裡面：字靠右時框往左挪、下面放不下就放在字上面，不會把整頁撐寬。

const MARGIN = 8;

export function installKeywordTips(): void {
  if (document.querySelector('.kw-tip')) return; // 開發時熱更新會再跑一次
  const tip = document.createElement('div');
  tip.className = 'kw-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);

  const keywordOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.kw[data-tip]') : null);
  const show = (el: HTMLElement) => {
    tip.textContent = el.dataset.tip ?? '';
    tip.hidden = false;
    const rect = el.getBoundingClientRect();
    // 可見的寬高（不含捲軸）。
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const left = Math.min(Math.max(MARGIN, rect.left), width - tip.offsetWidth - MARGIN);
    const below = rect.bottom + 4;
    const top = below + tip.offsetHeight <= height - MARGIN ? below : Math.max(MARGIN, rect.top - 4 - tip.offsetHeight);
    tip.style.left = `${Math.max(MARGIN, left)}px`;
    tip.style.top = `${top}px`;
  };
  const hide = () => {
    tip.hidden = true;
  };

  document.addEventListener('mouseover', (event) => {
    const el = keywordOf(event.target);
    if (el) show(el);
  });
  document.addEventListener('mouseout', (event) => {
    if (keywordOf(event.target)) hide();
  });
  document.addEventListener('focusin', (event) => {
    const el = keywordOf(event.target);
    if (el) show(el);
    else hide();
  });
  document.addEventListener('focusout', hide);
  // 捲動、點別的地方、畫面重畫（字不見了）都收起來。
  window.addEventListener('scroll', hide, true);
  document.addEventListener('click', (event) => {
    if (!keywordOf(event.target)) hide();
  });
}

/** 畫面重畫時呼叫：原本指著的字已經被換掉了。 */
export function hideKeywordTip(): void {
  const tip = document.querySelector<HTMLElement>('.kw-tip');
  if (tip) tip.hidden = true;
}
