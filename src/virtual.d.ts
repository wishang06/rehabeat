/** Provided by the publicAssets plugin in vite.config.ts. */
declare module 'virtual:public-assets' {
  /** True when public/beatmap.json exists. */
  export const hasBeatmap: boolean;
  /** True when public/stems/drums.mp3 and public/stems/melody.mp3 both exist. */
  export const hasStems: boolean;
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}
