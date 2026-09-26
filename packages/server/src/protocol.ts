import type { Action, GameEvent, PlayerId, PlayerView } from '@card-game/engine';
import type { GameReward, RankState } from '@card-game/economy';

// 連線對戰的訊息格式，伺服器與網頁共用。全部走同一條 WebSocket，每則訊息是一個 JSON 物件。
//
// 伺服器握有唯一的真實狀態：客戶端只送「我想做什麼」，伺服器驗證、執行，
// 再把各自看得到的部分分別傳給雙方——對手的手牌與牌庫順序永遠不會送到你的電腦上。

/** 房間裡一個座位上的玩家，雙方都看得到。 */
export interface SeatInfo {
  name: string;
  heroId: string;
  connected: boolean;
}

export type ClientMessage =
  /** 開一個新房間，自己坐 0 號座位。牌組照正式規則檢查。 */
  | { t: 'create'; name: string; heroId: string; deck: string[] }
  /** 用房號加入別人的房間，坐 1 號座位；兩個人都到了就開局。 */
  | { t: 'join'; code: string; name: string; heroId: string; deck: string[] }
  /** 斷線或重新整理後，用加入時拿到的 token 回到原本的座位。 */
  | { t: 'rejoin'; code: string; token: string }
  /** 在對局裡做一個動作。action.player 必須是自己的座位。 */
  | { t: 'act'; action: Action }
  /** 對局結束後想再來一局；雙方都按了才開新的一局。 */
  | { t: 'rematch' }
  /** 離開房間，不再回來。 */
  | { t: 'leave' }
  /** 排位賽排隊：用帳號的 session token 驗證身分，牌組只能放收藏裡有的卡。 */
  | { t: 'queue'; token: string; heroId: string; deck: string[] }
  /** 取消排隊。 */
  | { t: 'unqueue' };

/** 一場排位賽之後，給一位玩家看的結果。 */
export interface RankedReport {
  won: boolean;
  before: RankState;
  after: RankState;
  starsDelta: number;
  promoted: boolean;
  demoted: boolean;
  reward: GameReward;
}

export type ServerMessage =
  /** 你在哪個房間、哪個座位。token 存起來，斷線後用 rejoin 回來。 */
  | { t: 'room'; code: string; seat: PlayerId; token: string; seats: [SeatInfo | null, SeatInfo | null]; rematch: [boolean, boolean]; ranked: boolean }
  /** 排位賽排隊中：從什麼時候開始排（毫秒）、隊伍裡有幾個人。 */
  | { t: 'queued'; since: number; waiting: number }
  /** 排位賽結束：牌位變化與這場拿到的金幣。 */
  | { t: 'ranked'; report: RankedReport }
  /** 對局的最新局面：你的視角、你現在能做的動作、剛剛發生的事件（已經過濾掉你不該看到的）。 */
  | { t: 'state'; view: PlayerView; legal: Action[]; events: GameEvent[] }
  /** 動作被拒絕，或房間不存在等等。fatal 表示這個連線回不去了，要回到開局畫面。 */
  | { t: 'error'; message: string; fatal?: boolean };

/** 房號用的字母：去掉容易看錯的 0/O、1/I/L。 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;
