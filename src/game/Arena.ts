import { Math as PMath } from 'phaser';

/**
 * The stadium: its measurements, its furniture and the geometry needed to run
 * a top along a rail. Everything here is static - it describes the table, not
 * what is happening on it. The scene owns the physics response and the sound.
 */

export const VIEW_W = 1280;
export const VIEW_H = 960;

export const ARENA_X = 640;
export const ARENA_Y = 470;
export const ARENA_R = 400;

/** The floor is closed except for two mouths, north and south. */
export const GAP_ANGLES = [-Math.PI / 2, Math.PI / 2];
export const GAP_HALF = PMath.DegToRad(15);

// -- rails ----------------------------------------------------------------

export interface StraightRail
{
    kind: 'straight';
    start: PMath.Vector2;
    dir: PMath.Vector2;
    length: number;
}

export interface ArcRail
{
    kind: 'arc';
    center: PMath.Vector2;
    radius: number;
    /** Angle of the mouth, in radians. */
    from: number;
    /** Signed sweep: the sign is the direction a top is carried around. */
    sweep: number;
    length: number;
}

export type Rail = StraightRail | ArcRail;

export function straightRail (angle: number, inset: number, length: number): StraightRail
{
    return {
        kind: 'straight',
        start: new PMath.Vector2(
            ARENA_X + Math.cos(angle) * (ARENA_R - inset),
            ARENA_Y + Math.sin(angle) * (ARENA_R - inset)
        ),
        dir: new PMath.Vector2(-Math.cos(angle), -Math.sin(angle)),
        length
    };
}

export function arcRail (radius: number, from: number, sweep: number): ArcRail
{
    return {
        kind: 'arc',
        center: new PMath.Vector2(ARENA_X, ARENA_Y),
        radius,
        from,
        sweep,
        length: Math.abs(sweep) * radius
    };
}

/** Angle of an arc rail at `d` pixels along it. */
function arcAngleAt (rail: ArcRail, d: number): number
{
    return rail.from + Math.sign(rail.sweep) * (d / rail.radius);
}

/** Where a top sits when it is `d` pixels along the rail. */
export function railPoint (rail: Rail, d: number, out = new PMath.Vector2()): PMath.Vector2
{
    if (rail.kind === 'straight')
    {
        return out.set(rail.start.x + rail.dir.x * d, rail.start.y + rail.dir.y * d);
    }

    const a = arcAngleAt(rail, d);

    return out.set(
        rail.center.x + Math.cos(a) * rail.radius,
        rail.center.y + Math.sin(a) * rail.radius
    );
}

/** Unit vector of travel at `d` pixels along the rail. */
export function railTangent (rail: Rail, d: number, out = new PMath.Vector2()): PMath.Vector2
{
    if (rail.kind === 'straight')
    {
        return out.set(rail.dir.x, rail.dir.y);
    }

    const a = arcAngleAt(rail, d);
    const sign = Math.sign(rail.sweep);

    return out.set(-Math.sin(a) * sign, Math.cos(a) * sign);
}

/**
 * How far along the rail a point sits, and how far off the rail it is. `d` is
 * signed and unclamped so the mouth can be told apart from the far end - a
 * top drifting in from just behind the entry reads as slightly negative.
 */
export function railProject (rail: Rail, x: number, y: number): { d: number; dist: number }
{
    if (rail.kind === 'straight')
    {
        const relX = x - rail.start.x;
        const relY = y - rail.start.y;

        return {
            d: relX * rail.dir.x + relY * rail.dir.y,
            dist: Math.abs(relX * -rail.dir.y + relY * rail.dir.x)
        };
    }

    const dx = x - rail.center.x;
    const dy = y - rail.center.y;
    const angle = Math.atan2(dy, dx);
    const sign = Math.sign(rail.sweep);

    return {
        d: PMath.Angle.Wrap((angle - rail.from) * sign) * rail.radius,
        dist: Math.abs(Math.hypot(dx, dy) - rail.radius)
    };
}

/** The entry, pulled a little way in so the AI aims at the teeth. */
export function railMouth (rail: Rail, into = 18): PMath.Vector2
{
    return railPoint(rail, into);
}

// -- furniture ------------------------------------------------------------

/** A post that throws a top straight back out, pinball style. */
export interface Bumper
{
    x: number;
    y: number;
    radius: number;
    /** Fixed speed the top leaves with, on top of the bounce. */
    kick: number;
}

/** A pad that shoves anything standing on it in one fixed direction. */
export interface Pusher
{
    x: number;
    y: number;
    radius: number;
    dx: number;
    dy: number;
    /** Acceleration in px/s^2 while inside. */
    force: number;
}

/** Sludge: drags a top down to a crawl while it is in there. */
export interface SlowZone
{
    x: number;
    y: number;
    radius: number;
    /** Extra drag per second at the middle of the patch. */
    drag: number;
}

export interface ArenaLayout
{
    rails: Rail[];
    bumpers: Bumper[];
    pushers: Pusher[];
    slows: SlowZone[];
}

const D = PMath.DegToRad;

/**
 * The table. Two straight rails fire across the middle, two arcs sling a top
 * around the rim and spit it out sideways, six posts keep it bouncing, two
 * pads push a current around the floor, and two sludge patches punish anyone
 * who tries to sit still in a corner.
 */
export function buildArena (): ArenaLayout
{
    return {
        rails: [
            straightRail(0, 14, 250),
            straightRail(Math.PI, 14, 250),
            arcRail(282, D(196), D(62)),
            arcRail(282, D(16), D(62))
        ],
        bumpers: [
            { x: 640, y: 300, radius: 34, kick: 620 },
            { x: 505, y: 545, radius: 34, kick: 620 },
            { x: 775, y: 545, radius: 34, kick: 620 },
            { x: 640, y: 668, radius: 28, kick: 540 },
            { x: 470, y: 365, radius: 26, kick: 500 },
            { x: 810, y: 575, radius: 26, kick: 500 }
        ],
        pushers: [
            { x: 790, y: 210, radius: 58, dx: 0.866, dy: 0.5, force: 2300 },
            { x: 490, y: 730, radius: 58, dx: -0.866, dy: -0.5, force: 2300 }
        ],
        slows: [
            { x: 380, y: 620, radius: 92, drag: 7.5 },
            { x: 900, y: 320, radius: 92, drag: 7.5 }
        ]
    };
}

/** True inside one of the two ring-out mouths. */
export function isInGap (angle: number): boolean
{
    for (const gap of GAP_ANGLES)
    {
        if (Math.abs(PMath.Angle.Wrap(angle - gap)) < GAP_HALF) return true;
    }

    return false;
}
