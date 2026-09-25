import { validateDeck } from './deck';
import { fail, RuleError, type ErrorCode } from './errors';
import { cardDef, ceiling, creatureDef, currentCardId, heroDef, other } from './queries';
import { cleanup, drawCards, endGame, resolveAbility, shuffle, randomInt, type Ctx } from './resolve';
import { DEFAULT_RULES } from './rules';
import { baseTargets, legalTargets, sameTarget, type AbilitySource } from './targeting';
import { viewFor } from './view';
import type {
  Ability,
  Action,
  CardDb,
  CardRef,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  Rules,
  Target,
} from './types';

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: { code: ErrorCode; message: string } };

export interface PlayerConfig {
  heroId: string;
  deck: string[];
}

export interface GameConfig {
  seed: number;
  players: [PlayerConfig, PlayerConfig];
  rules?: Partial<Rules>;
}

/** 指定要查哪個技能的合法目標。 */
export type AbilityRef =
  | { kind: 'skill'; zone: number; skill: number }
  | { kind: 'heroPower' }
  | { kind: 'spell'; card: number };

// ─── 共用檢查 ────────────────────────────────────────────────────────────────

function handCard(p: PlayerState, uid: number): CardRef {
  const card = p.hand.find((c) => c.uid === uid);
  return card ?? fail('CARD_NOT_IN_HAND', '手牌中沒有這張卡');
}

function removeFromHand(p: PlayerState, uid: number): void {
  p.hand.splice(
    p.hand.findIndex((c) => c.uid === uid),
    1,
  );
}

function pay(p: PlayerState, cost: number): void {
  if (p.energy < cost) fail('NOT_ENOUGH_ENERGY', `能量不足：需要 ${cost}，目前 ${p.energy}`);
  p.energy -= cost;
}

function checkZone(state: GameState, zone: number): void {
  if (!Number.isInteger(zone) || zone < 0 || zone >= state.rules.zones) {
    fail('INVALID_ZONE', `格子編號必須是 1 到 ${state.rules.zones}`);
  }
}

function ownCreature(state: GameState, player: PlayerId, zone: number) {
  checkZone(state, zone);
  return state.players[player].zones[zone] ?? fail('NO_CREATURE', `格子 ${zone + 1} 沒有生物`);
}

function spellAbility(db: CardDb, cardId: string): Ability | null {
  const def = cardDef(db, cardId);
  return def.kind === 'spell' ? { name: def.name, cost: def.cost, target: def.target, effects: def.effects } : null;
}

/** 驗證玩家選的目標；只有一個合法目標時可以不選。 */
function chooseTarget(ctx: Ctx, ability: Ability, source: AbilitySource, chosen: Target | undefined): Target | null {
  if (ability.target.kind === 'none') {
    if (chosen !== undefined) fail('TARGET_NOT_ALLOWED', `「${ability.name}」不需要指定目標`);
    return null;
  }
  const legal = legalTargets(ctx.state, ability, source);
  if (legal.length === 0) fail('NO_LEGAL_TARGET', `「${ability.name}」目前沒有可以指定的目標`);
  if (chosen === undefined) {
    if (legal.length === 1) return legal[0]!;
    fail('TARGET_REQUIRED', `「${ability.name}」需要指定目標`);
  }
  if (legal.some((t) => sameTarget(t, chosen))) return chosen;
  if (baseTargets(ctx.state, ability, source).some((t) => sameTarget(t, chosen))) {
    fail('MUST_TARGET_TAUNT', '對手有挑釁中的生物，這個技能必須先指定牠');
  }
  fail('ILLEGAL_TARGET', `「${ability.name}」不能指定這個目標`);
}

// ─── 回合 ────────────────────────────────────────────────────────────────────

function startTurn(ctx: Ctx, player: PlayerId): void {
  const { db, state } = ctx;
  state.turn += 1;
  state.activePlayer = player;
  ctx.events.push({ type: 'turnStarted', player, turn: state.turn });

  const p = state.players[player];
  if (p.deck.length === 0) {
    endGame(ctx, { winner: other(player), reason: 'deckOut' });
    return;
  }
  drawCards(ctx, player, 1);

  // 第一個回合用起始值，之後每回合成長，再補滿。
  // 場地卡被破壞後最高上限可能比能量上限低，這裡會一併壓回去。
  const { rules } = state;
  const isFirstPlayer = player === state.firstPlayer;
  const isFirstTurn = state.turn <= 2; // 第 1、2 回合分別是先攻與後攻的第一個回合
  const grown = isFirstTurn ? rules.startingMaxEnergy[isFirstPlayer ? 0 : 1] : p.maxEnergy + rules.energyGrowth;
  p.maxEnergy = Math.min(grown, ceiling(db, state, player));
  p.energy = p.maxEnergy + (isFirstTurn && !isFirstPlayer ? rules.secondPlayerBonusEnergy : 0);
}

// ─── 各個動作 ────────────────────────────────────────────────────────────────

type ActionOf<T extends Action['type']> = Extract<Action, { type: T }>;
type TargetedAction = ActionOf<'useSkill'> | ActionOf<'heroPower'> | ActionOf<'castSpell'>;

function mulligan(ctx: Ctx, a: ActionOf<'mulligan'>): void {
  const { state } = ctx;
  if (state.phase !== 'mulligan') fail('WRONG_PHASE', '重抽只能在開局時進行');
  const p = state.players[a.player];
  if (p.mulliganDone) fail('ALREADY_MULLIGANED', '重抽只能一次');
  if (new Set(a.cards).size !== a.cards.length) fail('DUPLICATE_CARD', '同一張卡不能選兩次');

  const returned = a.cards.map((uid) => handCard(p, uid));
  for (const card of returned) removeFromHand(p, card.uid);
  p.deck.push(...returned);
  shuffle(ctx, p.deck);
  drawCards(ctx, a.player, returned.length);
  p.mulliganDone = true;
  ctx.events.push({ type: 'mulliganed', player: a.player, count: returned.length });

  if (state.players.every((each) => each.mulliganDone)) {
    state.phase = 'main';
    startTurn(ctx, state.firstPlayer);
  }
}

function summon(ctx: Ctx, a: ActionOf<'summon'>): void {
  const { db, state } = ctx;
  const p = state.players[a.player];
  const card = handCard(p, a.card);
  const def = cardDef(db, card.cardId);
  if (def.kind !== 'creature') fail('WRONG_CARD_KIND', `${def.name} 不是生物卡`);
  if (def.stage !== 0) fail('NOT_BASE_CREATURE', `${def.name} 是進化卡，只能用來進化`);
  checkZone(state, a.zone);
  if (p.zones[a.zone] != null) fail('ZONE_OCCUPIED', `格子 ${a.zone + 1} 已經有生物`);

  pay(p, def.cost);
  removeFromHand(p, card.uid);
  p.zones[a.zone] = {
    uid: card.uid,
    cards: [card],
    damage: 0,
    attackCounters: 0,
    hpCounters: 0,
    item: null,
    summonedTurn: state.turn,
    evolvedTurn: null,
    skillUsedTurn: null,
    tauntUntilTurn: null,
  };
  ctx.events.push({ type: 'summoned', player: a.player, zone: a.zone, cardId: card.cardId });
}

function evolve(ctx: Ctx, a: ActionOf<'evolve'>): void {
  const { db, state } = ctx;
  const p = state.players[a.player];
  const card = handCard(p, a.card);
  const def = cardDef(db, card.cardId);
  if (def.kind !== 'creature') fail('WRONG_CARD_KIND', `${def.name} 不是生物卡`);
  if (def.stage === 0) fail('WRONG_CARD_KIND', `${def.name} 是基礎生物，不能用來進化`);
  const creature = ownCreature(state, a.player, a.zone);
  const from = currentCardId(creature);
  if (def.evolvesFrom !== from) {
    fail('EVOLUTION_MISMATCH', `${def.name} 要由 ${cardDef(db, def.evolvesFrom!).name} 進化，這格是 ${cardDef(db, from).name}`);
  }
  if (creature.summonedTurn === state.turn) fail('SUMMONED_THIS_TURN', '召喚當回合不能進化');
  if (creature.evolvedTurn === state.turn) fail('ALREADY_EVOLVED', '同一隻生物一回合只能進化一次');

  pay(p, def.cost);
  removeFromHand(p, card.uid);
  // 已受的傷害、指示物、道具、本回合是否發動過技能，全部保留。
  creature.cards.push(card);
  creature.evolvedTurn = state.turn;
  ctx.events.push({ type: 'evolved', player: a.player, zone: a.zone, from, to: card.cardId });
}

function useSkill(ctx: Ctx, a: ActionOf<'useSkill'>): void {
  const { db, state } = ctx;
  const p = state.players[a.player];
  const creature = ownCreature(state, a.player, a.zone);
  const def = creatureDef(db, creature);
  const skill = def.skills[a.skill] ?? fail('INVALID_SKILL', `${def.name} 沒有第 ${a.skill + 1} 個技能`);
  if (creature.skillUsedTurn === state.turn) fail('SKILL_ALREADY_USED', `${def.name} 這回合已經發動過技能`);
  if (creature.summonedTurn === state.turn && !def.keywords?.includes('haste')) {
    fail('SUMMONED_THIS_TURN', '召喚當回合不能發動技能');
  }

  const source: AbilitySource = { kind: 'creature', player: a.player, zone: a.zone };
  const target = chooseTarget(ctx, skill, source, a.target);
  pay(p, skill.cost);
  creature.skillUsedTurn = state.turn;
  ctx.events.push({ type: 'abilityUsed', player: a.player, source: 'creature', cardId: def.id, ability: skill.name });
  resolveAbility(ctx, skill, source, target);
}

function heroPower(ctx: Ctx, a: ActionOf<'heroPower'>): void {
  const { db, state } = ctx;
  const p = state.players[a.player];
  const hero = heroDef(db, state, a.player);
  const power = hero.power ?? fail('NO_HERO_POWER', `${hero.name} 沒有天生技`);
  if (p.heroPowerUsedTurn === state.turn) fail('HERO_POWER_USED', '天生技每回合只能發動一次');

  const source: AbilitySource = { kind: 'hero', player: a.player };
  const target = chooseTarget(ctx, power, source, a.target);
  pay(p, power.cost);
  p.heroPowerUsedTurn = state.turn;
  ctx.events.push({ type: 'abilityUsed', player: a.player, source: 'hero', cardId: hero.id, ability: power.name });
  resolveAbility(ctx, power, source, target);
}

function castSpell(ctx: Ctx, a: ActionOf<'castSpell'>): void {
  const { db, state } = ctx;
  const p = state.players[a.player];
  const card = handCard(p, a.card);
  const spell = spellAbility(db, card.cardId) ?? fail('WRONG_CARD_KIND', `${cardDef(db, card.cardId).name} 不是法術卡`);

  const source: AbilitySource = { kind: 'spell', player: a.player };
  const target = chooseTarget(ctx, spell, source, a.target);
  pay(p, spell.cost);
  removeFromHand(p, card.uid);
  ctx.events.push({ type: 'abilityUsed', player: a.player, source: 'spell', cardId: card.cardId, ability: spell.name });
  resolveAbility(ctx, spell, source, target);
  p.discard.push(card);
}

function attachItem(ctx: Ctx, a: ActionOf<'attachItem'>): void {
  const { db, state } = ctx;
  const p = state.players[a.player];
  const card = handCard(p, a.card);
  const def = cardDef(db, card.cardId);
  if (def.kind !== 'item') fail('WRONG_CARD_KIND', `${def.name} 不是道具卡`);
  const creature = ownCreature(state, a.player, a.zone);
  if (creature.item !== null) fail('ITEM_SLOT_TAKEN', `${creatureDef(db, creature).name} 身上已經有道具`);

  pay(p, def.cost);
  removeFromHand(p, card.uid);
  creature.item = card;
  ctx.events.push({ type: 'itemAttached', player: a.player, zone: a.zone, cardId: card.cardId });
  cleanup(ctx); // 道具可能改變 HP 上限
}

function playField(ctx: Ctx, a: ActionOf<'playField'>): void {
  const { db, state } = ctx;
  const p = state.players[a.player];
  const card = handCard(p, a.card);
  const def = cardDef(db, card.cardId);
  if (def.kind !== 'field') fail('WRONG_CARD_KIND', `${def.name} 不是場地卡`);
  if (p.fieldPlayedTurn === state.turn) fail('FIELD_ALREADY_PLAYED', '場地卡每回合只能放一張');

  pay(p, def.cost);
  removeFromHand(p, card.uid);
  if (state.field !== null) {
    const replaced = state.field;
    state.players[replaced.owner].discard.push(replaced.card);
    ctx.events.push({ type: 'fieldDestroyed', owner: replaced.owner, cardId: replaced.card.cardId });
  }
  state.field = { card, owner: a.player };
  p.fieldPlayedTurn = state.turn;
  ctx.events.push({ type: 'fieldPlayed', player: a.player, cardId: card.cardId });
}

function endTurn(ctx: Ctx, a: ActionOf<'endTurn'>): void {
  ctx.state.players[a.player].energy = 0; // 沒花完的能量清空
  startTurn(ctx, other(a.player));
}

function dispatch(ctx: Ctx, action: Action): void {
  const { state } = ctx;
  if (action.player !== 0 && action.player !== 1) fail('INVALID_PLAYER', '玩家編號必須是 0 或 1');
  if (state.phase === 'over') fail('GAME_OVER', '對局已經結束');

  if (action.type === 'concede') return endGame(ctx, { winner: other(action.player), reason: 'concede' });
  if (action.type === 'mulligan') return mulligan(ctx, action);

  if (state.phase !== 'main') fail('WRONG_PHASE', '雙方都完成重抽後才能開始行動');
  if (action.player !== state.activePlayer) fail('NOT_YOUR_TURN', '現在不是你的回合');

  switch (action.type) {
    case 'summon':
      return summon(ctx, action);
    case 'evolve':
      return evolve(ctx, action);
    case 'useSkill':
      return useSkill(ctx, action);
    case 'heroPower':
      return heroPower(ctx, action);
    case 'castSpell':
      return castSpell(ctx, action);
    case 'attachItem':
      return attachItem(ctx, action);
    case 'playField':
      return playField(ctx, action);
    case 'endTurn':
      return endTurn(ctx, action);
  }
}

// ─── 對外介面 ────────────────────────────────────────────────────────────────

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(db: CardDb) {
  /** 在狀態複本上執行；丟出 RuleError 就整份丟掉，回傳錯誤。 */
  function run(state: GameState, fn: (ctx: Ctx) => void): ApplyResult {
    const ctx: Ctx = { db, state: structuredClone(state), events: [] };
    try {
      fn(ctx);
    } catch (error) {
      if (error instanceof RuleError) return { ok: false, error: { code: error.code, message: error.message } };
      throw error;
    }
    return { ok: true, state: ctx.state, events: ctx.events };
  }

  function createGame(config: GameConfig): ApplyResult {
    const rules: Rules = { ...DEFAULT_RULES, ...config.rules };
    const problems = config.players.flatMap((p, i) =>
      validateDeck(db, rules, p.heroId, p.deck).map((problem) => `玩家 ${i + 1}：${problem}`),
    );
    if (problems.length > 0) return { ok: false, error: { code: 'INVALID_CONFIG', message: problems.join('\n') } };

    const newPlayer = (heroId: string): PlayerState => ({
      heroId,
      heroDamage: 0,
      heroPowerUsedTurn: null,
      zones: Array.from({ length: rules.zones }, () => null),
      hand: [],
      deck: [],
      discard: [],
      energy: 0,
      maxEnergy: 0,
      ceilingBonus: 0,
      fieldPlayedTurn: null,
      mulliganDone: false,
    });
    const initial: GameState = {
      rules,
      rng: config.seed >>> 0,
      turn: 0,
      firstPlayer: 0,
      activePlayer: 0,
      phase: 'mulligan',
      players: [newPlayer(config.players[0].heroId), newPlayer(config.players[1].heroId)],
      field: null,
      result: null,
      nextUid: 1,
    };

    return run(initial, (ctx) => {
      const { state } = ctx;
      for (const player of [0, 1] as const) {
        const p = state.players[player];
        p.deck = config.players[player].deck.map((cardId) => ({ uid: state.nextUid++, cardId }));
        shuffle(ctx, p.deck);
        drawCards(ctx, player, rules.startingHand);
      }
      state.firstPlayer = randomInt(ctx, 2) as PlayerId;
      state.activePlayer = state.firstPlayer;
    });
  }

  function apply(state: GameState, action: Action): ApplyResult {
    return run(state, (ctx) => dispatch(ctx, action));
  }

  /** 某個技能、天生技或法術目前能選的目標，給畫面標示可點的單位。 */
  function targetsFor(state: GameState, player: PlayerId, ref: AbilityRef): Target[] {
    let ability: Ability | null | undefined;
    let source: AbilitySource;
    if (ref.kind === 'skill') {
      const creature = state.players[player].zones[ref.zone];
      if (creature == null) return [];
      ability = creatureDef(db, creature).skills[ref.skill];
      source = { kind: 'creature', player, zone: ref.zone };
    } else if (ref.kind === 'heroPower') {
      ability = heroDef(db, state, player).power;
      source = { kind: 'hero', player };
    } else {
      const card = state.players[player].hand.find((c) => c.uid === ref.card);
      ability = card === undefined ? null : spellAbility(db, card.cardId);
      source = { kind: 'spell', player };
    }
    return ability == null ? [] : legalTargets(state, ability, source);
  }

  /**
   * 列出這位玩家現在所有合法的動作。
   * 先列出候選，再逐一實際執行驗證，所以結果一定跟 apply 的判斷一致。
   */
  function legalActions(state: GameState, player: PlayerId): Action[] {
    if (state.phase === 'over') return [];
    const p = state.players[player];
    if (state.phase === 'mulligan') {
      if (p.mulliganDone) return [];
      return [
        { type: 'mulligan', player, cards: [] },
        { type: 'mulligan', player, cards: p.hand.map((c) => c.uid) },
      ];
    }
    if (state.activePlayer !== player) return [];

    const candidates: Action[] = [];
    const zones = Array.from({ length: state.rules.zones }, (_, zone) => zone);
    const withTargets = (base: TargetedAction, ability: Ability, targets: Target[]) => {
      if (ability.target.kind === 'none') candidates.push(base);
      else for (const target of targets) candidates.push({ ...base, target });
    };

    for (const card of p.hand) {
      const def = cardDef(db, card.cardId);
      if (def.kind === 'creature') {
        for (const zone of zones) {
          candidates.push({ type: def.stage === 0 ? 'summon' : 'evolve', player, card: card.uid, zone });
        }
      } else if (def.kind === 'spell') {
        const spell = spellAbility(db, card.cardId)!;
        withTargets({ type: 'castSpell', player, card: card.uid }, spell, targetsFor(state, player, { kind: 'spell', card: card.uid }));
      } else if (def.kind === 'item') {
        for (const zone of zones) candidates.push({ type: 'attachItem', player, card: card.uid, zone });
      } else {
        candidates.push({ type: 'playField', player, card: card.uid });
      }
    }
    p.zones.forEach((creature, zone) => {
      if (creature === null) return;
      creatureDef(db, creature).skills.forEach((skill, index) => {
        const ref: AbilityRef = { kind: 'skill', zone, skill: index };
        withTargets({ type: 'useSkill', player, zone, skill: index }, skill, targetsFor(state, player, ref));
      });
    });
    const power = heroDef(db, state, player).power;
    if (power) withTargets({ type: 'heroPower', player }, power, targetsFor(state, player, { kind: 'heroPower' }));
    candidates.push({ type: 'endTurn', player });

    return candidates.filter((action) => apply(state, action).ok);
  }

  /** 從設定與動作序列重建一局。伺服器存檔、回放、除錯都靠這個。 */
  function replay(config: GameConfig, actions: readonly Action[]): ApplyResult {
    let result = createGame(config);
    for (const action of actions) {
      if (!result.ok) return result;
      result = apply(result.state, action);
    }
    return result;
  }

  return {
    db,
    createGame,
    apply,
    targetsFor,
    legalActions,
    replay,
    viewFor: (state: GameState, player: PlayerId) => viewFor(db, state, player),
  };
}
