import { createContext, useContext } from 'react';

/** Media ids the active profile has completed or rated — used to flag "déjà vu". */
export const WatchedContext = createContext<Set<string>>(new Set());
export const useWatched = () => useContext(WatchedContext);
