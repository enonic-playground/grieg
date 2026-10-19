import { createContext, useContext } from 'react';

import type { CardHost } from './host';
import type { CardTool, JsonObject, ToolResults } from './shapes';

export type CardContextValue = {
  host: CardHost;
  locale: string;
  // Calls a read tool and shows its result as a new screen, with a way back.
  open: (tool: CardTool, args: JsonObject, title?: string) => void;
  // Calls a read tool for the screen on top and merges the result into it, for paging and
  // polling.
  refetch: <T extends CardTool>(
    tool: T,
    args: JsonObject,
    merge: (current: ToolResults[T], next: ToolResults[T]) => ToolResults[T],
  ) => Promise<void>;
  // Asks Claude to make a write. `hint` is what the user can type instead when the host does
  // not take the message. Resolves `true` once the host took it.
  ask: (request: string, hint: string) => Promise<boolean>;
};

export const CardContext = createContext<CardContextValue | null>(null);

export function useCard(): CardContextValue {
  const context = useContext(CardContext);
  if (context == null) throw new Error('useCard must be used inside a Card');
  return context;
}
