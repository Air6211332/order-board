export type {
  TileKind,
  BoundTile,
  Exit,
  Cell,
  BoardDefinition,
  Player,
  Phase,
  PendingChoice,
  PendingOrder,
  GameState,
  GameEvent,
  ForkMode,
  EndMode,
  PlayMode,
} from './types.js';

export {
  RulesError,
  validateBoard,
  startGame,
  pickStart,
  roll,
  chooseExit,
  confirmOrder,
  endGame,
  resolveForkMode,
  pickExitByFace,
  resolveStartCellIds,
} from './engine.js';

export { nextSeq, reassignSeq, fillMissingSeqs } from './seq.js';
export type { SeqCell } from './seq.js';

export type { StartGameOptions } from './engine.js';

export {
  resolveRolePlaceholders,
  ROLE_PLACEHOLDER_CHIPS,
} from './placeholders.js';
export type { RolePlaceholderContext } from './placeholders.js';
