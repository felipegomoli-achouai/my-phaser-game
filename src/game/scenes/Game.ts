import { Scene, Math as PMath, GameObjects, Input, Types } from 'phaser';
import { EventBus } from '../EventBus';
import { Bey } from '../Bey';
import { sfx } from '../Sfx';

const ARENA_X = 512;
const ARENA_Y = 384;
const ARENA_R = 320;

/** The stadium is closed except for two mouths, north and south. */
const GAP_ANGLES = [-Math.PI / 2, Math.PI / 2];
const GAP_HALF = PMath.DegToRad(21);

/** Side rails: the tip meshes with the teeth and gets slung at the middle. */
const RAIL_LENGTH = 215;
const RAIL_MOUTH = 78;
const RAIL_CAPTURE_WIDTH = 32;
const RAIL_TOP_SPEED = 1320;
const RAIL_ACCEL = 3400;
const RAIL_BOOST_TIME = 0.85;
const RAIL_BOOST_DAMAGE = 2.3;

/** The mouths have a low lip: only a real shove clears it. */
const GAP_ESCAPE_SPEED = 320;

/** Special attack tuning. */
const CHARGE_TIME = 1.25;
const SPECIAL_TIME = 0.85;
const SPECIAL_SPEED = 1650;
const SPECIAL_DAMAGE_MULT = 3.2;

/** Debug: player starts with the special meter already full. */
const DEBUG_FULL_METER = true;

type Phase = 'countdown' | 'battle' | 'charging' | 'special' | 'over';

/** A straight toothed rail running from the wall to the middle of the floor. */
interface Rail
{
    start: PMath.Vector2;
    dir: PMath.Vector2;
    length: number;
}

export class Game extends Scene
{
    private player: Bey;
    private enemy: Bey;

    private hud: GameObjects.Graphics;
    private aura: GameObjects.Graphics;
    private speedLines: GameObjects.Graphics;
    private darkness: GameObjects.Rectangle;
    private centerText: GameObjects.Text;
    private specialText: GameObjects.Text;
    private hintText: GameObjects.Text;
    private sparks: GameObjects.Particles.ParticleEmitter;

    private cursors: Types.Input.Keyboard.CursorKeys;
    private keys: Record<string, Input.Keyboard.Key>;

    private phase: Phase = 'countdown';
    private countdown = 3;
    private aiThink = 0;
    private aiAggressive = true;

    /** Special attack state. */
    private charger: Bey | null = null;
    private chargeTimer = 0;
    private chargeDir = new PMath.Vector2(1, 0);
    private orbitTimer = 0;
    private ghostTimer = 0;
    private hitStop = 0;
    /** When the last special connected, so a follow-up ring out counts as its kill. */
    private specialImpactTime = -9999;
    private shattered = new Set<Bey>();

    /** Rail state. */
    private rails: Rail[] = [];
    private rides = new Map<Bey, { rail: Rail; progress: number; speed: number }>();
    private railGlow: GameObjects.Graphics;
    private railTrail = 0;
    private aiUseRail = false;
    private lastBeep = 4;

    constructor ()
    {
        super('Game');
    }

    create ()
    {
        this.phase = 'countdown';
        this.countdown = 3;
        this.charger = null;
        this.hitStop = 0;
        this.lastBeep = 4;
        this.specialImpactTime = -9999;
        this.shattered = new Set<Bey>();
        this.rides = new Map();
        this.rails = this.buildRails();

        sfx.stopAll();

        this.cameras.main.setZoom(1);
        this.cameras.main.centerOn(ARENA_X, ARENA_Y);

        Bey.makeTextures(this, 'player', 0x2ee6ff, 0x0b4b6b);
        Bey.makeTextures(this, 'enemy', 0xff4d5a, 0x6b0b1c);

        this.drawArena();

        this.player = new Bey(this, {
            name: 'player',
            color: 0x2ee6ff,
            accent: 0x0b4b6b,
            x: ARENA_X - 150,
            y: ARENA_Y,
            spinDir: 1,
            accel: 1350,
            maxSpeed: 790
        });

        this.enemy = new Bey(this, {
            name: 'enemy',
            color: 0xff4d5a,
            accent: 0x6b0b1c,
            x: ARENA_X + 150,
            y: ARENA_Y,
            spinDir: -1,
            accel: 1260,
            maxSpeed: 760
        });

        this.sparks = this.add.particles(0, 0, 'spark', {
            speed: { min: 80, max: 320 },
            lifespan: { min: 180, max: 420 },
            scale: { start: 0.9, end: 0 },
            tint: [0xffffff, 0xffe066, 0xff9a3c],
            blendMode: 'ADD',
            emitting: false
        });
        this.sparks.setDepth(50);

        // Cinematic dimmer: sits above the arena, below the charging bey.
        // Oversized so the zoom-in never reveals its edges.
        this.darkness = this.add.rectangle(ARENA_X, ARENA_Y, 2400, 1800, 0x000000)
            .setAlpha(0)
            .setDepth(20);

        this.railGlow = this.add.graphics().setDepth(2);
        this.speedLines = this.add.graphics().setDepth(12);
        this.aura = this.add.graphics().setDepth(55);
        this.hud = this.add.graphics().setDepth(100);

        this.centerText = this.add.text(ARENA_X, ARENA_Y - 40, '', {
            fontFamily: 'Arial Black', fontSize: 64, color: '#ffffff',
            stroke: '#000000', strokeThickness: 8, align: 'center'
        }).setOrigin(0.5).setDepth(102);

        this.specialText = this.add.text(ARENA_X, 190, '', {
            fontFamily: 'Arial Black', fontSize: 54, color: '#ffffff',
            stroke: '#000000', strokeThickness: 10, align: 'center'
        }).setOrigin(0.5).setDepth(70).setAlpha(0);

        this.hintText = this.add.text(ARENA_X, 740,
            'WASD: mover   ESPACO: investida   SHIFT: especial   |   trilhos nas laterais aceleram, buracos ao norte e sul eliminam', {
            fontFamily: 'Arial', fontSize: 18, color: '#9fd8ff'
        }).setOrigin(0.5).setDepth(101);

        const keyboard = this.input.keyboard!;
        this.cursors = keyboard.createCursorKeys();
        this.keys = keyboard.addKeys('W,A,S,D,SPACE,SHIFT,R,M') as Record<string, Input.Keyboard.Key>;

        keyboard.on('keydown-R', () => this.scene.restart());
        keyboard.on('keydown-M', () =>
        {
            EventBus.emit('audio-muted', sfx.toggleMute());
        });

        // Browsers only allow audio after a real interaction.
        keyboard.on('keydown', () => sfx.unlock());
        this.input.on('pointerdown', () => sfx.unlock());

        this.events.once('shutdown', () => sfx.stopAll());

        if (DEBUG_FULL_METER)
        {
            this.player.meter = 100;
        }

        EventBus.emit('current-scene-ready', this);
    }

    update (_time: number, delta: number)
    {
        const dt = Math.min(delta / 1000, 1 / 30);

        // Impact freeze-frame: everything holds still for a few milliseconds.
        if (this.hitStop > 0)
        {
            this.hitStop -= dt;
            return;
        }

        if (this.phase === 'countdown')
        {
            this.updateCountdown(dt);
            return;
        }

        if (this.phase === 'charging')
        {
            this.updateCharge(dt);
            this.drawHud();
            return;
        }

        if (this.phase === 'battle' || this.phase === 'special')
        {
            this.handleInput(dt);
            this.updateAI(dt);

            // Meter fills over time; the AI charges a touch slower.
            this.player.gainMeter(6 * dt);
            this.enemy.gainMeter(5 * dt);

            // The drone tracks the liveliest top on the floor.
            sfx.updateDrone(
                Math.max(this.player.spinRatio, this.enemy.spinRatio),
                Math.min(1, Math.max(this.player.speed, this.enemy.speed) / 700)
            );
        }

        this.player.update(dt);
        this.enemy.update(dt);

        this.updateRails(dt);

        this.collideWithWall(this.player);
        this.collideWithWall(this.enemy);
        this.collideBeys();

        if (this.phase === 'special')
        {
            this.updateSpecialDash(dt);
        }

        this.drawRailGlow();
        this.drawHud();

        if ((this.phase === 'battle' || this.phase === 'special')
            && (!this.player.alive || !this.enemy.alive))
        {
            this.finish();
        }
    }

    private updateCountdown (dt: number): void
    {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown);
        this.centerText.setText(n > 0 ? String(n) : 'LET IT RIP!');

        if (n < this.lastBeep)
        {
            this.lastBeep = n;
            sfx.countdown(n <= 0);
        }

        if (this.countdown <= -0.6)
        {
            this.phase = 'battle';
            sfx.startDrone();
            this.centerText.setText('');
            // Both tops get shot into the arena.
            // Launched sideways, towards the rails, not at the open mouths.
            this.player.vel.set(340, -70);
            this.enemy.vel.set(-340, 70);
        }

        this.player.update(dt * 0.15);
        this.enemy.update(dt * 0.15);
        this.drawHud();
    }

    // -- input ------------------------------------------------------------

    private handleInput (dt: number): void
    {
        let dx = 0;
        let dy = 0;

        if (this.cursors.left.isDown || this.keys.A.isDown) dx -= 1;
        if (this.cursors.right.isDown || this.keys.D.isDown) dx += 1;
        if (this.cursors.up.isDown || this.keys.W.isDown) dy -= 1;
        if (this.cursors.down.isDown || this.keys.S.isDown) dy += 1;

        this.player.steer(dx, dy, dt);

        if (Input.Keyboard.JustDown(this.keys.SPACE))
        {
            // Dash follows the stick, or lunges at the opponent when idle.
            const useAim = dx !== 0 || dy !== 0;
            const ax = useAim ? dx : this.enemy.pos.x - this.player.pos.x;
            const ay = useAim ? dy : this.enemy.pos.y - this.player.pos.y;

            if (this.player.dash(ax, ay))
            {
                this.sparks.emitParticleAt(this.player.pos.x, this.player.pos.y, 6);
                sfx.dash();
            }
        }

        if (Input.Keyboard.JustDown(this.keys.SHIFT)
            && this.phase === 'battle'
            && this.player.specialReady)
        {
            this.startSpecial(this.player, this.enemy);
        }
    }

    // -- opponent ---------------------------------------------------------

    private updateAI (dt: number): void
    {
        const ai = this.enemy;
        const p = this.player;

        if (!ai.alive || !p.alive) return;

        this.aiThink -= dt;
        if (this.aiThink <= 0)
        {
            this.aiThink = PMath.FloatBetween(0.2, 0.45);
            // Attack while it has the stamina edge, otherwise stall and survive.
            this.aiAggressive = ai.spin >= p.spin - 6;
            // From far away a rail run hits harder than driving straight in.
            this.aiUseRail = Math.random() < 0.55;
        }

        // Lead the target a little so it does not chase the tail.
        const aimX = p.pos.x + p.vel.x * 0.22;
        const aimY = p.pos.y + p.vel.y * 0.22;
        let dx = aimX - ai.pos.x;
        let dy = aimY - ai.pos.y;
        const dist = Math.hypot(dx, dy) || 1;
        dx /= dist;
        dy /= dist;

        // Go fetch a rail and come back in swinging.
        if (this.aiUseRail && !ai.onRail && ai.boost <= 0 && ai.railCooldown <= 0 && dist > 190)
        {
            const mouth = this.nearestRailMouth(ai.pos);
            ai.steer(mouth.x - ai.pos.x, mouth.y - ai.pos.y, dt);
            return;
        }

        // Full meter: line up and unload the special.
        if (this.phase === 'battle' && ai.specialReady && dist > 90 && Math.random() < 0.035)
        {
            this.startSpecial(ai, p);
            return;
        }

        if (!this.aiAggressive)
        {
            // Orbit the centre: perpendicular to the player direction, biased away.
            const px = -dy;
            const py = dx;
            const flee = dist < 220 ? 1 : 0.3;
            dx = px - dx * flee;
            dy = py - dy * flee;
        }

        // Steer back inside before it rides the wall out.
        const cx = ai.pos.x - ARENA_X;
        const cy = ai.pos.y - ARENA_Y;
        const fromCenter = Math.hypot(cx, cy);
        if (fromCenter > ARENA_R * 0.7)
        {
            // Push harder when the drift is towards one of the open mouths.
            const danger = this.isInGap(Math.atan2(cy, cx)) ? 3.2 : 1.6;
            const w = (fromCenter - ARENA_R * 0.7) / (ARENA_R * 0.3);
            dx -= (cx / fromCenter) * w * danger;
            dy -= (cy / fromCenter) * w * danger;
        }

        ai.steer(dx, dy, dt);

        if (this.aiAggressive && dist < 170 && ai.dashCooldown <= 0 && Math.random() < 0.05)
        {
            if (ai.dash(p.pos.x - ai.pos.x, p.pos.y - ai.pos.y))
            {
                this.sparks.emitParticleAt(ai.pos.x, ai.pos.y, 6);
                sfx.dash();
            }
        }
    }

    // -- special attack ---------------------------------------------------

    /** Freezes the match and starts the wind-up cinematic. */
    private startSpecial (bey: Bey, target: Bey): void
    {
        this.phase = 'charging';
        this.charger = bey;
        this.chargeTimer = 0;
        this.orbitTimer = 0;

        // Direction is locked at the start of the charge, with a bit of lead.
        this.chargeDir.set(
            target.pos.x + target.vel.x * 0.12 - bey.pos.x,
            target.pos.y + target.vel.y * 0.12 - bey.pos.y
        ).normalize();

        this.player.frozen = true;
        this.enemy.frozen = true;
        this.player.vel.set(0, 0);
        this.enemy.vel.set(0, 0);

        // Lift the charging bey above the dimmer so it stays lit.
        bey.setDepth(60);

        const isPlayer = bey === this.player;
        this.specialText
            .setText(isPlayer ? 'TURBO STRIKE' : 'CRIMSON FANG')
            .setColor(isPlayer ? '#2ee6ff' : '#ff4d5a')
            .setAlpha(0)
            .setScale(1.6);

        this.cameras.main.shake(CHARGE_TIME * 1000, 0.004);
        sfx.chargeUp(CHARGE_TIME);
    }

    private updateCharge (dt: number): void
    {
        const bey = this.charger!;
        this.chargeTimer += dt;

        const t = PMath.Clamp(this.chargeTimer / CHARGE_TIME, 0, 1);
        const ease = t * t;

        // Screen dims fast, camera pushes in on the charging bey.
        this.darkness.setAlpha(0.85 * Math.min(1, Math.sqrt(t) * 1.35));

        const zoom = 1 + 0.18 * ease;
        this.cameras.main.setZoom(zoom);
        this.cameras.main.centerOn(
            PMath.Linear(ARENA_X, bey.pos.x, 0.55 * ease),
            PMath.Linear(ARENA_Y, bey.pos.y, 0.55 * ease)
        );

        // Furious spin + rattle that grow with the charge.
        bey.spinBoost = 16 * ease;
        bey.shakeAmp = 5 * ease;

        this.specialText.setAlpha(Math.min(1, t * 2));
        this.specialText.setScale(PMath.Linear(1.6, 1, Math.min(1, t * 1.6)));

        this.drawChargeAura(bey, t);
        this.spawnChargeParticles(bey, dt, t);

        if (t >= 1)
        {
            this.fireSpecial(bey);
        }
    }

    /** Rings of energy collapsing onto the bey. */
    private drawChargeAura (bey: Bey, t: number): void
    {
        const g = this.aura;
        g.clear();

        this.orbitTimer += 0.05;

        for (let i = 0; i < 3; i++)
        {
            // Each ring collapses on its own offset loop.
            const phase = (t * 2.2 + i / 3) % 1;
            const r = PMath.Linear(230, bey.radius + 6, phase);
            const alpha = (1 - phase) * 0.9 * t;

            g.lineStyle(4 - i, bey.color, alpha);
            g.strokeCircle(bey.pos.x, bey.pos.y, r);
        }

        // Tight glowing halo that swells as the charge peaks.
        g.lineStyle(3 + t * 6, bey.color, 0.35 + 0.45 * t);
        g.strokeCircle(bey.pos.x, bey.pos.y, bey.radius + 10 + Math.sin(this.orbitTimer * 6) * 4 * t);

        // Ground crackle: short spokes flicking outwards.
        g.lineStyle(2, 0xffffff, 0.5 * t);
        for (let i = 0; i < 10; i++)
        {
            const a = this.orbitTimer * 0.6 + (i / 10) * Math.PI * 2;
            const r0 = bey.radius + 14 + Math.random() * 20 * t;
            const r1 = r0 + 12 + Math.random() * 40 * t;
            g.lineBetween(
                bey.pos.x + Math.cos(a) * r0,
                bey.pos.y + Math.sin(a) * r0,
                bey.pos.x + Math.cos(a) * r1,
                bey.pos.y + Math.sin(a) * r1
            );
        }
    }

    /** Sparks sucked in from the edges of the arena while charging. */
    private spawnChargeParticles (bey: Bey, dt: number, t: number): void
    {
        this.ghostTimer -= dt;
        if (this.ghostTimer > 0) return;

        this.ghostTimer = 0.02;

        for (let i = 0; i < 2; i++)
        {
            const angle = Math.random() * Math.PI * 2;
            const radius = PMath.FloatBetween(150, 300);
            const sprite = this.add.image(
                bey.pos.x + Math.cos(angle) * radius,
                bey.pos.y + Math.sin(angle) * radius,
                'spark'
            );

            sprite.setDepth(58)
                .setTint(Math.random() < 0.5 ? bey.color : 0xffffff)
                .setScale(PMath.FloatBetween(0.6, 1.6) * (0.6 + t))
                .setBlendMode('ADD');

            this.tweens.add({
                targets: sprite,
                x: bey.pos.x,
                y: bey.pos.y,
                scale: 0.1,
                alpha: { from: 1, to: 0.4 },
                duration: PMath.Between(220, 420),
                ease: 'Cubic.In',
                onComplete: () => sprite.destroy()
            });
        }
    }

    /** Unfreezes everything and slings the bey at the locked direction. */
    private fireSpecial (bey: Bey): void
    {
        this.phase = 'special';

        this.player.frozen = false;
        this.enemy.frozen = false;

        bey.spinBoost = 6;
        bey.shakeAmp = 1.5;
        bey.launchSpecial(this.chargeDir.x, this.chargeDir.y, SPECIAL_SPEED, SPECIAL_TIME);

        this.aura.clear();

        // Snap back out of the close-up, with a flash and a big shockwave.
        this.tweens.add({
            targets: this.darkness,
            alpha: 0,
            duration: 180
        });
        // Pull the camera back out to the full arena over a fifth of a second.
        const fromZoom = this.cameras.main.zoom;
        const fromX = this.cameras.main.midPoint.x;
        const fromY = this.cameras.main.midPoint.y;

        this.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 220,
            ease: 'Quad.Out',
            onUpdate: (tween) =>
            {
                const k = tween.getValue() ?? 1;
                this.cameras.main.setZoom(PMath.Linear(fromZoom, 1, k));
                this.cameras.main.centerOn(
                    PMath.Linear(fromX, ARENA_X, k),
                    PMath.Linear(fromY, ARENA_Y, k)
                );
            },
            onComplete: () =>
            {
                this.cameras.main.setZoom(1);
                this.cameras.main.centerOn(ARENA_X, ARENA_Y);
            }
        });

        this.tweens.add({
            targets: this.specialText,
            alpha: 0,
            scale: 2.2,
            duration: 320
        });

        sfx.fire();
        sfx.roar(SPECIAL_TIME);
        this.cameras.main.flash(140, 255, 255, 255);
        this.cameras.main.shake(260, 0.014);
        this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 40);

        bey.setDepth(30);
        this.ghostTimer = 0;
    }

    /** Trail, after-images and speed lines while the special dash is live. */
    private updateSpecialDash (dt: number): void
    {
        const bey = this.charger;

        if (!bey || bey.special <= 0)
        {
            this.endSpecial();
            return;
        }

        // After-images dropped along the path.
        this.ghostTimer -= dt;
        if (this.ghostTimer <= 0)
        {
            this.ghostTimer = 0.025;

            const ghost = this.add.image(bey.pos.x, bey.pos.y, bey.textureKey)
                .setDepth(11)
                .setAlpha(0.55)
                .setRotation(Math.random() * Math.PI);

            this.tweens.add({
                targets: ghost,
                alpha: 0,
                scale: 1.35,
                duration: 260,
                onComplete: () => ghost.destroy()
            });
        }

        this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 2);

        // Speed lines streaming back from the bey.
        const g = this.speedLines;
        g.clear();

        const speed = bey.speed;
        if (speed < 50) return;

        const dirX = bey.vel.x / speed;
        const dirY = bey.vel.y / speed;
        const perpX = -dirY;
        const perpY = dirX;

        for (let i = 0; i < 14; i++)
        {
            const offset = PMath.FloatBetween(-46, 46);
            const back = PMath.FloatBetween(10, 70);
            const len = PMath.FloatBetween(40, 150);
            const alpha = PMath.FloatBetween(0.15, 0.7);

            const sx = bey.pos.x + perpX * offset - dirX * back;
            const sy = bey.pos.y + perpY * offset - dirY * back;

            g.lineStyle(PMath.FloatBetween(1, 3), i % 3 === 0 ? bey.color : 0xffffff, alpha);
            g.lineBetween(sx, sy, sx - dirX * len, sy - dirY * len);
        }
    }

    private endSpecial (): void
    {
        this.speedLines.clear();

        if (this.charger)
        {
            this.charger.spinBoost = 0;
            this.charger.shakeAmp = 0;
            this.charger.setDepth(10);
        }

        this.charger = null;

        if (this.phase === 'special')
        {
            this.phase = 'battle';
        }
    }

    // -- physics ----------------------------------------------------------

    /** True inside one of the two open mouths of the stadium. */
    private isInGap (angle: number): boolean
    {
        for (const gap of GAP_ANGLES)
        {
            if (Math.abs(PMath.Angle.Wrap(angle - gap)) < GAP_HALF) return true;
        }

        return false;
    }

    private collideWithWall (bey: Bey): void
    {
        if (bey.ringOut || bey.onRail) return;

        const dx = bey.pos.x - ARENA_X;
        const dy = bey.pos.y - ARENA_Y;
        const dist = Math.hypot(dx, dy);
        const nx = dx / dist;
        const ny = dy / dist;
        const inGap = this.isInGap(Math.atan2(dy, dx));

        const limit = ARENA_R - bey.radius;

        // The mouths are the only way out of the stadium, but they have a lip:
        // a top has to be pushed hard to actually clear one.
        if (inGap)
        {
            const outwardAtGap = bey.vel.x * nx + bey.vel.y * ny;

            if (dist > limit && dist < ARENA_R + 8 && outwardAtGap < GAP_ESCAPE_SPEED)
            {
                bey.pos.x = ARENA_X + nx * limit;
                bey.pos.y = ARENA_Y + ny * limit;

                if (outwardAtGap > 0)
                {
                    const lip = 0.55;
                    bey.vel.x -= (1 + lip) * outwardAtGap * nx;
                    bey.vel.y -= (1 + lip) * outwardAtGap * ny;

                    if (bey.alive && outwardAtGap > 90)
                    {
                        sfx.wall(outwardAtGap / 700);
                        this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 4);
                    }
                }

                return;
            }

            if (bey.alive && dist > ARENA_R + 24)
            {
                bey.ringOut = true;
                bey.alive = false;

                // Thrown out by a special: it does not land, it comes apart.
                if (this.time.now - this.specialImpactTime < 1200)
                {
                    this.shatterBey(bey);
                }
                else
                {
                    sfx.ringOut();
                    this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 24);
                    this.cameras.main.shake(220, 0.012);
                }
            }

            return;
        }

        if (dist <= limit) return;

        const outward = bey.vel.x * nx + bey.vel.y * ny;

        // Push back inside and bounce off the wall, losing a bit of spin.
        bey.pos.x = ARENA_X + nx * limit;
        bey.pos.y = ARENA_Y + ny * limit;

        if (outward > 0)
        {
            const restitution = bey.special > 0 ? 0.6 : 0.95;
            bey.vel.x -= (1 + restitution) * outward * nx;
            bey.vel.y -= (1 + restitution) * outward * ny;

            if (bey.alive && outward > 90)
            {
                bey.damage(outward * (bey.special > 0 ? 0.0015 : 0.005));
                sfx.wall(outward / 500);
                this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, bey.special > 0 ? 12 : 3);
            }
        }
    }

    // -- rails ------------------------------------------------------------

    private buildRails (): Rail[]
    {
        // One rail per side, each pointing straight at the middle of the floor.
        return [0, Math.PI].map((angle) => ({
            start: new PMath.Vector2(
                ARENA_X + Math.cos(angle) * (ARENA_R - 14),
                ARENA_Y + Math.sin(angle) * (ARENA_R - 14)
            ),
            dir: new PMath.Vector2(-Math.cos(angle), -Math.sin(angle)),
            length: RAIL_LENGTH
        }));
    }

    /** Entry point of whichever rail is closest, used by the AI. */
    private nearestRailMouth (from: PMath.Vector2): PMath.Vector2
    {
        let best = this.rails[0];
        let bestDist = Infinity;

        for (const rail of this.rails)
        {
            const d = PMath.Distance.Between(from.x, from.y, rail.start.x, rail.start.y);
            if (d < bestDist)
            {
                bestDist = d;
                best = rail;
            }
        }

        return new PMath.Vector2(
            best.start.x + best.dir.x * 18,
            best.start.y + best.dir.y * 18
        );
    }

    /**
     * Rails own the top while it is meshed: position and velocity are written
     * directly, the speed ramps up, and at the far end it is released at the
     * middle of the stadium with a short power window.
     */
    private updateRails (dt: number): void
    {
        this.railTrail -= dt;

        for (const bey of [this.player, this.enemy])
        {
            const ride = this.rides.get(bey);

            if (ride)
            {
                ride.speed = Math.min(RAIL_TOP_SPEED, ride.speed + RAIL_ACCEL * dt);
                ride.progress += ride.speed * dt;

                bey.pos.set(
                    ride.rail.start.x + ride.rail.dir.x * ride.progress,
                    ride.rail.start.y + ride.rail.dir.y * ride.progress
                );
                bey.vel.set(ride.rail.dir.x * ride.speed, ride.rail.dir.y * ride.speed);

                if (this.railTrail <= 0)
                {
                    this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 3);
                }

                if (ride.progress >= ride.rail.length)
                {
                    this.releaseFromRail(bey);
                }

                continue;
            }

            if (!bey.alive || bey.onRail || bey.railCooldown > 0 || bey.special > 0) continue;

            for (const rail of this.rails)
            {
                const relX = bey.pos.x - rail.start.x;
                const relY = bey.pos.y - rail.start.y;
                const along = relX * rail.dir.x + relY * rail.dir.y;
                const lateral = Math.abs(relX * -rail.dir.y + relY * rail.dir.x);

                // Only the mouth end grabs, so a top crossing the middle of the
                // floor is not yanked sideways out of nowhere.
                if (along > -30 && along < RAIL_MOUTH && lateral < RAIL_CAPTURE_WIDTH)
                {
                    this.captureOnRail(bey, rail, Math.max(0, along));
                    break;
                }
            }
        }

        if (this.railTrail <= 0)
        {
            this.railTrail = 0.03;
        }
    }

    private captureOnRail (bey: Bey, rail: Rail, progress: number): void
    {
        bey.onRail = true;
        this.rides.set(bey, { rail, progress, speed: Math.max(360, bey.speed) });

        sfx.railEnter();
        this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 10);
    }

    private releaseFromRail (bey: Bey): void
    {
        const ride = this.rides.get(bey);
        if (!ride) return;

        this.rides.delete(bey);

        bey.onRail = false;
        bey.boost = RAIL_BOOST_TIME;
        bey.railCooldown = 1;
        bey.vel.set(ride.rail.dir.x * ride.speed, ride.rail.dir.y * ride.speed);

        sfx.railLaunch();
        this.cameras.main.shake(160, 0.008);
        this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 20);
    }

    private collideBeys (): void
    {
        const a = this.player;
        const b = this.enemy;

        let dx = b.pos.x - a.pos.x;
        let dy = b.pos.y - a.pos.y;
        let dist = Math.hypot(dx, dy);
        const minDist = a.radius + b.radius;

        if (dist >= minDist) return;

        if (dist < 0.001)
        {
            dx = 1;
            dy = 0;
            dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;

        // Separate.
        const overlap = minDist - dist;
        a.pos.x -= nx * overlap * 0.5;
        a.pos.y -= ny * overlap * 0.5;
        b.pos.x += nx * overlap * 0.5;
        b.pos.y += ny * overlap * 0.5;

        // Closing speed along the contact normal.
        const rvn = (a.vel.x - b.vel.x) * nx + (a.vel.y - b.vel.y) * ny;
        if (rvn <= 0) return;

        const special = a.special > 0 || b.special > 0;
        const restitution = special ? 1.4 : 1.15;
        const invMassSum = 1 / a.mass + 1 / b.mass;
        const j = -(1 + restitution) * rvn / invMassSum;

        a.vel.x += (j / a.mass) * nx;
        a.vel.y += (j / a.mass) * ny;
        b.vel.x -= (j / b.mass) * nx;
        b.vel.y -= (j / b.mass) * ny;

        if (!a.alive || !b.alive) return;

        // Whoever was driving into the hit takes less damage.
        const pushA = Math.max(0, a.vel.x * nx + a.vel.y * ny);
        const pushB = Math.max(0, -(b.vel.x * nx + b.vel.y * ny));
        const total = pushA + pushB + 1;

        const impact = Math.abs(rvn);
        // Opposite spin directions grind against each other: extra bite.
        const scrape = a.spinDir === b.spinDir ? 0.85 : 1.25;
        const base = impact * 0.011 * scrape;

        // Stamina advantage also decides who wins the clash.
        const ratio = PMath.Clamp(b.spin / (a.spin + 1), 0.5, 2);

        const dmgA = base * (pushB / total + 0.25) * ratio
            * (b.special > 0 ? SPECIAL_DAMAGE_MULT : 1)
            * (b.boost > 0 ? RAIL_BOOST_DAMAGE : 1);
        const dmgB = base * (pushA / total + 0.25) / ratio
            * (a.special > 0 ? SPECIAL_DAMAGE_MULT : 1)
            * (a.boost > 0 ? RAIL_BOOST_DAMAGE : 1);

        a.damage(dmgA);
        b.damage(dmgB);

        // Landing hits builds the meter faster than idling does.
        a.gainMeter(dmgB * 1.6);
        b.gainMeter(dmgA * 1.6);

        // Extra knockback for the stronger side, so hits feel decisive.
        const railHit = a.boost > 0 || b.boost > 0;
        const kick = impact * (special ? 0.75 : railHit ? 0.55 : 0.25);
        const winnerIsA = a.special > 0 ? true : b.special > 0 ? false : a.spin > b.spin;
        const loser = winnerIsA ? b : a;
        const sign = winnerIsA ? 1 : -1;
        loser.vel.x += nx * kick * sign;
        loser.vel.y += ny * kick * sign;

        const hitX = a.pos.x + nx * a.radius;
        const hitY = a.pos.y + ny * a.radius;

        if (special)
        {
            // Money shot: freeze-frame, white flash and a shower of sparks.
            sfx.specialHit();
            this.sparks.emitParticleAt(hitX, hitY, 48);
            this.cameras.main.shake(420, 0.026);
            this.cameras.main.flash(120, 255, 255, 255);
            this.hitStop = 0.1;
            this.specialImpactTime = this.time.now;

            // Killed outright by the special: shatter instead of toppling.
            if (!a.alive) this.shatterBey(a);
            if (!b.alive) this.shatterBey(b);
        }
        else
        {
            sfx.hit(impact / (railHit ? 340 : 500));
            this.sparks.emitParticleAt(hitX, hitY, Math.min(28, 3 + Math.floor(impact / (railHit ? 16 : 25))));

            if (railHit)
            {
                this.cameras.main.shake(220, 0.014);
            }
            else if (impact > 200)
            {
                this.cameras.main.shake(120, 0.006);
            }
        }
    }

    /** Blows a defeated bey into pieces that skid across the arena and fade. */
    private shatterBey (bey: Bey): void
    {
        if (this.shattered.has(bey)) return;

        this.shattered.add(bey);
        bey.hide();
        sfx.shatter();

        this.cameras.main.shake(320, 0.02);
        this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 40);

        for (let i = 0; i < 22; i++)
        {
            const angle = Math.random() * Math.PI * 2;
            const distance = PMath.FloatBetween(90, 360);

            const piece = this.add.image(
                bey.pos.x + Math.cos(angle) * 6,
                bey.pos.y + Math.sin(angle) * 6,
                `shard-${bey.name}-${i % 4}`
            );

            piece.setDepth(35)
                .setRotation(Math.random() * Math.PI * 2)
                .setScale(PMath.FloatBetween(0.65, 1.5));

            // Each piece flies out, slows down, tumbles and fades where it lands.
            this.tweens.add({
                targets: piece,
                x: bey.pos.x + Math.cos(angle) * distance,
                y: bey.pos.y + Math.sin(angle) * distance,
                rotation: piece.rotation + PMath.FloatBetween(-9, 9),
                scale: piece.scale * 0.7,
                alpha: { from: 1, to: 0 },
                ease: 'Quad.Out',
                duration: PMath.Between(700, 1500),
                onComplete: () => piece.destroy()
            });
        }
    }

    // -- presentation -----------------------------------------------------

    private drawArena (): void
    {
        const g = this.add.graphics().setDepth(0);

        // Floor bowl: concentric rings fake the depth shading.
        for (let i = 0; i < 12; i++)
        {
            const t = i / 11;
            const r = ARENA_R * (1 - t * 0.92);
            g.fillStyle(i % 2 === 0 ? 0x16273a : 0x122132, 1);
            g.fillCircle(ARENA_X, ARENA_Y, r);
        }

        // Spokes + centre pit.
        g.lineStyle(2, 0x1f344c, 1);
        for (let i = 0; i < 12; i++)
        {
            const a = (i / 12) * Math.PI * 2;
            g.lineBetween(
                ARENA_X + Math.cos(a) * 60,
                ARENA_Y + Math.sin(a) * 60,
                ARENA_X + Math.cos(a) * (ARENA_R - 6),
                ARENA_Y + Math.sin(a) * (ARENA_R - 6)
            );
        }

        g.fillStyle(0x0a121c, 1);
        g.fillCircle(ARENA_X, ARENA_Y, 54);
        g.lineStyle(3, 0x3f6b95, 0.8);
        g.strokeCircle(ARENA_X, ARENA_Y, 54);

        // Wall, broken by the two mouths.
        const arcs: [number, number][] = [
            [-Math.PI / 2 + GAP_HALF, Math.PI / 2 - GAP_HALF],
            [Math.PI / 2 + GAP_HALF, (3 * Math.PI) / 2 - GAP_HALF]
        ];

        for (const [a0, a1] of arcs)
        {
            g.lineStyle(14, 0x2b4460, 1);
            g.beginPath();
            g.arc(ARENA_X, ARENA_Y, ARENA_R + 7, a0, a1, false);
            g.strokePath();

            g.lineStyle(4, 0x3f6b95, 1);
            g.beginPath();
            g.arc(ARENA_X, ARENA_Y, ARENA_R, a0, a1, false);
            g.strokePath();
        }

        this.drawGaps(g);

        for (const rail of this.rails)
        {
            this.drawRail(g, rail);
        }
    }

    /** The two ring-out mouths: open floor, hazard edges, arrows pointing out. */
    private drawGaps (g: GameObjects.Graphics): void
    {
        for (const gap of GAP_ANGLES)
        {
            const cos = Math.cos(gap);
            const sin = Math.sin(gap);

            // Ramp of floor running out through the mouth.
            g.fillStyle(0x0b1119, 1);
            g.beginPath();
            g.arc(ARENA_X, ARENA_Y, ARENA_R + 46, gap - GAP_HALF, gap + GAP_HALF, false);
            g.arc(ARENA_X, ARENA_Y, ARENA_R - 30, gap + GAP_HALF, gap - GAP_HALF, true);
            g.closePath();
            g.fillPath();

            // Hazard edges.
            for (const side of [-1, 1])
            {
                const a = gap + side * GAP_HALF;
                g.lineStyle(4, 0xffb020, 0.85);
                g.lineBetween(
                    ARENA_X + Math.cos(a) * (ARENA_R - 26),
                    ARENA_Y + Math.sin(a) * (ARENA_R - 26),
                    ARENA_X + Math.cos(a) * (ARENA_R + 46),
                    ARENA_Y + Math.sin(a) * (ARENA_R + 46)
                );
            }

            // Chevrons warning which way is out.
            g.lineStyle(3, 0xffb020, 0.55);
            for (let k = 0; k < 3; k++)
            {
                const r = ARENA_R - 34 + k * 26;
                const spread = 26 - k * 4;
                const cx = ARENA_X + cos * r;
                const cy = ARENA_Y + sin * r;
                const px = -sin;
                const py = cos;

                g.lineBetween(cx - px * spread, cy - py * spread, cx + cos * 16, cy + sin * 16);
                g.lineBetween(cx + px * spread, cy + py * spread, cx + cos * 16, cy + sin * 16);
            }
        }
    }

    /** A toothed rail: the tip meshes with these and gets flung inwards. */
    private drawRail (g: GameObjects.Graphics, rail: Rail): void
    {
        const { start, dir, length } = rail;
        const px = -dir.y;
        const py = dir.x;
        const wide = 19;
        const narrow = 12;

        const widthAt = (d: number) => wide - (d / length) * (wide - narrow);

        // Bed.
        g.fillStyle(0x0e1a26, 1);
        g.beginPath();
        g.moveTo(start.x + px * wide, start.y + py * wide);
        g.lineTo(start.x - px * wide, start.y - py * wide);
        g.lineTo(start.x + dir.x * length - px * narrow, start.y + dir.y * length - py * narrow);
        g.lineTo(start.x + dir.x * length + px * narrow, start.y + dir.y * length + py * narrow);
        g.closePath();
        g.fillPath();

        // Teeth.
        g.lineStyle(2, 0x49d17a, 0.8);
        for (let d = 0; d <= length; d += 11)
        {
            const w = widthAt(d);
            g.lineBetween(
                start.x + dir.x * d + px * w,
                start.y + dir.y * d + py * w,
                start.x + dir.x * d - px * w,
                start.y + dir.y * d - py * w
            );
        }

        // Guide edges.
        g.lineStyle(3, 0x49d17a, 0.95);
        for (const side of [-1, 1])
        {
            g.lineBetween(
                start.x + px * wide * side,
                start.y + py * wide * side,
                start.x + dir.x * length + px * narrow * side,
                start.y + dir.y * length + py * narrow * side
            );
        }

        // Exit marker at the inner end.
        g.lineStyle(3, 0x49d17a, 0.5);
        g.strokeCircle(start.x + dir.x * length, start.y + dir.y * length, 10);
    }

    /** Lights up a rail while a top is riding it. */
    private drawRailGlow (): void
    {
        const g = this.railGlow;
        g.clear();

        for (const [bey, ride] of this.rides)
        {
            const { start, dir, length } = ride.rail;
            const pulse = 0.45 + 0.35 * Math.sin(this.time.now / 45);

            g.lineStyle(10, bey.color, pulse * 0.55);
            g.lineBetween(start.x, start.y, start.x + dir.x * length, start.y + dir.y * length);

            // Head of the charge running along the teeth.
            const t = Math.min(1, ride.progress / length);
            g.fillStyle(0xffffff, 0.85);
            g.fillCircle(start.x + dir.x * length * t, start.y + dir.y * length * t, 7);
        }
    }

    private drawHud (): void
    {
        const g = this.hud;
        g.clear();

        this.drawBar(g, 40, 34, this.player, 0x2ee6ff, false);
        this.drawBar(g, 1024 - 40 - 360, 34, this.enemy, 0xff4d5a, true);
    }

    private drawBar (
        g: GameObjects.Graphics,
        x: number,
        y: number,
        bey: Bey,
        color: number,
        rightAligned: boolean
    ): void
    {
        const w = 360;
        const h = 26;

        g.fillStyle(0x000000, 0.55);
        g.fillRoundedRect(x - 3, y - 3, w + 6, h + 26, 6);

        g.fillStyle(0x22303c, 1);
        g.fillRect(x, y, w, h);

        const fill = w * bey.spinRatio;
        g.fillStyle(color, 1);
        if (rightAligned)
        {
            g.fillRect(x + w - fill, y, fill, h);
        }
        else
        {
            g.fillRect(x, y, fill, h);
        }

        g.lineStyle(2, 0xffffff, 0.35);
        g.strokeRect(x, y, w, h);

        // Special meter, thinner bar right under the stamina bar.
        const my = y + h + 4;
        const mh = 10;
        const meterFill = w * (bey.meter / 100);
        const full = bey.meter >= 100;
        // Full meter pulses so it is obvious the special is available.
        const pulse = full ? 0.55 + 0.45 * Math.sin(this.time.now / 90) : 1;

        g.fillStyle(0x1a2530, 1);
        g.fillRect(x, my, w, mh);
        g.fillStyle(full ? 0xffd166 : 0x8fd0ff, pulse);
        if (rightAligned)
        {
            g.fillRect(x + w - meterFill, my, meterFill, mh);
        }
        else
        {
            g.fillRect(x, my, meterFill, mh);
        }

        // Dash cooldown pip.
        const ready = bey.dashCooldown <= 0 && bey.spin >= 8;
        g.fillStyle(ready ? color : 0x44525e, 1);
        const pipX = rightAligned ? x + w - 10 : x + 10;
        g.fillCircle(pipX, my + mh + 12, 6);
    }

    private finish (): void
    {
        this.phase = 'over';

        // Let go of anything still meshed with a rail.
        for (const bey of this.rides.keys())
        {
            bey.onRail = false;
        }
        this.rides.clear();

        sfx.stopDrone();
        sfx.stopCharge();
        this.endSpecial();
        this.player.frozen = false;
        this.enemy.frozen = false;
        this.darkness.setAlpha(0);
        this.specialText.setAlpha(0);
        this.aura.clear();
        this.cameras.main.setZoom(1);
        this.cameras.main.centerOn(ARENA_X, ARENA_Y);

        const playerLost = !this.player.alive;
        const enemyLost = !this.enemy.alive;

        let title: string;
        if (playerLost && enemyLost)
        {
            title = 'EMPATE';
        }
        else if (enemyLost)
        {
            title = this.enemy.ringOut ? 'RING OUT!\nVOCE VENCEU' : 'VOCE VENCEU';
        }
        else
        {
            title = this.player.ringOut ? 'RING OUT!\nVOCE PERDEU' : 'VOCE PERDEU';
        }

        const score = this.registry.get('score') as { win: number; loss: number } | undefined
            ?? { win: 0, loss: 0 };

        if (enemyLost && !playerLost) score.win++;
        else if (playerLost && !enemyLost) score.loss++;
        this.registry.set('score', score);

        this.centerText.setText(`${title}\n${score.win} - ${score.loss}`);
        this.hintText.setText('Pressione R para lutar de novo');

        EventBus.emit('battle-over', { title, score });
    }
}
