/**
 * Re-export block types from the addon for convenience
 */
export type {
  BlockType,
  BlockHandle,
  BlockData,
  AnyBlockData,
  CommandBlockData,
  AIPromptBlockData,
  AIResponseBlockData,
  AICommandBlockData,
  DirectoryBlockData,
  StatusBlockData,
  SessionDividerBlockData,
  CommandEvent,
  CreateBlockOptions,
} from '../addons/block-injector/types';

export { createAICommandBlockDataFromResponse } from '../addons/block-injector/types';
