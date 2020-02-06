/*
 * Copyright 2018 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import { InitializeGame } from '../core/initialize';
import { CreateGameReducer } from '../core/reducer';
import { Game } from '../core/game';
import { UNDO, REDO, MAKE_MOVE } from '../core/action-types';
import { createStore } from 'redux';
import * as logging from '../core/logger';

const GameMetadataKey = gameID => `${gameID}:metadata`;

export const getPlayerMetadata = (gameMetadata, playerID) => {
  if (gameMetadata && gameMetadata.players) {
    return gameMetadata.players[playerID];
  }
};

/**
 * Redact the log.
 *
 * @param {Array} log - The game log (or deltalog).
 * @param {String} playerID - The playerID that this log is
 *                            to be sent to.
 */
export function redactLog(log, playerID) {
  if (log === undefined) {
    return log;
  }

  return log.map(logEvent => {
    // filter for all other players and spectators.
    if (playerID !== null && +playerID === +logEvent.action.payload.playerID) {
      return logEvent;
    }

    if (logEvent.redact !== true) {
      return logEvent;
    }

    const payload = {
      ...logEvent.action.payload,
      args: null,
    };
    const filteredEvent = {
      ...logEvent,
      action: { ...logEvent.action, payload },
    };

    /* eslint-disable-next-line no-unused-vars */
    const { redact, ...remaining } = filteredEvent;
    return remaining;
  });
}

/**
 * Verifies that the game has metadata and is using credentials.
 */
export const doesGameRequireAuthentication = gameMetadata => {
  if (!gameMetadata) return false;
  const { players } = gameMetadata;
  const hasCredentials = Object.keys(players).some(key => {
    return !!(players[key] && players[key].credentials);
  });
  return hasCredentials;
};

/**
 * Verifies that the move came from a player with the correct credentials.
 */
export const isActionFromAuthenticPlayer = (
  actionCredentials,
  playerMetadata
) => {
  if (!actionCredentials) return false;
  if (!playerMetadata) return false;
  return actionCredentials === playerMetadata.credentials;
};

/**
 * Master
 *
 * Class that runs the game and maintains the authoritative state.
 * It uses the transportAPI to communicate with clients and the
 * storageAPI to communicate with the database.
 */
export class Master {
  constructor(game, storageAPI, transportAPI, auth) {
    this.game = Game(game);
    this.storageAPI = storageAPI;
    this.transportAPI = transportAPI;
    this.auth = null;
    this.shouldAuth = () => false;

    if (auth === true) {
      this.auth = isActionFromAuthenticPlayer;
      this.shouldAuth = doesGameRequireAuthentication;
    } else if (typeof auth === 'function') {
      this.auth = auth;
      this.shouldAuth = () => true;
    }
  }

  /**
   * Called on each move / event made by the client.
   * Computes the new value of the game state and returns it
   * along with a deltalog.
   */
  async onUpdate(action, stateID, gameID, playerID) {
    let isActionAuthentic;
    const { credentials } = action.payload || {};
    if (this.executeSynchronously) {
      const gameMetadata = this.storageAPI.get(GameMetadataKey(gameID));
      const playerMetadata = getPlayerMetadata(gameMetadata, playerID);
      isActionAuthentic = this.shouldAuth(gameMetadata)
        ? this.auth(credentials, playerMetadata)
        : true;
    } else {
      const gameMetadata = await this.storageAPI.get(GameMetadataKey(gameID));
      const playerMetadata = getPlayerMetadata(gameMetadata, playerID);
      isActionAuthentic = this.shouldAuth(gameMetadata)
        ? await this.auth(credentials, playerMetadata)
        : true;
    }
    if (!isActionAuthentic) {
      return { error: 'unauthorized action' };
    }

    const key = gameID;

    let state;
    if (this.executeSynchronously) {
      state = this.storageAPI.get(key);
    } else {
      state = await this.storageAPI.get(key);
    }

    if (state === undefined) {
      logging.error(`game not found, gameID=[${key}]`);
      return { error: 'game not found' };
    }

    if (state.ctx.gameover !== undefined) {
      logging.error(`game over - gameID=[${key}]`);
      return;
    }

    const reducer = CreateGameReducer({
      game: this.game,
      numPlayers: state.ctx.numPlayers,
    });
    const store = createStore(reducer, state);

    // Only allow UNDO / REDO if there is exactly one player
    // that can make moves right now and the person doing the
    // action is that player.
    if (action.type == UNDO || action.type == REDO) {
      if (
        state.ctx.currentPlayer !== playerID ||
        state.ctx.activePlayers !== null
      ) {
        logging.error(`playerID=[${playerID}] cannot undo / redo right now`);
        return;
      }
    }

    // Check whether the player is active.
    if (!this.game.flow.isPlayerActive(state.G, state.ctx, playerID)) {
      logging.error(`player not active - playerID=[${playerID}]`);
      return;
    }

    // Check whether the player is allowed to make the move.
    if (
      action.type == MAKE_MOVE &&
      !this.game.flow.getMove(state.ctx, action.payload.type, playerID)
    ) {
      logging.error(
        `move not processed - canPlayerMakeMove=false, playerID=[${playerID}]`
      );
      return;
    }

    if (state._stateID !== stateID) {
      logging.error(
        `invalid stateID, was=[${stateID}], expected=[${state._stateID}]`
      );
      return;
    }

    let log = store.getState().log || [];

    // Update server's version of the store.
    store.dispatch(action);
    state = store.getState();

    this.transportAPI.sendAll(playerID => {
      const filteredState = {
        ...state,
        G: this.game.playerView(state.G, state.ctx, playerID),
        ctx: { ...state.ctx, _random: undefined },
        log: undefined,
        deltalog: undefined,
        _undo: [],
        _redo: [],
        _initial: {
          ...state._initial,
          _undo: [],
          _redo: [],
        },
      };

      const log = redactLog(state.deltalog, playerID);

      return {
        type: 'update',
        args: [gameID, filteredState, log],
      };
    });

    // TODO: We currently attach the log back into the state
    // object before storing it, but this should probably
    // sit in a different part of the database eventually.
    log = [...log, ...state.deltalog];
    const stateWithLog = { ...state, log };

    if (this.executeSynchronously) {
      this.storageAPI.set(key, stateWithLog);
    } else {
      await this.storageAPI.set(key, stateWithLog);
    }
  }

  /**
   * Called when the client connects / reconnects.
   * Returns the latest game state and the entire log.
   */
  async onSync(gameID, playerID, numPlayers) {
    const key = gameID;

    let state, gameMetadata, filteredGameMetadata;

    if (this.executeSynchronously) {
      state = this.storageAPI.get(key);
      gameMetadata = this.storageAPI.get(GameMetadataKey(gameID));
    } else {
      state = await this.storageAPI.get(key);
      gameMetadata = await this.storageAPI.get(GameMetadataKey(gameID));
    }
    if (gameMetadata) {
      filteredGameMetadata = Object.values(gameMetadata.players).map(player => {
        return { id: player.id, name: player.name };
      });
    }
    // If the game doesn't exist, then create one on demand.
    // TODO: Move this out of the sync call.
    if (state === undefined) {
      state = InitializeGame({ game: this.game, numPlayers });

      if (this.executeSynchronously) {
        this.storageAPI.set(key, state);
        state = this.storageAPI.get(key);
      } else {
        await this.storageAPI.set(key, state);
        state = await this.storageAPI.get(key);
      }
    }

    const filteredState = {
      ...state,
      G: this.game.playerView(state.G, state.ctx, playerID),
      ctx: { ...state.ctx, _random: undefined },
      log: undefined,
      deltalog: undefined,
      _undo: [],
      _redo: [],
      _initial: {
        ...state._initial,
        _undo: [],
        _redo: [],
      },
    };

    const log = redactLog(state.log, playerID);

    this.transportAPI.send({
      playerID,
      type: 'sync',
      args: [gameID, filteredState, log, filteredGameMetadata],
    });

    return;
  }
}
