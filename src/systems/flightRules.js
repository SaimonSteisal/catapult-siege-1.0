// ============================================================================
//  systems/flightRules.js — ЕДИНЫЙ источник правды поведения снаряда (plan
//  PLAN_AIMING_FLIGHT.md §2). Эти правила читают и боевой _onHit, и predictFull,
//  поэтому дуга и фактический полёт расходятся только в случайном спреде.
// ============================================================================
import { CFG } from '../config.js';

export function rulesFor(ammoId, flags = {}) {
  const a = CFG.ammo[ammoId] || CFG.ammo.stone;
  // зеркало ballistics._detonate: radiusBonus → stoneRain
  let R = (a.radius || 0);
  if (R > 0 && flags.demolitionist) R *= 1.3;
  if (ammoId === 'grapeshot' && flags.stoneRain) R = Math.max(R, 5.6);
  return {
    terrainDetonate: R > 0,                    // взрывные рвут и о землю (B3)
    fuseSec: a.fuse || 0,                      // взрыватель в игровом времени (B2)
    fuseVelMul: 0.35,                          // зеркало боевого vel*0.35
    fuseDrop: 6,                               // зеркало боевого vel.y -= 6
    pierce: a.pierce ? { max: 3, velMul: 0.62 } : null,
    bounce: (a.restitution || 0) >= 0.15 ? { e: a.restitution, friction: 0.5 } : null,
    blastRadius: R,
    bounceShow: (CFG.aim.bounceShow || []).includes(ammoId) || !!flags.ricochetPredict,
  };
}
