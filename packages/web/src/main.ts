import {
  createEngine,
  describeAbility,
  describeCard,
  describeHero,
  sampleDb,
  SAMPLE_CARDS,
  SAMPLE_HEROES,
  type Action,
  type Color,
  type CreatureView,
  type DeckCardDef,
  type GameEvent,
  type GameState,
  type PlayerId,
  type PlayerView,
  type SideView,
  type Target,
} from '@card-game/engine';
import { chooseAction, STYLES } from '@card-game/sim/bot';
import { describeEvents, ZONE, type LogLine } from './log';
import './style.css';

const db = sampleDb();
const engine = createEngine(db);
const YOU: PlayerId = 0;
const BOT: PlayerId = 1;
const BOT_STEP_MS = 750;

// ─── 狀態 ────────────────────────────────────────────────────────────────────

type Selection =
  | { kind: 'hand'; uid: number }
  | { kind: 'creature'; player: PlayerId; zone: number }
  | { kind: 'skill'; zone: number; skill: number }
  | { kind: 'heroPower' }
  | { kind: 'hero'; player: PlayerId }
  | { kind: 'field'; player: PlayerId };

interface Saved {
  screen: 'setup' | 'play';
  heroId: string;
  state: GameState | null;
  log: LogLine[];
  redraw: number[];
}

interface App extends Saved {
  selection: Selection | null;
  busy: boolean;
  toast: string | null;
}

const app: App = {
  screen: 'setup',
  heroId: SAMPLE_HEROES[1]!.id,
  state: null,
  log: [],
  redraw: [],
  selection: null,
  busy: false,
  toast: null,
};

interface Float {
  key: string;
  text: string;
  tone: 'damage' | 'loss' | 'heal' | 'buff';
}
let floats: Float[] = [];

const root = document.getElementById('app')!;

// ─── 小工具 ──────────────────────────────────────────────────────────────────

const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const card = (id: string) => db.cards.get(id)!;
const hero = (id: string) => db.heroes.get(id)!;
const nameOf = (id: string) => db.cards.get(id)?.name ?? db.heroes.get(id)?.name ?? id;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const targetKey = (t: Target) => (t.kind === 'hero' ? `h${t.player}` : t.kind === 'field' ? `f${t.player}` : `z${t.player}${t.zone}`);

function pips(colors: Color[]): string {
  if (colors.length === 0) return '<span class="pips" aria-label="無色"><i class="pip none"></i></span>';
  return `<span class="pips" aria-label="${colors.join('')}">${colors.map((c) => `<i class="pip ${c}"></i>`).join('')}</span>`;
}

function kindLabel(def: DeckCardDef): string {
  switch (def.kind) {
    case 'creature':
      return def.stage === 0 ? '生物' : `進化・${def.stage === 1 ? '一階' : '二階'}`;
    case 'spell':
      return '法術';
    case 'item':
      return '道具';
    case 'field':
      return '場地';
  }
}

/** 試玩用牌組：從全部範例卡隨機組 40 張（每種最多 3 張），不限顏色。 */
function randomDeck(seed: number): string[] {
  const pool = SAMPLE_CARDS.flatMap((c) => [c.id, c.id, c.id]);
  let t = seed >>> 0;
  const random = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, 40);
}

// ─── 合法動作與可點的目標 ─────────────────────────────────────────────────────
//
// 畫面上能點的東西全部由引擎的合法動作推出來，網頁不自己判斷規則。

let legalCache: { state: GameState; actions: Action[] } | null = null;
function legal(): Action[] {
  const s = app.state;
  if (s === null || app.busy || s.phase !== 'main' || s.activePlayer !== YOU) return [];
  if (legalCache?.state !== s) legalCache = { state: s, actions: engine.legalActions(s, YOU) };
  return legalCache.actions;
}

const actsForCard = (uid: number) => legal().filter((a) => 'card' in a && a.card === uid);
const actsForSkill = (zone: number, skill: number) =>
  legal().filter((a) => a.type === 'useSkill' && a.zone === zone && a.skill === skill);
const actsForPower = () => legal().filter((a) => a.type === 'heroPower');

/** 目前選取狀態下，點哪個位置會執行哪個動作。 */
function choices(): Map<string, Action> {
  const map = new Map<string, Action>();
  const sel = app.selection;
  if (sel === null) return map;
  const acts =
    sel.kind === 'hand' ? actsForCard(sel.uid) : sel.kind === 'skill' ? actsForSkill(sel.zone, sel.skill) : sel.kind === 'heroPower' ? actsForPower() : [];
  for (const a of acts) {
    if (a.type === 'summon' || a.type === 'evolve' || a.type === 'attachItem') map.set(`z${YOU}${a.zone}`, a);
    else if ((a.type === 'castSpell' || a.type === 'useSkill' || a.type === 'heroPower') && a.target) map.set(targetKey(a.target), a);
  }
  return map;
}

// ─── 執行動作 ────────────────────────────────────────────────────────────────

function floatsFrom(events: GameEvent[]): Float[] {
  const out: Float[] = [];
  for (const e of events) {
    if (e.type === 'damaged') out.push({ key: targetKey(e.target), text: `−${e.amount}`, tone: 'damage' });
    else if (e.type === 'hpLost') out.push({ key: targetKey(e.target), text: `−${e.amount}`, tone: 'loss' });
    else if (e.type === 'healed' && e.amount > 0) out.push({ key: targetKey(e.target), text: `+${e.amount}`, tone: 'heal' });
    else if (e.type === 'buffed') out.push({ key: `z${e.player}${e.zone}`, text: `+${e.attack}/+${e.hp}`, tone: 'buff' });
  }
  return out;
}

function step(before: GameState, after: GameState, events: GameEvent[]): void {
  app.state = after;
  app.log.push(...describeEvents(db, events, before, after, YOU));
  if (app.log.length > 300) app.log.splice(0, app.log.length - 300);
  app.selection = null;
  app.toast = null;
  floats = floatsFrom(events);
  render();
}

function perform(action: Action): void {
  const before = app.state;
  if (before === null) return;
  const result = engine.apply(before, action);
  if (!result.ok) {
    app.toast = result.error.message;
    render();
    return;
  }
  step(before, result.state, result.events);
  if (result.state.phase === 'main' && result.state.activePlayer === BOT) void botTurn();
}

/** 電腦的回合：一步一步慢慢播，看得清楚它做了什麼。 */
async function botTurn(): Promise<void> {
  if (app.busy) return;
  app.busy = true;
  render();
  while (app.state !== null && app.state.phase === 'main' && app.state.activePlayer === BOT) {
    await sleep(BOT_STEP_MS);
    const before = app.state;
    if (before === null || app.screen !== 'play') break;
    const pick = chooseAction(engine, before, BOT, STYLES.balanced);
    step(before, pick.state, pick.events);
  }
  app.busy = false;
  render();
}

function startGame(): void {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const rivals = SAMPLE_HEROES.filter((h) => h.id !== app.heroId);
  const rival = rivals[seed % rivals.length]!.id;
  const created = engine.createGame({
    seed,
    players: [
      { heroId: app.heroId, deck: randomDeck(seed ^ 0x9e3779b9) },
      { heroId: rival, deck: randomDeck(seed + 1) },
    ],
    skipDeckValidation: true,
  });
  if (!created.ok) {
    app.toast = created.error.message;
    render();
    return;
  }
  const kept = engine.apply(created.state, { type: 'mulligan', player: BOT, cards: [] });
  if (!kept.ok) return;
  Object.assign(app, { screen: 'play', state: kept.state, log: [], redraw: [], selection: null, toast: null });
  render();
}

// ─── 說明欄的文字 ────────────────────────────────────────────────────────────

function handReason(def: DeckCardDef, energy: number): string {
  if (def.cost > energy) return `能量不足：需要 ${def.cost}，目前 ${energy}`;
  switch (def.kind) {
    case 'creature':
      return def.stage === 0
        ? '生物區已滿'
        : `場上沒有可以進化的${nameOf(def.evolvesFrom!)}（召喚當回合不能進化，一回合只能進化一次）`;
    case 'spell':
      return '目前沒有可以指定的目標';
    case 'item':
      return '場上沒有可以裝備的生物（每隻限一張道具）';
    case 'field':
      return '場地卡每回合只能放一張';
  }
}

function skillReason(cv: CreatureView, cost: number, energy: number): string {
  const def = card(cv.cardId);
  const haste = def.kind === 'creature' && def.keywords?.includes('haste');
  if (cv.skillUsedThisTurn) return '這回合已經發動過技能';
  if (cv.summonedThisTurn && !haste) return '召喚當回合不能發動技能';
  if (cost > energy) return `能量不足：需要 ${cost}`;
  return '目前沒有可以指定的目標';
}

function lines(texts: string[]): string {
  const [head, ...body] = texts;
  return `<p class="d-head">${esc(head ?? '')}</p>${body.map((t) => `<p class="d-line">${esc(t)}</p>`).join('')}`;
}

function creatureStatus(cv: CreatureView): string {
  const tags: string[] = [`HP ${cv.hp} / ${cv.maxHp}`];
  if (cv.attackBonus) tags.push(`技能傷害 +${cv.attackBonus}`);
  if (cv.damageReduction) tags.push(`受到傷害 −${cv.damageReduction}`);
  if (cv.item) tags.push(`道具：${nameOf(cv.item)}`);
  if (cv.taunting) tags.push('挑釁中');
  if (cv.evolutionChain.length > 1) tags.push(`進化：${cv.evolutionChain.map(nameOf).join(' → ')}`);
  return `<ul class="tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function detail(view: PlayerView): string {
  const sel = app.selection;
  const toast = app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : '';
  const cancel = '<button class="ghost" data-do="cancel">取消</button>';
  const myTurn = view.phase === 'main' && view.activePlayer === YOU && !app.busy;

  if (sel === null) {
    if (view.phase === 'over') return toast + '<p class="d-head">對局結束</p>';
    if (!myTurn) return toast + '<p class="d-head">電腦的回合</p><p class="d-line">電腦正在行動，右邊的紀錄會一步一步列出它做了什麼。</p>';
    return (
      toast +
      `<p class="d-head">你的回合</p>
       <p class="d-line">點手牌出牌；點你的生物選技能發動；點任何卡可以看說明。</p>
       <p class="d-line">能量 ${view.you.energy} / ${view.you.maxEnergy}。沒花完的能量會留到對手的回合，你的回合開始時才重置。</p>`
    );
  }

  if (sel.kind === 'hand') {
    const held = view.you.hand.find((c) => c.uid === sel.uid);
    if (!held) return toast;
    const def = card(held.cardId);
    const acts = actsForCard(sel.uid);
    let hint = '';
    if (!myTurn) hint = '<p class="hint">輪到你的時候才能出牌。</p>';
    else if (acts.length === 0) hint = `<p class="hint blocked">${esc(handReason(def, view.you.energy))}</p>`;
    else if (acts.some((a) => a.type === 'summon')) hint = '<p class="hint">點一個空的生物格召喚。</p>';
    else if (acts.some((a) => a.type === 'evolve')) hint = '<p class="hint">點要進化的生物。</p>';
    else if (acts.some((a) => a.type === 'attachItem')) hint = '<p class="hint">點你要裝上道具的生物。</p>';
    else if (acts.some((a) => a.type === 'playField')) hint = '<button class="primary" data-do="direct">放到場地區</button>';
    else if (acts.some((a) => a.type === 'castSpell' && !a.target)) hint = '<button class="primary" data-do="direct">施放</button>';
    else hint = '<p class="hint">點選法術的目標。</p>';
    return toast + lines(describeCard(def, nameOf)) + hint + cancel;
  }

  if (sel.kind === 'creature') {
    const side = sel.player === YOU ? view.you : view.opponent;
    const cv = side.zones[sel.zone];
    if (!cv) return toast;
    const def = card(cv.cardId);
    let body = lines(describeCard(def, nameOf)) + creatureStatus(cv);
    if (sel.player === YOU && def.kind === 'creature') {
      body += '<div class="skills">';
      def.skills.forEach((skill, index) => {
        const acts = actsForSkill(sel.zone, index);
        const reason = myTurn && acts.length === 0 ? skillReason(cv, skill.cost, view.you.energy) : '';
        body += `<button class="skill" data-skill="${sel.zone}:${index}" ${acts.length === 0 ? 'disabled' : ''}>
          <span class="skill-cost">${skill.cost}</span><span class="skill-text">${esc(describeAbility(skill))}</span>
          ${reason ? `<span class="skill-why">${esc(reason)}</span>` : ''}</button>`;
      });
      body += '</div>';
    }
    return toast + body + cancel;
  }

  if (sel.kind === 'skill' || sel.kind === 'heroPower') {
    const ability =
      sel.kind === 'skill'
        ? (card(view.you.zones[sel.zone]!.cardId) as Extract<DeckCardDef, { kind: 'creature' }>).skills[sel.skill]!
        : hero(view.you.heroId).power!;
    return toast + `<p class="d-head">選擇目標</p><p class="d-line">${esc(describeAbility(ability))}</p><p class="hint">發光的就是可以選的目標。</p>` + cancel;
  }

  if (sel.kind === 'hero') {
    const side = sel.player === YOU ? view.you : view.opponent;
    return toast + lines(describeHero(hero(side.heroId))) + `<ul class="tags"><li>HP ${side.heroHp} / ${side.heroMaxHp}</li></ul>` + cancel;
  }

  const side = sel.player === YOU ? view.you : view.opponent;
  return toast + (side.field ? lines(describeCard(card(side.field), nameOf)) : '<p class="d-head">場地區是空的</p>') + cancel;
}

// ─── 牌桌 ────────────────────────────────────────────────────────────────────

function zone(cv: CreatureView | null, player: PlayerId, index: number, picks: Map<string, Action>, view: PlayerView): string {
  const key = `z${player}${index}`;
  const sel = app.selection;
  const selected = sel?.kind === 'creature' && sel.player === player && sel.zone === index;
  const classes = ['zone'];
  if (picks.has(key)) classes.push('pick');
  if (selected || (sel?.kind === 'skill' && player === YOU && sel.zone === index)) classes.push('selected');
  if (!cv) {
    return `<button class="${classes.join(' ')} empty" data-key="${key}" aria-label="${player === YOU ? '你' : '對手'}的 ${ZONE[index]} 空格"><span class="zone-num">${ZONE[index]}</span></button>`;
  }
  const def = card(cv.cardId);
  const myTurn = view.phase === 'main' && view.activePlayer === YOU && !app.busy;
  if (player === YOU && myTurn && def.kind === 'creature' && def.skills.some((_, i) => actsForSkill(index, i).length > 0)) classes.push('ready');
  if (player === YOU && (cv.skillUsedThisTurn || cv.summonedThisTurn) && view.activePlayer === YOU) classes.push('spent');
  if (cv.taunting) classes.push('taunt');
  const badges: string[] = [];
  if (cv.attackBonus) badges.push(`<i class="badge atk">攻+${cv.attackBonus}</i>`);
  if (cv.damageReduction) badges.push(`<i class="badge def">減${cv.damageReduction}</i>`);
  if (cv.item) badges.push(`<i class="badge item">${esc(nameOf(cv.item))}</i>`);
  if (cv.taunting) badges.push('<i class="badge taunt">挑釁</i>');
  const hurt = cv.hp < cv.maxHp ? ' hurt' : '';
  return `<button class="${classes.join(' ')} r-${def.rarity}" data-key="${key}" aria-label="${esc(def.name)}，HP ${cv.hp}">
    <span class="zone-num">${ZONE[index]}</span>
    <span class="z-top"><span class="rarity">${def.rarity}</span>${pips(def.colors)}</span>
    <span class="z-name">${esc(def.name)}</span>
    <span class="z-hp${hurt}"><b>${cv.hp}</b><small>/${cv.maxHp}</small></span>
    <span class="badges">${badges.join('')}</span>
  </button>`;
}

function energyRow(side: SideView): string {
  const slots = Array.from({ length: side.ceiling }, (_, i) =>
    `<i class="crystal ${i < side.energy ? 'on' : i < side.maxEnergy ? 'spent' : 'locked'}"></i>`,
  ).join('');
  return `<div class="energy" aria-label="能量 ${side.energy} / ${side.maxEnergy}">
    <span class="e-label">能量</span><span class="crystals">${slots}</span>
    <span class="e-count"><b>${side.energy}</b>/${side.maxEnergy}</span></div>`;
}

function heroPlate(side: SideView, player: PlayerId, picks: Map<string, Action>): string {
  const h = hero(side.heroId);
  const key = `h${player}`;
  const pct = Math.max(0, Math.round((side.heroHp / side.heroMaxHp) * 100));
  const classes = ['hero'];
  if (picks.has(key)) classes.push('pick');
  if (app.selection?.kind === 'hero' && app.selection.player === player) classes.push('selected');
  const extra = player === BOT ? `<span class="h-hand">手牌 ${side.handCount}</span>` : '';
  return `<button class="${classes.join(' ')}" data-key="${key}" aria-label="${esc(h.name)}，HP ${side.heroHp}">
    <span class="h-name">${esc(h.name)}</span>${pips(h.colors)}
    <span class="h-hp"><b>${side.heroHp}</b><small>/${side.heroMaxHp}</small></span>
    <span class="h-bar"><i style="width:${pct}%"></i></span>${extra}</button>`;
}

function sideRows(side: SideView, player: PlayerId, picks: Map<string, Action>, view: PlayerView): string {
  const fieldKey = `f${player}`;
  const fieldClasses = ['field'];
  if (picks.has(fieldKey)) fieldClasses.push('pick');
  const field = `<button class="${fieldClasses.join(' ')}${side.field ? ' filled' : ''}" data-key="${fieldKey}" aria-label="場地區">
    <span class="f-label">場地</span><span class="f-name">${side.field ? esc(nameOf(side.field)) : '—'}</span></button>`;
  // 場地區在擁有者的左邊、牌庫與棄牌在右邊；對手那側轉了 180°，左右相反，跟 docs/board.svg 一致。
  const zones = side.zones.map((cv, i) => zone(cv, player, i, picks, view)).join('');
  const discard = `<div class="pile"><span>棄牌</span><b>${side.discard.length}</b></div>`;
  const deck = `<div class="pile"><span>牌庫</span><b>${side.deckCount}</b></div>`;
  const mine = player === YOU;
  const creatures = `<div class="row creatures">${mine ? field + zones + discard : discard + zones + field}</div>`;
  const energy = `<div class="row energy-row">${mine ? `<span></span>${energyRow(side)}${deck}` : `${deck}${energyRow(side)}<span></span>`}</div>`;

  let heroRow = `<div class="row hero-row">${heroPlate(side, player, picks)}`;
  if (player === YOU) {
    const power = hero(side.heroId).power;
    if (power) {
      const usable = actsForPower().length > 0;
      heroRow += `<button class="power${app.selection?.kind === 'heroPower' ? ' selected' : ''}" data-do="power" ${usable ? '' : 'disabled'}>
        <span class="skill-cost">${power.cost}</span>天生技「${esc(power.name)}」</button>`;
    }
  }
  heroRow += '</div>';
  return player === YOU ? creatures + energy + heroRow : heroRow + energy + creatures;
}

function hand(view: PlayerView): string {
  const cards = view.you.hand
    .map((held) => {
      const def = card(held.cardId);
      const playable = actsForCard(held.uid).length > 0;
      const selected = app.selection?.kind === 'hand' && app.selection.uid === held.uid;
      const hp = def.kind === 'creature' ? `<span class="c-hp">HP ${def.hp}</span>` : '';
      return `<button class="card k-${def.kind} r-${def.rarity}${playable ? ' playable' : ''}${selected ? ' selected' : ''}" data-hand="${held.uid}">
        <span class="c-cost">${def.cost}</span>
        <span class="c-top"><span class="rarity">${def.rarity}</span>${pips(def.colors)}</span>
        <span class="c-name">${esc(def.name)}</span>
        <span class="c-kind">${kindLabel(def)}</span>${hp}</button>`;
    })
    .join('');
  return `<div class="hand" aria-label="你的手牌">${cards || '<p class="empty-hand">沒有手牌</p>'}</div>`;
}

function overlay(view: PlayerView): string {
  if (view.phase === 'mulligan' && !view.you.mulliganDone) {
    const first = view.firstPlayer === YOU;
    const cards = view.you.hand
      .map((held) => {
        const def = card(held.cardId);
        const marked = app.redraw.includes(held.uid);
        return `<button class="card k-${def.kind} r-${def.rarity}${marked ? ' marked' : ''}" data-mull="${held.uid}" aria-pressed="${marked}">
          <span class="c-cost">${def.cost}</span>
          <span class="c-top"><span class="rarity">${def.rarity}</span>${pips(def.colors)}</span>
          <span class="c-name">${esc(def.name)}</span><span class="c-kind">${kindLabel(def)}</span>
          ${marked ? '<span class="c-mark">重抽</span>' : ''}</button>`;
      })
      .join('');
    const plate = (id: string, label: string) =>
      `<div class="vs-hero"><span class="vs-label">${label}</span>${lines(describeHero(hero(id)))}</div>`;
    return `<div class="overlay"><div class="dialog" role="dialog" aria-label="起手">
      <h2>起手</h2>
      <p class="d-line">你是<b>${first ? '先攻' : '後攻'}</b>，${first ? '第一回合 1 點能量' : '第一回合 2 點能量'}。先看對手是誰，再決定要不要重抽。</p>
      <div class="versus">${plate(view.you.heroId, '你')}${plate(view.opponent.heroId, '對手')}</div>
      <p class="d-line">點選要洗回牌庫重抽的牌，可以選任意張，只能重抽一次。</p>
      <div class="mull-hand">${cards}</div>
      <button class="primary" data-do="mulligan">${app.redraw.length ? `重抽 ${app.redraw.length} 張` : '保留這手牌'}</button>
    </div></div>`;
  }
  if (view.phase === 'over' && view.result) {
    const { winner, reason } = view.result;
    const why = { heroDefeated: '英雄被打倒', deckOut: '牌庫抽完', concede: '投降' }[reason];
    const title = winner === 'draw' ? '平手' : winner === YOU ? '勝利' : '落敗';
    return `<div class="overlay"><div class="dialog end ${winner === YOU ? 'won' : 'lost'}" role="dialog" aria-label="${title}">
      <h2>${title}</h2><p class="d-line">${why}・共 ${view.turn} 回合</p>
      <div class="end-actions"><button class="primary" data-do="again">再來一局</button><button class="ghost" data-do="setup">換英雄</button></div>
    </div></div>`;
  }
  return '';
}

function playScreen(): string {
  const view = engine.viewFor(app.state!, YOU);
  const picks = choices();
  const myTurn = view.phase === 'main' && view.activePlayer === YOU && !app.busy;
  const banner =
    view.phase === 'mulligan' ? '起手' : view.phase === 'over' ? '對局結束' : `第 ${view.turn} 回合・${view.activePlayer === YOU ? '你的回合' : '電腦的回合'}`;
  const log = app.log.map((l) => `<li class="t-${l.tone}">${esc(l.text)}</li>`).join('');
  return `<div class="table">
    <section class="board${picks.size ? ' targeting' : ''}" aria-label="牌桌">
      ${sideRows(view.opponent, BOT, picks, view)}
      <div class="midline"><span class="turn">${banner}</span>
        <button class="end-turn" data-do="end" ${myTurn ? '' : 'disabled'}>結束回合</button></div>
      ${sideRows(view.you, YOU, picks, view)}
      ${hand(view)}
    </section>
    <aside class="panel">
      <div class="detail">${detail(view)}</div>
      <div class="log-wrap"><p class="log-title">對戰紀錄</p><ol class="log">${log}</ol></div>
      <button class="ghost small" data-do="concede" ${view.phase === 'main' ? '' : 'disabled'}>投降</button>
    </aside>
  </div>${overlay(view)}`;
}

function setupScreen(): string {
  const heroes = SAMPLE_HEROES.map((h) => {
    const [head, ...body] = describeHero(h);
    const chosen = h.id === app.heroId;
    return `<button class="hero-pick${chosen ? ' chosen' : ''}" data-hero="${h.id}" aria-pressed="${chosen}">
      <span class="hp-big">${h.hp}</span><span class="hp-unit">HP</span>
      <span class="hp-name">${esc(h.name)}</span>${pips(h.colors)}
      <span class="hp-text">${esc(body.join('　'))}</span><span class="sr">${esc(head ?? '')}</span></button>`;
  }).join('');
  return `<main class="setup">
    <header><h1>卡牌試玩桌</h1><p>選一名英雄，跟電腦打一局。對手的英雄隨機，開局時會先告訴你是誰。</p></header>
    <div class="heroes">${heroes}</div>
    <button class="primary big" data-do="start">開始對戰</button>
    ${app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : ''}
    <section class="howto">
      <h2>怎麼玩</h2>
      <ul>
        <li>能量：先攻第一回合 1 點、後攻 2 點，之後每回合上限 +2，最高 12。沒花完的留到對手回合，你的回合開始時重置。</li>
        <li>點手牌出牌。生物要選一個空格召喚；道具要選自己的生物；進化卡要點場上對應的生物。</li>
        <li>點你的生物，選一個技能發動。每隻生物每回合一個技能，召喚當回合不能發動（有【速攻】的例外）。發動技能不會結束回合，要按「結束回合」。</li>
        <li>正對面、斜對角的技能，目標格空著就會打到後面的英雄。</li>
        <li>對手的生物在挑釁時，選得到牠的技能都必須打牠；只打英雄的技能不受影響。</li>
        <li>手牌上限 10 張，滿手時抽到的牌直接進棄牌區。場地卡放在自己的場地區，只強化自己的生物。</li>
        <li>把對手英雄的 HP 打到 0 就贏了。</li>
      </ul>
      <p class="note">試玩說明：範例卡只有 ${SAMPLE_CARDS.length} 張，單色組不成 40 張，所以雙方的牌組都從全部範例卡隨機組成，不限顏色。電腦用的是模擬平衡時的均衡打法。</p>
    </section>
  </main>`;
}

// ─── 繪製與事件 ──────────────────────────────────────────────────────────────

function render(): void {
  const handScroll = root.querySelector('.hand')?.scrollLeft ?? 0;
  root.innerHTML = app.screen === 'setup' ? setupScreen() : playScreen();
  const handEl = root.querySelector('.hand');
  if (handEl) handEl.scrollLeft = handScroll;
  const log = root.querySelector('.log');
  if (log) log.scrollTop = log.scrollHeight;
  for (const f of floats) {
    const target = root.querySelector(`[data-key="${f.key}"]`);
    if (!target) continue;
    const span = document.createElement('span');
    span.className = `float ${f.tone}`;
    span.textContent = f.text;
    target.appendChild(span);
    span.addEventListener('animationend', () => span.remove());
  }
  floats = [];
}

function inspect(key: string): void {
  const player = Number(key[1]) as PlayerId;
  const view = engine.viewFor(app.state!, YOU);
  if (key[0] === 'z') {
    const index = Number(key[2]);
    const side = player === YOU ? view.you : view.opponent;
    app.selection = side.zones[index] ? { kind: 'creature', player, zone: index } : null;
  } else if (key[0] === 'h') {
    app.selection = { kind: 'hero', player };
  } else {
    app.selection = { kind: 'field', player };
  }
  render();
}

function chooseAbility(acts: Action[], selection: Selection): void {
  // 只有一個目標（或不用目標）就直接發動，紀錄會寫出打到哪裡；否則進入選目標。
  if (acts.length === 1) perform(acts[0]!);
  else if (acts.length > 1) {
    app.selection = selection;
    render();
  }
}

root.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-do],[data-key],[data-hand],[data-skill],[data-hero],[data-mull]');
  if (!el) {
    if (app.selection) {
      app.selection = null;
      render();
    }
    return;
  }
  const { do: command, key, hand: handUid, skill, hero: heroId, mull } = el.dataset;

  if (heroId) {
    app.heroId = heroId;
    render();
  } else if (mull) {
    const uid = Number(mull);
    app.redraw = app.redraw.includes(uid) ? app.redraw.filter((u) => u !== uid) : [...app.redraw, uid];
    render();
  } else if (handUid) {
    const uid = Number(handUid);
    app.selection = app.selection?.kind === 'hand' && app.selection.uid === uid ? null : { kind: 'hand', uid };
    render();
  } else if (skill) {
    const [z, s] = skill.split(':').map(Number) as [number, number];
    chooseAbility(actsForSkill(z, s), { kind: 'skill', zone: z, skill: s });
  } else if (key) {
    const act = choices().get(key);
    if (act) perform(act);
    else if (app.state) inspect(key);
  } else if (command === 'start' || command === 'again') {
    startGame();
  } else if (command === 'setup') {
    Object.assign(app, { screen: 'setup', state: null, selection: null, toast: null });
    render();
  } else if (command === 'mulligan') {
    const cards = app.redraw;
    app.redraw = [];
    perform({ type: 'mulligan', player: YOU, cards });
  } else if (command === 'end') {
    perform({ type: 'endTurn', player: YOU });
  } else if (command === 'concede') {
    perform({ type: 'concede', player: YOU });
  } else if (command === 'power') {
    chooseAbility(actsForPower(), { kind: 'heroPower' });
  } else if (command === 'direct' && app.selection?.kind === 'hand') {
    const act = actsForCard(app.selection.uid).find((a) => a.type === 'playField' || (a.type === 'castSpell' && !a.target));
    if (act) perform(act);
  } else if (command === 'cancel') {
    app.selection = null;
    render();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && app.selection) {
    app.selection = null;
    render();
  }
});

// ─── 啟動（重新發布時保留進行中的對局）──────────────────────────────────────

interface Hot {
  snapshot?: (fn: () => Saved) => void;
  ready?: (fn: (data: Partial<Saved>) => void) => void;
  data?: Partial<Saved>;
}
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => ({ screen: app.screen, heroId: app.heroId, state: app.state, log: app.log, redraw: app.redraw }));

function start(data: Partial<Saved>): void {
  Object.assign(app, data);
  render();
  if (app.state?.phase === 'main' && app.state.activePlayer === BOT) void botTurn();
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
