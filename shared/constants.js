// Shared constants + helpers — works in Node (require) and browser (window.GAME)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GAME = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    TICK_HZ: 30,

    // rendering — canvas fills the window; camera follows the BALL; zoom from height
    VISIBLE_WORLD_H: 260,
    GROUND_FRAC: 0.82,
    MIN_VISIBLE_W: 540,

    // world (long side-on pitch, several screens)
    WORLD_W: 3200,
    GOAL_L: 26,
    GOAL_R: 3174,
    CROSSBAR_H: 150,
    GOAL_DEPTH: 30,

    GOAL_TARGET: 5,
    MAX_PER_SIDE: 2,

    // players (calmer keep-away pace)
    P_W: 18, P_H: 54,
    P_RADIUS: 13,
    P_SPEED: 150,
    P_ACCEL: 1200,
    GRAVITY: 1500,          // for the little header hop
    HOP_VH: 230,            // header pops the player up a touch

    // stances: 0 feet, 1 knee, 2 head — heights match where the ball meets the body
    STANCE_H: [9, 34, 66],
    STANCE_OFF: [14, 8, 2], // how far in front the strike zone sits
    STANCE_SETTLE: 1.8,     // a raised stance drifts back down after this long

    // ball — bounces die quickly, rolls stop fast (no scoring from half)
    B_RADIUS: 7,
    B_GRAVITY: 1350,
    B_RESTITUTION: 0.34,
    B_FRICTION: 2.7,
    B_AIRDRAG: 0.09,
    B_HMAX: 240,            // cap height so pops don't fly off forever

    // the juggle hit (Space). hold longer = more power (height + distance).
    CHARGE_MAX: 0.7,        // seconds to full charge
    HIT_RX: 30,             // horizontal reach of the strike zone
    HIT_RH: 18,             // vertical tolerance around the stance height
    HIT_CD: 0.22,           // min time between hits
    WHIFF_CD: 0.3,          // recovery after a mistimed swing
    HIT_UP_MIN: 250, HIT_UP_MAX: 470,    // upward launch (tap..charged)
    HIT_FWD_MIN: 35, HIT_FWD_MAX: 290,   // forward launch (tap..charged)
    DEAD_VX: 22,            // below this horizontal speed a grounded ball is "dead"

    // states the client renders
    S_IDLE: 'idle', S_RUN: 'run', S_AIR: 'air',
    S_KICK: 'kick', S_KNEE: 'knee', S_HEAD: 'head', S_WHIFF: 'whiff',
  };

  C.attackDir = (team) => (team === 0 ? 1 : -1);
  C.targetGoalX = (team) => (team === 0 ? C.GOAL_R : C.GOAL_L);
  C.ownGoalX = (team) => (team === 0 ? C.GOAL_L : C.GOAL_R);
  // stance whose height best matches a ball height h
  C.nearestStance = (h) => {
    let bi = 0, bd = 1e9;
    for (let i = 0; i < 3; i++) { const d = Math.abs(h - C.STANCE_H[i]); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };

  return C;
});
