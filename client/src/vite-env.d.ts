/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DISCORD_CLIENT_ID?: string;
  /** Set by the GitHub Pages build: there is no game server to connect to. */
  readonly VITE_STATIC_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The Discord SDK is an optional dependency; keep the import typed loosely. */
declare module '@discord/embedded-app-sdk' {
  export class DiscordSDK {
    constructor(clientId: string);
    ready(): Promise<void>;
    readonly instanceId: string;
  }
}
