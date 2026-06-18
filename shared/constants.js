// Shared constants + helpers — works in Node (require) and browser (window.GAME)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GAME = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    // loop / net
    TICK_HZ: 30,

    // rendering — the client canvas fills the window; the camera follows the BALL.
    // Zoom is derived so ~VISIBLE_WORLD_H world-units of height are on screen,
    // which makes the players nice and chunky.
    VISIBLE_WORLD_H: 300,
    GROUND_FRAC: 0.82,     // pitch surface as a fraction of canvas height
    MIN_VISIBLE_W: 560,    // never zoom in so far we see less than this much pitch width

    // world (a long side-on pitch — several screens wide)
    WORLD_W: 3600,
    GOAL_L: 26,            // left goal line x  (team 1 attacks here)
    GOAL_R: 3574,          // right goal line x (team 0 attacks here)
    CROSSBAR_H: 170,       // ball must be below this height to be a goal
    GOAL_DEPTH: 30,        // visual net depth

    // match
    GOAL_TARGET: 5,        // first to this many goals wins

    // teams
    MAX_PER_SIDE: 2,       // up to 2v2

    // players
    P_W: 18, P_H: 54,      // body box (for collisions / hitboxes)
    P_RADIUS: 13,          // horizontal half-width for overlap
    P_SPEED: 205,
    P_ACCEL: 1800,
    JUMP_VH: 560,
    GRAVITY: 1550,

    // stances (ball height when you control it): 0 feet, 1 knee, 2 head
    // heights are tuned to where the ball actually meets the body in the renderer
    STANCE_H: [9, 34, 66],  // gaps 25 / 32 — must stay larger than HMATCH+JUGGLE_BOB
    STANCE_OFF: [16, 9, 2], // how far in front of the body the ball sits, per stance
    STANCE_SETTLE: 1.4,    // a raised stance drops a level after this long untouched
    JUGGLE_BOB: 4,         // bob amplitude while juggling

    // ball
    B_RADIUS: 7,
    B_GRAVITY: 1550,
    B_RESTITUTION: 0.58,
    B_FRICTION: 1.4,       // ground roll damping /s
    B_AIRDRAG: 0.12,
    COLLECT_R: 26,         // horizontal pickup range for a loose ball
    COLLECT_VMAX: 470,     // can't trap a screamer
    KICK_IMMUNITY: 0.18,

    // shots by stance (forward vx, upward vh)
    SHOT_LOW_VX: 520, SHOT_LOW_VH: 60,
    SHOT_MID_VX: 430, SHOT_MID_VH: 360,
    SHOT_HIGH_VX: 360, SHOT_HIGH_VH: 470,

    // bicycle (desperate forward smash)
    BIKE_VX: 600, BIKE_VH: 150, BIKE_JUMP: 360,

    // contests (winning the ball) — must match the ball's stance to win a controlled ball
    SLIDE_VX: 360, SLIDE_TIME: 0.5, SLIDE_REACH: 34,
    BLOCK_TIME: 0.34, BLOCK_REACH: 24,
    FLY_VX: 300, FLY_VH: 300, FLY_TIME: 0.46, FLY_REACH: 30,
    HEAD_VH: 360, HEAD_TIME: 0.42, HEAD_REACH: 26,
    HMATCH: 18,            // vertical tolerance to "connect"; with bob 4 the effective gap
                           // to an adjacent stance is 25-4=21 > 18, so wrong-height whiffs
    STUN_TIME: 0.85,       // knocked-down duration

    // states (locomotion + action) the client renders
    S_IDLE: 'idle', S_RUN: 'run', S_AIR: 'air',
    S_DRIBBLE: 'dribble', S_KNEE: 'jknee', S_HEAD: 'jhead',
    S_SHOOT: 'shoot', S_VOLLEY: 'volley', S_HEADER: 'header',
    S_SLIDE: 'slide', S_BLOCK: 'block', S_FLY: 'flykick', S_BIKE: 'bicycle',
    S_DOWN: 'down',
  };

  C.attackDir = (team) => (team === 0 ? 1 : -1);
  C.targetGoalX = (team) => (team === 0 ? C.GOAL_R : C.GOAL_L);
  C.ownGoalX = (team) => (team === 0 ? C.GOAL_L : C.GOAL_R);

  return C;
});
