import { SAMPLE_CARDS, newCreature, type Action, type CardRef, type Engine, type GameState, type PlayerId } from '@card-game/engine';

// 新手教學：一局事先安排好的對局，一步一步帶著玩。每一步說明要做什麼、把要點的地方標亮，
// 只接受這一步要的動作，做到了就進下一步。對手的回合照劇本走，不是電腦在想。

export const TUTORIAL_KEY = 'card-game.tutorial-done';

const YOU: PlayerId = 0;
const THEM: PlayerId = 1;

export interface TutorialStep {
  title: string;
  text: string;
  /** 要標亮的元素（CSS 選擇器）。 */
  highlight?: (state: GameState) => string[];
  /** 這一步接受哪些動作；沒有就是只看說明、按「下一步」。 */
  allow?: (action: Action, state: GameState) => boolean;
}

/** 手牌裡某張卡的 uid。 */
const handUid = (state: GameState, cardId: string): number | undefined =>
  state.players[YOU].hand.find((card) => card.cardId === cardId)?.uid;

/** 見習騎士（進化後是聖騎士）在哪一格。 */
export const knightZone = (state: GameState): number =>
  state.players[YOU].zones.findIndex((creature) => creature !== null && creature.cards[0]!.cardId === 'squire');

const handSel = (state: GameState, cardId: string) => {
  const uid = handUid(state, cardId);
  return uid === undefined ? [] : [`[data-hand="${uid}"]`];
};
const zoneSel = (player: PlayerId, zone: number) => (zone < 0 ? [] : [`[data-key="z${player}${zone}"]`]);
const enemyZone = (state: GameState, cardId: string) =>
  state.players[THEM].zones.findIndex((creature) => creature?.cards.at(-1)?.cardId === cardId);

export const STEPS: TutorialStep[] = [
  {
    title: '歡迎',
    text: '下面是你的英雄「無名劍士」，上面是對手。把對手英雄的 ♥ 打到 0 就贏了。無名劍士的被動讓你的生物攻擊 +1。',
    highlight: () => ['.hero'],
  },
  {
    title: '能量',
    text: '這一排是能量。召喚、法術、技能都要花能量；每回合開始補滿，能量上限每回合 +2，最高 12。卡片左上角的數字就是費用。',
    highlight: () => ['.energy-row'],
  },
  {
    title: '召喚生物',
    text: '點手牌裡的「見習騎士」，再點下面一個發光的空格，把牠召喚上場。',
    highlight: (state) => handSel(state, 'squire'),
    allow: (action) => action.type === 'summon' && action.player === YOU,
  },
  {
    title: '結束回合',
    text: '剛召喚的生物這回合還不能行動（野獸和進化卡例外）。按「結束回合」換對手。',
    highlight: () => ['.end-turn'],
    allow: (action) => action.type === 'endTurn',
  },
  {
    title: '攻擊',
    text: '對手召喚了灰狼。點你的見習騎士，再點發光的灰狼攻擊。攻擊不花能量；打生物時，對方會用牠的攻擊力反擊。',
    highlight: (state) => [...zoneSel(YOU, knightZone(state)), ...zoneSel(THEM, enemyZone(state, 'gray-wolf'))],
    allow: (action) => action.type === 'attack' && action.target.kind === 'creature',
  },
  {
    title: '技能',
    text: '見習騎士被反擊受傷了。點「聖泉修女」，按她的技能「治療」，再點見習騎士。技能要花能量，每隻生物每回合攻擊一次、技能一次。',
    highlight: (state) => zoneSel(YOU, state.players[YOU].zones.findIndex((c) => c?.cards[0]!.cardId === 'spring-nun')),
    allow: (action) => action.type === 'useSkill',
  },
  {
    title: '法術',
    text: '點手牌裡的「聖盾術」，再點見習騎士，讓牠的 ♥ 上限 +4。法術用完就進棄牌區。',
    highlight: (state) => handSel(state, 'holy-ward'),
    allow: (action, state) => action.type === 'castSpell' && action.card === handUid(state, 'holy-ward'),
  },
  {
    title: '進化',
    text: '點手牌裡的「聖騎士」，再點見習騎士把牠進化。進化會保留受過的傷害與加成，數值與技能變強；每隻生物最多進化一次。',
    highlight: (state) => handSel(state, 'paladin'),
    allow: (action) => action.type === 'evolve',
  },
  {
    title: '結束回合',
    text: '這回合做完了，按「結束回合」。',
    highlight: () => ['.end-turn'],
    allow: (action) => action.type === 'endTurn',
  },
  {
    title: '攻擊範圍',
    text: '生物只打得到正前方和左右兩個斜對角；那三格裡只要有一格空著，就能從空格打到後面的英雄。對手的石像鬼離得太遠，擋不住。點聖騎士，再點對手英雄。',
    highlight: (state) => [...zoneSel(YOU, knightZone(state)), '[data-key="h1"]'],
    allow: (action) => action.type === 'attack' && action.target.kind === 'hero',
  },
  {
    title: '完成！',
    text: '你學會基本玩法了。還有種族特色、異常狀態、英雄進化卡、組牌與卡包，都寫在開局畫面的「怎麼玩」。去跟電腦打一局吧！',
  },
];

const card = (state: GameState, cardId: string): CardRef => ({ uid: state.nextUid++, cardId });

/** 開一局教學：你是先攻、無名劍士；場上已經有一隻聖泉修女；手牌是教學要用的卡。 */
export function startTutorial(engine: Engine): GameState {
  const deck = (heroColors: string[]) =>
    SAMPLE_CARDS.filter((c) => c.kind !== 'heroEvolution' && !(c.kind === 'creature' && (c.token || c.stage > 0)) && c.colors.every((x) => heroColors.includes(x)))
      .slice(0, 30)
      .map((c) => c.id);
  for (let seed = 1; ; seed++) {
    const created = engine.createGame({
      seed,
      players: [
        { heroId: 'nameless-swordsman', deck: deck(['white']) },
        { heroId: 'flame-lord', deck: deck(['red']) },
      ],
      skipDeckValidation: true,
    });
    if (!created.ok) throw new Error(created.error.message);
    let state = created.state;
    for (const player of [0, 1] as const) {
      const kept = engine.apply(state, { type: 'mulligan', player, cards: [] });
      if (!kept.ok) throw new Error(kept.error.message);
      state = kept.state;
    }
    if (state.activePlayer !== YOU) continue;
    const me = state.players[YOU];
    me.hand = [card(state, 'squire'), card(state, 'holy-ward'), card(state, 'paladin')];
    me.maxEnergy = me.energy = 4;
    const nun = newCreature(state.nextUid++, YOU, 'spring-nun', 0);
    me.zones[4] = nun;
    state.players[THEM].hand = [];
    return state;
  }
}

/** 對手的回合（照劇本）：第一次召喚灰狼到見習騎士的正對面；第二次召喚石像鬼到打不到的地方。 */
export function scriptedTurn(engine: Engine, state: GameState, round: number): { state: GameState; events: import('@card-game/engine').GameEvent[] } {
  const events: import('@card-game/engine').GameEvent[] = [];
  let current = state;
  const run = (action: Action) => {
    const result = engine.apply(current, action);
    if (!result.ok) throw new Error(`教學劇本出錯：${result.error.message}`);
    current = result.state;
    events.push(...result.events);
  };
  const them = current.players[THEM];
  const knight = Math.max(0, knightZone(current));
  if (round === 0) {
    const wolf = card(current, 'gray-wolf');
    them.hand.push(wolf);
    them.energy = Math.max(them.energy, 1);
    run({ type: 'summon', player: THEM, card: wolf.uid, zone: knight });
  } else {
    const gargoyle = card(current, 'gargoyle');
    them.hand.push(gargoyle);
    them.energy = Math.max(them.energy, 4);
    const far = [0, 1, 2, 3, 4].find((zone) => Math.abs(zone - knight) >= 2 && current.players[THEM].zones[zone] === null) ?? 0;
    run({ type: 'summon', player: THEM, card: gargoyle.uid, zone: far });
  }
  run({ type: 'endTurn', player: THEM });
  // 輪到你：教學需要的能量補足。
  const me = current.players[YOU];
  me.energy = Math.max(me.energy, 4);
  return { state: current, events };
}
