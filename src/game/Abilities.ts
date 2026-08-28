import { Math as PMath } from 'phaser';

/**
 * The four things bound to 1-4. They cost nothing but time: no meter, no spin,
 * just a cooldown, so the floor is always about to have something on it.
 *
 * This file is the tuning sheet and the shape of what is in flight. The scene
 * runs them, because firing one needs the stadium, the sound and the camera.
 */

export type AbilityId = 'saw' | 'slash' | 'vortex' | 'repulse';

export interface AbilityDef
{
    id: AbilityId;
    /** Shown on the HUD pip. */
    label: string;
    cooldown: number;
    color: number;
}

/** Index in this array is the key: 0 is "1", 3 is "4". */
export const ABILITIES: AbilityDef[] = [
    { id: 'saw', label: 'SERRA', cooldown: 3.4, color: 0xffd166 },
    { id: 'slash', label: 'CORTE', cooldown: 4.2, color: 0xff7ad9 },
    { id: 'vortex', label: 'VORTICE', cooldown: 9, color: 0x9d7bff },
    { id: 'repulse', label: 'REPULSOR', cooldown: 6.5, color: 0x6dffc8 }
];

export const ABILITY_COUNT = ABILITIES.length;

// -- saw: a disc thrown along the way you are already going ---------------

export const SAW_SPEED = 820;
export const SAW_LIFE = 3.4;
export const SAW_RADIUS = 17;
export const SAW_DAMAGE = 8;
export const SAW_KNOCK = 780;
/** Ricochets off the wall and off posts before it gives up. */
export const SAW_BOUNCES = 5;

// -- slash: a short arc swung in front, all knockback -----------------------

export const SLASH_RANGE = 165;
export const SLASH_ARC = PMath.DegToRad(90);
export const SLASH_DAMAGE = 13;
export const SLASH_KNOCK = 1350;
export const SLASH_TUMBLE = 0.45;
export const SLASH_LIFE = 0.24;

// -- vortex: a well dropped on the floor that drags the other top in -------

export const VORTEX_LIFE = 3.2;
export const VORTEX_RADIUS = 170;
export const VORTEX_PULL = 1700;
/** Spin torn off per second while caught in it. */
export const VORTEX_DAMAGE = 4;

// -- repulse: a ring that shoves everything away, projectiles included -----

export const REPULSE_RADIUS = 240;
export const REPULSE_KNOCK = 1200;
export const REPULSE_DAMAGE = 5;
export const REPULSE_LIFE = 0.38;
/** Seconds of ignoring sludge after the ring goes off. */
export const REPULSE_FREE = 1.2;

/**
 * Something on the floor with a life of its own. Saws and vortices are
 * simulated and travel on the wire; slashes and rings are a flash and are
 * played from the cast message on the other browser.
 */
export interface Fx
{
    id: number;
    kind: AbilityId;
    /** 0 = the cyan top's, 1 = the red top's. */
    owner: 0 | 1;
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    bounces: number;
    /** Facing, for the slash arc and the saw's spin. */
    angle: number;
}

/** True for the kinds the host simulates and ships in the snapshot. */
export function isPersistent (kind: AbilityId): boolean
{
    return kind === 'saw' || kind === 'vortex';
}

export const KIND_ORDER: AbilityId[] = ['saw', 'slash', 'vortex', 'repulse'];
