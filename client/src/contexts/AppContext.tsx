import { createContext, useContext, useReducer, type ReactNode } from 'react';

// TODO: Replace with your actual application state shape
interface State {
  count: number;
}

// TODO: Replace with your actual action types
type Action = { type: 'increment' } | { type: 'decrement' } | { type: 'reset' };

const initialState: State = { count: 0 };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'increment':
      return { count: state.count + 1 };
    case 'decrement':
      return { count: state.count - 1 };
    case 'reset':
      return initialState;
    default:
      return state;
  }
}

interface AppContextValue {
  state: State;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Provides global application state to the component tree.
 * Wrap your app root (or a section of it) with this provider.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>;
}

/**
 * Access global application state and dispatch.
 * Must be used within an AppProvider.
 */
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
