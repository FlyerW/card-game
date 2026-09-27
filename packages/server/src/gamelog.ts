import { appendFile, readFile } from 'node:fs/promises';
import { DEFAULT_RULES, type CardDb, type GameState, type PlayerId } from '@card-game/engine';

// 對局紀錄：每一局一行 JSON，存在 data/games.jsonl。之後用真人的數據調平衡（npm run game-stats）。
// 連線對戰（友誼賽、排位賽）由伺服器上的對局直接記；跟電腦打的由瀏覽器回報（伺服器帳號才會送上來）。

export interface PlayerRecord {
  hero: string;
  /** 打出過的英雄進化卡。 */
  heroEvolution: string | null;
  deck: string[];
  /** 伺服器帳號的 id；電腦與友誼賽沒登入的是 null。 */
  account: string | null;
  /** 電腦對手的難度；真人是 null。 */
  bot: 'normal' | 'hard' | null;
}

export interface GameRecord {
  at: string;
  mode: 'bot' | 'friendly' | 'ranked';
  winner: PlayerId | 'draw';
  reason: string;
  /** 先攻的是哪一邊。 */
  firstPlayer: PlayerId;
  /** 全局回合數（先攻第 1 回合是 1、後攻第 1 回合是 2）。 */
  turns: number;
  seconds: number;
  players: [PlayerRecord, PlayerRecord];
}

export class GameLog {
  private writing: Promise<void> = Promise.resolve();

  /** file 是 null 就只丟掉（測試用）。 */
  constructor(private readonly file: string | null) {}

  add(record: GameRecord): Promise<void> {
    if (this.file === null) return Promise.resolve();
    const file = this.file;
    const line = `${JSON.stringify(record)}\n`;
    this.writing = this.writing.catch(() => undefined).then(() => appendFile(file, line));
    return this.writing;
  }

  static async read(file: string): Promise<GameRecord[]> {
    const text = await readFile(file, 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as GameRecord];
        } catch {
          return [];
        }
      });
  }
}

/** 伺服器上的一局打完：從狀態記下雙方、勝負與長度。 */
export function recordFromState(
  state: GameState,
  mode: GameRecord['mode'],
  seats: [{ heroId: string; deck: string[]; account: string | null }, { heroId: string; deck: string[]; account: string | null }],
  seconds: number,
  now = new Date(),
): GameRecord | null {
  if (!state.result) return null;
  const player = (seat: PlayerId): PlayerRecord => ({
    hero: seats[seat].heroId,
    heroEvolution: state.players[seat].heroEvolution?.cardId ?? null,
    deck: [...seats[seat].deck],
    account: seats[seat].account,
    bot: null,
  });
  return {
    at: now.toISOString(),
    mode,
    winner: state.result.winner,
    reason: state.result.reason,
    firstPlayer: state.firstPlayer,
    turns: state.turn,
    seconds: Math.round(seconds),
    players: [player(0), player(1)],
  };
}

const REASONS = ['heroDefeated', 'deckOut', 'concede'];

/**
 * 瀏覽器回報的電腦對戰：格式不對、英雄或卡不存在就是 null，不記。
 * 瀏覽器可以亂報，所以這些數據只拿來參考，金幣另外照原本的規則算。
 */
export function parseBotRecord(value: unknown, db: CardDb, account: string, now = new Date()): GameRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const deck = (list: unknown): string[] | null =>
    Array.isArray(list) && list.length <= DEFAULT_RULES.deckSize && list.every((id) => typeof id === 'string' && db.cards.has(id)) ? (list as string[]) : null;
  const hero = (id: unknown): string | null => (typeof id === 'string' && db.heroes.has(id) ? id : null);
  const evolution = (id: unknown): string | null => (typeof id === 'string' && db.cards.get(id)?.kind === 'heroEvolution' ? id : null);
  const whole = (n: unknown, max: number): number | null => (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max ? n : null);
  const you = { hero: hero(v.hero), deck: deck(v.deck) };
  const bot = { hero: hero(v.opponentHero), deck: deck(v.opponentDeck) };
  const turns = whole(v.turns, 500);
  const seconds = whole(v.seconds, 6 * 3600);
  const winner = v.winner === 'you' ? 0 : v.winner === 'bot' ? 1 : v.winner === 'draw' ? 'draw' : null;
  if (!you.hero || !you.deck || !bot.hero || !bot.deck || turns === null || seconds === null || winner === null) return null;
  if (typeof v.first !== 'boolean' || typeof v.reason !== 'string' || !REASONS.includes(v.reason)) return null;
  return {
    at: now.toISOString(),
    mode: 'bot',
    winner,
    reason: v.reason,
    firstPlayer: v.first ? 0 : 1,
    turns,
    seconds,
    players: [
      { hero: you.hero, heroEvolution: evolution(v.heroEvolution), deck: you.deck, account, bot: null },
      { hero: bot.hero, heroEvolution: evolution(v.opponentHeroEvolution), deck: bot.deck, account: null, bot: v.difficulty === 'normal' ? 'normal' : 'hard' },
    ],
  };
}
