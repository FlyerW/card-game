import {
  createEngine,
  describeAbility,
  describeCard,
  describeColors,
  describeHero,
  heroPower,
  sampleDb,
  SAMPLE_CARDS,
  SAMPLE_HEROES,
  type Action,
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
import {
  addProblem,
  autoDeck,
  deckIssues,
  deckScreen,
  fillRandom,
  loadDecks,
  removeOne,
  saveDecks,
  type Builder,
  type KindFilter,
} from './deck-builder';
import { esc, kindLabel, pips } from './ui';
import './style.css';

const db = sampleDb();
const engine = createEngine(db);
const YOU: PlayerId = 0;
const BOT: PlayerId = 1;
const BOT_STEP_MS = 750;
/** 輪到你回應但沒有瞬發牌可用時，停一下再自動跳過，紀錄才看得清楚。 */
const AUTO_PASS_MS = 250;

// ─── 狀態 ────────────────────────────────────────────────────────────────────

type Selection =
  | { kind: 'hand'; uid: number }
  /** 已經選好召喚或進化的格子，正在選進場效果的目標。 */
  | { kind: 'entry'; uid: number; zone: number }
  | { kind: 'creature'; player: PlayerId; zone: number }
  | { kind: 'skill'; zone: number; skill: number }
  | { kind: 'heroPower' }
  | { kind: 'hero'; player: PlayerId }
  | { kind: 'field'; player: PlayerId };

interface Saved {
  screen: 'setup' | 'deck' | 'play';
  heroId: string;
  /** 每個英雄的自訂牌組；沒有就每局自動組。 */
  decks: Record<string, string[]>;
  state: GameState | null;
  log: LogLine[];
  redraw: number[];
}

interface App extends Saved {
  selection: Selection | null;
  busy: boolean;
  toast: string | null;
  /** 選了「這回合都不回應」的回合編號。 */
  skipResponsesTurn: number | null;
  builder: Builder;
  /** 卡牌大小：true 縮小、false 放大；null 表示照視窗高度自動決定。 */
  compactPref: boolean | null;
}

const app: App = {
  screen: 'setup',
  heroId: SAMPLE_HEROES[1]!.id,
  decks: loadDecks(db),
  builder: { heroId: SAMPLE_HEROES[1]!.id, filter: 'all', focus: null },
  state: null,
  log: [],
  redraw: [],
  selection: null,
  busy: false,
  toast: null,
  skipResponsesTurn: null,
  compactPref: loadDensity(),
};

// ─── 卡牌大小：整個牌桌要放得進一個畫面 ────────────────────────────────────────

const DENSITY_KEY = 'card-game.density';
/** 視窗比這個矮就自動用小卡牌。 */
const COMPACT_BELOW = 820;

function loadDensity(): boolean | null {
  try {
    const saved = localStorage.getItem('card-game.density');
    return saved === 'compact' ? true : saved === 'large' ? false : null;
  } catch {
    return null;
  }
}

const compact = () => app.compactPref ?? window.innerHeight < COMPACT_BELOW;
const applyDensity = () => document.documentElement.classList.toggle('compact', compact());
applyDensity();
window.addEventListener('resize', applyDensity);
document.addEventListener('fullscreenchange', () => {
  applyDensity();
  render();
});

interface Float {
  key: string;
  text: string;
  tone: 'damage' | 'loss' | 'heal' | 'buff';
}
let floats: Float[] = [];

const root = document.getElementById('app')!;

// ─── 小工具 ──────────────────────────────────────────────────────────────────

const card = (id: string) => db.cards.get(id)!;
const hero = (id: string) => db.heroes.get(id)!;
const nameOf = (id: string) => db.cards.get(id)?.name ?? db.heroes.get(id)?.name ?? id;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const targetKey = (t: Target) => (t.kind === 'hero' ? `h${t.player}` : t.kind === 'field' ? `f${t.player}` : `z${t.player}${t.zone}`);



// ─── 合法動作與可點的目標 ─────────────────────────────────────────────────────
//
// 畫面上能點的東西全部由引擎的合法動作推出來，網頁不自己判斷規則。

let legalCache: { state: GameState; actions: Action[] } | null = null;
function legal(): Action[] {
  const s = app.state;
  if (s === null || app.busy || s.phase !== 'main' || engine.actor(s) !== YOU) return [];
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
  if (sel.kind === 'entry') {
    for (const a of actsForCard(sel.uid)) {
      if ((a.type === 'summon' || a.type === 'evolve') && a.zone === sel.zone && a.target) map.set(targetKey(a.target), a);
    }
    return map;
  }
  const acts =
    sel.kind === 'hand' ? actsForCard(sel.uid) : sel.kind === 'skill' ? actsForSkill(sel.zone, sel.skill) : sel.kind === 'heroPower' ? actsForPower() : [];
  for (const a of acts) {
    // 同一格可能對應好幾個動作（進場效果的不同目標），先記第一個，點下去時再決定要不要進入選目標。
    if (a.type === 'summon' || a.type === 'evolve' || a.type === 'attachItem') {
      if (!map.has(`z${YOU}${a.zone}`)) map.set(`z${YOU}${a.zone}`, a);
    } else if ((a.type === 'castSpell' || a.type === 'useSkill' || a.type === 'heroPower' || a.type === 'evolveHero') && a.target) {
      map.set(targetKey(a.target), a);
    }
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
  void advance();
}

/** 輪到你回應，但手上沒有能用的瞬發牌，或你選了這回合都不回應，就自動跳過。 */
function shouldAutoPass(s: GameState): boolean {
  if (s.window !== YOU) return false;
  if (app.skipResponsesTurn === s.turn) return true;
  return engine.legalActions(s, YOU).every((a) => a.type === 'pass');
}

/**
 * 輪到電腦做決定（它的回合，或它要不要回應你）就讓它一步一步慢慢播，看得清楚它做了什麼；
 * 輪到你回應但沒得回應就自動跳過；輪到你真的要做決定時停下來。
 */
async function advance(): Promise<void> {
  if (app.busy) return;
  app.busy = true;
  render();
  while (app.state !== null && app.state.phase === 'main' && app.screen === 'play') {
    const before = app.state;
    if (engine.actor(before) === BOT) {
      await sleep(BOT_STEP_MS);
      if (app.state !== before) break;
      const pick = chooseAction(engine, before, BOT, STYLES.balanced);
      step(before, pick.state, pick.events);
    } else if (shouldAutoPass(before)) {
      await sleep(AUTO_PASS_MS);
      if (app.state !== before) break;
      const passed = engine.apply(before, { type: 'pass', player: YOU });
      if (!passed.ok) break;
      step(before, passed.state, passed.events);
    } else {
      break;
    }
  }
  app.busy = false;
  render();
}

function startGame(): void {
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const rivals = SAMPLE_HEROES.filter((h) => h.id !== app.heroId);
  const rival = rivals[seed % rivals.length]!.id;
  // 雙方都照正式規則組牌；你有自訂牌組就用你的，電腦每局自動組一副。
  const created = engine.createGame({
    seed,
    players: [
      { heroId: app.heroId, deck: app.decks[app.heroId] ?? autoDeck(db, app.heroId, seed ^ 0x9e3779b9) },
      { heroId: rival, deck: autoDeck(db, rival, seed + 1) },
    ],
  });
  if (!created.ok) {
    app.toast = created.error.message;
    render();
    return;
  }
  const kept = engine.apply(created.state, { type: 'mulligan', player: BOT, cards: [] });
  if (!kept.ok) return;
  Object.assign(app, { screen: 'play', state: kept.state, log: [], redraw: [], selection: null, toast: null, skipResponsesTurn: null });
  render();
}

// ─── 說明欄的文字 ────────────────────────────────────────────────────────────

function handReason(def: DeckCardDef, you: SideView): string {
  if (def.kind === 'heroEvolution' && def.evolvesFrom !== you.heroId) return '這不是你英雄的進化卡';
  if (def.cost > you.energy) return `能量不足：需要 ${def.cost}，目前 ${you.energy}`;
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
    case 'heroEvolution':
      return '英雄已經進化過（每局限一次）';
  }
}

function skillReason(cv: CreatureView, cost: number, energy: number): string {
  const def = card(cv.cardId);
  const haste = def.kind === 'creature' && def.keywords?.includes('haste');
  if (cv.paralyzed) return '麻痺中，不能發動技能';
  if (cv.asleep) return '沉睡中，不能發動技能';
  if (cv.skillUsedThisTurn) return '這回合已經發動過技能';
  if (cv.summonedThisTurn && !haste) return '召喚當回合不能發動技能';
  if (cost > energy) return `能量不足：需要 ${cost}`;
  return '目前沒有可以指定的目標';
}

function lines(texts: string[]): string {
  const [head, ...body] = texts;
  return `<p class="d-head">${esc(head ?? '')}</p>${body.map((t) => `<p class="d-line">${esc(t)}</p>`).join('')}`;
}

/** 現在輪到你做決定：你的回合，或輪到你決定要不要回應。 */
const myMove = (view: PlayerView) => view.phase === 'main' && (view.window ?? view.activePlayer) === YOU && !app.busy;

function targetLabel(view: PlayerView, target: Target): string {
  const side = target.player === YOU ? view.you : view.opponent;
  const owner = target.player === YOU ? '你的' : '電腦的';
  if (target.kind === 'hero') return `${owner}英雄`;
  if (target.kind === 'field') return `${owner}場地卡`;
  const cv = side.zones[target.zone];
  return `${owner} ${ZONE[target.zone]} ${cv ? nameOf(cv.cardId) : ''}`.trim();
}

/** 等待結算的連鎖，最上面的先結算。 */
function chainBox(view: PlayerView): string {
  if (view.chain.length === 0) return '';
  const items = [...view.chain]
    .reverse()
    .map((l) => {
      const who = l.player === YOU ? '你' : '電腦';
      const target = l.target ? ` → ${targetLabel(view, l.target)}` : '';
      const what = l.source === 'spell' ? nameOf(l.cardId) : `${nameOf(l.cardId)}「${l.ability}」`;
      return `<li class="${l.player === YOU ? 't-you' : 't-bot'}">${who}：${esc(what)}${esc(target)}</li>`;
    })
    .join('');
  return `<div class="chain"><p class="chain-title">連鎖・上面的先結算</p><ol>${items}</ol></div>`;
}

/** 輪到你回應時的說明與按鈕。 */
function responsePrompt(view: PlayerView): string {
  const top = view.chain.at(-1);
  const what = top
    ? `電腦${top.source === 'spell' ? '施放' : '發動'}「${top.ability}」${top.target ? `，目標是${targetLabel(view, top.target)}` : ''}`
    : view.endingTurn
      ? '電腦宣告回合結束'
      : '電腦剛做了一個動作';
  return `<p class="d-head">要回應嗎？</p>
    <p class="d-line">${esc(what)}。你有 ${view.you.energy} 點能量，可以用瞬發法術或【瞬發】技能回應；發光的就是能用的。</p>
    ${view.endingTurn ? '<p class="d-line">這是這回合最後的機會，你的回合開始時能量會重置。</p>' : ''}
    <div class="respond"><button class="primary" data-do="pass">不回應</button><button class="ghost" data-do="skip-turn">這回合都不回應</button></div>`;
}

function creatureStatus(cv: CreatureView): string {
  const tags: string[] = [`HP ${cv.hp} / ${cv.maxHp}`];
  if (cv.attackBonus) tags.push(`技能傷害 +${cv.attackBonus}`);
  if (cv.damageReduction) tags.push(`受到傷害 −${cv.damageReduction}`);
  if (cv.item) tags.push(`道具：${nameOf(cv.item)}`);
  if (cv.taunting) tags.push('挑釁中');
  if (cv.poison) tags.push(`中毒 ${cv.poison}：牠的回合開始時失去 ${cv.poison} HP`);
  if (cv.burn) tags.push(`灼燒 ${cv.burn}：牠的回合結束時受到 ${cv.burn} 傷害`);
  if (cv.paralyzed) tags.push('麻痺：不能發動技能');
  if (cv.asleep) tags.push('沉睡：不能發動技能，受到傷害就醒');
  if (cv.evolutionChain.length > 1) tags.push(`進化：${cv.evolutionChain.map(nameOf).join(' → ')}`);
  return `<ul class="tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function detail(view: PlayerView): string {
  const sel = app.selection;
  const toast = app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : '';
  const cancel = '<button class="ghost" data-do="cancel">取消</button>';
  const myTurn = myMove(view);

  if (sel === null) {
    if (view.phase === 'over') return toast + '<p class="d-head">對局結束</p>';
    if (view.window === YOU && myTurn) return toast + responsePrompt(view);
    if (view.window === BOT) return toast + '<p class="d-head">等電腦決定要不要回應</p><p class="d-line">電腦還有存下來的能量，可以用瞬發牌回應你。</p>';
    if (!myTurn) return toast + '<p class="d-head">電腦的回合</p><p class="d-line">電腦正在行動，右邊的紀錄會一步一步列出它做了什麼。</p>';
    return (
      toast +
      `<p class="d-head">你的回合</p>
       <p class="d-line">點手牌出牌；點你的生物選技能發動；點任何卡可以看說明。</p>
       <p class="d-line">能量 ${view.you.energy} / ${view.you.maxEnergy}。沒花完的能量會留到對手的回合，可以拿來用瞬發牌回應；你的回合開始時才重置。</p>`
    );
  }

  if (sel.kind === 'hand') {
    const held = view.you.hand.find((c) => c.uid === sel.uid);
    if (!held) return toast;
    const def = card(held.cardId);
    const acts = actsForCard(sel.uid);
    let hint = '';
    if (!myTurn) hint = '<p class="hint">輪到你的時候才能出牌。</p>';
    else if (acts.length === 0 && view.window === YOU && !(def.kind === 'spell' && def.instant)) hint = '<p class="hint blocked">回應只能用瞬發法術</p>';
    else if (acts.length === 0) hint = `<p class="hint blocked">${esc(handReason(def, view.you))}</p>`;
    else if (acts.some((a) => a.type === 'summon')) hint = '<p class="hint">點一個空的生物格召喚。</p>';
    else if (acts.some((a) => a.type === 'evolve')) hint = '<p class="hint">點要進化的生物。</p>';
    else if (acts.some((a) => a.type === 'attachItem')) hint = '<p class="hint">點你要裝上道具的生物。</p>';
    else if (acts.some((a) => a.type === 'playField')) hint = '<button class="primary" data-do="direct">放到場地區</button>';
    else if (acts.some((a) => a.type === 'evolveHero' && a.target)) hint = '<p class="hint">點選進場效果的目標，英雄就會進化。</p>';
    else if (acts.some((a) => a.type === 'evolveHero')) hint = '<button class="primary" data-do="direct">進化英雄</button>';
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
        const reason =
          myTurn && acts.length === 0
            ? view.window === YOU && !skill.instant
              ? '回應只能用【瞬發】技能'
              : skillReason(cv, skill.cost, view.you.energy)
            : '';
        body += `<button class="skill" data-skill="${sel.zone}:${index}" ${acts.length === 0 ? 'disabled' : ''}>
          <span class="skill-cost">${skill.cost}</span><span class="skill-text">${esc(describeAbility(skill))}</span>
          ${reason ? `<span class="skill-why">${esc(reason)}</span>` : ''}</button>`;
      });
      body += '</div>';
    }
    return toast + body + cancel;
  }

  if (sel.kind === 'entry') {
    const held = view.you.hand.find((c) => c.uid === sel.uid);
    const def = held ? card(held.cardId) : null;
    const entry = def?.kind === 'creature' ? def.entry : undefined;
    if (!entry) return toast;
    return (
      toast +
      `<p class="d-head">選擇進場效果的目標</p><p class="d-line">${esc(def!.name)} 放在 ${ZONE[sel.zone]}</p>
       <p class="d-line">${esc(describeAbility({ ...entry, cost: 0 }).replace('（0）', ''))}</p><p class="hint">發光的就是可以選的目標。</p>` +
      cancel
    );
  }

  if (sel.kind === 'skill' || sel.kind === 'heroPower') {
    const ability =
      sel.kind === 'skill'
        ? (card(view.you.zones[sel.zone]!.cardId) as Extract<DeckCardDef, { kind: 'creature' }>).skills[sel.skill]!
        : heroPower(db, app.state!, YOU)!;
    return toast + `<p class="d-head">選擇目標</p><p class="d-line">${esc(describeAbility(ability))}</p><p class="hint">發光的就是可以選的目標。</p>` + cancel;
  }

  if (sel.kind === 'hero') {
    const side = sel.player === YOU ? view.you : view.opponent;
    const evolved = side.heroEvolution ? lines(describeCard(card(side.heroEvolution), nameOf)) : '';
    return toast + lines(describeHero(hero(side.heroId))) + evolved + `<ul class="tags"><li>HP ${side.heroHp} / ${side.heroMaxHp}</li></ul>` + cancel;
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
  if (selected || ((sel?.kind === 'skill' || sel?.kind === 'entry') && player === YOU && sel.zone === index)) classes.push('selected');
  if (!cv) {
    return `<button class="${classes.join(' ')} empty" data-key="${key}" aria-label="${player === YOU ? '你' : '對手'}的 ${ZONE[index]} 空格"><span class="zone-num">${ZONE[index]}</span></button>`;
  }
  const def = card(cv.cardId);
  const myTurn = myMove(view);
  if (player === YOU && myTurn && def.kind === 'creature' && def.skills.some((_, i) => actsForSkill(index, i).length > 0)) classes.push('ready');
  if (player === YOU && (cv.skillUsedThisTurn || cv.summonedThisTurn) && view.activePlayer === YOU) classes.push('spent');
  if (cv.taunting) classes.push('taunt');
  const badges: string[] = [];
  if (cv.attackBonus) badges.push(`<i class="badge atk">攻+${cv.attackBonus}</i>`);
  if (cv.damageReduction) badges.push(`<i class="badge def">減${cv.damageReduction}</i>`);
  if (cv.item) badges.push(`<i class="badge item">${esc(nameOf(cv.item))}</i>`);
  if (cv.taunting) badges.push('<i class="badge taunt">挑釁</i>');
  if (cv.poison) badges.push(`<i class="badge poison">毒${cv.poison}</i>`);
  if (cv.burn) badges.push(`<i class="badge burn">燒${cv.burn}</i>`);
  if (cv.paralyzed) badges.push('<i class="badge para">麻痺</i>');
  if (cv.asleep) badges.push('<i class="badge sleep">沉睡</i>');
  const hurt = cv.hp < cv.maxHp ? ' hurt' : '';
  // 左上角顯示這隻生物總共花了多少費用，進化過的顯示成 4+3，一眼看出對手在牠身上投資了多少。
  const invested = cv.evolutionChain.map((id) => card(id).cost).join('+');
  return `<button class="${classes.join(' ')} r-${def.rarity}" data-key="${key}" aria-label="${esc(def.name)}，費用 ${invested}，HP ${cv.hp}">
    <span class="zone-num">${ZONE[index]}</span>
    <span class="z-top"><span class="z-cost">${invested}</span><span class="rarity">${def.rarity}</span>${pips(def.colors)}</span>
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
  const name = side.heroEvolution ? nameOf(side.heroEvolution) : h.name;
  if (side.heroEvolution) classes.push('evolved');
  return `<button class="${classes.join(' ')}" data-key="${key}" aria-label="${esc(name)}，HP ${side.heroHp}">
    <span class="h-name">${esc(name)}</span>${pips(h.colors)}
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
    const power = heroPower(db, app.state!, YOU);
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
      const isEvolution = def.kind === 'creature' && def.stage > 0;
      return `<button class="card k-${def.kind} r-${def.rarity}${playable ? ' playable' : ''}${selected ? ' selected' : ''}" data-hand="${held.uid}">
        <span class="c-cost${isEvolution ? ' evo' : ''}">${isEvolution ? '+' : ''}${def.cost}</span>
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
  const myTurn = myMove(view);
  const waiting = view.window === YOU ? '・等你回應' : view.window === BOT ? '・電腦考慮回應' : '';
  const banner =
    view.phase === 'mulligan'
      ? '起手'
      : view.phase === 'over'
        ? '對局結束'
        : `第 ${view.turn} 回合・${view.activePlayer === YOU ? '你的回合' : '電腦的回合'}${waiting}`;
  const turnButton =
    view.window === YOU
      ? `<button class="end-turn respond-btn" data-do="pass" ${myTurn ? '' : 'disabled'}>不回應</button>`
      : `<button class="end-turn" data-do="end" ${myTurn && view.window === null ? '' : 'disabled'}>結束回合</button>`;
  const log = app.log.map((l) => `<li class="t-${l.tone}">${esc(l.text)}</li>`).join('');
  return `<div class="table">
    <section class="board${picks.size ? ' targeting' : ''}" aria-label="牌桌">
      ${sideRows(view.opponent, BOT, picks, view)}
      <div class="midline"><span class="turn">${banner}</span>
        ${turnButton}</div>
      ${sideRows(view.you, YOU, picks, view)}
      ${hand(view)}
    </section>
    <aside class="panel">
      <div class="detail">${chainBox(view)}${detail(view)}</div>
      <div class="log-wrap"><p class="log-title">對戰紀錄</p><ol class="log">${log}</ol></div>
      <div class="panel-tools">
        <button class="ghost small" data-do="concede" ${view.phase === 'main' ? '' : 'disabled'}>投降</button>
        <button class="ghost small" data-do="density" aria-pressed="${compact()}">${compact() ? '放大卡牌' : '縮小卡牌'}</button>
        ${document.fullscreenEnabled ? `<button class="ghost small" data-do="fullscreen">${document.fullscreenElement ? '離開全螢幕' : '全螢幕'}</button>` : ''}
      </div>
    </aside>
  </div>${overlay(view)}`;
}

function setupScreen(): string {
  const heroes = SAMPLE_HEROES.map((h) => {
    const [head, ...body] = describeHero(h);
    const evolution = SAMPLE_CARDS.find((c) => c.kind === 'heroEvolution' && c.evolvesFrom === h.id);
    if (evolution) body.push(`可進化為 ${evolution.name}（${evolution.cost}）`);
    const chosen = h.id === app.heroId;
    return `<button class="hero-pick${chosen ? ' chosen' : ''}" data-hero="${h.id}" aria-pressed="${chosen}">
      <span class="hp-big">${h.hp}</span><span class="hp-unit">HP</span>
      <span class="hp-name">${esc(h.name)}</span>${pips(h.colors)}
      <span class="hp-text">${esc(body.join('　'))}</span><span class="sr">${esc(head ?? '')}</span></button>`;
  }).join('');
  const custom = app.decks[app.heroId];
  const problems = custom ? deckIssues(db, app.heroId, custom).problems : [];
  const colors = describeColors(hero(app.heroId).colors);
  const deckText = !custom
    ? `還沒有自訂牌組：每局從${colors}與無色的卡自動組一副（進化線照 3/2/1 帶）。`
    : problems.length
      ? `自訂牌組還不能用：${problems[0]}`
      : `用你的自訂牌組（${custom.length} 張）。`;
  return `<main class="setup">
    <header><h1>卡牌試玩桌</h1><p>選一名英雄，跟電腦打一局。對手的英雄隨機，開局時會先告訴你是誰。</p></header>
    <div class="heroes">${heroes}</div>
    <section class="deck-bar">
      <div><p class="d-head">牌組</p><p class="d-line${problems.length ? ' warn' : ''}">${esc(deckText)}</p></div>
      <button class="ghost" data-do="builder">${custom ? '編輯牌組' : '自己組牌'}</button>
    </section>
    <button class="primary big" data-do="start" ${problems.length ? 'disabled' : ''}>開始對戰</button>
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
        <li>有些英雄有英雄進化卡：HP 上限增加、天生技變強，每局只能進化一次。</li>
        <li>異常狀態只會中在生物身上：中毒（回合開始時失去 HP）、灼燒（回合結束時受到傷害）、麻痺、沉睡（都不能發動技能，沉睡被打就醒）。進化會解除全部。</li>
        <li>即時回應：對手宣告動作之後、結算之前，你可以用存下來的能量打出瞬發法術，或發動生物的【瞬發】技能。回應也能再被回應，後打出的先結算。發動的生物在結算前被打倒，牠的技能就不會打出來。</li>
        <li>把對手英雄的 HP 打到 0 就贏了。</li>
      </ul>
      <p class="note">試玩說明：範例卡有 ${SAMPLE_CARDS.length} 張，牌組照正式規則：40 張、同名最多 3 張、只能放英雄顏色內的卡與無色卡。
        你可以自己組牌；電腦每局自動組一副。電腦用的是模擬平衡時的均衡打法。</p>
    </section>
  </main>`;
}

// ─── 繪製與事件 ──────────────────────────────────────────────────────────────

function render(): void {
  const handScroll = root.querySelector('.hand')?.scrollLeft ?? 0;
  const custom = app.decks[app.builder.heroId];
  root.innerHTML =
    app.screen === 'setup'
      ? setupScreen()
      : app.screen === 'deck'
        ? deckScreen(db, app.builder, custom ?? [], custom !== undefined)
        : playScreen();
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

/** 組牌畫面的點擊。處理了就回傳 true。 */
function builderClick(el: HTMLElement, command: string | undefined): boolean {
  const { add, remove, focus, filter } = el.dataset;
  const heroId = app.builder.heroId;
  const deck = app.decks[heroId] ?? [];
  const edit = (next: string[]) => {
    app.decks = { ...app.decks, [heroId]: next };
    saveDecks(app.decks);
  };
  if (add) {
    if (addProblem(deck, add) === null) edit([...deck, add]);
    app.builder.focus = add;
  } else if (remove) {
    edit(removeOne(deck, remove));
    app.builder.focus = remove;
  } else if (focus) {
    app.builder.focus = app.builder.focus === focus ? null : focus;
  } else if (filter) {
    app.builder.filter = filter as KindFilter;
  } else if (command === 'deck-fill') {
    edit(fillRandom(db, heroId, deck));
  } else if (command === 'deck-auto') {
    edit(autoDeck(db, heroId, (Math.random() * 2 ** 32) >>> 0));
  } else if (command === 'deck-clear') {
    edit([]);
  } else if (command === 'deck-forget') {
    const { [heroId]: _, ...rest } = app.decks;
    app.decks = rest;
    saveDecks(app.decks);
  } else if (command === 'deck-done') {
    app.screen = 'setup';
    window.scrollTo(0, 0);
  } else {
    return false;
  }
  render();
  return true;
}

root.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-do],[data-key],[data-hand],[data-skill],[data-hero],[data-mull],[data-add],[data-remove],[data-focus],[data-filter]',
  );
  if (!el) {
    if (app.selection) {
      app.selection = null;
      render();
    }
    return;
  }
  const { do: command, key, hand: handUid, skill, hero: heroId, mull } = el.dataset;
  if (app.screen === 'deck' && builderClick(el, command)) return;

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
    const sel = app.selection;
    if (act && (act.type === 'summon' || act.type === 'evolve') && sel?.kind === 'hand') {
      const options = actsForCard(sel.uid).filter((a) => (a.type === 'summon' || a.type === 'evolve') && a.zone === act.zone);
      if (options.length > 1) {
        app.selection = { kind: 'entry', uid: sel.uid, zone: act.zone };
        render();
      } else perform(act);
    } else if (act) perform(act);
    else if (app.state) inspect(key);
  } else if (command === 'builder') {
    app.builder = { heroId: app.heroId, filter: app.builder.filter, focus: null };
    app.screen = 'deck';
    app.toast = null;
    render();
    window.scrollTo(0, 0);
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
  } else if (command === 'pass') {
    perform({ type: 'pass', player: YOU });
  } else if (command === 'skip-turn' && app.state) {
    app.skipResponsesTurn = app.state.turn;
    perform({ type: 'pass', player: YOU });
  } else if (command === 'density') {
    app.compactPref = !compact();
    try {
      localStorage.setItem(DENSITY_KEY, app.compactPref ? 'compact' : 'large');
    } catch {
      // 存不了就只在這次開著的頁面有效。
    }
    applyDensity();
    render();
  } else if (command === 'fullscreen') {
    const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    request.catch(() => {
      app.toast = '這個畫面不能切換全螢幕，可以改用瀏覽器的全螢幕（F11）。';
      render();
    });
  } else if (command === 'concede') {
    perform({ type: 'concede', player: YOU });
  } else if (command === 'power') {
    chooseAbility(actsForPower(), { kind: 'heroPower' });
  } else if (command === 'direct' && app.selection?.kind === 'hand') {
    const act = actsForCard(app.selection.uid).find(
      (a) => a.type === 'playField' || a.type === 'evolveHero' || (a.type === 'castSpell' && !a.target),
    );
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
hot?.snapshot?.(() => ({ screen: app.screen, heroId: app.heroId, decks: app.decks, state: app.state, log: app.log, redraw: app.redraw }));

function start(data: Partial<Saved>): void {
  // 舊版存下來的對局沒有連鎖、回應這些欄位，新版的引擎接不下去，回到開局畫面重來。
  if (data.state && !Array.isArray((data.state as Partial<GameState>).chain)) {
    data = { ...data, screen: 'setup', state: null, log: [], redraw: [] };
  }
  Object.assign(app, data);
  if (!db.heroes.has(app.heroId)) app.heroId = SAMPLE_HEROES[1]!.id;
  render();
  void advance();
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
