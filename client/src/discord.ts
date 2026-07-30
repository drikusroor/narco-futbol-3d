/**
 * Discord Activity support.
 *
 * Inside Discord the game runs in an iframe whose network access is limited to
 * the activity proxy: every request has to be prefixed with `/.proxy/`. That is
 * the only thing the game needs to know to work as an embedded activity, so the
 * detection here is deliberately dependency-free.
 *
 * The optional @discord/embedded-app-sdk is loaded lazily and only used to
 * greet the client and read the instance id, so a party in the same voice
 * channel automatically lands in the same match. If the SDK is not installed,
 * or we are not inside Discord, everything falls back to the normal web build.
 */

export interface DiscordContext {
  active: boolean;
  /** Room name to join: the Discord instance so a party shares a pitch. */
  room: string | null;
  user: string | null;
}

let cached: boolean | null = null;

/** True when the page is running as a Discord activity. */
export function isDiscordActivity(): boolean {
  if (cached !== null) return cached;
  const params = new URLSearchParams(location.search);
  cached =
    params.has('frame_id') ||
    params.has('instance_id') ||
    location.hostname.endsWith('discordsays.com');
  return cached;
}

/**
 * Boot the Discord SDK when present. Never throws: any failure just means the
 * game runs as a plain web page.
 */
export async function initDiscord(): Promise<DiscordContext> {
  const params = new URLSearchParams(location.search);
  const fallbackRoom = params.get('instance_id');
  if (!isDiscordActivity()) {
    return { active: false, room: null, user: null };
  }

  const clientId = (import.meta.env?.VITE_DISCORD_CLIENT_ID as string | undefined) ?? '';
  if (!clientId) {
    return { active: true, room: fallbackRoom, user: null };
  }

  try {
    // Optional dependency: bundlers resolve it when installed, and the catch
    // below covers the case where it is not.
    const mod = await import(/* @vite-ignore */ '@discord/embedded-app-sdk');
    const sdk = new mod.DiscordSDK(clientId);
    await sdk.ready();
    return {
      active: true,
      room: sdk.instanceId ?? fallbackRoom,
      user: null,
    };
  } catch {
    return { active: true, room: fallbackRoom, user: null };
  }
}
