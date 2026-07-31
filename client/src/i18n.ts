/**
 * Two languages, one flat dictionary. Static markup is translated by tagging it
 * with `data-i18n`; everything drawn at runtime calls `t()`. Switching language
 * re-runs both, so nothing needs a reload.
 */

export type Lang = 'en' | 'es';

const en = {
  'lang.name': 'English',

  // --- front end ------------------------------------------------------------
  'menu.tagline': 'Five a side. No referee worth the name. 1988.',
  'menu.name': 'Your name',
  'menu.name.ph': 'El Chino',
  'menu.room': 'Ground (room)',
  'menu.room.ph': 'estadio',
  'menu.team': 'Team',
  'menu.team.auto': 'Auto',
  'menu.length': 'Length',
  'menu.size': 'Squads',
  'menu.bots': 'Bots',
  'menu.bots.easy': 'Sunday league',
  'menu.bots.normal': 'Normal',
  'menu.bots.hard': 'Sicarios',
  'menu.play': 'PLAY',
  'menu.training': 'TRAINING',
  'menu.tutorial': 'TUTORIAL',
  'menu.settings': 'SETTINGS',
  'menu.note': 'Empty shirts are filled by bots, and they hand the shirt back the moment a human turns up.',
  'menu.credits': 'Arcade football. Fictional clubs, fictional sponsors, fictional everything. Faces by DiceBear “Personas” (Draftbit, CC BY 4.0).',
  'menu.discord': 'Everyone in this Discord activity joins the same pitch. Empty shirts are filled by bots.',
  'menu.min': '{n} min',
  'menu.vs': '{n} v {n}',
  'loading.connecting': 'CONNECTING…',
  'loading.disconnected': 'DISCONNECTED — {reason}',

  // --- hud ------------------------------------------------------------------
  'hud.stamina': 'AIR',
  'hud.charge': 'POWER',
  'hud.chat.ph': 'Press {key} to talk…',
  'hud.help.hint': 'Change any of these under Settings.',
  'phase.warmup': 'WARM UP',
  'phase.kickoff': 'KICK OFF',
  'phase.play': 'PLAYING',
  'phase.goal': 'GOOOOL',
  'phase.freekick': 'FREE KICK',
  'phase.fulltime': 'FULL TIME',
  'phase.training': 'TRAINING',
  'role.keeper': 'KEEPER',
  'role.defender': 'DEFENDER',
  'role.midfielder': 'MIDFIELD',
  'role.winger': 'WINGER',
  'role.striker': 'STRIKER',

  // --- match events ---------------------------------------------------------
  'event.goal': 'GOOOOAL!',
  'event.fulltime': 'FULL TIME',
  'event.draw': 'DRAW',
  'event.foul.toast': 'FOUL!',
  'event.foul': 'foul by {name}',
  'event.save': 'save!',
  'event.post': 'off the woodwork!',
  'event.someone': 'someone',
  'event.muted': 'sound off',
  'event.unmuted': 'sound on',
  'notice.joined': '{name} joined {team}',
  'notice.left': '{name} left',
  'notice.config': '{name} changed the match settings',
  'notice.locked': 'match in progress — settings locked',
  'notice.trainingBusy': 'training is for a private pitch',

  // --- power-ups ------------------------------------------------------------
  'powerup.speed.blurb': 'Everything moves faster. Especially you.',
  'powerup.power.blurb': 'Shots leave scorch marks.',
  'powerup.strength.blurb': 'Nobody takes it off you.',
  'powerup.vision.blurb': 'Passes find their man.',

  // --- settings -------------------------------------------------------------
  'settings.title': 'SETTINGS',
  'settings.language': 'Language',
  'settings.controls': 'Controls',
  'settings.audio': 'Sound',
  'settings.volume': 'Volume',
  'settings.art': 'Player art',
  'settings.art.off': 'Models',
  'settings.art.auto': 'Sprites far away',
  'settings.art.all': 'Sprites everywhere',
  'settings.art.blurb':
    'Players can be drawn from sprite sheets pre-rendered off the same models, the way the old isometric games did it. The sheets are baked when you first switch this on.',
  'settings.action': 'Action',
  'settings.primary': 'Key',
  'settings.secondary': 'Alternative',
  'settings.pad': 'Pad',
  'settings.rebind': 'Click a slot and press the key, mouse button or pad button you want. Esc clears it.',
  'settings.listening': 'press anything…',
  'settings.reset': 'RESTORE DEFAULTS',
  'settings.close': 'CLOSE',
  'settings.leave': 'LEAVE THE PITCH',
  'settings.pad.none': 'No gamepad. Plug one in and press a button — sticks move and aim, the menus take the d-pad, A and B.',
  'settings.pad.found': '{name} — left stick moves, right stick aims. Menus take the d-pad, A and B.',
  'action.up': 'Move up',
  'action.down': 'Move down',
  'action.left': 'Move left',
  'action.right': 'Move right',
  'action.sprint': 'Sprint',
  'action.pass': 'Pass (hold for a through ball)',
  'action.shoot': 'Shoot (hold for harder and higher)',
  'action.lob': 'Lofted pass / cross',
  'action.tackle': 'Tackle (sprinting = slide)',
  'action.switch': 'Switch to the nearest team-mate',
  'action.chat': 'Chat',
  'action.help': 'Show the controls',
  'action.settings': 'Settings',
  'action.mute': 'Mute',

  // --- training -------------------------------------------------------------
  'training.title': 'TRAINING',
  'training.pick': 'Pick a drill. Nobody is watching.',
  'training.start': 'START',
  'training.back': 'BACK',
  'training.leave': 'Leave training',
  'drill.free': 'Free play',
  'drill.free.blurb': 'An empty ground, a ball, and a keeper to beat.',
  'drill.free.prompt': 'Knock it about. Nothing is being counted.',
  'drill.shooting': 'Shooting',
  'drill.shooting.blurb': 'Beat the keeper from every angle.',
  'drill.shooting.prompt': 'Score from the spot marked on the grass.',
  'drill.dribble': 'Dribbling',
  'drill.dribble.blurb': 'Carry the ball through the gates against a defender.',
  'drill.dribble.prompt': 'Run the ball through the gates, in order.',
  'drill.passing': 'Passing',
  'drill.passing.blurb': 'Find the target with ground passes and crosses.',
  'drill.passing.prompt': 'Pass into the lit circle.',
  'drill.stat.scored': 'Scored',
  'drill.stat.attempts': 'Attempts',
  'drill.stat.gates': 'Gates',
  'drill.stat.hits': 'Hits',
  'drill.stat.time': 'Time',
  'drill.stat.best': 'Best',
  'drill.lap': 'Lap done in {time}s',
  'drill.reset': 'reset',

  // --- tutorial -------------------------------------------------------------
  'tutorial.title': 'TUTORIAL',
  'tutorial.step': 'Step {n} of {total}',
  'tutorial.skip': 'Skip',
  'tutorial.done.title': '¡LISTO!',
  'tutorial.done.sub': 'Go and win something.',
  'tutorial.move': 'Move with {keys}.',
  'tutorial.move.tip': 'The pitch always runs left to right, whichever side you are on.',
  'tutorial.sprint': 'Hold {keys} to sprint.',
  'tutorial.sprint.tip': 'Sprinting burns the AIR meter and you turn like a bus.',
  'tutorial.getball': 'Go and get the ball.',
  'tutorial.getball.tip': 'Run into it. Close control sticks it to your feet.',
  'tutorial.dribble': 'Carry the ball 12 metres.',
  'tutorial.dribble.tip': 'Sprinting with the ball pushes it further ahead of you.',
  'tutorial.pass': 'Play a pass with {keys}.',
  'tutorial.pass.tip': 'Hold it longer to drill it through the gap.',
  'tutorial.lob': 'Clip a lofted ball with {keys}.',
  'tutorial.lob.tip': 'Crosses beat a low block. Nothing on the ground gets through.',
  'tutorial.shoot': 'Have a shot with {keys}.',
  'tutorial.shoot.tip': 'The longer you hold, the harder and higher it goes.',
  'tutorial.score': 'Now put one in the net.',
  'tutorial.score.tip': 'Aim across the keeper into the far corner.',
  'tutorial.tackle': 'Win the ball back with {keys}.',
  'tutorial.tackle.tip': 'Standing still it is a shoulder charge; at a sprint it is a slide, and mistiming it is a free kick.',
  'tutorial.switch': 'Switch player with {keys}.',
  'tutorial.switch.tip': 'Defending is easier when you take over whoever is nearest the ball.',
} as const;

export type Key = keyof typeof en;

const es: Record<Key, string> = {
  'lang.name': 'Español',

  'menu.tagline': 'Cinco contra cinco. Sin árbitro que valga. 1988.',
  'menu.name': 'Tu nombre',
  'menu.name.ph': 'El Chino',
  'menu.room': 'Estadio (sala)',
  'menu.room.ph': 'estadio',
  'menu.team': 'Equipo',
  'menu.team.auto': 'Auto',
  'menu.length': 'Duración',
  'menu.size': 'Equipos',
  'menu.bots': 'Bots',
  'menu.bots.easy': 'Tranquilos',
  'menu.bots.normal': 'Normales',
  'menu.bots.hard': 'Sicarios',
  'menu.play': 'JUGAR',
  'menu.training': 'ENTRENAR',
  'menu.tutorial': 'TUTORIAL',
  'menu.settings': 'AJUSTES',
  'menu.note': 'Las camisetas vacías las llenan los bots, y las devuelven apenas llega alguien de carne y hueso.',
  'menu.credits': 'Fútbol arcade. Clubes ficticios, patrocinadores ficticios, todo ficticio. Caras de DiceBear “Personas” (Draftbit, CC BY 4.0).',
  'menu.discord': 'Todos en esta actividad de Discord caen a la misma cancha. Los bots completan el equipo.',
  'menu.min': '{n} min',
  'menu.vs': '{n} v {n}',
  'loading.connecting': 'CONECTANDO…',
  'loading.disconnected': 'DESCONECTADO — {reason}',

  'hud.stamina': 'AIRE',
  'hud.charge': 'FUERZA',
  'hud.chat.ph': 'Apretá {key} para hablar…',
  'hud.help.hint': 'Cambiá cualquiera de estos en Ajustes.',
  'phase.warmup': 'CALENTANDO',
  'phase.kickoff': 'SAQUE',
  'phase.play': 'EN JUEGO',
  'phase.goal': 'GOOOOL',
  'phase.freekick': 'TIRO LIBRE',
  'phase.fulltime': 'FINAL',
  'phase.training': 'ENTRENAMIENTO',
  'role.keeper': 'ARQUERO',
  'role.defender': 'DEFENSA',
  'role.midfielder': 'VOLANTE',
  'role.winger': 'EXTREMO',
  'role.striker': 'DELANTERO',

  'event.goal': '¡GOOOOL!',
  'event.fulltime': 'FINAL',
  'event.draw': 'EMPATE',
  'event.foul.toast': '¡FALTA!',
  'event.foul': 'falta de {name}',
  'event.save': '¡atajada!',
  'event.post': '¡al palo!',
  'event.someone': 'alguien',
  'event.muted': 'sonido apagado',
  'event.unmuted': 'sonido encendido',
  'notice.joined': '{name} entró a {team}',
  'notice.left': '{name} se fue',
  'notice.config': '{name} cambió la configuración',
  'notice.locked': 'partido en curso — configuración bloqueada',
  'notice.trainingBusy': 'el entrenamiento es en cancha privada',

  'powerup.speed.blurb': 'Todo se mueve más rápido. Vos sobre todo.',
  'powerup.power.blurb': 'Los remates dejan humo.',
  'powerup.strength.blurb': 'No te la saca nadie.',
  'powerup.vision.blurb': 'Los pases encuentran al hombre.',

  'settings.title': 'AJUSTES',
  'settings.language': 'Idioma',
  'settings.controls': 'Controles',
  'settings.audio': 'Sonido',
  'settings.volume': 'Volumen',
  'settings.art': 'Dibujo de los jugadores',
  'settings.art.off': 'Modelos',
  'settings.art.auto': 'Sprites a lo lejos',
  'settings.art.all': 'Sprites siempre',
  'settings.art.blurb':
    'Los jugadores se pueden dibujar con láminas de sprites pre-renderizadas de los mismos modelos, como hacían los juegos isométricos de antes. Las láminas se generan la primera vez que lo activás.',
  'settings.action': 'Acción',
  'settings.primary': 'Tecla',
  'settings.secondary': 'Alternativa',
  'settings.pad': 'Joystick',
  'settings.rebind': 'Hacé clic en una casilla y apretá la tecla, el botón del mouse o el del joystick que quieras. Esc la borra.',
  'settings.listening': 'apretá lo que sea…',
  'settings.reset': 'VALORES POR DEFECTO',
  'settings.close': 'CERRAR',
  'settings.leave': 'SALIR DE LA CANCHA',
  'settings.pad.none': 'No hay joystick. Enchufá uno y apretá un botón — los sticks mueven y apuntan, los menús van con la cruceta, A y B.',
  'settings.pad.found': '{name} — stick izquierdo mueve, derecho apunta. Los menús van con la cruceta, A y B.',
  'action.up': 'Mover arriba',
  'action.down': 'Mover abajo',
  'action.left': 'Mover izquierda',
  'action.right': 'Mover derecha',
  'action.sprint': 'Sprint',
  'action.pass': 'Pase (mantené para el pase filtrado)',
  'action.shoot': 'Remate (mantené para más fuerza y altura)',
  'action.lob': 'Pase alto / centro',
  'action.tackle': 'Quite (corriendo = barrida)',
  'action.switch': 'Cambiar al compañero más cercano',
  'action.chat': 'Chat',
  'action.help': 'Ver los controles',
  'action.settings': 'Ajustes',
  'action.mute': 'Silenciar',

  'training.title': 'ENTRENAMIENTO',
  'training.pick': 'Elegí un ejercicio. No mira nadie.',
  'training.start': 'EMPEZAR',
  'training.back': 'VOLVER',
  'training.leave': 'Salir del entrenamiento',
  'drill.free': 'Libre',
  'drill.free.blurb': 'Una cancha vacía, una pelota y un arquero para batir.',
  'drill.free.prompt': 'Dale nomás. Acá no se cuenta nada.',
  'drill.shooting': 'Remate',
  'drill.shooting.blurb': 'Batí al arquero desde todos los ángulos.',
  'drill.shooting.prompt': 'Metela desde la marca en el pasto.',
  'drill.dribble': 'Gambeta',
  'drill.dribble.blurb': 'Llevá la pelota por los conos con un marcador encima.',
  'drill.dribble.prompt': 'Pasá la pelota por las puertas, en orden.',
  'drill.passing': 'Pases',
  'drill.passing.blurb': 'Encontrá el objetivo con pases rasantes y centros.',
  'drill.passing.prompt': 'Pasala adentro del círculo encendido.',
  'drill.stat.scored': 'Goles',
  'drill.stat.attempts': 'Intentos',
  'drill.stat.gates': 'Puertas',
  'drill.stat.hits': 'Aciertos',
  'drill.stat.time': 'Tiempo',
  'drill.stat.best': 'Mejor',
  'drill.lap': 'Vuelta en {time}s',
  'drill.reset': 'reiniciar',

  'tutorial.title': 'TUTORIAL',
  'tutorial.step': 'Paso {n} de {total}',
  'tutorial.skip': 'Saltar',
  'tutorial.done.title': '¡LISTO!',
  'tutorial.done.sub': 'Andá a ganar algo.',
  'tutorial.move': 'Movete con {keys}.',
  'tutorial.move.tip': 'La cancha siempre va de izquierda a derecha, juegues donde juegues.',
  'tutorial.sprint': 'Mantené {keys} para correr.',
  'tutorial.sprint.tip': 'El sprint quema el AIRE y doblás como un colectivo.',
  'tutorial.getball': 'Andá a buscar la pelota.',
  'tutorial.getball.tip': 'Corré hacia ella. El control te la deja pegada al pie.',
  'tutorial.dribble': 'Llevá la pelota 12 metros.',
  'tutorial.dribble.tip': 'Si corrés con la pelota, la empujás más lejos.',
  'tutorial.pass': 'Tirá un pase con {keys}.',
  'tutorial.pass.tip': 'Mantenelo más tiempo para clavarlo entre líneas.',
  'tutorial.lob': 'Levantá una pelota con {keys}.',
  'tutorial.lob.tip': 'El centro rompe el bloque bajo. Por abajo no pasa nada.',
  'tutorial.shoot': 'Probá un remate con {keys}.',
  'tutorial.shoot.tip': 'Cuanto más lo mantenés, más fuerte y más alto sale.',
  'tutorial.score': 'Ahora metela adentro.',
  'tutorial.score.tip': 'Cruzala al segundo palo.',
  'tutorial.tackle': 'Recuperá la pelota con {keys}.',
  'tutorial.tackle.tip': 'Parado es un empujón de hombro; corriendo es barrida, y si llegás tarde es falta.',
  'tutorial.switch': 'Cambiá de jugador con {keys}.',
  'tutorial.switch.tip': 'Defender es más fácil si agarrás al que está más cerca de la pelota.',
};

const DICTS: Record<Lang, Record<Key, string>> = { en, es };
export const LANGS: Lang[] = ['en', 'es'];

function detect(): Lang {
  try {
    const saved = localStorage.getItem('nf.lang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // no storage, fall through to the browser's preference
  }
  return (navigator.language ?? 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
}

let lang: Lang = detect();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem('nf.lang', next);
  } catch {
    // not persisting is survivable
  }
  document.documentElement.lang = next;
  applyStatic();
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Look up a string, filling `{placeholders}` from `params`. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** Translate everything in the document tagged with a data-i18n attribute. */
export function applyStatic(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n as Key);
  }
  for (const node of root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) {
    node.placeholder = t(node.dataset.i18nPh as Key);
  }
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle as Key);
  }
}

document.documentElement.lang = lang;
