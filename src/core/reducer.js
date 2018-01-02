/*
 * Copyright 2017 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

import * as Actions from './action-types';
import * as ActionCreators from './action-creators';

/**
 * createGameReducer
 *
 * Creates the main game state reducer.
 * @param {...object} game - Return value of Game().
 * @param {...object} numPlayers - The number of players.
 */
export function createGameReducer({game, numPlayers}) {
  if (!numPlayers) {
    numPlayers = 2;
  }

  const initial = {
    // User managed state.
    G: game.setup(numPlayers),

    // Framework managed state.
    ctx: game.flow.ctx(numPlayers),

    // A list of actions performed so far. Used by the
    // GameLog to display a journal of moves.
    log: [],

    // A monotonically non-decreasing ID to ensure that
    // state updates are only allowed from clients that
    // are at the same version that the server.
    _id: 0,

    // A snapshot of this object so that actions can be
    // replayed over it to view old snapshots.
    _initial: {}
  };

  const state = game.flow.reducer({ G: initial.G, ctx: initial.ctx }, { type: 'init' });
  initial.G = state.G;
  initial.ctx = state.ctx;

  const deepCopy = obj => JSON.parse(JSON.stringify(obj));
  initial._initial = deepCopy(initial);

  /**
   * GameReducer
   *
   * Redux reducer that maintains the overall game state.
   * @param {object} state - The state before the action.
   * @param {object} action - A Redux action.
   */
  return (state = initial, action) => {
    const processGameEvent = (state, action) => {
      const { G, ctx } = game.flow.reducer(
          { G: state.G, ctx: state.ctx }, action.e);
      const log = [...state.log, action];
      return {...state, G, ctx, log, _id: state._id + 1};
    };

    const processMove = (state, action) => {
      let G = state.G;
      let ctx = state.ctx;

      // Ignore the move if it isn't valid at this point.
      if (!game.flow.validator(G, ctx, action.move)) {
        return state;
      }

      G = game.reducer(G, action.move, ctx);
      state = { ...state, G, ctx };

      // End the turn automatically if endTurnIf is true.
      if (game.flow.endTurnIf(G, ctx)) {
        state = processGameEvent(
            state, ActionCreators.gameEvent({ type: 'endTurn' }, action.move.playerID));
      }

      const log = [...state.log, action];
      return {...state, log, _id: state._id + 1};
    };

    switch (action.type) {
      case Actions.MAKE_MOVE:  return processMove(state, action);
      case Actions.GAME_EVENT: return processGameEvent(state, action);
      case Actions.RESTORE:    return action.state;
      default:                 return state;
    }
  };
}

/**
 * createMoveDispatchers
 *
 * Creates a set of dispatchers to make moves.
 * @param {Array} moveNames - A list of move names.
 * @param {object} store - The Redux store to create dispatchers for.
 */
export function createMoveDispatchers(moveNames, store, playerID) {
  let dispatchers = {};
  for (const name of moveNames) {
    dispatchers[name] = function(...args) {
      store.dispatch(ActionCreators.makeMove({
        type: name,
        args,
        playerID,
      }));
    };
  }
  return dispatchers;
}
