import { Object, Misc } from 'ts-toolbelt';
import Koa from 'koa';
import { Store as ReduxStore } from 'redux';
import * as ActionCreators from './core/action-creators';
import { Flow } from './core/flow';
import { CreateGameReducer } from './core/reducer';
import { INVALID_MOVE } from './core/constants';
import { Auth } from './server/auth';
import * as StorageAPI from './server/db/base';
import { EventsAPI } from './plugins/plugin-events';
import { LogAPI } from './plugins/plugin-log';
import { RandomAPI } from './plugins/random/random';

export { StorageAPI };

export type AnyFn = (...args: any[]) => any;

export interface State<G extends any = any> {
  G: G;
  ctx: Ctx;
  deltalog?: Array<LogEntry>;
  plugins: {
    [pluginName: string]: PluginState;
  };
  _undo: Array<Undo<G>>;
  _redo: Array<Undo<G>>;
  _stateID: number;
}

export type PartialGameState = Pick<State, 'G' | 'ctx' | 'plugins'>;

export type StageName = string;
export type PlayerID = string;

export type StageArg = StageName | { stage?: StageName; moveLimit?: number };

export interface ActivePlayersArg {
  currentPlayer?: StageArg;
  others?: StageArg;
  all?: StageArg;
  value?: Record<PlayerID, StageArg>;
  moveLimit?: number;
  revert?: boolean;
  next?: ActivePlayersArg;
}

export interface ActivePlayers {
  [playerID: string]: StageName;
}

export interface Ctx {
  numPlayers: number;
  playOrder: Array<PlayerID>;
  playOrderPos: number;
  activePlayers: null | ActivePlayers;
  currentPlayer: PlayerID;
  numMoves?: number;
  gameover?: any;
  turn: number;
  phase: string;
  _activePlayersMoveLimit?: Record<PlayerID, number>;
  _activePlayersNumMoves?: Record<PlayerID, number>;
  _prevActivePlayers?: Array<{
    activePlayers: null | ActivePlayers;
    _activePlayersMoveLimit?: Record<PlayerID, number>;
    _activePlayersNumMoves?: Record<PlayerID, number>;
  }>;
  _nextActivePlayers?: ActivePlayersArg;
  _random?: {
    seed: string | number;
  };
}

export interface DefaultPluginAPIs {
  events: EventsAPI;
  log: LogAPI;
  random: RandomAPI;
}

export interface PluginState {
  data: SerializableAny;
  api?: any;
}

export interface LogEntry {
  action:
    | ActionShape.MakeMove
    | ActionShape.GameEvent
    | ActionShape.Undo
    | ActionShape.Redo;
  _stateID: number;
  turn: number;
  phase: string;
  redact?: boolean;
  automatic?: boolean;
  metadata?: any;
}

interface PluginContext<
  API extends any = any,
  Data extends any = any,
  G extends any = any
> {
  G: G;
  ctx: Ctx;
  game: Game;
  api: API;
  data: Data;
}

export interface Plugin<
  API extends any = any,
  Data extends any = any,
  G extends any = any
> {
  name: string;
  noClient?: (context: PluginContext<API, Data, G>) => boolean;
  setup?: (setupCtx: { G: G; ctx: Ctx; game: Game<G, Ctx> }) => Data;
  action?: (data: Data, payload: ActionShape.Plugin['payload']) => Data;
  api?: (context: {
    G: G;
    ctx: Ctx;
    game: Game<G, Ctx>;
    data: Data;
    playerID?: PlayerID;
  }) => API;
  flush?: (context: PluginContext<API, Data, G>) => Data;
  dangerouslyFlushRawState?: (flushCtx: {
    state: State<G>;
    game: Game<G, Ctx>;
    api: API;
    data: Data;
  }) => State<G>;
  fnWrap?: (
    fn: (context: FnContext<G>, ...args: SerializableAny[]) => any
  ) => (context: FnContext<G>, ...args: SerializableAny[]) => any;
  playerView?: (context: {
    G: G;
    ctx: Ctx;
    game: Game<G, Ctx>;
    data: Data;
    playerID?: PlayerID | null;
  }) => any;
}

export type FnContext<
  G extends any = any,
  PluginAPIs extends {} = {}
> = PluginAPIs &
  DefaultPluginAPIs & {
    G: G;
    ctx: Ctx;
  };

type SerializableAny = Misc.JSON.Value;
type MoveFn<G extends any = any, PluginAPIs extends {} = {}> = (
  context: FnContext<G, PluginAPIs> & { playerID: PlayerID },
  ...args: SerializableAny[]
) => void | G | typeof INVALID_MOVE;

export interface LongFormMove<G extends any = any, PluginAPIs extends {} = {}> {
  move: MoveFn<G, PluginAPIs>;
  redact?: boolean;
  noLimit?: boolean;
  client?: boolean;
  undoable?: boolean | ((G: G, ctx: Ctx) => boolean);
  ignoreStaleStateID?: boolean;
}

export type Move<G extends any = any, PluginAPIs extends {} = {}> =
  | MoveFn<G, PluginAPIs>
  | LongFormMove<G, PluginAPIs>;

export interface MoveMap<G extends any = any, PluginAPIs extends {} = {}> {
  [moveName: string]: Move<G, PluginAPIs>;
}

export interface PhaseConfig<G extends any = any, PluginAPIs extends {} = {}> {
  start?: boolean;
  next?: string;
  onBegin?: (context: FnContext<G, PluginAPIs>) => any;
  onEnd?: (context: FnContext<G, PluginAPIs>) => any;
  endIf?: (
    context: FnContext<G, PluginAPIs>
  ) => boolean | void | { next: string };
  moves?: MoveMap<G, PluginAPIs>;
  turn?: TurnConfig<G, PluginAPIs>;
  wrapped?: {
    endIf?: (state: State<G>) => boolean | void | { next: string };
    onBegin?: (state: State<G>) => any;
    onEnd?: (state: State<G>) => any;
  };
}

export interface StageConfig<G extends any = any, PluginAPIs extends {} = {}> {
  moves?: MoveMap<G, PluginAPIs>;
  next?: string;
}

export interface StageMap<G extends any = any, PluginAPIs extends {} = {}> {
  [stageName: string]: StageConfig<G, PluginAPIs>;
}

export interface TurnOrderConfig<
  G extends any = any,
  PluginAPIs extends {} = {}
> {
  first: (context: FnContext<G, PluginAPIs>) => number;
  next: (context: FnContext<G, PluginAPIs>) => number | undefined;
  playOrder?: (context: FnContext<G, PluginAPIs>) => PlayerID[];
}

export interface TurnConfig<G extends any = any, PluginAPIs extends {} = {}> {
  activePlayers?: object;
  moveLimit?: number;
  onBegin?: (context: FnContext<G, PluginAPIs>) => any;
  onEnd?: (context: FnContext<G, PluginAPIs>) => any;
  endIf?: (
    context: FnContext<G, PluginAPIs>
  ) => boolean | void | { next: PlayerID };
  onMove?: (context: FnContext<G, PluginAPIs>) => any;
  stages?: StageMap<G, PluginAPIs>;
  moves?: MoveMap<G, PluginAPIs>;
  order?: TurnOrderConfig<G, PluginAPIs>;
  wrapped?: {
    endIf?: (state: State<G>) => boolean | void | { next: PlayerID };
    onBegin?: (state: State<G>) => any;
    onEnd?: (state: State<G>) => any;
    onMove?: (state: State<G>) => any;
  };
}

interface PhaseMap<G extends any = any, PluginAPIs extends {} = {}> {
  [phaseName: string]: PhaseConfig<G, PluginAPIs>;
}

export interface Game<
  G extends any = any,
  PluginAPIs extends {} = {},
  SetupData extends any = any
> {
  name?: string;
  minPlayers?: number;
  maxPlayers?: number;
  disableUndo?: boolean;
  seed?: string | number;
  setup?: (
    context: Omit<FnContext<any, PluginAPIs>, 'G'>,
    setupData?: SetupData
  ) => G;
  validateSetupData?: (
    setupData: SetupData | undefined,
    numPlayers: number
  ) => string | undefined;
  moves?: MoveMap<G, PluginAPIs>;
  phases?: PhaseMap<G, PluginAPIs>;
  turn?: TurnConfig<G, PluginAPIs>;
  events?: {
    endGame?: boolean;
    endPhase?: boolean;
    endTurn?: boolean;
    setPhase?: boolean;
    endStage?: boolean;
    setStage?: boolean;
    pass?: boolean;
    setActivePlayers?: boolean;
  };
  endIf?: (context: FnContext<G, PluginAPIs>) => any;
  onEnd?: (context: FnContext<G, PluginAPIs>) => any;
  playerView?: (G: G, ctx: Ctx, playerID: PlayerID) => any;
  plugins?: Array<Plugin<any, any, G>>;
  ai?: {
    enumerate: (
      G: G,
      ctx: Ctx,
      playerID: PlayerID
    ) => Array<
      | { event: string; args?: any[] }
      | { move: string; args?: any[] }
      | ActionShape.MakeMove
      | ActionShape.GameEvent
    >;
  };
  processMove?: (
    state: State<G>,
    action: ActionPayload.MakeMove
  ) => State<G> | typeof INVALID_MOVE;
  flow?: ReturnType<typeof Flow>;
}

export type Undo<G extends any = any> = {
  G: G;
  ctx: Ctx;
  plugins: {
    [pluginName: string]: PluginState;
  };
  moveType?: string;
  playerID?: PlayerID;
};

export namespace Server {
  export type GenerateCredentials = (
    ctx: Koa.DefaultContext
  ) => Promise<string> | string;

  export type AuthenticateCredentials = (
    credentials: string,
    playerMetadata: PlayerMetadata
  ) => Promise<boolean> | boolean;

  export type PlayerMetadata = {
    id: number;
    name?: string;
    credentials?: string;
    data?: any;
    isConnected?: boolean;
  };

  export interface MatchData {
    gameName: string;
    players: { [id: number]: PlayerMetadata };
    setupData?: any;
    gameover?: any;
    nextMatchID?: string;
    unlisted?: boolean;
    createdAt: number;
    updatedAt: number;
  }

  export type AppCtx = Koa.DefaultContext & {
    db: StorageAPI.Async | StorageAPI.Sync;
    auth: Auth;
  };

  export type App = Koa<Koa.DefaultState, AppCtx>;
}

export namespace LobbyAPI {
  export type GameList = string[];
  type PublicPlayerMetadata = Omit<Server.PlayerMetadata, 'credentials'>;
  export type Match = Omit<Server.MatchData, 'players'> & {
    matchID: string;
    players: PublicPlayerMetadata[];
  };
  export interface MatchList {
    matches: Match[];
  }
  export interface CreatedMatch {
    matchID: string;
  }
  export interface JoinedMatch {
    playerCredentials: string;
  }
  export interface NextMatch {
    nextMatchID: string;
  }
}

export type Reducer = ReturnType<typeof CreateGameReducer>;
export type Store = ReduxStore<State, ActionShape.Any>;

export namespace CredentialedActionShape {
  export type MakeMove = ReturnType<typeof ActionCreators.makeMove>;
  export type GameEvent = ReturnType<typeof ActionCreators.gameEvent>;
  export type Plugin = ReturnType<typeof ActionCreators.plugin>;
  export type AutomaticGameEvent = ReturnType<
    typeof ActionCreators.automaticGameEvent
  >;
  export type Undo = ReturnType<typeof ActionCreators.undo>;
  export type Redo = ReturnType<typeof ActionCreators.redo>;
  export type Any =
    | MakeMove
    | GameEvent
    | AutomaticGameEvent
    | Undo
    | Redo
    | Plugin;
}

export namespace ActionShape {
  type StripCredentials<T extends object> = Object.P.Omit<
    T,
    ['payload', 'credentials']
  >;
  export type MakeMove = StripCredentials<CredentialedActionShape.MakeMove>;
  export type GameEvent = StripCredentials<CredentialedActionShape.GameEvent>;
  export type Plugin = StripCredentials<CredentialedActionShape.Plugin>;
  export type AutomaticGameEvent = StripCredentials<
    CredentialedActionShape.AutomaticGameEvent
  >;
  export type Sync = ReturnType<typeof ActionCreators.sync>;
  export type Update = ReturnType<typeof ActionCreators.update>;
  export type Reset = ReturnType<typeof ActionCreators.reset>;
  export type Undo = StripCredentials<CredentialedActionShape.Undo>;
  export type Redo = StripCredentials<CredentialedActionShape.Redo>;
  export type Any =
    | MakeMove
    | GameEvent
    | AutomaticGameEvent
    | Sync
    | Update
    | Reset
    | Undo
    | Redo
    | Plugin;
}

export namespace ActionPayload {
  type GetPayload<T extends object> = Object.At<T, 'payload'>;
  export type MakeMove = GetPayload<ActionShape.MakeMove>;
  export type GameEvent = GetPayload<ActionShape.GameEvent>;
}

export type FilteredMetadata = {
  id: number;
  name?: string;
}[];

export interface SyncInfo {
  state: State;
  filteredMetadata: FilteredMetadata;
  initialState: State;
  log: LogEntry[];
}

export interface ChatMessage {
  id: string;
  sender: PlayerID;
  payload: any;
}
