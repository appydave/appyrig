import { createContext, useContext } from 'react';
import type { NavGroupKey, PageKey } from '@client/app/types.js';

export interface NavGroupView {
  key: NavGroupKey;
  label: string;
  pages: { key: PageKey; label: string }[];
}

/** The nav as shown, lent by the app to any page that lists it (the About page). */
const NavContext = createContext<NavGroupView[]>([]);

export const NavProvider = NavContext.Provider;

export function useNavGroups(): NavGroupView[] {
  return useContext(NavContext);
}
