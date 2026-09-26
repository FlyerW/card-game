import { nextRandom } from './rng';
import {
  attackPower,
  cardDef,
  ceiling,
  currentCardId,
  currentHp,
  damageReduction,
  fieldDef,
  hasKeyword,
  heroHp,
  isToken,
  isCursed,
  isWeakened,
  other,
  ownersTurn,
  regeneration,
} from './queries';
import type { AbilitySource } from './targeting';
import type {
  Ability,
  CardDb,
  CardRef,
  Creature,
  Effect,
  GameEvent,
  GameResult,
  GameState,
  PlayerId,
  StatusKind,
  Target,
} from './types';

/** 一個動作執行期間的工作區：狀態是複本，出錯時整份丟掉，不會留下改到一半的狀態。 */
export interface Ctx {
  db: CardDb;
  state: GameState;
  events: GameEvent[];
}

export function randomInt(ctx: Ctx, bound: number): number {
  const [value, next] = nextRandom(ctx.state.rng);
  ctx.state.rng = next;
  return Math.floor(value * bound);
}

/** Fisher–Yates，亂數取自遊戲狀態，所以可以重播。 */
export function shuffle(ctx: Ctx, cards: CardRef[]): void {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(ctx, i + 1);
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
}

/** 把一張卡加入手牌；手牌滿了就直接進棄牌區。 */
function toHand(ctx: Ctx, player: PlayerId, card: CardRef): boolean {
  const p = ctx.state.players[player];
  if (p.hand.length >= ctx.state.rules.handLimit) {
    p.discard.push(card);
    ctx.events.push({ type: 'burned', player, cardId: card.cardId });
    return false;
  }
  p.hand.push(card);
  return true;
}

/** 把已經從牌庫拿出來的牌加入手牌（手牌滿就進棄牌區），記成抽牌事件，對手看不到是哪幾張。 */
export function drawTaken(ctx: Ctx, player: PlayerId, cards: CardRef[]): void {
  const drawn = cards.filter((card) => toHand(ctx, player, card));
  if (drawn.length > 0) ctx.events.push({ type: 'drew', player, cards: drawn });
}

/** 抽到牌庫空為止。只有「回合開始時」抽不到牌才會落敗，那個判斷在 startTurn。 */
export function drawCards(ctx: Ctx, player: PlayerId, count: number): void {
  const p = ctx.state.players[player];
  const drawn: CardRef[] = [];
  for (let i = 0; i < count && p.deck.length > 0; i++) {
    const card = p.deck.shift()!;
    if (toHand(ctx, player, card)) drawn.push(card);
  }
  if (drawn.length > 0) ctx.events.push({ type: 'drew', player, cards: drawn });
}

export function endGame(ctx: Ctx, result: GameResult): void {
  ctx.state.phase = 'over';
  ctx.state.result = result;
  ctx.events.push({ type: 'gameOver', result });
}

/** 剛進場的生物：沒有傷害、指示物與狀態，召喚當回合不能行動。 */
export function newCreature(uid: number, owner: PlayerId, cardId: string, turn: number): Creature {
  return {
    uid,
    owner,
    cards: [{ uid, cardId }],
    damage: 0,
    attackCounters: 0,
    hpCounters: 0,
    item: null,
    summonedTurn: turn,
    evolvedTurn: null,
    attackedTurn: null,
    skillUsedTurn: null,
    tauntUntilTurn: null,
    poison: 0,
    burn: 0,
    paralyzedUntilTurn: null,
    silencedUntilTurn: null,
    disarmedUntilTurn: null,
    weakenedUntilTurn: null,
    cursedUntilTurn: null,
  };
}

/** 把生物連同進化堆疊與道具送進棄牌區。 */
function removeCreature(ctx: Ctx, player: PlayerId, zone: number): void {
  const p = ctx.state.players[player];
  const creature = p.zones[zone];
  if (creature == null) return;
  p.zones[zone] = null;
  // 衍生物離場就消失；身上的道具照樣進棄牌區。
  if (!isToken(ctx.db, creature)) p.discard.push(...creature.cards);
  if (creature.item !== null) p.discard.push(creature.item);
  ctx.events.push({ type: 'creatureDestroyed', player, zone, cardId: currentCardId(creature) });
}

/** 清掉 HP 歸零的生物，再檢查英雄。每個效果結算完都要跑一次。 */
export function cleanup(ctx: Ctx): void {
  const { db, state } = ctx;
  for (const player of [0, 1] as const) {
    state.players[player].zones.forEach((creature, zone) => {
      if (creature !== null && currentHp(db, state, creature) <= 0) removeCreature(ctx, player, zone);
    });
  }
  if (state.phase === 'over') return;
  const defeated = ([0, 1] as const).filter((player) => heroHp(db, state, player) <= 0);
  if (defeated.length === 2) endGame(ctx, { winner: 'draw', reason: 'heroDefeated' });
  else if (defeated.length === 1) endGame(ctx, { winner: other(defeated[0]!), reason: 'heroDefeated' });
}

/** 目標格子現在那隻生物的 uid。 */
const targetCreatureUid = (state: GameState, target: Target | null): number | null =>
  target?.kind === 'creature' ? (state.players[target.player].zones[target.zone]?.uid ?? null) : null;

/** 目標生物還在原本的格子、而且是同一隻，才回傳牠；前一個效果打死了就回傳 null。 */
function liveCreature(state: GameState, target: Target | null, uid: number | null): Creature | null {
  if (target?.kind !== 'creature') return null;
  const creature = state.players[target.player].zones[target.zone] ?? null;
  return creature !== null && creature.uid === uid ? creature : null;
}

/** 造成傷害，回傳實際造成多少（扣掉減傷）。 */
function dealDamage(ctx: Ctx, target: Target, creature: Creature | null, amount: number): number {
  if (target.kind === 'hero') {
    ctx.state.players[target.player].heroDamage += amount;
    ctx.events.push({ type: 'damaged', target, amount });
    return amount;
  }
  if (creature !== null) {
    const dealt = Math.max(0, amount - damageReduction(ctx.db, ctx.state, creature));
    creature.damage += dealt;
    ctx.events.push({ type: 'damaged', target, amount: dealt });
    return dealt;
  }
  return 0;
}

function healHero(ctx: Ctx, player: PlayerId, amount: number): void {
  const owner = ctx.state.players[player];
  const healed = Math.min(amount, owner.heroDamage);
  owner.heroDamage -= healed;
  ctx.events.push({ type: 'healed', target: { kind: 'hero', player }, amount: healed });
}

function healCreature(ctx: Ctx, creature: Creature, target: Target, amount: number): void {
  const healed = Math.min(amount, creature.damage);
  creature.damage -= healed;
  ctx.events.push({ type: 'healed', target, amount: healed });
}

type StatusEffect = Extract<Effect, { type: 'poison' | 'burn' | 'paralyze' | 'silence' | 'disarm' | 'weaken' | 'curse' }>;

/** 對一隻生物施加異常狀態。 */
function inflict(ctx: Ctx, creature: Creature, player: PlayerId, zone: number, effect: StatusEffect): void {
  const { state } = ctx;
  let status: StatusKind;
  let amount: number | undefined;
  switch (effect.type) {
    case 'poison':
      creature.poison += effect.amount;
      [status, amount] = ['poison', creature.poison];
      break;
    case 'burn':
      creature.burn = Math.max(creature.burn, effect.amount);
      [status, amount] = ['burn', creature.burn];
      break;
    case 'paralyze':
      creature.paralyzedUntilTurn = ownersTurn(state, creature.owner, 1);
      status = 'paralysis';
      break;
    case 'silence':
      creature.silencedUntilTurn = ownersTurn(state, creature.owner, 1);
      status = 'silence';
      break;
    case 'disarm':
      creature.disarmedUntilTurn = ownersTurn(state, creature.owner, 1);
      status = 'disarm';
      break;
    case 'weaken':
      creature.weakenedUntilTurn = ownersTurn(state, creature.owner, 1);
      status = 'weakness';
      break;
    case 'curse':
      creature.cursedUntilTurn = ownersTurn(state, creature.owner, 1);
      status = 'curse';
      break;
  }
  ctx.events.push({ type: 'statusApplied', player, zone, status, ...(amount === undefined ? {} : { amount }) });
}

/** 進化會解除全部異常狀態。 */
export function clearStatuses(ctx: Ctx, creature: Creature, player: PlayerId, zone: number): void {
  const had =
    creature.poison > 0 ||
    creature.burn > 0 ||
    creature.paralyzedUntilTurn !== null ||
    creature.silencedUntilTurn !== null ||
    creature.disarmedUntilTurn !== null ||
    creature.weakenedUntilTurn !== null ||
    creature.cursedUntilTurn !== null;
  creature.poison = 0;
  creature.burn = 0;
  creature.paralyzedUntilTurn = null;
  creature.silencedUntilTurn = null;
  creature.disarmedUntilTurn = null;
  creature.weakenedUntilTurn = null;
  creature.cursedUntilTurn = null;
  if (had) ctx.events.push({ type: 'statusesCleared', player, zone });
}

/** 回合開始：這位玩家中毒的生物失去 HP。失去 HP 不算傷害，所以減傷擋不住。 */
export function tickPoison(ctx: Ctx, player: PlayerId): void {
  const { db, state } = ctx;
  state.players[player].zones.forEach((creature, zone) => {
    if (creature === null || creature.poison === 0) return;
    const target: Target = { kind: 'creature', player, zone };
    const lost = Math.min(creature.poison, currentHp(db, state, creature));
    ctx.events.push({ type: 'statusTriggered', player, zone, status: 'poison', amount: creature.poison });
    creature.damage += lost;
    ctx.events.push({ type: 'hpLost', target, amount: lost });
  });
  cleanup(ctx);
}

/** 回合開始：這位玩家有再生的生物回復 HP。在中毒之前，所以再生抵得掉同樣多的中毒。 */
export function tickRegenerate(ctx: Ctx, player: PlayerId): void {
  const { db, state } = ctx;
  state.players[player].zones.forEach((creature, zone) => {
    if (creature === null || creature.damage === 0) return;
    const amount = regeneration(db, state, creature);
    if (amount > 0) healCreature(ctx, creature, { kind: 'creature', player, zone }, amount);
  });
}

/** 回合開始：自己的場地卡讓英雄回復，或讓對手每隻生物失去 HP。 */
export function tickField(ctx: Ctx, player: PlayerId): void {
  const { db, state } = ctx;
  const field = fieldDef(db, state, player);
  if (field?.heroRegenerate) healHero(ctx, player, field.heroRegenerate);
  if (field?.enemyDecay) {
    const enemy = other(player);
    let drained = 0;
    state.players[enemy].zones.forEach((creature, zone) => {
      if (creature === null) return;
      const lost = Math.min(field.enemyDecay!, currentHp(db, state, creature));
      creature.damage += lost;
      drained += lost;
      ctx.events.push({ type: 'hpLost', target: { kind: 'creature', player: enemy, zone }, amount: lost });
    });
    if (field.lifesteal && drained > 0) healHero(ctx, player, drained);
    cleanup(ctx);
  }
}

/** 吸血：這隻生物造成多少傷害，擁有者的英雄就回復多少。 */
function lifesteal(ctx: Ctx, creature: Creature, dealt: number): void {
  if (dealt > 0 && hasKeyword(ctx.db, creature, 'lifesteal')) healHero(ctx, creature.owner, dealt);
}

/** 攻擊或反擊打多少：攻擊力，虛弱時減半。 */
const strikeDamage = (ctx: Ctx, creature: Creature): number => {
  const power = attackPower(ctx.db, ctx.state, creature);
  return isWeakened(ctx.state, creature) ? Math.floor(power / 2) : power;
};

/**
 * 生物攻擊：打英雄就只是造成傷害；打生物時，雙方同時用攻擊力打對方（被攻擊的一方反擊）。
 * 被攻擊的一方就算麻痺、沉默、繳械也會反擊，反擊不算牠的行動。
 */
export function combat(ctx: Ctx, player: PlayerId, zone: number, target: Target): void {
  const { state } = ctx;
  const attacker = state.players[player].zones[zone]!;
  const power = strikeDamage(ctx, attacker);
  ctx.events.push({ type: 'attacked', player, zone, cardId: currentCardId(attacker), target });
  if (target.kind === 'creature') {
    const defender = state.players[target.player].zones[target.zone]!;
    const counter = strikeDamage(ctx, defender);
    lifesteal(ctx, attacker, dealDamage(ctx, target, defender, power));
    lifesteal(ctx, defender, dealDamage(ctx, { kind: 'creature', player, zone }, attacker, counter));
  } else {
    lifesteal(ctx, attacker, dealDamage(ctx, target, null, power));
  }
  cleanup(ctx);
}

/** 回合結束：這位玩家灼燒的生物受到傷害。算傷害，減傷擋得住。 */
export function tickBurn(ctx: Ctx, player: PlayerId): void {
  ctx.state.players[player].zones.forEach((creature, zone) => {
    if (creature === null || creature.burn === 0) return;
    ctx.events.push({ type: 'statusTriggered', player, zone, status: 'burn', amount: creature.burn });
    dealDamage(ctx, { kind: 'creature', player, zone }, creature, creature.burn);
  });
  cleanup(ctx);
}

function applyEffect(
  ctx: Ctx,
  effect: Effect,
  source: AbilitySource,
  sourceCreature: Creature | null,
  target: Target | null,
  targetUid: number | null,
  abilityName: string,
): void {
  const { db, state } = ctx;
  const me = source.player;
  const player = state.players[me];
  const creature = liveCreature(state, target, targetUid);
  // 技能傷害就是卡上的數字，不加攻擊力；發動的生物被詛咒時減半。
  const cursed = sourceCreature !== null && isCursed(state, sourceCreature);
  const skillDamage = (amount: number) => (cursed ? Math.floor(amount / 2) : amount);
  const steal = (dealt: number) => {
    if (sourceCreature !== null) lifesteal(ctx, sourceCreature, dealt);
  };

  switch (effect.type) {
    case 'damage':
      if (target !== null && (target.kind === 'hero' || creature !== null)) {
        steal(dealDamage(ctx, target, creature, skillDamage(effect.amount)));
      }
      return;

    case 'damageEnemyCreatures': {
      const enemy = other(me);
      let dealt = 0;
      state.players[enemy].zones.forEach((each, zone) => {
        if (each !== null) dealt += dealDamage(ctx, { kind: 'creature', player: enemy, zone }, each, skillDamage(effect.amount));
      });
      steal(dealt);
      return;
    }

    case 'draw':
      drawCards(ctx, me, effect.count);
      return;

    case 'opponentDiscardRandom': {
      const enemy = other(me);
      const { hand, discard } = state.players[enemy];
      for (let i = 0; i < effect.count && hand.length > 0; i++) {
        const [card] = hand.splice(randomInt(ctx, hand.length), 1);
        discard.push(card!);
        ctx.events.push({ type: 'discarded', player: enemy, cardId: card!.cardId });
      }
      return;
    }

    case 'heal':
      if (target?.kind === 'hero') healHero(ctx, target.player, effect.amount);
      else if (creature !== null) healCreature(ctx, creature, target!, effect.amount);
      return;

    case 'healAll':
      healHero(ctx, me, effect.amount);
      player.zones.forEach((each, zone) => {
        if (each !== null) healCreature(ctx, each, { kind: 'creature', player: me, zone }, effect.amount);
      });
      return;

    case 'destroyCreature':
      if (creature !== null && target?.kind === 'creature') removeCreature(ctx, target.player, target.zone);
      return;

    case 'summonToken':
      for (let i = 0; i < effect.count; i++) {
        const zone = player.zones.findIndex((each) => each === null);
        if (zone === -1) return;
        const uid = state.nextUid++;
        player.zones[zone] = newCreature(uid, me, effect.token, state.turn);
        ctx.events.push({ type: 'summoned', player: me, zone, cardId: effect.token });
      }
      return;

    case 'lookPick': {
      const cards = player.deck.splice(0, effect.look);
      if (cards.length <= effect.pick) {
        // 牌庫剩的不夠選，全部拿走，不用等。
        drawTaken(ctx, me, cards);
        return;
      }
      state.choice = { player: me, ability: abilityName, cards, pick: effect.pick };
      ctx.events.push({ type: 'revealing', player: me, count: cards.length, pick: effect.pick });
      return;
    }

    case 'halveHp': {
      const halve = (each: Creature, at: Target) => {
        const hp = currentHp(db, state, each);
        const lost = hp - Math.floor(hp / 2);
        each.damage += lost;
        ctx.events.push({ type: 'hpLost', target: at, amount: lost });
      };
      if (effect.all) {
        const enemy = other(me);
        state.players[enemy].zones.forEach((each, zone) => {
          if (each !== null) halve(each, { kind: 'creature', player: enemy, zone });
        });
      } else if (creature !== null) halve(creature, target!);
      return;
    }

    case 'taunt':
      if (sourceCreature !== null && source.kind === 'creature') {
        sourceCreature.tauntUntilTurn = state.turn + 1;
        ctx.events.push({ type: 'taunting', player: me, zone: source.zone });
      }
      return;

    case 'buff': {
      // 增益自身，或增益我方目標生物；兩者都是我方的生物。
      let buffed: Creature | null = null;
      let zone = -1;
      if (effect.on === 'self' && source.kind === 'creature') {
        buffed = sourceCreature;
        zone = source.zone;
      } else if (effect.on === 'target' && target?.kind === 'creature') {
        buffed = creature;
        zone = target.zone;
      }
      if (buffed === null) return;
      buffed.attackCounters += effect.attack;
      buffed.hpCounters += effect.hp;
      ctx.events.push({ type: 'buffed', player: me, zone, attack: effect.attack, hp: effect.hp });
      return;
    }

    case 'gainMaxEnergy': {
      const gained = Math.max(0, Math.min(effect.amount, ceiling(db, state, me) - player.maxEnergy));
      player.maxEnergy += gained;
      ctx.events.push({ type: 'maxEnergyGained', player: me, amount: gained });
      return;
    }

    case 'raiseCeiling':
      player.ceilingBonus += effect.amount;
      ctx.events.push({ type: 'ceilingRaised', player: me, amount: effect.amount });
      return;

    case 'destroy':
      if (target?.kind === 'field') {
        const owner = state.players[target.player];
        if (owner.field !== null) {
          owner.discard.push(owner.field);
          ctx.events.push({ type: 'fieldDestroyed', player: target.player, cardId: owner.field.cardId });
          owner.field = null;
        }
      } else if (creature?.item != null && target?.kind === 'creature') {
        const item = creature.item;
        state.players[target.player].discard.push(item);
        creature.item = null;
        ctx.events.push({ type: 'itemDestroyed', player: target.player, zone: target.zone, cardId: item.cardId });
      }
      return;

    case 'searchEvolution':
    case 'evolveFromDeck': {
      if (sourceCreature === null || source.kind !== 'creature') return;
      const from = currentCardId(sourceCreature);
      const index = player.deck.findIndex((card) => {
        const def = cardDef(db, card.cardId);
        return def.kind === 'creature' && def.evolvesFrom === from;
      });
      // 牌庫裡沒有對應的進化卡，或這回合已經進化過，就沒有效果。
      if (index === -1) return;
      if (effect.type === 'evolveFromDeck' && sourceCreature.evolvedTurn === state.turn) return;
      const [card] = player.deck.splice(index, 1);
      if (effect.type === 'searchEvolution') {
        ctx.events.push({ type: 'searched', player: me, cardId: card!.cardId });
        toHand(ctx, me, card!);
      } else {
        sourceCreature.cards.push(card!);
        sourceCreature.evolvedTurn = state.turn;
        ctx.events.push({ type: 'evolved', player: me, zone: source.zone, from, to: card!.cardId });
        clearStatuses(ctx, sourceCreature, me, source.zone);
      }
      shuffle(ctx, player.deck);
      return;
    }

    case 'poison':
    case 'burn':
    case 'paralyze':
    case 'silence':
    case 'disarm':
    case 'weaken':
    case 'curse':
      if (effect.all) {
        const enemy = other(me);
        state.players[enemy].zones.forEach((each, zone) => {
          if (each !== null) inflict(ctx, each, enemy, zone, effect);
        });
        return;
      }
      // 只作用在生物身上：目標是英雄，或生物已經不在了，就沒有效果。
      if (creature !== null && target?.kind === 'creature') inflict(ctx, creature, target.player, target.zone, effect);
      return;
  }
}

/**
 * 依序結算一個技能、天生技或法術的每個效果。
 * 前一個效果打倒了目標生物，針對它的效果就不發動。
 */
export function resolveAbility(ctx: Ctx, ability: Ability, source: AbilitySource, target: Target | null): void {
  const { state } = ctx;
  const targetUid = targetCreatureUid(state, target);
  const sourceCreature = source.kind === 'creature' ? (state.players[source.player].zones[source.zone] ?? null) : null;
  for (const effect of ability.effects) {
    if (state.phase === 'over') return;
    applyEffect(ctx, effect, source, sourceCreature, target, targetUid, ability.name);
    cleanup(ctx);
  }
}

