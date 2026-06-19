// Shared constants + helpers — works in Node (require) and browser (window.GAME)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GAME = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    TICK_HZ: 30,
    BUILD: 'keep-up v7',   // shown on the menu so you can confirm you have the latest

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
    P_SPEED: 132,
    P_ACCEL: 1050,
    GRAVITY: 1500,          // for the little header hop
    HOP_VH: 230,            // header pops the player up a touch

    // stances: 0 feet, 1 knee, 2 head — heights match where the ball meets the body
    STANCE_H: [9, 34, 66],
    STANCE_OFF: [14, 8, 2], // how far in front the strike zone sits
    STANCE_SETTLE: 1.8,     // a raised stance drifts back down after this long

    // ball — bounces die quickly, rolls stop fast, stays low (no scoring from half,
    // and juggling keeps it close to you rather than flying away)
    B_RADIUS: 7,
    B_GRAVITY: 820,         // very floaty: slow fall, lots of hang time to switch stance
    B_RESTITUTION: 0.32,
    B_FRICTION: 3.0,
    B_AIRDRAG: 0.08,
    B_HMAX: 150,            // cap height so pops stay readable

    // the juggle hit (Space). hold longer = more power (height + distance).
    CHARGE_MAX: 0.7,        // seconds to full charge
    HIT_RX: 36,             // horizontal reach of the strike zone
    HIT_RH: 26,             // vertical cap (the stance must also match the ball's height band)
    HIT_CD: 0.2,            // min time between hits
    WHIFF_CD: 0.24,         // recovery after a mistimed swing
    HIT_UP_MIN: 230, HIT_UP_MAX: 430,    // upward launch (tap..charged)
    HIT_FWD_MIN: 80, HIT_FWD_MAX: 240,   // forward launch — diagonal so the ball runs with you
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
