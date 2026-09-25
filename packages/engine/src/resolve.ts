import { nextRandom } from './rng';
import {
  attackBonus,
  cardDef,
  ceiling,
  currentCardId,
  currentHp,
  damageReduction,
  heroHp,
  other,
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

/** 清掉 HP 歸零的生物，再檢查英雄。每個效果結算完都要跑一次。 */
export function cleanup(ctx: Ctx): void {
  const { db, state } = ctx;
  for (const player of [0, 1] as const) {
    const p = state.players[player];
    p.zones.forEach((creature, zone) => {
      if (creature === null || currentHp(db, state, creature) > 0) return;
      p.zones[zone] = null;
      p.discard.push(...creature.cards);
      if (creature.item !== null) p.discard.push(creature.item);
      ctx.events.push({ type: 'creatureDestroyed', player, zone, cardId: currentCardId(creature) });
    });
  }
  if (state.phase === 'over') return;
  const defeated = ([0, 1] as const).filter((player) => heroHp(db, state, player) <= 0);
  if (defeated.length === 2) endGame(ctx, { winner: 'draw', reason: 'heroDefeated' });
  else if (defeated.length === 1) endGame(ctx, { winner: other(defeated[0]!), reason: 'heroDefeated' });
}

/** 目標生物還在原本的格子、而且是同一隻，才回傳牠；前一個效果打死了就回傳 null。 */
function liveCreature(state: GameState, target: Target | null, uid: number | null): Creature | null {
  if (target?.kind !== 'creature') return null;
  const creature = state.players[target.player].zones[target.zone] ?? null;
  return creature !== null && creature.uid === uid ? creature : null;
}

function dealDamage(ctx: Ctx, target: Target, creature: Creature | null, amount: number): void {
  if (target.kind === 'hero') {
    ctx.state.players[target.player].heroDamage += amount;
    ctx.events.push({ type: 'damaged', target, amount });
  } else if (creature !== null) {
    const dealt = Math.max(0, amount - damageReduction(ctx.db, ctx.state, creature));
    creature.damage += dealt;
    ctx.events.push({ type: 'damaged', target, amount: dealt });
  }
}

function applyEffect(
  ctx: Ctx,
  effect: Effect,
  source: AbilitySource,
  sourceCreature: Creature | null,
  target: Target | null,
  targetUid: number | null,
): void {
  const { db, state } = ctx;
  const me = source.player;
  const player = state.players[me];
  const bonus = sourceCreature === null ? 0 : attackBonus(db, state, sourceCreature);
  const creature = liveCreature(state, target, targetUid);

  switch (effect.type) {
    case 'damage':
      if (target !== null && (target.kind === 'hero' || creature !== null)) {
        dealDamage(ctx, target, creature, effect.amount + bonus);
      }
      return;

    case 'damageEnemyCreatures': {
      const enemy = other(me);
      state.players[enemy].zones.forEach((each, zone) => {
        if (each !== null) dealDamage(ctx, { kind: 'creature', player: enemy, zone }, each, effect.amount + bonus);
      });
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
      if (target?.kind === 'hero') {
        const owner = state.players[target.player];
        const healed = Math.min(effect.amount, owner.heroDamage);
        owner.heroDamage -= healed;
        ctx.events.push({ type: 'healed', target, amount: healed });
      } else if (creature !== null) {
        const healed = Math.min(effect.amount, creature.damage);
        creature.damage -= healed;
        ctx.events.push({ type: 'healed', target: target!, amount: healed });
      }
      return;

    case 'halveHp':
      if (creature !== null) {
        const hp = currentHp(db, state, creature);
        const lost = hp - Math.floor(hp / 2);
        creature.damage += lost;
        ctx.events.push({ type: 'hpLost', target: target!, amount: lost });
      }
      return;

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
      }
      shuffle(ctx, player.deck);
      return;
    }
  }
}

/** 依序結算一個技能、天生技或法術的每個效果。 */
export function resolveAbility(ctx: Ctx, ability: Ability, source: AbilitySource, target: Target | null): void {
  const { state } = ctx;
  const sourceCreature = source.kind === 'creature' ? (state.players[source.player].zones[source.zone] ?? null) : null;
  const targetUid =
    target?.kind === 'creature' ? (state.players[target.player].zones[target.zone]?.uid ?? null) : null;
  for (const effect of ability.effects) {
    if (state.phase === 'over') return;
    applyEffect(ctx, effect, source, sourceCreature, target, targetUid);
    cleanup(ctx);
  }
}

