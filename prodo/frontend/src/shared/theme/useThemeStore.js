import { create } from 'zustand'

export const useThemeStore = create((set) => ({
  variant: 'default-light',
  setVariant: (v) => set({ variant: v }),
}))
