import {
  createEngine,
  DEFAULT_RULES,
  describeAbility,
  describeCard,
  describeColors,
  describeEffects,
  describeEntry,
  describeHero,
  other,
  sampleDb,
  SAMPLE_CARDS,
  SAMPLE_HEROES,
  type Action,
  type CreatureView,
  type DeckCardDef,
  type GameEvent,
  type GameState,
  type HeroDef,
  type PlayerId,
  type PlayerView,
  type SideView,
  type Target,
} from '@card-game/engine';
import { ECONOMY, emptyTally, gameSummary, questDef, recordGame, refreshDay, tallyEvents, type GameTally, type Profile } from '@card-game/economy';
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
import { ONLINE_AVAILABLE, OnlineClient } from './online';
import { loadProfile, newShop, ownedOf, saveProfile, shopClick, shopScreen, today, walletBar, type Shop } from './shop';
import { esc, kindLabel, pips } from './ui';
import './style.css';

const db = sampleDb();
const engine = createEngine(db);
/** 你的座位。跟電腦打時是 0；連線對戰時由伺服器決定。 */
let YOU: PlayerId = 0;
/** 對手的座位。 */
const THEM = (): PlayerId => other(YOU);
/** 跟電腦打時電腦的座位。 */
const BOT: PlayerId = 1;
const BOT_STEP_MS = 750;
/** 存檔格式。引擎的狀態改了就加一，舊版存下來的對局就不接著打。 */
const SAVE_FORMAT = 6;

// ─── 狀態 ────────────────────────────────────────────────────────────────────

type Selection =
  | { kind: 'hand'; uid: number }
  /** 已經選好召喚或進化的格子，正在選進場效果的目標。 */
  | { kind: 'entry'; uid: number; zone: number }
  /** confirmDismiss：按了「退場」，等再按一次確認。 */
  | { kind: 'creature'; player: PlayerId; zone: number; confirmDismiss?: boolean }
  | { kind: 'skill'; zone: number; skill: number }
  | { kind: 'heroPower' }
  | { kind: 'hero'; player: PlayerId }
  | { kind: 'field'; player: PlayerId };

/** 這局結束時拿到的獎勵，顯示在結算畫面上。 */
interface Reward {
  winGold: number;
  questGold: number;
  /** 結算後的任務進度，例如「召喚 10 隻生物 6/10」。 */
  quest: string;
  /** 自己投降的對局不算。 */
  conceded: boolean;
}

interface Saved {
  format: number;
  screen: 'setup' | 'deck' | 'lobby' | 'play' | 'shop';
  heroId: string;
  /** 每個英雄的自訂牌組；沒有就每局自動組。 */
  decks: Record<string, string[]>;
  state: GameState | null;
  log: LogLine[];
  redraw: number[];
  /** 這局你用的牌組，結算任務（例如用有綠色卡的牌組贏）時看顏色。 */
  gameDeck: string[];
  /** 這局邊打邊累計的召喚、抽牌、法術。 */
  tally: GameTally;
  /** 這局的獎勵；null 表示還沒結算。 */
  reward: Reward | null;
}

interface App extends Saved {
  /** 跟電腦打，或連線對戰。 */
  mode: 'bot' | 'online';
  /** 畫面上的局面：你的視角。跟電腦打時由 state 算出來，連線時由伺服器送來。 */
  view: PlayerView | null;
  /** 你現在能做的動作。 */
  legalActions: Action[];
  /** 連線對戰：送出動作後、等伺服器回覆前，先不能再點。 */
  pending: boolean;
  selection: Selection | null;
  busy: boolean;
  toast: string | null;
  builder: Builder;
  /** 卡牌大小：true 縮小、false 放大；null 表示照視窗高度自動決定。 */
  compactPref: boolean | null;
  /** 連線對戰時顯示給對手看的名字。 */
  playerName: string;
  /** 開局畫面上輸入的房號；網址帶 ?room= 時預先填好。 */
  roomCode: string;
  /** 看牌庫頂選牌時，已經點選的牌。 */
  picks: number[];
  /** 金幣、收藏、每日任務，存在這個瀏覽器裡。 */
  profile: Profile;
  shop: Shop;
}

const app: App = {
  format: SAVE_FORMAT,
  screen: 'setup',
  heroId: SAMPLE_HEROES[1]!.id,
  decks: loadDecks(db),
  builder: { heroId: SAMPLE_HEROES[1]!.id, filter: 'all', focus: null },
  state: null,
  mode: 'bot',
  view: null,
  legalActions: [],
  pending: false,
  log: [],
  redraw: [],
  selection: null,
  busy: false,
  toast: null,
  compactPref: loadDensity(),
  playerName: loadName(),
  roomCode: new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '',
  picks: [],
  gameDeck: [],
  tally: emptyTally(),
  reward: null,
  profile: loadProfile(db),
  shop: newShop(),
};

/** 開始新的一局：清掉上一局的累計與獎勵。 */
function resetGameRecord(deck: string[]): void {
  Object.assign(app, { gameDeck: deck, tally: emptyTally(), reward: null });
}

/** 對局結束：照勝負、這局的累計與牌組發金幣、推進每日任務。每局只結算一次。 */
function settle(view: PlayerView): void {
  if (app.reward || !view.result) return;
  const { winner, reason } = view.result;
  const conceded = reason === 'concede' && winner !== YOU;
  const summary = gameSummary(db, app.tally, app.gameDeck, winner === YOU, conceded);
  const result = recordGame(app.profile, summary, today());
  app.profile = result.profile;
  saveProfile(app.profile);
  const quest = questDef(app.profile.quest.id);
  app.reward = {
    winGold: result.winGold,
    questGold: result.questGold,
    quest: quest ? `${quest.text} ${app.profile.quest.progress}/${quest.goal}` : '',
    conceded,
  };
}

function loadName(): string {
  try {
    return localStorage.getItem('card-game.name') ?? '';
  } catch {
    return '';
  }
}

// ─── 連線對戰 ────────────────────────────────────────────────────────────────

const online = new OnlineClient();
online.onStatus = () => render();
online.onMessage = (message) => {
  if (message.t === 'room') {
    app.mode = 'online';
    YOU = message.seat;
    // 還沒開局（等朋友加入）就留在等候畫面；已經在打就只是更新對手的連線狀態。
    if (app.screen !== 'play') app.screen = 'lobby';
    render();
  } else if (message.t === 'state') {
    app.mode = 'online';
    app.pending = false;
    const fresh = message.view.phase === 'mulligan' && app.view?.phase !== 'mulligan';
    if (fresh) {
      Object.assign(app, { log: [], redraw: [], selection: null, view: null });
      resetGameRecord(app.gameDeck);
    }
    app.screen = 'play';
    step(app.view ?? message.view, message.view, message.legal, message.events);
  } else {
    app.pending = false;
    app.toast = message.message;
    if (message.fatal) {
      app.mode = 'bot';
      app.screen = 'setup';
      app.view = null;
    }
    render();
  }
};

function createRoom(): void {
  const deck = myDeck();
  resetGameRecord(deck);
  online.send({ t: 'create', name: app.playerName, heroId: app.heroId, deck });
}

function joinRoom(): void {
  const code = app.roomCode.trim().toUpperCase();
  if (!code) {
    app.toast = '先輸入朋友給你的房號';
    render();
    return;
  }
  const deck = myDeck();
  resetGameRecord(deck);
  online.send({ t: 'join', code, name: app.playerName, heroId: app.heroId, deck });
}

function leaveRoom(): void {
  online.leave();
  Object.assign(app, { mode: 'bot', screen: 'setup', view: null, state: null, selection: null, toast: null, pending: false });
  history.replaceState(null, '', location.pathname);
  render();
}

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

function legal(): Action[] {
  const view = app.view;
  if (view === null || app.busy || app.pending || view.phase !== 'main') return [];
  return app.legalActions;
}

const actsForCard = (uid: number) => legal().filter((a) => 'card' in a && a.card === uid);
const actsForSkill = (zone: number, skill: number) =>
  legal().filter((a) => a.type === 'useSkill' && a.zone === zone && a.skill === skill);
const actsForPower = () => legal().filter((a) => a.type === 'heroPower');
const actsForAttack = (zone: number) => legal().filter((a) => a.type === 'attack' && a.zone === zone);

/** 這隻生物能發動的技能：自己的，加上道具給的。 */
function skillsOf(cv: CreatureView) {
  const def = card(cv.cardId);
  const item = cv.item ? card(cv.item) : null;
  return [...(def.kind === 'creature' ? def.skills : []), ...(item?.kind === 'item' ? (item.skills ?? []) : [])];
}

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
  if (sel.kind === 'creature' && sel.player === YOU) {
    // 選了自己的生物：發光的對手生物與英雄就是能攻擊的目標。
    for (const a of actsForAttack(sel.zone)) if (a.type === 'attack') map.set(targetKey(a.target), a);
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

/** 局面變了：更新畫面、寫紀錄、播飄字。兩種模式共用。 */
function step(before: PlayerView, after: PlayerView, legalActions: Action[], events: GameEvent[]): void {
  app.view = after;
  app.legalActions = legalActions;
  app.tally = tallyEvents(app.tally, events, YOU);
  if (after.phase === 'over') settle(after);
  if (!after.choice) app.picks = [];
  app.log.push(...describeEvents(db, events, before, after, themName()));
  if (app.log.length > 300) app.log.splice(0, app.log.length - 300);
  app.selection = null;
  app.toast = null;
  floats = floatsFrom(events);
  render();
}

// ─── 跟電腦打：完整的狀態在這個瀏覽器裡 ───────────────────────────────────────

const localLegal = (state: GameState): Action[] =>
  state.phase === 'main' && engine.actor(state) === YOU ? engine.legalActions(state, YOU) : [];

function localStep(after: GameState, events: GameEvent[]): void {
  const before = app.view ?? engine.viewFor(after, YOU);
  app.state = after;
  step(before, engine.viewFor(after, YOU), localLegal(after), events);
}

function perform(action: Action): void {
  if (app.mode === 'online') {
    app.pending = true;
    online.send({ t: 'act', action });
    render();
    return;
  }
  const before = app.state;
  if (before === null) return;
  const result = engine.apply(before, action);
  if (!result.ok) {
    app.toast = result.error.message;
    render();
    return;
  }
  localStep(result.state, result.events);
  void advance();
}

/** 跟電腦打：輪到電腦就讓它一步一步慢慢播，看得清楚它做了什麼；輪到你時停下來。 */
async function advance(): Promise<void> {
  if (app.mode !== 'bot' || app.busy) return;
  app.busy = true;
  render();
  while (app.state !== null && app.state.phase === 'main' && app.screen === 'play' && app.mode === 'bot') {
    const before = app.state;
    if (engine.actor(before) === BOT) {
      await sleep(BOT_STEP_MS);
      if (app.state !== before) break;
      const pick = chooseAction(engine, before, BOT, STYLES.balanced);
      localStep(pick.state, pick.events);
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
  YOU = 0;
  // 雙方都照正式規則組牌；你有自訂牌組就用你的，沒有就用收藏自動組一副。電腦每局從全部的卡自動組一副。
  const deck = myDeck();
  const created = engine.createGame({
    seed,
    players: [
      { heroId: app.heroId, deck },
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
  Object.assign(app, { mode: 'bot', screen: 'play', log: [], redraw: [], selection: null, toast: null, view: null });
  resetGameRecord(deck);
  localStep(kept.state, []);
}

/** 收藏決定每張卡最多能放幾張。 */
const owned = () => ownedOf(app.profile);

/** 你這局要用的牌組：有自訂牌組就用，沒有就用收藏自動組一副。 */
const myDeck = (): string[] => app.decks[app.heroId] ?? autoDeck(db, app.heroId, (Math.random() * 2 ** 32) >>> 0, owned());

/** 目前的天生技：英雄進化卡有新的就用新的。 */
function powerOf(side: SideView) {
  const evolution = side.heroEvolution ? card(side.heroEvolution) : null;
  return (evolution?.kind === 'heroEvolution' ? evolution.power : undefined) ?? hero(side.heroId).power;
}

/** 對手的稱呼：電腦，或朋友取的名字。 */
function themName(): string {
  if (app.mode !== 'online') return '電腦';
  return online.room?.seats[THEM()]?.name || '對手';
}

// ─── 說明欄的文字 ────────────────────────────────────────────────────────────

function handReason(def: DeckCardDef, you: SideView): string {
  if (def.kind === 'heroEvolution' && def.evolvesFrom !== you.heroId) return '這不是你英雄的進化卡';
  if (def.cost > you.energy) return `能量不足：需要 ${def.cost}，目前 ${you.energy}`;
  switch (def.kind) {
    case 'creature':
      return def.stage === 0
        ? '生物區已滿'
        : `場上沒有可以進化的${nameOf(def.evolvesFrom!)}（每隻最多進化一次）`;
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

/** 攻擊與技能共用的限制；沒有就是 null。 */
function actReason(cv: CreatureView): string | null {
  const def = card(cv.cardId);
  // 有速攻，或進化過（進化卡都算有速攻），召喚當回合就能行動。
  const haste = (def.kind === 'creature' && def.keywords?.includes('haste')) || cv.evolutionChain.length > 1;
  if (cv.paralyzed) return '麻痺中，不能攻擊、不能發動技能';
  if (cv.summonedThisTurn && !haste) return '召喚當回合不能攻擊、不能發動技能';
  return null;
}

function skillReason(cv: CreatureView, cost: number, energy: number, rest: boolean): string {
  const reason = actReason(cv);
  if (reason) return reason;
  if (cv.skillUsedThisTurn) return '這回合已經發動過技能';
  if (cv.silenced) return '沉默中，不能發動技能';
  if (rest && cv.attackedThisTurn) return '這回合攻擊過了，不能休息';
  if (cost > energy) return `能量不足：需要 ${cost}`;
  return '目前沒有可以指定的目標';
}

function attackReason(cv: CreatureView): string {
  const reason = actReason(cv);
  if (reason) return reason;
  if (cv.attackedThisTurn) return '這回合已經攻擊過（或休息了）';
  if (cv.disarmed) return '被繳械，不能攻擊';
  if (cv.attack <= 0) return '攻擊力是 0，不能攻擊';
  return '沒有可以攻擊的目標';
}

function lines(texts: string[]): string {
  const [head, ...body] = texts;
  return `<p class="d-head">${esc(head ?? '')}</p>${body.map((t) => `<p class="d-line">${esc(t)}</p>`).join('')}`;
}

/** 現在輪到你做決定。 */
const myMove = (view: PlayerView) => view.phase === 'main' && view.activePlayer === YOU && !app.busy && !app.pending;

function creatureStatus(cv: CreatureView): string {
  const tags: string[] = [`⚔ ${cv.attack}${cv.attackBonus ? `（含加成 +${cv.attackBonus}）` : ''}`, `♥ ${cv.hp} / ${cv.maxHp}`];
  if (cv.damageReduction) tags.push(`受到傷害 −${cv.damageReduction}`);
  if (cv.item) tags.push(`道具：${nameOf(cv.item)}`);
  if (cv.taunting) tags.push('挑釁中');
  if (cv.poison) tags.push(`中毒 ${cv.poison}：牠的回合開始時失去 ${cv.poison}♥`);
  if (cv.burn) tags.push(`灼燒 ${cv.burn}：牠的回合結束時受到 ${cv.burn} 傷害`);
  if (cv.paralyzed) tags.push('麻痺：不能攻擊、不能發動技能');
  if (cv.silenced) tags.push('沉默：不能發動技能');
  if (cv.disarmed) tags.push('繳械：不能攻擊');
  if (cv.weakened) tags.push('虛弱：攻擊與反擊的傷害減半');
  if (cv.cursed) tags.push('詛咒：技能傷害減半');
  if (cv.evolutionChain.length > 1) tags.push(`進化：${cv.evolutionChain.map(nameOf).join(' → ')}`);
  return `<ul class="tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function detail(view: PlayerView): string {
  const sel = app.selection;
  const toast = app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : '';
  const cancel = '<button class="ghost" data-do="cancel">取消</button>';
  const myTurn = myMove(view);

  const away =
    app.mode === 'online' && online.room?.seats[THEM()]?.connected === false
      ? `<p class="toast" role="status">${esc(themName())}斷線了，等他重新連上。</p>`
      : app.mode === 'online' && !online.connected
        ? '<p class="toast" role="status">你的連線中斷了，正在重新連線……</p>'
        : '';
  if (sel === null) {
    if (view.phase === 'over') return away + toast + '<p class="d-head">對局結束</p>';
    if (away) return away + toast;
    if (view.opponentChoosing) {
      return toast + `<p class="d-head">${esc(themName())}正在選牌</p><p class="d-line">對手翻開了牌庫頂的牌，選好就會繼續。</p>`;
    }
    if (!myTurn) {
      return toast + `<p class="d-head">${esc(themName())}的回合</p><p class="d-line">右邊的紀錄會一步一步列出對手做了什麼。</p>`;
    }
    return (
      toast +
      `<p class="d-head">你的回合</p>
       <p class="d-line">點手牌出牌；點你的生物，再點發光的對手生物或英雄攻擊，或選技能發動；點任何卡可以看說明。</p>
       <p class="d-line">能量 ${view.you.energy} / ${view.you.maxEnergy}。沒花完的能量不會留下來，你的下個回合開始時重置。</p>`
    );
  }

  if (sel.kind === 'hand') {
    const held = view.you.hand.find((c) => c.uid === sel.uid);
    if (!held) return toast;
    const def = card(held.cardId);
    const acts = actsForCard(sel.uid);
    let hint = '';
    if (!myTurn) hint = '<p class="hint">輪到你的時候才能出牌。</p>';
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
      const attacks = actsForAttack(sel.zone);
      const orSkill = skillsOf(cv).length > 0 ? '技能另外算，每回合也可以發動一次（花能量，不會被反擊）。' : '';
      body +=
        attacks.length > 0
          ? `<p class="hint">點發光的對手生物或英雄攻擊：不花能量，打生物時對方會反擊。${orSkill}</p>`
          : myTurn
            ? `<p class="hint blocked">${esc(attackReason(cv))}</p>`
            : '';
      body += '<div class="skills">';
      skillsOf(cv).forEach((skill, index) => {
        const acts = actsForSkill(sel.zone, index);
        const reason = myTurn && acts.length === 0 ? skillReason(cv, skill.cost, view.you.energy, skill.rest === true) : '';
        body += `<button class="skill" data-skill="${sel.zone}:${index}" ${acts.length === 0 ? 'disabled' : ''}>
          <span class="skill-cost">${skill.cost}</span><span class="skill-text">${esc(`${skill.name}：${describeEffects(skill, nameOf)}`)}</span>
          ${reason ? `<span class="skill-why">${esc(reason)}</span>` : ''}</button>`;
      });
      body += '</div>';
      const dismiss = app.legalActions.find((a) => a.type === 'dismiss' && a.zone === sel.zone);
      if (dismiss && sel.confirmDismiss) {
        const extra = cv.item === null && cv.evolutionChain.length === 1 ? '' : '（進化前的牌和道具也一起）';
        body += `<p class="hint blocked">${esc(def.name)}會送進棄牌區${extra}，不能收回。</p>
          <div class="respond"><button class="primary" data-do="dismiss-confirm">確定退場</button><button class="ghost" data-do="dismiss-cancel">留著</button></div>`;
      } else if (dismiss) {
        body += '<button class="ghost" data-do="dismiss">退場（空出這一格）</button>';
      }
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
       <p class="d-line">${esc(describeEntry(entry, nameOf))}</p><p class="hint">發光的就是可以選的目標。</p>` +
      cancel
    );
  }

  if (sel.kind === 'skill' || sel.kind === 'heroPower') {
    const ability = sel.kind === 'skill' ? skillsOf(view.you.zones[sel.zone]!)[sel.skill]! : powerOf(view.you)!;
    return toast + `<p class="d-head">選擇目標</p><p class="d-line">${esc(describeAbility(ability, nameOf))}</p><p class="hint">發光的就是可以選的目標。</p>` + cancel;
  }

  if (sel.kind === 'hero') {
    const side = sel.player === YOU ? view.you : view.opponent;
    const evolved = side.heroEvolution ? lines(describeCard(card(side.heroEvolution), nameOf)) : '';
    return toast + lines(describeHero(hero(side.heroId))) + evolved + `<ul class="tags"><li>♥ ${side.heroHp} / ${side.heroMaxHp}</li></ul>` + cancel;
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
  if (player === YOU && myTurn && (actsForAttack(index).length > 0 || skillsOf(cv).some((_, i) => actsForSkill(index, i).length > 0))) {
    classes.push('ready');
  }
  // 這回合什麼都不能做了（剛召喚，或攻擊與技能都用過）就變淡。
  const sick = cv.summonedThisTurn && actReason(cv) !== null;
  const done = sick || (cv.attackedThisTurn && (cv.skillUsedThisTurn || skillsOf(cv).length === 0));
  if (player === YOU && done && view.activePlayer === YOU) classes.push('spent');
  if (cv.taunting) classes.push('taunt');
  const badges: string[] = [];

  if (cv.damageReduction) badges.push(`<i class="badge def">減${cv.damageReduction}</i>`);
  if (cv.item) badges.push(`<i class="badge item">${esc(nameOf(cv.item))}</i>`);
  if (cv.taunting) badges.push('<i class="badge taunt">挑釁</i>');
  if (cv.poison) badges.push(`<i class="badge poison">毒${cv.poison}</i>`);
  if (cv.burn) badges.push(`<i class="badge burn">燒${cv.burn}</i>`);
  if (cv.paralyzed) badges.push('<i class="badge para">麻痺</i>');
  if (cv.silenced) badges.push('<i class="badge silence">沉默</i>');
  if (cv.disarmed) badges.push('<i class="badge disarm">繳械</i>');
  if (cv.weakened) badges.push('<i class="badge weak">虛弱</i>');
  if (cv.cursed) badges.push('<i class="badge curse">詛咒</i>');
  // 滿血是綠色，受過傷是紅色；攻擊力有加成時標成金色。
  const hurt = cv.hp < cv.maxHp ? ' hurt' : ' full';
  const buffed = cv.attackBonus > 0 ? ' up' : '';
  // 左上角顯示這隻生物總共花了多少費用，進化過的顯示成 4+3，一眼看出對手在牠身上投資了多少。
  // 衍生物沒有費用，標成「衍」。
  const invested = def.kind === 'creature' && def.token ? '衍' : cv.evolutionChain.map((id) => card(id).cost).join('+');
  return `<button class="${classes.join(' ')} r-${def.rarity}" data-key="${key}" aria-label="${esc(def.name)}，費用 ${invested}，攻擊 ${cv.attack}，血量 ${cv.hp}">
    <span class="z-top"><span class="z-cost">${invested}</span><span class="rarity">${def.rarity}</span>${pips(def.colors)}</span>
    <span class="z-name">${esc(def.name)}</span>
    <span class="z-stats"><span class="z-atk${buffed}" title="攻擊">⚔<b>${cv.attack}</b></span><span class="z-hp${hurt}" title="血量"><i aria-hidden="true">♥</i><b>${cv.hp}</b><small>/${cv.maxHp}</small></span></span>
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
  // 打倒時可能扣到負的，畫面上寫 0。
  const hp = Math.max(0, side.heroHp);
  const pct = Math.round((hp / side.heroMaxHp) * 100);
  const classes = ['hero', side.heroHp < side.heroMaxHp ? 'hurt' : 'full'];
  if (picks.has(key)) classes.push('pick');
  if (app.selection?.kind === 'hero' && app.selection.player === player) classes.push('selected');
  const extra = player !== YOU ? `<span class="h-hand">手牌 ${side.handCount}</span>` : '';
  const name = side.heroEvolution ? nameOf(side.heroEvolution) : h.name;
  if (side.heroEvolution) classes.push('evolved');
  return `<button class="${classes.join(' ')}" data-key="${key}" aria-label="${esc(name)}，血量 ${hp}">
    <span class="h-name">${esc(name)}</span>${pips(h.colors)}
    <span class="h-hp"><i aria-hidden="true">♥</i><b>${hp}</b><small>/${side.heroMaxHp}</small></span>
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
    const power = powerOf(side);
    if (power) {
      const usable = actsForPower().length > 0;
      // 有次數限制的天生技，標出這局還剩幾次。
      const left = power.uses === undefined ? '' : `（剩 ${Math.max(0, power.uses - side.heroPowerUses)} 次）`;
      heroRow += `<button class="power${app.selection?.kind === 'heroPower' ? ' selected' : ''}" data-do="power" ${usable ? '' : 'disabled'}>
        <span class="skill-cost">${power.cost}</span>天生技「${esc(power.name)}」${left}</button>`;
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
      const hp = def.kind === 'creature' ? `<span class="c-hp"><span class="c-atk">⚔${def.attack}</span> <span class="c-heart">♥</span>${def.hp}</span>` : '';
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
  if (view.choice && view.phase === 'main') {
    // 看牌庫頂選牌：翻開的牌只有你看得到，選好張數才能確定。
    const { cards: shown, pick } = view.choice;
    const cards = shown
      .map((held) => {
        const def = card(held.cardId);
        const picked = app.picks.includes(held.uid);
        const stats = def.kind === 'creature' ? `<span class="c-hp"><span class="c-atk">⚔${def.attack}</span> <span class="c-heart">♥</span>${def.hp}</span>` : '';
        return `<button class="card k-${def.kind} r-${def.rarity}${picked ? ' picked' : ''}" data-pick="${held.uid}" aria-pressed="${picked}">
          <span class="c-cost">${def.cost}</span>
          <span class="c-top"><span class="rarity">${def.rarity}</span>${pips(def.colors)}</span>
          <span class="c-name">${esc(def.name)}</span><span class="c-kind">${kindLabel(def)}</span>${stats}
          ${picked ? '<span class="c-mark">加入手牌</span>' : ''}</button>`;
      })
      .join('');
    const focus = app.picks.length > 0 ? lines(describeCard(card(shown.find((c) => c.uid === app.picks.at(-1))!.cardId), nameOf)) : '';
    return `<div class="overlay"><div class="dialog" role="dialog" aria-label="選牌">
      <h2>${esc(view.choice.ability)}</h2>
      <p class="d-line">牌庫頂的 ${shown.length} 張，選 ${pick} 張加入手牌，其餘放回牌庫底。對手看不到你翻開了什麼。</p>
      <div class="mull-hand">${cards}</div>
      ${focus ? `<div class="pick-focus">${focus}</div>` : ''}
      <button class="primary" data-do="choose" ${app.picks.length === pick ? '' : 'disabled'}>加入手牌（${app.picks.length}/${pick}）</button>
    </div></div>`;
  }
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
  if (view.phase === 'mulligan' && app.mode === 'online') {
    return `<div class="overlay"><div class="dialog" role="dialog" aria-label="等對手"><h2>等${esc(themName())}決定起手</h2>
      <p class="d-line">雙方都決定好要不要重抽，對局就會開始。</p></div></div>`;
  }
  if (view.phase === 'over' && view.result) {
    const { winner, reason } = view.result;
    const why = { heroDefeated: '英雄被打倒', deckOut: '牌庫抽完', concede: '投降' }[reason];
    const title = winner === 'draw' ? '平手' : winner === YOU ? '勝利' : '落敗';
    const asked = online.room?.rematch;
    const actions =
      app.mode === 'online'
        ? asked?.[YOU]
          ? `<p class="d-line">等${esc(themName())}也按「再來一局」……</p><button class="ghost" data-do="leave-room">離開房間</button>`
          : `${asked?.[THEM()] ? `<p class="d-line">${esc(themName())}想再來一局</p>` : ''}
             <div class="end-actions"><button class="primary" data-do="rematch">再來一局</button><button class="ghost" data-do="leave-room">離開房間</button></div>`
        : '<div class="end-actions"><button class="primary" data-do="again">再來一局</button><button class="ghost" data-do="setup">換英雄</button><button class="ghost" data-do="shop">卡包與收藏</button></div>';
    return `<div class="overlay"><div class="dialog end ${winner === YOU ? 'won' : 'lost'}" role="dialog" aria-label="${title}">
      <h2>${title}</h2><p class="d-line">${why}・共 ${view.turn} 回合</p>${rewardLines()}${actions}
    </div></div>`;
  }
  return '';
}

/** 結算畫面上的金幣與任務進度。 */
function rewardLines(): string {
  const reward = app.reward;
  if (!reward) return '';
  if (reward.conceded) return '<p class="d-line reward">投降的對局不算金幣與任務進度。</p>';
  const lines: string[] = [];
  if (reward.winGold > 0) lines.push(`<span class="gain">+${reward.winGold} 金幣</span>（今天贏場 ${app.profile.winGoldToday}/${ECONOMY.dailyWinGoldCap}）`);
  else if (app.view?.result?.winner === YOU) lines.push(`今天贏場金幣已經拿滿 ${ECONOMY.dailyWinGoldCap} 了`);
  if (reward.questGold > 0) lines.push(`<span class="gain">每日任務完成 +${reward.questGold} 金幣</span>`);
  else if (reward.quest && !app.profile.quest.done) lines.push(`每日任務：${esc(reward.quest)}`);
  lines.push(`金幣 ${app.profile.gold}`);
  return `<div class="reward">${lines.map((line) => `<p class="d-line">${line}</p>`).join('')}</div>`;
}

function playScreen(): string {
  const view = app.view!;
  const picks = choices();
  const myTurn = myMove(view);
  const banner =
    view.phase === 'mulligan'
      ? '起手'
      : view.phase === 'over'
        ? '對局結束'
        : `第 ${view.turn} 回合・${view.activePlayer === YOU ? '你的回合' : `${themName()}的回合`}`;
  const turnButton = `<button class="end-turn" data-do="end" ${myTurn ? '' : 'disabled'}>結束回合</button>`;
  const log = app.log.map((l) => `<li class="t-${l.tone}">${esc(l.text)}</li>`).join('');
  return `<div class="table">
    <section class="board${picks.size ? ' targeting' : ''}" aria-label="牌桌">
      ${sideRows(view.opponent, THEM(), picks, view)}
      <div class="midline"><span class="turn">${banner}</span>
        ${turnButton}</div>
      ${sideRows(view.you, YOU, picks, view)}
      ${hand(view)}
    </section>
    <aside class="panel">
      <div class="detail">${detail(view)}</div>
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
      <span class="hp-big">${h.hp}</span><span class="hp-unit">♥</span>
      <span class="hp-name">${esc(h.name)}</span>${pips(h.colors)}
      <span class="hp-text">${esc(body.join('　'))}</span><span class="sr">${esc(head ?? '')}</span></button>`;
  }).join('');
  const custom = app.decks[app.heroId];
  const problems = custom ? deckIssues(db, app.heroId, custom, owned()).problems : [];
  const colors = describeColors(hero(app.heroId).colors);
  const deckText = !custom
    ? `還沒有自訂牌組：每局從收藏裡${colors}與無色的卡自動組一副（進化線照 2/2 帶）。`
    : problems.length
      ? `自訂牌組還不能用：${problems[0]}`
      : `用你的自訂牌組（${custom.length} 張）。`;
  return `<main class="setup">
    <header><h1>卡牌試玩桌</h1><p>${
      ONLINE_AVAILABLE
        ? '選一名英雄，跟電腦打，或開一個房間跟朋友連線對戰。'
        : '選一名英雄，跟電腦打一局。對手的英雄隨機，開局時會先告訴你是誰。'
    }</p></header>
    ${walletBar(app.profile)}
    <div class="heroes">${heroes}</div>
    <section class="deck-bar">
      <div><p class="d-head">牌組</p><p class="d-line${problems.length ? ' warn' : ''}">${esc(deckText)}</p></div>
      <button class="ghost" data-do="builder">${custom ? '編輯牌組' : '自己組牌'}</button>
    </section>
    ${ONLINE_AVAILABLE ? onlineSetup(problems.length > 0) : `<button class="primary big" data-do="start" ${problems.length ? 'disabled' : ''}>開始對戰</button>`}
    ${app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : ''}
    <section class="howto">
      <h2>怎麼玩</h2>
      <ul>
        <li>能量：先攻第一回合 1 點、後攻 2 點，之後每回合上限 +2，最高 12。每個回合開始時補滿。</li>
        <li>點手牌出牌。生物要選一個空格召喚；道具要選自己的生物；進化卡要點場上對應的生物。</li>
        <li>每隻生物有攻擊力（⚔）和血量（♥）。血量滿的是綠色，受過傷的是紅色。</li>
        <li>點你的生物，再點發光的對手生物或英雄就是攻擊：不花能量，打生物時對方會用牠的攻擊力反擊，打英雄不會被反擊。技能要花能量，不會被反擊。攻擊和技能每隻每回合各一次，可以都用；召喚當回合都不行（有【速攻】的例外；進化卡都算有速攻，召喚當回合就能進化、進化完馬上能動）。</li>
        <li>標「休息」的技能不花能量，但這回合還沒攻擊才能用，用了這回合就不能攻擊（例如挑釁）。</li>
        <li>正對面、斜對角的技能，目標格空著就會打到後面的英雄。</li>
        <li>對手的生物在挑釁時，只能攻擊牠；選得到牠的技能也必須打牠，只打英雄的技能不受影響。</li>
        <li>手牌上限 10 張，滿手時抽到的牌直接進棄牌區。場地卡放在自己的場地區，只強化自己的生物。</li>
        <li>有些英雄有英雄進化卡：血量上限增加、天生技變強，每局只能進化一次。</li>
        <li>異常狀態只會中在生物身上：中毒（回合開始時失去血量）、灼燒（回合結束時受到傷害）、麻痺（不能攻擊也不能發動技能）、沉默（不能發動技能）、繳械（不能攻擊）、虛弱（攻擊傷害減半）、詛咒（技能傷害減半）。後面五種都到牠的下個回合結束，進化會解除全部。</li>
        <li>把對手英雄的血量打到 0 就贏了。</li>
      </ul>
      <p class="note">試玩說明：範例卡有 ${SAMPLE_CARDS.length} 張，牌組照正式規則：${DEFAULT_RULES.deckSize} 張、同名最多 ${DEFAULT_RULES.maxCopies} 張、UR 最多 ${DEFAULT_RULES.maxUrCopies} 張、只能放英雄顏色內的卡與無色卡。
        你可以用收藏裡的卡自己組牌；電腦每局從全部的卡自動組一副。電腦用的是模擬平衡時的均衡打法。
        金幣、收藏與牌組存在這個瀏覽器裡，換瀏覽器或清掉網站資料就會重來。</p>
    </section>
  </main>`;
}

/** 開局畫面上連線對戰的部分：名字、跟電腦打、開房間、用房號加入。 */
function onlineSetup(blocked: boolean): string {
  const invited = new URLSearchParams(location.search).get('room');
  return `<section class="online">
    ${invited ? `<p class="invite">朋友邀請你加入房間 <b>${esc(invited.toUpperCase())}</b>：選好英雄和牌組，按「加入」。</p>` : ''}
    <label class="field-row"><span>你的名字</span>
      <input id="player-name" maxlength="16" placeholder="對手會看到這個名字" value="${esc(app.playerName)}" autocomplete="nickname"></label>
    <div class="online-actions">
      <button class="primary big" data-do="create-room" ${blocked ? 'disabled' : ''}>開房間跟朋友打</button>
      <span class="or">或</span>
      <label class="join"><input id="room-code" maxlength="4" placeholder="房號" value="${esc(app.roomCode)}" autocomplete="off">
        <button class="primary" data-do="join-room" ${blocked ? 'disabled' : ''}>加入</button></label>
      <span class="or">或</span>
      <button class="ghost" data-do="start" ${blocked ? 'disabled' : ''}>跟電腦打</button>
    </div>
  </section>`;
}

/** 開好房間、等朋友加入的畫面。 */
function lobbyScreen(): string {
  const room = online.room;
  if (!room) return '<main class="setup"><p class="d-line">連線中……</p></main>';
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  const friend = room.seats[THEM()];
  return `<main class="setup lobby">
    <header><h1>房間 ${esc(room.code)}</h1><p>把連結或房號傳給朋友，他打開、選好英雄按「加入」，對局就會開始。</p></header>
    <section class="deck-bar">
      <div><p class="d-head">邀請連結</p><p class="d-line"><code id="invite-link">${esc(link)}</code></p></div>
      <button class="ghost" data-do="copy-link">複製連結</button>
    </section>
    ${
      ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
        ? '<p class="toast" role="note">你是用 localhost 開的，這個連結只有你自己的電腦打得開。把網址換成朋友連得到的位址（同一個網路用終端機印出的區網網址，不同地方用通道網址），或直接把房號給他。</p>'
        : ''
    }
    <p class="d-line">${friend ? `${esc(friend.name)} 已經加入` : '等朋友加入……'}${online.connected ? '' : '（重新連線中）'}</p>
    ${app.toast ? `<p class="toast" role="alert">${esc(app.toast)}</p>` : ''}
    <button class="ghost" data-do="leave-room">離開房間</button>
  </main>`;
}

// ─── 繪製與事件 ──────────────────────────────────────────────────────────────

function render(): void {
  const handScroll = root.querySelector('.hand')?.scrollLeft ?? 0;
  const custom = app.decks[app.builder.heroId];
  // 開著頁面跨過午夜：換成今天的任務。
  const fresh = refreshDay(app.profile, today());
  if (fresh !== app.profile) {
    app.profile = fresh;
    saveProfile(fresh);
  }
  root.innerHTML =
    app.screen === 'setup'
      ? setupScreen()
      : app.screen === 'deck'
        ? deckScreen(db, app.builder, custom ?? [], custom !== undefined, owned())
        : app.screen === 'shop'
          ? shopScreen(db, app.profile, app.shop, app.toast)
          : app.screen === 'lobby'
            ? lobbyScreen()
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
  const view = app.view!;
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
    if (addProblem(db, deck, add, owned()) === null) edit([...deck, add]);
    app.builder.focus = add;
  } else if (remove) {
    edit(removeOne(deck, remove));
    app.builder.focus = remove;
  } else if (focus) {
    app.builder.focus = app.builder.focus === focus ? null : focus;
  } else if (filter) {
    app.builder.filter = filter as KindFilter;
  } else if (command === 'deck-fill') {
    edit(fillRandom(db, heroId, deck, owned()));
  } else if (command === 'deck-auto') {
    edit(autoDeck(db, heroId, (Math.random() * 2 ** 32) >>> 0, owned()));
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
    '[data-do],[data-key],[data-hand],[data-skill],[data-hero],[data-mull],[data-pick],[data-add],[data-remove],[data-focus],[data-filter],[data-rarity],[data-color],[data-missing],[data-exchange]',
  );
  if (!el) {
    if (app.selection) {
      app.selection = null;
      render();
    }
    return;
  }
  const { do: command, key, hand: handUid, skill, hero: heroId, mull, pick } = el.dataset;
  if (app.screen === 'deck' && builderClick(el, command)) return;
  if (app.screen === 'shop' && shopClick(db, app, el, command)) {
    render();
    return;
  }

  if (heroId) {
    app.heroId = heroId;
    render();
  } else if (mull) {
    const uid = Number(mull);
    app.redraw = app.redraw.includes(uid) ? app.redraw.filter((u) => u !== uid) : [...app.redraw, uid];
    render();
  } else if (pick) {
    const uid = Number(pick);
    const limit = app.view?.choice?.pick ?? 0;
    if (app.picks.includes(uid)) app.picks = app.picks.filter((u) => u !== uid);
    else if (app.picks.length < limit) app.picks = [...app.picks, uid];
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
    else if (app.view) inspect(key);
  } else if (command === 'builder') {
    app.builder = { heroId: app.heroId, filter: app.builder.filter, focus: null };
    app.screen = 'deck';
    app.toast = null;
    render();
    window.scrollTo(0, 0);
  } else if (command === 'shop') {
    Object.assign(app, { screen: 'shop', toast: null });
    app.shop = { ...app.shop, opened: null, dealing: false, notice: null };
    render();
    window.scrollTo(0, 0);
  } else if (command === 'shop-done') {
    Object.assign(app, { screen: 'setup', toast: null });
    render();
    window.scrollTo(0, 0);
  } else if (command === 'create-room') {
    createRoom();
  } else if (command === 'join-room') {
    joinRoom();
  } else if (command === 'leave-room') {
    leaveRoom();
  } else if (command === 'rematch') {
    online.send({ t: 'rematch' });
  } else if (command === 'copy-link') {
    const text = document.getElementById('invite-link')?.textContent ?? '';
    navigator.clipboard.writeText(text).then(
      () => {
        app.toast = '已複製邀請連結';
        render();
      },
      () => {
        const range = document.createRange();
        const node = document.getElementById('invite-link');
        if (node) range.selectNodeContents(node);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
      },
    );
  } else if (command === 'start' || command === 'again') {
    startGame();
  } else if (command === 'setup') {
    Object.assign(app, { screen: 'setup', state: null, view: null, selection: null, toast: null });
    render();
  } else if (command === 'mulligan') {
    const cards = app.redraw;
    app.redraw = [];
    perform({ type: 'mulligan', player: YOU, cards });
  } else if (command === 'end') {
    perform({ type: 'endTurn', player: YOU });
  } else if (command === 'choose') {
    const cards = app.picks;
    app.picks = [];
    perform({ type: 'choose', player: YOU, cards });
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
  } else if ((command === 'dismiss' || command === 'dismiss-cancel') && app.selection?.kind === 'creature') {
    app.selection = { ...app.selection, confirmDismiss: command === 'dismiss' };
    render();
  } else if (command === 'dismiss-confirm' && app.selection?.kind === 'creature') {
    perform({ type: 'dismiss', player: YOU, zone: app.selection.zone });
  } else if (command === 'cancel') {
    app.selection = null;
    render();
  }
});

root.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === 'player-name') {
    app.playerName = input.value;
    try {
      localStorage.setItem('card-game.name', input.value);
    } catch {
      // 存不了就下次再輸入一次。
    }
  } else if (input.id === 'room-code') {
    app.roomCode = input.value.toUpperCase();
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
// 只保留跟電腦打的對局；連線對戰的狀態在伺服器上，重新連線就回得去。
hot?.snapshot?.(() => ({
  format: SAVE_FORMAT,
  screen: app.mode === 'online' ? 'setup' : app.screen,
  heroId: app.heroId,
  decks: app.decks,
  state: app.mode === 'online' ? null : app.state,
  log: app.mode === 'online' ? [] : app.log,
  redraw: app.redraw,
  gameDeck: app.gameDeck,
  tally: app.tally,
  reward: app.reward,
}));

function start(data: Partial<Saved>): void {
  // 舊版引擎存下來的對局，新版的引擎接不下去，回到開局畫面重來；牌組與選的英雄照樣保留。
  if (data.state && data.format !== SAVE_FORMAT) {
    data = { ...data, screen: 'setup', state: null, log: [], redraw: [] };
  }
  data = { ...data, format: SAVE_FORMAT };
  Object.assign(app, data);
  if (!db.heroes.has(app.heroId)) app.heroId = SAMPLE_HEROES[1]!.id;
  if (app.state && app.screen === 'play') {
    YOU = 0;
    app.view = engine.viewFor(app.state, YOU);
    app.legalActions = localLegal(app.state);
  } else if (app.screen === 'play' || app.screen === 'lobby') {
    app.screen = 'setup';
  }
  // 上次在連線房間裡就自動回去；伺服器會把房間與局面送回來。
  if (ONLINE_AVAILABLE && online.hasSession) {
    app.screen = 'lobby';
    online.connect();
  }
  render();
  void advance();
}

if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
