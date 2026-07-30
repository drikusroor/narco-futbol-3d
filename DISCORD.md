# Running Narco Futbol as a Discord Activity

The game is already built to run inside Discord: it is a single origin serving
both the client and the WebSocket, it never talks to a third-party host, and it
handles the activity proxy's `/.proxy/` prefix on both the HTTP and WebSocket
side. What remains is registration and a couple of environment variables.

## 1. Create the application

1. https://discord.com/developers/applications → **New Application**.
2. **Activities → Settings** → enable Activities.
3. **Activities → URL Mappings**, add a root mapping:

   | Prefix | Target |
   | --- | --- |
   | `/` | `narco-futbol.fly.dev` (your deployed host) |

   The game only ever requests paths under that origin, so the single root
   mapping is enough - `/ws`, `/api/health` and the static bundle all ride on it.
4. Note the **Application ID**; that is the client id below.

## 2. Deploy the game

```bash
fly deploy
```

Discord requires HTTPS and WSS; `fly.toml` sets `force_https`, and the client
picks `wss://` automatically whenever the page is served over HTTPS.

## 3. Point the client at the application

The Discord SDK is an *optional* dependency. Without it the game still runs
inside Discord - it detects the activity from the `frame_id` query parameter,
routes through `/.proxy/`, and uses the `instance_id` as the room name, so a
party in one voice channel lands on one pitch. Installing the SDK adds the
proper handshake and a stable instance id:

```bash
npm install @discord/embedded-app-sdk
VITE_DISCORD_CLIENT_ID=<application id> npm run build
```

If `VITE_DISCORD_CLIENT_ID` is unset the SDK is never loaded and the fallback
path is used.

## 4. Test it

Enable **Activities → Testing** in the developer portal, add yourself, then
launch the activity from a voice channel. Everyone who joins the activity gets
the same room name, so they end up in the same match automatically, and every
shirt nobody claims is played by a bot.

## What Discord changes, and what it does not

| | |
| --- | --- |
| Networking | Every request is prefixed `/.proxy/`. The client adds it when it detects the activity; the server strips it on both HTTP routes and the WebSocket upgrade. |
| Room selection | The Discord instance id becomes the room name and the field is locked in the menu. |
| Rendering, audio, input | Unchanged. It is the same page as the web build. |

## Notes for a production activity

- **Machines matter.** A room lives in one process's memory. Keep
  `min_machines_running = 1` and let Fly pin the WebSocket, or shard rooms by
  name across machines if you outgrow a single one.
- **Naming.** Discord user names are not read by default; players type a name
  in the menu. Wiring `sdk.commands.authenticate()` into
  `client/src/discord.ts` and passing the result through `GameSocket.connect`
  would replace that field with the real Discord identity.
- **Mobile.** The activity runs on the mobile client too, but the game is
  currently keyboard and gamepad only - touch controls would need adding
  alongside `client/src/input/controls.ts`.
