/**
 * Tuning constants for Narco Futbol.
 *
 * Units are metres / seconds / radians. The pitch lies in the XZ plane with
 * Y up (Three.js convention). Team 0 defends -X and attacks +X, team 1 the
 * mirror. Everything here is shared by the authoritative server sim and the
 * client-side prediction, so the two never disagree about the rules.
 */

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_INTERVAL_TICKS = Math.round(TICK_RATE / SNAPSHOT_RATE);

// --- Pitch ------------------------------------------------------------------
// Deliberately smaller than a real pitch: arcade football wants everyone within
// a few seconds of the ball.
export const PITCH_LENGTH = 80;
export const PITCH_WIDTH = 52;
export const HALF_LENGTH = PITCH_LENGTH / 2;
export const HALF_WIDTH = PITCH_WIDTH / 2;

export const GOAL_WIDTH = 11;
export const GOAL_HALF_WIDTH = GOAL_WIDTH / 2;
export const GOAL_HEIGHT = 3.4;
export const GOAL_DEPTH = 3;
export const POST_RADIUS = 0.12;

// Penalty box, used by the keeper AI and for free-kick placement.
export const BOX_LENGTH = 14;
export const BOX_HALF_WIDTH = 18;
export const CENTER_CIRCLE_RADIUS = 8;

// Sidelines and goal lines are walls - no throw-ins in this league.
export const WALL_RESTITUTION = 0.62;
export const WALL_HEIGHT = 6;

// --- Ball -------------------------------------------------------------------
export const BALL_RADIUS = 0.34; // slightly oversized, reads better at distance
export const BALL_MASS = 0.43;
export const GRAVITY = 16.5; // punchier than 9.81 so lobs come down fast
export const BALL_DRAG = 0.0125; // quadratic air drag coefficient (per m/s^2)
export const BALL_MAGNUS = 0.0058; // curve strength: a = k * (spin x vel)
export const BALL_RESTITUTION = 0.56;
export const BALL_GROUND_FRICTION = 0.34; // sliding friction on the turf
export const BALL_ROLL_DECEL = 0.62; // rolling resistance (m/s^2)
export const BALL_SPIN_DECAY = 0.85; // per second, multiplicative
export const BALL_MAX_SPEED = 42;

// --- Players ----------------------------------------------------------------
export const PLAYER_RADIUS = 0.55;
export const PLAYER_HEIGHT = 1.85;
export const PLAYER_MASS = 78;

export const RUN_SPEED = 7.4;
export const SPRINT_SPEED = 10.6;
export const DRIBBLE_SPEED_PENALTY = 0.9; // multiplier while carrying the ball
export const PLAYER_ACCEL = 34;
export const PLAYER_DECEL = 28;
export const PLAYER_TURN_RATE = 13; // rad/s toward movement direction

export const STAMINA_MAX = 1;
export const STAMINA_SPRINT_DRAIN = 0.085; // per second
export const STAMINA_RECOVER = 0.055; // per second when not sprinting
export const STAMINA_TIRED_THRESHOLD = 0.2;

// --- Ball control -----------------------------------------------------------
export const CONTROL_RADIUS = 1.55; // inside this you can touch the ball
export const CONTROL_HEIGHT = 1.5; // ball must be below this to be dribbled
export const DRIBBLE_LEAD = 1.05; // how far ahead of the feet the ball sits
export const DRIBBLE_GAIN = 12; // how hard the ball is pulled to the lead point
export const DRIBBLE_SPRINT_LEAD = 2.1; // heavier touches at full sprint
export const TOUCH_COOLDOWN = 0.24; // after kicking you cannot re-touch instantly
export const SHIELD_ANGLE = 1.9; // rad; back-to-goal shielding arc

// --- Kicking ----------------------------------------------------------------
export const PASS_SPEED_MIN = 12;
export const PASS_SPEED_MAX = 27;
export const PASS_CHARGE_TIME = 0.7; // seconds to fully charge a pass
export const THROUGH_PASS_LEAD = 7.5; // metres of lead on a fully charged pass

export const SHOT_SPEED_MIN = 19;
export const SHOT_SPEED_MAX = 38;
export const SHOT_CHARGE_TIME = 0.85;
export const SHOT_LIFT_MAX = 0.4; // vertical fraction at full charge
export const SHOT_AIM_ASSIST = 0.45; // blend toward the goal mouth

export const LOB_SPEED_MIN = 13;
export const LOB_SPEED_MAX = 26;
export const LOB_CHARGE_TIME = 0.65;
export const LOB_ANGLE = 0.62; // rad launch angle

export const KICK_ANIM_TIME = 0.22;

// --- Tackling ---------------------------------------------------------------
export const TACKLE_RANGE = 2.0;
export const TACKLE_COOLDOWN = 0.75;
export const SHOULDER_IMPULSE = 7.5;
export const SLIDE_SPEED = 12.5;
export const SLIDE_DURATION = 0.62;
export const SLIDE_RECOVERY = 0.75;
export const SLIDE_RANGE = 2.3;
export const STUN_TIME = 0.55;
export const FOUL_CHANCE_FROM_BEHIND = 0.75;

// --- Power-ups --------------------------------------------------------------
export const POWERUP_RADIUS = 1.3;
export const POWERUP_DURATION = 12;
export const POWERUP_SPAWN_INTERVAL = 11;
export const POWERUP_MAX_ACTIVE = 2;
export const POWERUP_RESPAWN_DELAY = 15;

// --- Match ------------------------------------------------------------------
export const DEFAULT_MATCH_SECONDS = 300;
export const DEFAULT_TEAM_SIZE = 5; // includes the keeper
export const MIN_TEAM_SIZE = 2;
export const MAX_TEAM_SIZE = 6;
export const KICKOFF_DELAY = 2.0;
export const GOAL_CELEBRATION = 3.6;
export const FREE_KICK_DELAY = 1.6;
export const FREE_KICK_WALL_DISTANCE = 5;
export const FULLTIME_LINGER = 14;

export const TEAM_COUNT = 2;

/** Team identity. The names are flavour; the sim only cares about 0 and 1. */
export const TEAM_INFO = [
  {
    id: 0,
    name: 'Cartel de Medallo',
    short: 'MED',
    primary: 0xe8443a,
    secondary: 0x2b1a17,
    accent: 0xffd34d,
  },
  {
    id: 1,
    name: 'Los Verdes de Cali',
    short: 'CAL',
    primary: 0x2fbf71,
    secondary: 0x14261d,
    accent: 0xf2f2f2,
  },
] as const;
