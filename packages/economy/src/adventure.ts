import type { Profile } from './index';

// 冒險模式：一段小劇情，一關一個 BOSS。前一關打過（任何難度）才解鎖下一關；
// 每一關第一次打過給 100 金幣（重複打不再給，不然可以一直刷）。

export type AdventureDifficulty = 'normal' | 'hard' | 'nightmare';

export const DIFFICULTY_NAMES: Record<AdventureDifficulty, string> = { normal: '普通', hard: '困難', nightmare: '惡夢' };

export interface AdventureStage {
  id: string;
  title: string;
  /** 普通、困難用普通版的 BOSS；惡夢用惡夢版（BOSS 專用的被動與天生技）。 */
  boss: { normal: string; nightmare: string };
  intro: string;
  outro: string;
}

export const ADVENTURE_REWARD = 100;

export const ADVENTURE: AdventureStage[] = [
  {
    id: 'mist-forest',
    title: '迷霧森林',
    boss: { normal: 'boss-grove-king', nightmare: 'boss-grove-king-nightmare' },
    intro: '一股黑色的霧從森林深處湧出，樹木一棵棵枯萎。你追著霧來到森林中心，古老的樹精王被霧吞噬，眼裡只剩憤怒。',
    outro: '樹精王倒下時，霧散了一些。他虛弱地說：「霧……是從海邊的洞窟來的。」',
  },
  {
    id: 'tide-cave',
    title: '潮汐洞窟',
    boss: { normal: 'boss-tide-witch', nightmare: 'boss-tide-witch-nightmare' },
    intro: '海邊的洞窟裡傳來歌聲。潮汐女巫站在漩渦中央，她的歌聲把海浪染成了黑色。',
    outro: '女巫清醒過來：「我只是被控制了……真正的源頭在北方的墓園，那裡的死者都醒了。」',
  },
  {
    id: 'graveyard',
    title: '亡者墓園',
    boss: { normal: 'boss-lich-lord', nightmare: 'boss-lich-lord-nightmare' },
    intro: '墓園的土不停翻動，骷髏一具具爬出來。亡靈君主坐在骨頭堆成的王座上，笑著看你走近。',
    outro: '君主化成灰前留下一句話：「你太晚了……火山已經開始噴發，那傢伙要把整片大陸燒掉。」',
  },
  {
    id: 'volcano',
    title: '熔岩火山',
    boss: { normal: 'boss-forge-general', nightmare: 'boss-forge-general-nightmare' },
    intro: '火山口的岩漿翻騰，熔爐魔將正把黑霧煉成火焰，整座山都在震動。',
    outro: '魔將的火熄滅了。岩漿裡浮出一枚刻著聖徽的徽章——黑霧的源頭，竟然是大陸最神聖的地方。',
  },
  {
    id: 'fallen-cathedral',
    title: '墮落聖堂',
    boss: { normal: 'boss-fallen-paladin', nightmare: 'boss-fallen-paladin-nightmare' },
    intro: '聖堂的鐘聲變得陰沉。守護大陸百年的聖騎士長站在祭壇前，盔甲已經被黑霧染黑：「只有毀滅，才能帶來真正的秩序。」',
    outro: '聖騎士長跪倒在地，黑霧終於散去。他看著你，露出百年來第一個微笑：「謝謝你……讓我醒過來。」大陸恢復了平靜——至少現在是這樣。',
  },
];

/** 這一關打過了哪些難度。 */
export const clearedOn = (profile: Profile, stageId: string): AdventureDifficulty[] => profile.adventure?.[stageId] ?? [];

/** 第 index 關解鎖了沒：第一關一開始就能打，之後要前一關打過。 */
export const stageUnlocked = (profile: Profile, index: number): boolean =>
  index === 0 || (ADVENTURE[index - 1] !== undefined && clearedOn(profile, ADVENTURE[index - 1]!.id).length > 0);

/** 打過一關：記下難度；第一次打過這一關給 100 金幣。還沒解鎖或沒有這一關回傳 null。 */
export function clearStage(profile: Profile, stageId: string, difficulty: AdventureDifficulty): { profile: Profile; gold: number } | null {
  const index = ADVENTURE.findIndex((stage) => stage.id === stageId);
  if (index === -1 || !stageUnlocked(profile, index) || !Object.hasOwn(DIFFICULTY_NAMES, difficulty)) return null;
  const before = clearedOn(profile, stageId);
  const gold = before.length === 0 ? ADVENTURE_REWARD : 0;
  const cleared = before.includes(difficulty) ? before : [...before, difficulty];
  return { profile: { ...profile, gold: profile.gold + gold, adventure: { ...profile.adventure, [stageId]: cleared } }, gold };
}
