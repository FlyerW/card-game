// 起始牌組：五個基礎英雄（單色、每個人都有）各一副固定的 30 張，只用第一彈（基本卡包）的卡。
// 開局畫面的預設選項；不用收藏也能打（新玩家的收藏就是這五副用到的卡）。改了這裡，新舊玩家的起始牌組一起變。
// 每副都放那位英雄的英雄進化卡；其餘以 N、R 為主，SR 3–5 張，照顏色的主題配。
// 困難電腦互打（每組 80 局、輪流先攻）調到 44.7%–53.4%：BOT=hard npx tsx packages/sim/starter-probe.ts <英雄 A> <英雄 B> 80

/** [卡 id, 張數]；張數加起來是 30。 */
type Recipe = readonly (readonly [string, 1 | 2])[];

const RECIPES: Record<string, Recipe> = {
  // 白：鋪場、全體增益（每隻生物都吃得到劍士之道的 ⚔ +1）
  'nameless-swordsman': [
    ['healing-light', 2], ['squire', 2], ['blessed-pilgrim', 2], ['spring-nun', 2],
    ['paladin', 2], ['martyr-knight', 2], ['legion-banner', 2], ['shield-knight', 2], ['dream-herald', 1],
    ['sword-knight', 2], ['assault-rider', 2], ['rally', 2], ['victory-horn', 1],
    ['knight-captain', 2], ['realm-marshal', 1], ['seraph', 1], ['sword-saint', 1], ['banish', 1],
  ],
  // 藍：抽牌、控場，手牌多了用手牌傷害收尾
  'deep-seer': [
    ['jellyfish', 2], ['storm-jelly', 2], ['tide-mage', 2], ['scroll-apprentice', 2], ['ice-shard', 2], ['tidal-rebound', 2],
    ['glacial-bind', 1], ['apprentice-scholar', 2], ['shock-eel', 2], ['inspiration', 2], ['blade-of-knowledge', 2],
    ['tome-warden', 2], ['stargazer', 1], ['jelly-empress', 1], ['glacial-rift', 1], ['abyssal-sage', 1],
    ['void-scholar', 1], ['sea-serpent', 1], ['memory-whale', 1],
  ],
  // 黑：中毒、解場，骷髏進化線撐場面
  'underworld-priest': [
    ['bone-armor', 1], ['skeleton', 2], ['venom-spider', 2], ['plague-rat', 2], ['venom-dart', 2], ['withering-curse', 1],
    ['rust-mite', 2], ['skeleton-knight', 2], ['hex-witch', 2], ['gravekeeper', 2], ['death-touch', 1], ['toxic-fog', 1],
    ['blood-ritualist', 1], ['necromancer', 1], ['plague-walker', 1], ['plague', 2], ['rot-marsh', 1],
    ['soul-eater', 1], ['death-knight', 1], ['bone-lord', 1], ['underworld-lord', 1],
  ],
  // 紅：快攻、燒傷，便宜的生物加直接傷害
  'flame-lord': [
    ['claws', 2], ['ember-fox', 2], ['flame-imp', 2], ['blast-mage', 2], ['scorching-ray', 2],
    ['ember-fox-king', 2], ['blast-sapper', 2], ['self-immolator', 2], ['arsonist', 2], ['fireball', 2], ['devouring-flame', 2],
    ['wildfire', 1], ['war-drums', 1], ['flame-caller', 2], ['elemental-lord', 1], ['ember-heart', 1], ['flame-sovereign', 1],
    ['nine-tailed-fox', 1],
  ],
  // 綠：加能量上限、回復，大隻又耐打的生物
  'forest-king': [
    ['forest-stag', 2], ['moss-sprite', 2], ['bloom-fairy', 1], ['energy-crystal', 2], ['forest-breath', 2],
    ['grove-druid', 2], ['strangler-vine', 2], ['pack-alpha', 2], ['grove-bear-king', 2],
    ['grove-bear', 2], ['grove-warden', 2], ['hunt', 2], ['moss-lizard', 2], ['life-tree', 1],
    ['world-tree-king', 1], ['vine-colossus', 1], ['elder-treant', 1], ['mountain-giant', 1],
  ],
};

/** 這個英雄的起始牌組（30 個卡 id）；UR 英雄沒有，回傳 null。 */
export function starterDeck(heroId: string): string[] | null {
  const recipe = RECIPES[heroId];
  return recipe ? recipe.flatMap(([id, n]) => Array<string>(n).fill(id)) : null;
}

/** 有起始牌組的英雄。 */
export const STARTER_HEROES: readonly string[] = Object.keys(RECIPES);
