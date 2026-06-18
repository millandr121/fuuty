// Shared constants + tiny helpers, usable from both Node (require) and browser (script tag -> window.GAME)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GAME = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    // Network / loop
    TICK_HZ: 30,
    SNAPSHOT_HZ: 30,

    // Field
    FIELD_W: 960,
    FIELD_H: 600,
    WALL: 8,            // inner border padding for play area
    GOAL_H: 180,        // goal mouth height
    CROSSBAR_Z: 80,     // ball must be below this to count as a goal
    BLOCK: 48,          // checker block size for the grass pattern

    // Teams
    TEAM_SIZE: 3,       // players per side (humans + NPCs)
    MATCH_SECONDS: 360, // 6 minute timer

    // Players
    P_RADIUS: 13,
    P_SPEED: 178,
    P_ACCEL: 1400,

    // Ball
    B_RADIUS: 7,
    GRAVITY: 1250,
    GROUND_RESTITUTION: 0.55,
    GROUND_FRICTION: 1.6,   // per second velocity damping while rolling
    AIR_DRAG: 0.15,

    // Possession
    COLLECT_RADIUS: 24,
    COLLECT_HEIGHT: 42,
    DRIBBLE_AHEAD: 18,

    // Juggling
    JUGGLE_LOW: 26,
    JUGGLE_HIGH: 72,
    JUGGLE_BOUNCE_VZ: 430,

    // Actions
    SHOOT_SPEED: 470,
    SHOOT_LIFT: 120,
    JUGGLE_PASS_VZ: 440,
    JUGGLE_PASS_FWD: 175,
    BICYCLE_JUMP_VZ: 470,
    BICYCLE_SHOT_SPEED: 560,
    BICYCLE_SHOT_DOWN: -170,

    SLIDE_SPEED: 365,
    SLIDE_TIME: 0.55,
    SLIDE_REACH: 30,

    BODY_JUMP_VZ: 250,
    BODY_FWD: 210,
    BODY_TIME: 0.34,
    BODY_REACH: 24,

    STUN_TIME: 0.85,     // how long a tackled player is "down"
    KICK_IMMUNITY: 0.18, // after kicking, you can't instantly recollect

    // States (string enums)
    S_IDLE: 'idle', S_RUN: 'run', S_JUGGLE: 'juggle', S_SHOOT: 'shoot',
    S_SLIDE: 'slide', S_BODY: 'body', S_BICYCLE: 'bicycle', S_DOWN: 'down',
  };

  // derived
  C.GOAL_TOP = (C.FIELD_H - C.GOAL_H) / 2;
  C.GOAL_BOT = (C.FIELD_H + C.GOAL_H) / 2;

  return C;
});
