import { Math as PMath, Scene, GameObjects } from 'phaser';

export interface BeyConfig
{
    name: string;
    color: number;
    accent: number;
    x: number;
    y: number;
    /** 1 = clockwise, -1 = counter-clockwise. Opposite spins scrape harder. */
    spinDir: 1 | -1;
    radius?: number;
    mass?: number;
    maxSpin?: number;
    /** Steering acceleration in px/s^2 */
    accel?: number;
    /** Top speed in px/s */
    maxSpeed?: number;
}

/**
 * A single spinning top. Holds its own state and visuals, but no game rules:
 * collisions, arena bounds and win conditions live in the Arena scene.
 */
export class Bey
{
    public readonly name: string;
    public readonly color: number;
    public readonly spinDir: 1 | -1;

    public pos: PMath.Vector2;
    public vel: PMath.Vector2;

    public radius: number;
    public mass: number;
    public maxSpin: number;
    public spin: number;
    public accel: number;
    public maxSpeed: number;

    /** False once spin hits 0 or the bey leaves the arena. */
    public alive = true;
    public ringOut = false;

    public dashCooldown = 0;
    public hitFlash = 0;

    /** Special attack meter, 0..100. Full = special ready. */
    public meter = 0;
    /** Seconds left of the special dash. While > 0 the bey is a wrecking ball. */
    public special = 0;
    /** Cinematic freeze: keeps rendering, stops all movement and spin drain. */
    public frozen = false;
    /** Extra visual spin multiplier used while charging / dashing. */
    public spinBoost = 0;
    /** Visual rattle, in pixels. */
    public shakeAmp = 0;

    /** True while the tip is locked into a stadium rail. The scene drives it. */
    public onRail = false;
    /** Seconds left of the rail-launch power window. */
    public boost = 0;
    /** Stops the rail from grabbing the same top again immediately. */
    public railCooldown = 0;
    /** Seconds of being flung around with no control after a heavy hit. */
    public tumble = 0;

    private container: GameObjects.Container;
    private disc: GameObjects.Image;
    private shadow: GameObjects.Image;
    private wobblePhase = 0;
    private discAngle = 0;

    constructor (scene: Scene, config: BeyConfig)
    {
        this.name = config.name;
        this.color = config.color;
        this.spinDir = config.spinDir;

        this.radius = config.radius ?? 26;
        this.mass = config.mass ?? 1;
        this.maxSpin = config.maxSpin ?? 130;
        this.spin = this.maxSpin;
        this.accel = config.accel ?? 950;
        this.maxSpeed = config.maxSpeed ?? 520;

        this.pos = new PMath.Vector2(config.x, config.y);
        this.vel = new PMath.Vector2(0, 0);

        this.shadow = scene.add.image(0, 7, 'bey-shadow').setAlpha(0.35);
        this.disc = scene.add.image(0, 0, `bey-${this.name}`);

        this.container = scene.add.container(this.pos.x, this.pos.y, [this.shadow, this.disc]);
        this.container.setDepth(10);
    }

    get spinRatio (): number
    {
        return PMath.Clamp(this.spin / this.maxSpin, 0, 1);
    }

    get speed (): number
    {
        return this.vel.length();
    }

    /** Steering input. Direction does not need to be normalized. */
    steer (dirX: number, dirY: number, dt: number): void
    {
        // No steering while the rail owns the tip.
        if (!this.alive || this.onRail) return;

        const len = Math.hypot(dirX, dirY);
        if (len < 0.001) return;

        // A dying bey can barely steer any more, and a top that has just been
        // smashed across the stadium has almost no say at all.
        const control = (0.35 + 0.65 * this.spinRatio) * (this.tumble > 0 ? 0.15 : 1);

        this.vel.x += (dirX / len) * this.accel * control * dt;
        this.vel.y += (dirY / len) * this.accel * control * dt;
    }

    /** Burst of speed. Returns false if on cooldown or too weak to pay for it. */
    dash (dirX: number, dirY: number): boolean
    {
        if (!this.alive || this.dashCooldown > 0 || this.spin < 8) return false;

        const len = Math.hypot(dirX, dirY);
        if (len < 0.001) return false;

        this.vel.x += (dirX / len) * 430;
        this.vel.y += (dirY / len) * 430;

        this.spin -= 5;
        this.dashCooldown = 1.1;

        return true;
    }

    damage (amount: number): void
    {
        this.spin = Math.max(0, this.spin - amount);
        this.hitFlash = Math.max(this.hitFlash, Math.min(1, amount / 8));

        if (this.spin <= 0)
        {
            this.alive = false;
        }
    }

    /** Feeds the special meter. Returns true when it just filled up. */
    gainMeter (amount: number): boolean
    {
        if (this.meter >= 100) return false;

        this.meter = Math.min(100, this.meter + amount);

        return this.meter >= 100;
    }

    get specialReady (): boolean
    {
        return this.alive && this.meter >= 100 && this.special <= 0;
    }

    /** Fires the special: meter is spent and the bey is launched at a target. */
    launchSpecial (dirX: number, dirY: number, speed: number, duration: number): void
    {
        const len = Math.hypot(dirX, dirY) || 1;

        this.meter = 0;
        this.special = duration;
        this.vel.set((dirX / len) * speed, (dirY / len) * speed);
    }

    update (dt: number): void
    {
        this.dashCooldown = Math.max(0, this.dashCooldown - dt);
        this.hitFlash = Math.max(0, this.hitFlash - dt * 3);

        if (this.frozen)
        {
            this.render(dt);
            return;
        }

        this.special = Math.max(0, this.special - dt);
        this.boost = Math.max(0, this.boost - dt);
        this.railCooldown = Math.max(0, this.railCooldown - dt);
        this.tumble = Math.max(0, this.tumble - dt);

        // On a rail the scene sets position and velocity directly: no drag, no
        // wobble, no steering. Spin still burns, a little slower.
        if (this.onRail)
        {
            this.spin = Math.max(0, this.spin - 1.2 * dt);
            if (this.spin <= 0) this.alive = false;
            this.render(dt);
            return;
        }

        if (this.alive)
        {
            const dashing = this.special > 0;
            const tumbling = this.tumble > 0;

            // The special dash barely slows down and ignores the normal cap.
            // A tumbling top keeps most of the speed it was hit with, which is
            // what makes it ricochet around the stadium instead of settling.
            const drag = dashing ? 0.3 : tumbling ? 0.45 : 0.95;
            this.vel.scale(Math.max(0, 1 - drag * dt));

            const cap = dashing
                ? this.maxSpeed * 3.2
                : tumbling ? this.maxSpeed * 2.6 : this.maxSpeed;
            if (this.speed > cap)
            {
                this.vel.setLength(cap);
            }

            // Spin drains over time, faster while moving hard.
            const burn = (1.5 + this.speed * 0.0026) * (dashing ? 0.35 : 1);
            this.spin = Math.max(0, this.spin - burn * dt);

            if (this.spin <= 0)
            {
                this.alive = false;
            }

            // Knocked senseless: veers around while it recovers.
            if (tumbling)
            {
                this.wobblePhase += dt * 14;
                this.vel.x += Math.cos(this.wobblePhase * 2.3) * 260 * dt;
                this.vel.y += Math.sin(this.wobblePhase * 1.7) * 260 * dt;
                this.shakeAmp = 3;
                this.spinBoost = 2;
            }
            else if (this.special <= 0 && this.boost <= 0)
            {
                this.shakeAmp = 0;
                this.spinBoost = 0;
            }

            // Low spin: drunken wobble that drags the bey off course.
            if (this.spinRatio < 0.3 && !dashing)
            {
                const wobble = (0.3 - this.spinRatio) / 0.3;
                this.wobblePhase += dt * 9;
                this.vel.x += Math.cos(this.wobblePhase * 1.7) * 110 * wobble * dt;
                this.vel.y += Math.sin(this.wobblePhase) * 110 * wobble * dt;
            }
        }
        else
        {
            this.vel.scale(Math.max(0, 1 - 2.2 * dt));
        }

        this.pos.x += this.vel.x * dt;
        this.pos.y += this.vel.y * dt;

        this.render(dt);
    }

    private render (dt: number): void
    {
        // Visual spin rate follows remaining stamina, boosted while charging.
        const rate = this.alive ? (0.25 + this.spinRatio) * 22 * (1 + this.spinBoost) : 3;
        this.discAngle += this.spinDir * rate * dt;
        this.disc.setRotation(this.discAngle);

        const wobbleAmp = this.alive ? (1 - this.spinRatio) * 4 : 10;
        this.wobblePhase += dt * (this.alive ? 12 : 5);

        const rattle = this.shakeAmp;

        this.container.setPosition(this.pos.x, this.pos.y);
        this.disc.setPosition(
            Math.cos(this.wobblePhase) * wobbleAmp + PMath.FloatBetween(-rattle, rattle),
            Math.sin(this.wobblePhase * 1.3) * wobbleAmp * 0.6 + PMath.FloatBetween(-rattle, rattle)
        );

        if (this.alive)
        {
            this.disc.setScale(1 + this.hitFlash * 0.25 + Math.min(0.35, this.spinBoost * 0.03));
        }
        else
        {
            // Topple: shrink and fade out.
            this.disc.setScale(Math.max(0.2, this.disc.scaleX - dt * 0.4));
            this.disc.setAlpha(Math.max(0, this.disc.alpha - dt * 0.6));
            this.shadow.setAlpha(Math.max(0, this.shadow.alpha - dt * 0.6));
        }

        this.shadow.setPosition(this.disc.x * 0.4, 7 + this.disc.y * 0.4);
    }

    /** Hides the top once it has been replaced by flying debris. */
    hide (): void
    {
        this.container.setVisible(false);
    }

    setDepth (depth: number): void
    {
        this.container.setDepth(depth);
    }

    /** Texture key of this bey's disc, for after-images and effects. */
    get textureKey (): string
    {
        return `bey-${this.name}`;
    }

    destroy (): void
    {
        this.container.destroy();
    }

    /** Bakes the disc (and shared shadow) textures. Call once per scene. */
    static makeTextures (scene: Scene, name: string, color: number, accent: number, radius = 26): void
    {
        const size = radius * 2 + 8;
        const c = size / 2;
        const g = scene.add.graphics();

        // Outer metal ring.
        g.fillStyle(accent, 1);
        g.fillCircle(c, c, radius);

        // Blades around the rim.
        const blades = 6;
        g.fillStyle(color, 1);
        for (let i = 0; i < blades; i++)
        {
            const a0 = (i / blades) * Math.PI * 2;
            const a1 = a0 + (Math.PI * 2 / blades) * 0.55;
            g.beginPath();
            g.moveTo(c, c);
            g.arc(c, c, radius - 1, a0, a1, false);
            g.closePath();
            g.fillPath();
        }

        // Body and centre bolt.
        g.fillStyle(color, 1);
        g.fillCircle(c, c, radius * 0.62);
        g.fillStyle(accent, 1);
        g.fillCircle(c, c, radius * 0.42);
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(c, c, radius * 0.16);

        // Highlight so the disc reads as 3D from above.
        g.fillStyle(0xffffff, 0.18);
        g.fillCircle(c - radius * 0.28, c - radius * 0.3, radius * 0.28);

        g.lineStyle(2, 0x000000, 0.45);
        g.strokeCircle(c, c, radius);

        g.generateTexture(`bey-${name}`, size, size);
        g.clear();

        // Debris used by the shatter animation: jagged chunks of the disc.
        for (let v = 0; v < 4; v++)
        {
            const w = 24;
            const h = 20;

            g.fillStyle(color, 1);
            g.beginPath();
            g.moveTo(1, 3 + v);
            g.lineTo(w - 2, 1 + v * 2);
            g.lineTo(w - 5 - v * 2, h - 1);
            g.closePath();
            g.fillPath();

            g.fillStyle(accent, 1);
            g.beginPath();
            g.moveTo(1, 3 + v);
            g.lineTo(w - 5 - v * 2, h - 1);
            g.lineTo(2 + v, h - 4);
            g.closePath();
            g.fillPath();

            g.generateTexture(`shard-${name}-${v}`, w, h);
            g.clear();
        }

        if (!scene.textures.exists('bey-shadow'))
        {
            g.fillStyle(0x000000, 1);
            g.fillEllipse(c, c, radius * 2.1, radius * 1.8);
            g.generateTexture('bey-shadow', size, size);
            g.clear();
        }

        if (!scene.textures.exists('spark'))
        {
            g.fillStyle(0xffffff, 1);
            g.fillCircle(6, 6, 5);
            g.generateTexture('spark', 12, 12);
            g.clear();
        }

        if (!scene.textures.exists('flame'))
        {
            // Soft blob: concentric circles fading out, so the trail particles
            // read as fire rather than as hard dots.
            for (let i = 8; i > 0; i--)
            {
                g.fillStyle(0xffffff, 0.16);
                g.fillCircle(16, 16, i * 2);
            }

            g.generateTexture('flame', 32, 32);
        }

        g.destroy();
    }
}
