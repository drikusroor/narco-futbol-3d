import { createAvatar } from '@dicebear/core';

/**
 * A face for every name. The name is the only seed, so the same player is the
 * same face on every screen in the room without a byte of it going over the
 * wire - everybody already knows everybody's name.
 *
 * The faces are DiceBear's "Personas" set, drawn by Draftbit and used under
 * CC BY 4.0 - see the credits line on the front end and in the README.
 */

/** Warm, smoky tones that sit with the rest of the front end. */
const BACKGROUNDS = ['b6552a', '7a4a2a', '3d5a3a', '8c3a10', '2f4858', '6b3f5e'];

type Style = Parameters<typeof createAvatar>[0];

let stylePromise: Promise<Style> | null = null;
const cache = new Map<string, string>();

/** The style pack is fetched the first time a face is needed, not up front. */
function loadStyle(): Promise<Style> {
  stylePromise ??= import('@dicebear/personas').then((m) => m as unknown as Style);
  return stylePromise;
}

/** An `<img>`-ready data URI for this name. */
export async function avatarUri(name: string, size = 96): Promise<string> {
  const key = `${size}:${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const style = await loadStyle();
  const uri = createAvatar(style, {
    seed: name,
    size,
    radius: 50,
    scale: 92,
    backgroundColor: BACKGROUNDS,
    backgroundType: ['solid'],
  }).toDataUri();
  cache.set(key, uri);
  return uri;
}

/**
 * Point an `<img>` at this name's face. Safe to call on every keystroke: each
 * call stamps the element, so a slow lookup for an old name cannot land on top
 * of a newer one.
 */
export function setAvatar(img: HTMLImageElement, name: string, size = 96): void {
  img.dataset.seed = name;
  if (!name) {
    img.removeAttribute('src');
    return;
  }
  void avatarUri(name, size).then((uri) => {
    if (img.dataset.seed === name) img.src = uri;
  });
}

/** Build a fresh `<img>` for a name, for lists that are rebuilt as they go. */
export function avatarElement(name: string, className = 'avatar'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  setAvatar(img, name, 64);
  return img;
}

const bitmaps = new Map<string, Promise<HTMLImageElement | null>>();

/** The same face as a decoded image, for drawing into a canvas texture. */
export function avatarBitmap(name: string, size = 96): Promise<HTMLImageElement | null> {
  const key = `${size}:${name}`;
  let pending = bitmaps.get(key);
  if (!pending) {
    pending = avatarUri(name, size).then(
      (uri) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image(size, size);
          img.onload = () => resolve(img);
          // A missing face is not worth losing the name tag over.
          img.onerror = () => resolve(null);
          img.src = uri;
        }),
    );
    bitmaps.set(key, pending);
  }
  return pending;
}
