import { Scene, Math as PMath, GameObjects, Input, Types } from 'phaser';
import { EventBus } from '../EventBus';
import { Bey } from '../Bey';

const ARENA_X = 512;
const ARENA_Y = 384;
const ARENA_R = 320;

/** Outward speed at the rim needed to launch a bey clean out of the stadium. */
const RING_OUT_SPEED = 430;

type Phase = 'countdown' | 'battle' | 'over';

export class Game extends Scene
{
    private player: Bey;
    private enemy: Bey;

    private hud: GameObjects.Graphics;
    private centerText: GameObjects.Text;
    private hintText: GameObjects.Text;
    private sparks: GameObjects.Particles.ParticleEmitter;

    private cursors: Types.Input.Keyboard.CursorKeys;
    private keys: Record<string, Input.Keyboard.Key>;

    private phase: Phase = 'countdown';
    private countdown = 3;
    private aiThink = 0;
    private aiAggressive = true;

    constructor ()
    {
        super('Game');
    }

    create ()
    {
        this.phase = 'countdown';
        this.countdown = 3;

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
            accel: 980,
            maxSpeed: 520
        });

        this.enemy = new Bey(this, {
            name: 'enemy',
            color: 0xff4d5a,
            accent: 0x6b0b1c,
            x: ARENA_X + 150,
            y: ARENA_Y,
            spinDir: -1,
            accel: 900,
            maxSpeed: 500
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

        this.hud = this.add.graphics().setDepth(100);

        this.centerText = this.add.text(ARENA_X, ARENA_Y - 40, '', {
            fontFamily: 'Arial Black', fontSize: 64, color: '#ffffff',
            stroke: '#000000', strokeThickness: 8, align: 'center'
        }).setOrigin(0.5).setDepth(102);

        this.hintText = this.add.text(ARENA_X, 740,
            'WASD / setas: mover    ESPACO: investida    R: reiniciar', {
            fontFamily: 'Arial', fontSize: 18, color: '#9fd8ff'
        }).setOrigin(0.5).setDepth(101);

        const keyboard = this.input.keyboard!;
        this.cursors = keyboard.createCursorKeys();
        this.keys = keyboard.addKeys('W,A,S,D,SPACE,R') as Record<string, Input.Keyboard.Key>;

        keyboard.on('keydown-R', () => this.scene.restart());

        EventBus.emit('current-scene-ready', this);
    }

    update (_time: number, delta: number)
    {
        const dt = Math.min(delta / 1000, 1 / 30);

        if (this.phase === 'countdown')
        {
            this.countdown -= dt;
            const n = Math.ceil(this.countdown);
            this.centerText.setText(n > 0 ? String(n) : 'LET IT RIP!');

            if (this.countdown <= -0.6)
            {
                this.phase = 'battle';
                this.centerText.setText('');
                // Both tops get shot into the arena.
                this.player.vel.set(180, -120);
                this.enemy.vel.set(-180, 120);
            }

            this.player.update(dt * 0.15);
            this.enemy.update(dt * 0.15);
            this.drawHud();
            return;
        }

        if (this.phase === 'battle')
        {
            this.handleInput(dt);
            this.updateAI(dt);
        }

        this.player.update(dt);
        this.enemy.update(dt);

        this.collideWithWall(this.player);
        this.collideWithWall(this.enemy);
        this.collideBeys();

        this.drawHud();

        if (this.phase === 'battle' && (!this.player.alive || !this.enemy.alive))
        {
            this.finish();
        }
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
            }
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
        }

        // Lead the target a little so it does not chase the tail.
        const aimX = p.pos.x + p.vel.x * 0.22;
        const aimY = p.pos.y + p.vel.y * 0.22;
        let dx = aimX - ai.pos.x;
        let dy = aimY - ai.pos.y;
        const dist = Math.hypot(dx, dy) || 1;
        dx /= dist;
        dy /= dist;

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
            const w = (fromCenter - ARENA_R * 0.7) / (ARENA_R * 0.3);
            dx -= (cx / fromCenter) * w * 1.6;
            dy -= (cy / fromCenter) * w * 1.6;
        }

        ai.steer(dx, dy, dt);

        if (this.aiAggressive && dist < 170 && ai.dashCooldown <= 0 && Math.random() < 0.05)
        {
            if (ai.dash(p.pos.x - ai.pos.x, p.pos.y - ai.pos.y))
            {
                this.sparks.emitParticleAt(ai.pos.x, ai.pos.y, 6);
            }
        }
    }

    // -- physics ----------------------------------------------------------

    private collideWithWall (bey: Bey): void
    {
        if (bey.ringOut) return;

        const dx = bey.pos.x - ARENA_X;
        const dy = bey.pos.y - ARENA_Y;
        const dist = Math.hypot(dx, dy);
        const limit = ARENA_R - bey.radius;

        if (dist <= limit) return;

        const nx = dx / dist;
        const ny = dy / dist;
        const outward = bey.vel.x * nx + bey.vel.y * ny;

        if (bey.alive && outward > RING_OUT_SPEED)
        {
            // Launched clean over the rim.
            bey.ringOut = true;
            bey.alive = false;
            this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 24);
            this.cameras.main.shake(220, 0.012);
            return;
        }

        // Push back inside and bounce off the wall, losing a bit of spin.
        bey.pos.x = ARENA_X + nx * limit;
        bey.pos.y = ARENA_Y + ny * limit;

        if (outward > 0)
        {
            const restitution = 0.72;
            bey.vel.x -= (1 + restitution) * outward * nx;
            bey.vel.y -= (1 + restitution) * outward * ny;

            if (bey.alive && outward > 90)
            {
                bey.damage(outward * 0.008);
                this.sparks.emitParticleAt(bey.pos.x, bey.pos.y, 3);
            }
        }
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

        const restitution = 0.9;
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
        const base = impact * 0.022 * scrape;

        // Stamina advantage also decides who wins the clash.
        const ratio = PMath.Clamp(b.spin / (a.spin + 1), 0.5, 2);

        a.damage(base * (pushB / total + 0.25) * ratio);
        b.damage(base * (pushA / total + 0.25) / ratio);

        // Extra knockback for the stronger side, so hits feel decisive.
        const kick = impact * 0.25;
        const winnerIsA = a.spin > b.spin;
        const loser = winnerIsA ? b : a;
        const sign = winnerIsA ? 1 : -1;
        loser.vel.x += nx * kick * sign;
        loser.vel.y += ny * kick * sign;

        const hitX = a.pos.x + nx * a.radius;
        const hitY = a.pos.y + ny * a.radius;
        this.sparks.emitParticleAt(hitX, hitY, Math.min(20, 3 + Math.floor(impact / 25)));

        if (impact > 200)
        {
            this.cameras.main.shake(120, 0.006);
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

        // Rim.
        g.lineStyle(14, 0x2b4460, 1);
        g.strokeCircle(ARENA_X, ARENA_Y, ARENA_R + 7);
        g.lineStyle(4, 0x3f6b95, 1);
        g.strokeCircle(ARENA_X, ARENA_Y, ARENA_R);

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
        g.fillRoundedRect(x - 3, y - 3, w + 6, h + 6, 6);

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

        // Dash cooldown pip under the bar.
        const ready = bey.dashCooldown <= 0 && bey.spin >= 8;
        g.fillStyle(ready ? color : 0x44525e, 1);
        const pipX = rightAligned ? x + w - 10 : x + 10;
        g.fillCircle(pipX, y + h + 14, 6);
    }

    private finish (): void
    {
        this.phase = 'over';

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
