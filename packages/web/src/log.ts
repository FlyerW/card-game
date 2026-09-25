import type { CardDb, GameEvent, GameState, PlayerId, Target } from '@card-game/engine';

// 把引擎的事件翻成對戰紀錄裡的一句話。

export const ZONE = ['①', '②', '③', '④', '⑤'];

export interface LogLine {
  text: string;
  tone: 'you' | 'bot' | 'turn' | 'end';
}

/** 事件發生時，目標生物可能已經被擊倒；先查動作前的局面，找不到再查動作後的。 */
function creatureName(db: CardDb, states: GameState[], player: PlayerId, zone: number): string {
  for (const state of states) {
    const creature = state.players[player].zones[zone];
    if (creature) return db.cards.get(creature.cards.at(-1)!.cardId)?.name ?? '生物';
  }
  return '生物';
}

export function describeEvents(
  db: CardDb,
  events: GameEvent[],
  before: GameState,
  after: GameState,
  you: PlayerId,
): LogLine[] {
  const name = (id: string) => db.cards.get(id)?.name ?? db.heroes.get(id)?.name ?? id;
  const who = (player: PlayerId) => (player === you ? '你' : '電腦');
  const tone = (player: PlayerId): LogLine['tone'] => (player === you ? 'you' : 'bot');
  const targetText = (target: Target): string => {
    if (target.kind === 'hero') return `${who(target.player)}的英雄`;
    if (target.kind === 'field') return `${who(target.player)}的場地卡`;
    return `${who(target.player)}的 ${ZONE[target.zone]} ${creatureName(db, [before, after], target.player, target.zone)}`;
  };

  const lines: LogLine[] = [];
  let responding = false;
  for (const event of events) {
    switch (event.type) {
      case 'responded':
        responding = true;
        break;
      case 'resolving':
        lines.push({ text: `　結算 ${name(event.cardId)}「${event.ability}」`, tone: 'turn' });
        break;
      case 'fizzled':
        lines.push({ text: `　${name(event.cardId)} 已經離場，「${event.ability}」沒有發動`, tone: 'turn' });
        break;
      case 'turnStarted':
        lines.push({ text: `第 ${event.turn} 回合・${who(event.player)}`, tone: 'turn' });
        break;
      case 'drew':
        if (event.player === you) {
          lines.push({ text: `你抽到 ${event.cards.map((card) => name(card.cardId)).join('、')}`, tone: 'you' });
        } else {
          lines.push({ text: `電腦抽了 ${event.cards.length} 張`, tone: 'bot' });
        }
        break;
      case 'burned':
        lines.push({ text: `　${who(event.player)}的手牌已滿，${name(event.cardId)} 直接進棄牌區`, tone: 'turn' });
        break;
      case 'searched':
        lines.push({ text: `　${who(event.player)}從牌庫找到 ${name(event.cardId)}`, tone: 'turn' });
        break;
      case 'mulliganed':
        lines.push({
          text: event.count === 0 ? `${who(event.player)}保留了起手牌` : `${who(event.player)}重抽了 ${event.count} 張`,
          tone: tone(event.player),
        });
        break;
      case 'summoned':
        lines.push({ text: `${who(event.player)}在 ${ZONE[event.zone]} 召喚 ${name(event.cardId)}`, tone: tone(event.player) });
        break;
      case 'evolved':
        lines.push({
          text: `${who(event.player)}的 ${ZONE[event.zone]} ${name(event.from)} 進化為 ${name(event.to)}`,
          tone: tone(event.player),
        });
        break;
      case 'abilityUsed': {
        const text =
          event.source === 'spell'
            ? `${who(event.player)}施放 ${name(event.cardId)}`
            : event.source === 'entry'
              ? `　${name(event.cardId)} 進場「${event.ability}」`
              : event.source === 'hero'
              ? `${who(event.player)}的英雄發動天生技「${event.ability}」`
              : `${who(event.player)}的 ${name(event.cardId)} 發動「${event.ability}」`;
        const response =
          event.source === 'spell'
            ? `↳ ${who(event.player)}回應：施放 ${name(event.cardId)}`
            : `↳ ${who(event.player)}回應：${name(event.cardId)} 發動「${event.ability}」`;
        lines.push({ text: responding ? response : text, tone: tone(event.player) });
        responding = false;
        break;
      }
      case 'heroEvolved':
        lines.push({ text: `${who(event.player)}的英雄進化為 ${name(event.cardId)}`, tone: tone(event.player) });
        break;
      case 'itemAttached':
        lines.push({
          text: `${who(event.player)}替 ${ZONE[event.zone]} 裝上 ${name(event.cardId)}`,
          tone: tone(event.player),
        });
        break;
      case 'fieldPlayed':
        lines.push({ text: `${who(event.player)}放置場地卡 ${name(event.cardId)}`, tone: tone(event.player) });
        break;
      case 'damaged':
        lines.push({ text: `　${targetText(event.target)}受到 ${event.amount} 傷害`, tone: 'turn' });
        break;
      case 'hpLost':
        lines.push({ text: `　${targetText(event.target)}失去 ${event.amount} HP`, tone: 'turn' });
        break;
      case 'healed':
        lines.push({ text: `　${targetText(event.target)}回復 ${event.amount} HP`, tone: 'turn' });
        break;
      case 'buffed': {
        const parts = [];
        if (event.attack) parts.push(`攻擊 +${event.attack}`);
        if (event.hp) parts.push(`HP 上限 +${event.hp}`);
        lines.push({ text: `　${ZONE[event.zone]} ${parts.join('、')}`, tone: 'turn' });
        break;
      }
      case 'taunting':
        lines.push({ text: `　${ZONE[event.zone]} 開始挑釁`, tone: 'turn' });
        break;
      case 'discarded':
        lines.push({ text: `　${who(event.player)}棄掉了 ${name(event.cardId)}`, tone: 'turn' });
        break;
      case 'creatureDestroyed':
        lines.push({ text: `　${who(event.player)}的 ${name(event.cardId)} 被擊倒`, tone: 'turn' });
        break;
      case 'itemDestroyed':
        lines.push({ text: `　${who(event.player)}的道具 ${name(event.cardId)} 被破壞`, tone: 'turn' });
        break;
      case 'fieldDestroyed':
        lines.push({ text: `　${who(event.player)}的場地卡 ${name(event.cardId)} 離場`, tone: 'turn' });
        break;
      case 'maxEnergyGained':
        lines.push({ text: `　${who(event.player)}的能量上限 +${event.amount}`, tone: 'turn' });
        break;
      case 'ceilingRaised':
        lines.push({ text: `　${who(event.player)}的最高上限 +${event.amount}`, tone: 'turn' });
        break;
      case 'statusApplied': {
        const label = { poison: `中毒 ${event.amount ?? ''}`, burn: `灼燒 ${event.amount ?? ''}`, paralysis: '麻痺', sleep: '沉睡' }[event.status];
        lines.push({ text: `　${targetText({ kind: 'creature', player: event.player, zone: event.zone })}${label.trim()}`, tone: 'turn' });
        break;
      }
      case 'statusTriggered':
        lines.push({
          text: `　${targetText({ kind: 'creature', player: event.player, zone: event.zone })}${event.status === 'poison' ? '毒發' : '灼燒發作'}`,
          tone: 'turn',
        });
        break;
      case 'statusesCleared':
        lines.push({ text: `　${ZONE[event.zone]} 進化，異常狀態全部解除`, tone: 'turn' });
        break;
      case 'wokeUp':
        lines.push({ text: `　${targetText({ kind: 'creature', player: event.player, zone: event.zone })}醒了`, tone: 'turn' });
        break;
      case 'gameOver': {
        const { winner, reason } = event.result;
        const why = { heroDefeated: '英雄被打倒', deckOut: '牌庫抽完', concede: '投降' }[reason];
        const text = winner === 'draw' ? `平手（${why}）` : `${winner === you ? '你贏了' : '電腦贏了'}（${why}）`;
        lines.push({ text, tone: 'end' });
        break;
      }
    }
  }
  return lines;
}
