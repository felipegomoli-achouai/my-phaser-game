/**
 * Procedural sound effects. Everything is synthesised with the Web Audio API,
 * so the game ships with no audio assets at all.
 *
 * Browsers block audio until the user interacts with the page, so `unlock()`
 * must be called from a real input event before anything is audible.
 */
export class Sfx
{
    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private noise: AudioBuffer | null = null;

    private muted = false;

    /**
     * The signature spin sound: the toothed tip ratcheting along the stadium
     * rail. Low, buzzy and dense - a growl, not a whistle.
     */
    private drone: {
        sources: AudioScheduledSourceNode[];
        teeth: OscillatorNode;
        sub: OscillatorNode;
        toothLid: BiquadFilterNode;
        body: BiquadFilterNode;
        chest: BiquadFilterNode;
        teethGain: GainNode;
        gritRate: OscillatorNode;
        gritBand: BiquadFilterNode;
        gritGain: GainNode;
        raspRate: OscillatorNode;
        raspBand: BiquadFilterNode;
        raspGain: GainNode;
        blade: BiquadFilterNode;
        bladeRate: OscillatorNode;
        jet: BiquadFilterNode;
        jetGain: GainNode;
        hum: OscillatorNode[];
        gain: GainNode;
    } | null = null;

    /** Charge wind-up, kept so it can be cut short. */
    private riser: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | null = null;
    /** Engine roar during the special dash. */
    private roarVoice: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | null = null;
    /** Revving grind while two tops are locked together in a finisher. */
    private clashVoice: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | null = null;
    /** Sustained scream while two specials are locked in a duel. */
    private duelVoice: {
        nodes: AudioScheduledSourceNode[];
        gain: GainNode;
        scream: BiquadFilterNode;
        engine: OscillatorNode;
        press: GainNode;
    } | null = null;

    get isMuted (): boolean
    {
        return this.muted;
    }

    /** Creates the context lazily; safe to call on every frame. */
    private ensure (): AudioContext | null
    {
        if (this.ctx) return this.ctx;

        const Ctor = window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

        if (!Ctor) return null;

        this.ctx = new Ctor();

        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.35;

        // Limiter on the bus: lets the impacts slam without clipping the output.
        const limiter = this.ctx.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 6;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.16;

        this.master.connect(limiter).connect(this.ctx.destination);

        // One second of white noise, reused by every percussive sound.
        const length = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++)
        {
            data[i] = Math.random() * 2 - 1;
        }

        return this.ctx;
    }

    /** Call from a click / keypress so the browser lets the audio through. */
    unlock (): void
    {
        const ctx = this.ensure();
        if (ctx && ctx.state === 'suspended')
        {
            void ctx.resume();
        }
    }

    toggleMute (): boolean
    {
        this.muted = !this.muted;

        if (this.master && this.ctx)
        {
            this.master.gain.setTargetAtTime(this.muted ? 0 : 0.35, this.ctx.currentTime, 0.02);
        }

        return this.muted;
    }

    // -- building blocks --------------------------------------------------

    private now (): number
    {
        return this.ctx!.currentTime;
    }

    /** Soft-clipper used to make the big hits dirty instead of polite. */
    private shaper (amount: number): WaveShaperNode
    {
        const ws = this.ctx!.createWaveShaper();
        const n = 1024;
        const curve = new Float32Array(n);

        for (let i = 0; i < n; i++)
        {
            const x = (i * 2) / n - 1;
            curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
        }

        ws.curve = curve;
        ws.oversample = '4x';

        return ws;
    }

    /**
     * Turns a sawtooth into a hard pulse train. Used as the chopper for the
     * spin sound: the gear tip only bites the rail for part of each turn.
     */
    private pulseShaper (duty = 0.34): WaveShaperNode
    {
        const ws = this.ctx!.createWaveShaper();
        const n = 512;
        const curve = new Float32Array(n);
        const edge = 1 - duty * 2;

        for (let i = 0; i < n; i++)
        {
            const x = (i * 2) / n - 1;
            curve[i] = x > edge ? 1 : -1;
        }

        ws.curve = curve;

        return ws;
    }

    /** A burst of filtered noise: impacts, whooshes, scrapes, explosions. */
    private burst (
        opts: {
            duration: number;
            volume: number;
            type: BiquadFilterType;
            freqFrom: number;
            freqTo?: number;
            q?: number;
            delay?: number;
            attack?: number;
            drive?: number;
        }
    ): void
    {
        const ctx = this.ensure();
        if (!ctx || !this.noise || !this.master) return;

        const t0 = this.now() + (opts.delay ?? 0);

        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.playbackRate.value = 0.7 + Math.random() * 0.6;

        const filter = ctx.createBiquadFilter();
        filter.type = opts.type;
        filter.Q.value = opts.q ?? 1;
        filter.frequency.setValueAtTime(opts.freqFrom, t0);
        filter.frequency.exponentialRampToValueAtTime(
            Math.max(40, opts.freqTo ?? opts.freqFrom),
            t0 + opts.duration
        );

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.volume), t0 + (opts.attack ?? 0.006));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

        if (opts.drive)
        {
            src.connect(filter).connect(this.shaper(opts.drive)).connect(gain).connect(this.master);
        }
        else
        {
            src.connect(filter).connect(gain).connect(this.master);
        }

        src.start(t0);
        src.stop(t0 + opts.duration + 0.02);
    }

    /** A single decaying tone: clangs, beeps, jingles, sub-bass drops. */
    private tone (
        opts: {
            freq: number;
            freqTo?: number;
            duration: number;
            volume: number;
            type?: OscillatorType;
            delay?: number;
            drive?: number;
        }
    ): void
    {
        const ctx = this.ensure();
        if (!ctx || !this.master) return;

        const t0 = this.now() + (opts.delay ?? 0);

        const osc = ctx.createOscillator();
        osc.type = opts.type ?? 'square';
        osc.frequency.setValueAtTime(opts.freq, t0);
        if (opts.freqTo)
        {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqTo), t0 + opts.duration);
        }

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.volume), t0 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

        if (opts.drive)
        {
            osc.connect(this.shaper(opts.drive)).connect(gain).connect(this.master);
        }
        else
        {
            osc.connect(gain).connect(this.master);
        }

        osc.start(t0);
        osc.stop(t0 + opts.duration + 0.02);
    }

    // -- the spinning drone -----------------------------------------------

    /**
     * The tip is a gear that meshes with a toothed rail in the stadium floor,
     * so the fundamental of the sound is the tooth-pass rate: teeth per turn
     * times turns per second. That lands low - roughly 80-360 Hz here - and
     * the character comes from how rich and dirty that pulse train is, not
     * from any high resonance. Anything above ~4 kHz is deliberately cut so it
     * growls instead of whistling.
     *
     * Layers:
     *   1. tooth buzz - a saw at the tooth-pass rate plus a sub an octave down,
     *      shaped by two body resonances (the hollow tip and the stadium),
     *   2. mesh grit - a mid noise band gated by a pulse train at the same
     *      rate: the actual clatter of teeth landing,
     *   3. blade whirr and low air for the body of the top,
     *   4. a quiet hum for mass.
     */
    startDrone (): void
    {
        const ctx = this.ensure();
        if (!ctx || !this.master || !this.noise || this.drone) return;

        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        gain.connect(this.master);

        // Hard lid: this sound lives under 4 kHz.
        const lid = ctx.createBiquadFilter();
        lid.type = 'lowpass';
        lid.frequency.value = 3800;
        lid.Q.value = 0.7;
        lid.connect(gain);

        const drive = this.shaper(3.5);
        drive.connect(lid);

        const sources: AudioScheduledSourceNode[] = [];

        // Contact is never perfectly even: a small, slow wobble only.
        const wobble = ctx.createOscillator();
        wobble.type = 'triangle';
        wobble.frequency.value = 5.7;
        const wobbleAmt = ctx.createGain();
        wobbleAmt.gain.value = 6;
        wobble.connect(wobbleAmt);
        wobble.start();
        sources.push(wobble);

        // A second, faster wobble: teeth never land at a perfectly even rate.
        const flutter = ctx.createOscillator();
        flutter.type = 'sine';
        flutter.frequency.value = 13.3;
        const flutterAmt = ctx.createGain();
        flutterAmt.gain.value = 4;
        flutter.connect(flutterAmt).connect(wobbleAmt);
        flutter.start();
        sources.push(flutter);

        // 1. Tooth buzz.
        const teeth = ctx.createOscillator();
        teeth.type = 'sawtooth';
        teeth.frequency.value = 200;
        wobbleAmt.connect(teeth.frequency);

        const sub = ctx.createOscillator();
        sub.type = 'triangle';
        sub.frequency.value = 100;

        const subGain = ctx.createGain();
        subGain.gain.value = 0.5;

        // Body resonances: the hollow tip and the bowl around it.
        const body = ctx.createBiquadFilter();
        body.type = 'peaking';
        body.frequency.value = 340;
        body.Q.value = 1.6;
        body.gain.value = 9;

        const chest = ctx.createBiquadFilter();
        chest.type = 'peaking';
        chest.frequency.value = 820;
        chest.Q.value = 1.2;
        chest.gain.value = 6;

        // Keeps the saw from ever getting thin and reedy.
        const toothLid = ctx.createBiquadFilter();
        toothLid.type = 'lowpass';
        toothLid.frequency.value = 2200;
        toothLid.Q.value = 0.8;

        // Kept deliberately low: the pitched part is only there for weight.
        // Anything more and the whole thing turns into a cartoon buzz.
        const teethGain = ctx.createGain();
        teethGain.gain.value = 0.07;

        teeth.connect(toothLid);
        sub.connect(subGain).connect(toothLid);
        toothLid.connect(body).connect(chest).connect(teethGain).connect(drive);

        teeth.start();
        sub.start();
        sources.push(teeth, sub);

        // 2. Mesh grit: teeth actually landing on the rail.
        const gritSrc = ctx.createBufferSource();
        gritSrc.buffer = this.noise;
        gritSrc.loop = true;

        const gritBand = ctx.createBiquadFilter();
        gritBand.type = 'bandpass';
        gritBand.frequency.value = 1200;
        // Wide: a saw going through wood is broadband rasp, not a tone.
        gritBand.Q.value = 1.6;

        const gritChop = ctx.createGain();
        gritChop.gain.value = 0.4;

        const gritRate = ctx.createOscillator();
        gritRate.type = 'sawtooth';
        gritRate.frequency.value = 200;
        wobbleAmt.connect(gritRate.frequency);

        // Narrow duty: each tooth is a short scrape, not a smooth wobble.
        const gritDepth = ctx.createGain();
        gritDepth.gain.value = 0.7;
        gritRate.connect(this.pulseShaper(0.22)).connect(gritDepth).connect(gritChop.gain);
        gritRate.start();
        sources.push(gritRate);

        const gritGain = ctx.createGain();
        gritGain.gain.value = 0.6;

        gritSrc.connect(gritBand).connect(gritChop).connect(gritGain).connect(drive);
        gritSrc.start();
        sources.push(gritSrc);

        // 2b. Second rasp layer, chopped a hair off the first rate. The two
        // grains drift in and out of phase, which is what stops the sound
        // from locking into a clean, synthetic buzz.
        const raspSrc = ctx.createBufferSource();
        raspSrc.buffer = this.noise;
        raspSrc.loop = true;
        raspSrc.playbackRate.value = 1.3;

        const raspBand = ctx.createBiquadFilter();
        raspBand.type = 'bandpass';
        raspBand.frequency.value = 2600;
        raspBand.Q.value = 1.2;

        const raspChop = ctx.createGain();
        raspChop.gain.value = 0.35;

        const raspRate = ctx.createOscillator();
        raspRate.type = 'sawtooth';
        raspRate.frequency.value = 207;
        wobbleAmt.connect(raspRate.frequency);

        const raspDepth = ctx.createGain();
        raspDepth.gain.value = 0.65;
        raspRate.connect(this.pulseShaper(0.3)).connect(raspDepth).connect(raspChop.gain);
        raspRate.start();
        sources.push(raspRate);

        const raspGain = ctx.createGain();
        raspGain.gain.value = 0.3;

        raspSrc.connect(raspBand).connect(raspChop).connect(raspGain).connect(drive);
        raspSrc.start();
        sources.push(raspSrc);

        // 3a. Blade whirr: the body chopping air once per turn.
        const bladeSrc = ctx.createBufferSource();
        bladeSrc.buffer = this.noise;
        bladeSrc.loop = true;
        bladeSrc.playbackRate.value = 0.9;

        const blade = ctx.createBiquadFilter();
        blade.type = 'bandpass';
        blade.frequency.value = 900;
        blade.Q.value = 5;

        const bladeChop = ctx.createGain();
        bladeChop.gain.value = 0.42;

        const bladeRate = ctx.createOscillator();
        bladeRate.type = 'sine';
        bladeRate.frequency.value = 70;

        const bladeDepth = ctx.createGain();
        bladeDepth.gain.value = 0.5;
        bladeRate.connect(bladeDepth).connect(bladeChop.gain);
        bladeRate.start();
        sources.push(bladeRate);

        const bladeGain = ctx.createGain();
        bladeGain.gain.value = 0.3;

        bladeSrc.connect(blade).connect(bladeChop).connect(bladeGain).connect(drive);
        bladeSrc.start();
        sources.push(bladeSrc);

        // 3b. Low air wash.
        const jetSrc = ctx.createBufferSource();
        jetSrc.buffer = this.noise;
        jetSrc.loop = true;
        jetSrc.playbackRate.value = 0.7;

        const jet = ctx.createBiquadFilter();
        jet.type = 'lowpass';
        jet.frequency.value = 700;
        jet.Q.value = 1;

        const jetGain = ctx.createGain();
        jetGain.gain.value = 0.25;

        jetSrc.connect(jet).connect(jetGain).connect(drive);
        jetSrc.start();
        sources.push(jetSrc);

        // 4. Low hum for mass.
        const hum: OscillatorNode[] = [];
        for (const [type, freq, level] of [['triangle', 84, 0.3], ['sine', 42, 0.35]] as const)
        {
            const o = ctx.createOscillator();
            o.type = type;
            o.frequency.value = freq;

            const g = ctx.createGain();
            g.gain.value = level;

            o.connect(g).connect(gain);
            o.start();
            hum.push(o);
            sources.push(o);
        }

        this.drone = {
            sources, teeth, sub, toothLid, body, chest, teethGain,
            gritRate, gritBand, gritGain, raspRate, raspBand, raspGain,
            blade, bladeRate, jet, jetGain, hum, gain
        };
    }

    /**
     * Spin sets the tooth-pass rate (how fast the gear is running along the
     * rail); speed adds a little pitch and opens up the grit and the air.
     */
    updateDrone (spin: number, speed: number): void
    {
        if (!this.drone || !this.ctx) return;

        const t = this.ctx.currentTime;
        const d = this.drone;

        // Fundamental: teeth per turn times turns per second. Stays low.
        const toothHz = 60 + 150 * spin + 40 * speed;

        d.teeth.frequency.setTargetAtTime(toothHz, t, 0.06);
        d.sub.frequency.setTargetAtTime(toothHz * 0.5, t, 0.06);
        d.gritRate.frequency.setTargetAtTime(toothHz, t, 0.06);

        // Resonances track the fundamental so the growl keeps its shape.
        d.body.frequency.setTargetAtTime(toothHz * 1.7, t, 0.08);
        d.chest.frequency.setTargetAtTime(toothHz * 4.1, t, 0.08);
        d.toothLid.frequency.setTargetAtTime(1500 + 1400 * spin + 500 * speed, t, 0.08);

        d.teethGain.gain.setTargetAtTime(0.05 + 0.05 * spin + 0.03 * speed, t, 0.09);

        // The rasp is the sound. Both grains ride the tooth rate, the second
        // one slightly off it so the grain never repeats exactly.
        d.gritBand.frequency.setTargetAtTime(700 + 800 * spin + 300 * speed, t, 0.08);
        d.gritGain.gain.setTargetAtTime(0.5 + 0.3 * speed + 0.2 * spin, t, 0.09);

        d.raspRate.frequency.setTargetAtTime(toothHz * 1.035, t, 0.06);
        d.raspBand.frequency.setTargetAtTime(2000 + 1500 * spin + 600 * speed, t, 0.08);
        d.raspGain.gain.setTargetAtTime(0.22 + 0.24 * speed + 0.12 * spin, t, 0.09);

        d.bladeRate.frequency.setTargetAtTime(30 + 78 * spin + 18 * speed, t, 0.08);
        d.blade.frequency.setTargetAtTime(700 + 900 * spin, t, 0.1);

        d.jet.frequency.setTargetAtTime(420 + 900 * speed, t, 0.06);
        d.jetGain.gain.setTargetAtTime(0.18 + 0.3 * speed, t, 0.08);

        d.hum[0].frequency.setTargetAtTime(70 + 44 * spin, t, 0.1);
        d.hum[1].frequency.setTargetAtTime(34 + 22 * spin, t, 0.1);

        d.gain.gain.setTargetAtTime(0.055 + 0.06 * spin + 0.04 * speed, t, 0.08);
    }

    stopDrone (): void
    {
        if (!this.drone || !this.ctx) return;

        const t = this.ctx.currentTime;
        this.drone.gain.gain.cancelScheduledValues(t);
        this.drone.gain.gain.setTargetAtTime(0.0001, t, 0.08);

        for (const node of this.drone.sources)
        {
            node.stop(t + 0.5);
        }

        this.drone = null;
    }

    // -- one-shots --------------------------------------------------------

    countdown (final: boolean): void
    {
        this.tone({ freq: final ? 880 : 520, duration: final ? 0.5 : 0.14, volume: 0.28, type: 'square' });
        if (final)
        {
            this.burst({ duration: 0.5, volume: 0.3, type: 'bandpass', freqFrom: 400, freqTo: 2400, q: 0.7 });
        }
    }

    /**
     * Forge hammer on an anvil / two blades meeting. Layered as:
     *   1. a razor-fast strike transient, hard clipped,
     *   2. a second strike 9 ms later - metal answering metal, not one clang,
     *   3. an anvil body with a steep pitch drop, where the force lives,
     *   4. a high, dense, inharmonic steel cluster that dies fast, plus a long
     *      quiet blade shimmer that only shows up on the heavy hits.
     */
    hit (strength: number): void
    {
        const ctx = this.ensure();
        if (!ctx) return;

        const s = Math.min(1, Math.max(0.12, strength));

        // 1. The strike.
        this.burst({
            duration: 0.014,
            volume: 0.55 + 0.5 * s,
            type: 'highpass',
            freqFrom: 5200,
            freqTo: 9000,
            q: 0.5,
            attack: 0.0004,
            drive: 16
        });

        // 2. The answer, a few milliseconds later.
        this.burst({
            duration: 0.05,
            volume: 0.4 + 0.5 * s,
            type: 'bandpass',
            freqFrom: 3600 + 3200 * s,
            freqTo: 1900,
            q: 0.9,
            attack: 0.0006,
            drive: 12,
            delay: 0.009
        });

        // 3. Anvil body: the mass behind the blow.
        this.tone({
            freq: 300 + 250 * s,
            freqTo: 66,
            duration: 0.2 + 0.14 * s,
            volume: 0.55 + 0.45 * s,
            type: 'triangle',
            drive: 10
        });
        this.tone({
            freq: 128,
            freqTo: 46,
            duration: 0.17,
            volume: 0.4 + 0.3 * s,
            type: 'sine',
            drive: 6
        });

        // 4. Steel cluster: high, inharmonic, short.
        const base = 1500 + 1500 * s;

        [1, 1.29, 1.71, 2.19, 2.83, 3.61, 4.57].forEach((ratio, i) =>
        {
            const detune = 1 + (Math.random() - 0.5) * 0.04;

            this.tone({
                freq: base * ratio * detune,
                freqTo: base * ratio * detune * 0.9,
                duration: (0.32 / (1 + i * 0.55)) * (0.6 + 0.6 * s),
                volume: (0.3 + 0.3 * s) / (1 + i * 1.3),
                type: i < 3 ? 'triangle' : 'sine',
                delay: i * 0.003
            });
        });

        // Blade shimmer, heavy hits only.
        if (s > 0.45)
        {
            this.tone({
                freq: base * 1.98,
                freqTo: base * 1.88,
                duration: 0.7 + 0.6 * s,
                volume: 0.06 + 0.08 * s,
                type: 'sine',
                delay: 0.02
            });
            this.burst({
                duration: 0.5 + 0.5 * s,
                volume: 0.05 + 0.08 * s,
                type: 'highpass',
                freqFrom: 4200,
                freqTo: 6800,
                q: 0.6,
                delay: 0.03
            });
        }

        // Rims grinding as the two tops slide apart again.
        this.burst({
            duration: 0.09 + 0.1 * s,
            volume: 0.1 + 0.16 * s,
            type: 'bandpass',
            freqFrom: 2600,
            freqTo: 5200,
            q: 0.8,
            delay: 0.03
        });
    }

    /** Scrape against the stadium wall. */
    wall (strength: number): void
    {
        const s = Math.min(1, Math.max(0.1, strength));

        this.burst({
            duration: 0.12,
            volume: 0.08 + 0.16 * s,
            type: 'lowpass',
            freqFrom: 500 + 900 * s,
            freqTo: 200,
            q: 0.8
        });

        this.tone({ freq: 240 + 180 * s, freqTo: 140, duration: 0.1, volume: 0.06 + 0.1 * s, type: 'triangle' });
    }

    dash (): void
    {
        this.burst({ duration: 0.24, volume: 0.22, type: 'bandpass', freqFrom: 320, freqTo: 1900, q: 1.4 });
        this.tone({ freq: 180, freqTo: 420, duration: 0.2, volume: 0.1, type: 'sawtooth' });
    }

    // -- special attack ---------------------------------------------------

    /**
     * Wind-up: a distorted riser, a rumble that grows under it, a metallic
     * whine and an accelerating rev — clicks that get closer and closer
     * together until the launch.
     */
    chargeUp (duration: number): void
    {
        const ctx = this.ensure();
        if (!ctx || !this.master || !this.noise) return;

        this.stopCharge();

        const t0 = this.now();

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.42, t0 + duration * 0.92);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + 0.12);

        // Tremolo that speeds up: the "engine revving" feel.
        const trem = ctx.createGain();
        trem.gain.value = 0.75;

        const tremLfo = ctx.createOscillator();
        tremLfo.type = 'sawtooth';
        tremLfo.frequency.setValueAtTime(7, t0);
        tremLfo.frequency.exponentialRampToValueAtTime(46, t0 + duration);

        const tremDepth = ctx.createGain();
        tremDepth.gain.value = 0.3;
        tremLfo.connect(tremDepth).connect(trem.gain);
        tremLfo.start(t0);
        tremLfo.stop(t0 + duration + 0.2);

        gain.connect(this.master);
        trem.connect(gain);

        const nodes: AudioScheduledSourceNode[] = [tremLfo];
        const drive = this.shaper(8);
        drive.connect(trem);

        // Two detuned saws climbing three octaves.
        for (const detune of [0, 14])
        {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.detune.value = detune;
            osc.frequency.setValueAtTime(70, t0);
            osc.frequency.exponentialRampToValueAtTime(820, t0 + duration);

            const g = ctx.createGain();
            g.gain.value = 0.5;

            osc.connect(g).connect(drive);
            osc.start(t0);
            osc.stop(t0 + duration + 0.15);
            nodes.push(osc);
        }

        // Metallic whine on top.
        const whine = ctx.createOscillator();
        whine.type = 'square';
        whine.frequency.setValueAtTime(380, t0);
        whine.frequency.exponentialRampToValueAtTime(2600, t0 + duration);

        const whineGain = ctx.createGain();
        whineGain.gain.setValueAtTime(0.0001, t0);
        whineGain.gain.exponentialRampToValueAtTime(0.12, t0 + duration);
        whine.connect(whineGain).connect(trem);
        whine.start(t0);
        whine.stop(t0 + duration + 0.15);
        nodes.push(whine);

        // Air sucked into the vortex.
        const air = ctx.createBufferSource();
        air.buffer = this.noise;
        air.loop = true;

        const airFilter = ctx.createBiquadFilter();
        airFilter.type = 'bandpass';
        airFilter.Q.value = 1.2;
        airFilter.frequency.setValueAtTime(300, t0);
        airFilter.frequency.exponentialRampToValueAtTime(5200, t0 + duration);

        air.connect(airFilter).connect(trem);
        air.start(t0);
        air.stop(t0 + duration + 0.15);
        nodes.push(air);

        // Sub rumble building underneath.
        const rumble = ctx.createBufferSource();
        rumble.buffer = this.noise;
        rumble.loop = true;
        rumble.playbackRate.value = 0.35;

        const rumbleFilter = ctx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 110;

        const rumbleGain = ctx.createGain();
        rumbleGain.gain.setValueAtTime(0.0001, t0);
        rumbleGain.gain.exponentialRampToValueAtTime(1.6, t0 + duration);

        rumble.connect(rumbleFilter).connect(rumbleGain).connect(gain);
        rumble.start(t0);
        rumble.stop(t0 + duration + 0.15);
        nodes.push(rumble);

        // Accelerating rev clicks, packed tighter towards the launch.
        const clicks = 16;
        for (let i = 0; i < clicks; i++)
        {
            const at = duration * Math.pow(i / clicks, 1.7);
            this.burst({
                duration: 0.03,
                volume: 0.06 + 0.16 * (i / clicks),
                type: 'bandpass',
                freqFrom: 900 + 1800 * (i / clicks),
                freqTo: 600,
                q: 3,
                delay: at,
                attack: 0.001
            });
        }

        this.riser = { nodes, gain };
    }

    stopCharge (): void
    {
        if (!this.riser || !this.ctx) return;

        const t = this.ctx.currentTime;
        this.riser.gain.gain.cancelScheduledValues(t);
        this.riser.gain.gain.setTargetAtTime(0.0001, t, 0.03);

        for (const node of this.riser.nodes)
        {
            node.stop(t + 0.2);
        }

        this.riser = null;
    }

    /** The launch: an explosion plus a shockwave. */
    fire (): void
    {
        this.stopCharge();

        // Blast body, driven hard.
        this.burst({ duration: 0.7, volume: 0.6, type: 'lowpass', freqFrom: 7000, freqTo: 160, q: 0.6, attack: 0.002, drive: 10 });
        // Sub drop that hits in the chest.
        this.tone({ freq: 170, freqTo: 34, duration: 0.75, volume: 0.5, type: 'sine', drive: 6 });
        // Metal scream tearing away.
        this.tone({ freq: 2200, freqTo: 320, duration: 0.35, volume: 0.2, type: 'sawtooth', drive: 4 });
        // Crackling debris.
        for (let i = 0; i < 5; i++)
        {
            this.burst({
                duration: 0.05,
                volume: 0.12,
                type: 'bandpass',
                freqFrom: 1500 + Math.random() * 4000,
                freqTo: 800,
                q: 2,
                delay: 0.04 + Math.random() * 0.28,
                attack: 0.001
            });
        }
    }

    /** Sustained rocket roar while the special dash is flying. */
    roar (duration: number): void
    {
        const ctx = this.ensure();
        if (!ctx || !this.master || !this.noise) return;

        this.stopRoar();

        const t0 = this.now();

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.34, t0 + 0.06);
        gain.gain.setValueAtTime(0.34, t0 + duration * 0.7);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
        gain.connect(this.master);

        const drive = this.shaper(7);
        drive.connect(gain);

        // Exhaust noise, opening up as it accelerates.
        const jet = ctx.createBufferSource();
        jet.buffer = this.noise;
        jet.loop = true;

        const jetFilter = ctx.createBiquadFilter();
        jetFilter.type = 'bandpass';
        jetFilter.Q.value = 1.1;
        jetFilter.frequency.setValueAtTime(260, t0);
        jetFilter.frequency.exponentialRampToValueAtTime(1500, t0 + duration);

        jet.connect(jetFilter).connect(drive);
        jet.start(t0);
        jet.stop(t0 + duration + 0.1);

        // Engine note climbing under the noise.
        const engine = ctx.createOscillator();
        engine.type = 'sawtooth';
        engine.frequency.setValueAtTime(150, t0);
        engine.frequency.exponentialRampToValueAtTime(360, t0 + duration);

        const engineGain = ctx.createGain();
        engineGain.gain.value = 0.5;
        engine.connect(engineGain).connect(drive);
        engine.start(t0);
        engine.stop(t0 + duration + 0.1);

        this.roarVoice = { nodes: [jet, engine], gain };
    }

    stopRoar (): void
    {
        if (!this.roarVoice || !this.ctx) return;

        const t = this.ctx.currentTime;
        this.roarVoice.gain.gain.cancelScheduledValues(t);
        this.roarVoice.gain.gain.setTargetAtTime(0.0001, t, 0.05);

        for (const node of this.roarVoice.nodes)
        {
            node.stop(t + 0.25);
        }

        this.roarVoice = null;
    }

    /** Special attack connecting: detonation plus flying shrapnel. */
    specialHit (): void
    {
        this.stopRoar();

        // Detonation: a cracking front, a body and a sub drop.
        this.burst({ duration: 0.05, volume: 1.4, type: 'highpass', freqFrom: 4000, freqTo: 9000, q: 0.5, attack: 0.0004, drive: 18 });
        this.burst({ duration: 0.9, volume: 1.2, type: 'lowpass', freqFrom: 9000, freqTo: 110, q: 0.5, attack: 0.001, drive: 14 });
        this.tone({ freq: 120, freqTo: 26, duration: 1, volume: 0.95, type: 'sine', drive: 8 });
        this.tone({ freq: 62, freqTo: 22, duration: 0.9, volume: 0.65, type: 'triangle', drive: 4, delay: 0.02 });
        // Anvil-sized clang riding the blast.
        this.tone({ freq: 420, freqTo: 90, duration: 0.4, volume: 0.5, type: 'triangle', drive: 10 });

        // Shrapnel: inharmonic metal partials flung outwards.
        [1, 1.47, 2.11, 2.83, 3.62, 4.51].forEach((ratio, i) =>
        {
            this.tone({
                freq: 760 * ratio * (1 + (Math.random() - 0.5) * 0.08),
                freqTo: 620 * ratio,
                duration: 0.7 / (1 + i * 0.45),
                volume: 0.2 / (1 + i * 0.9),
                type: i < 2 ? 'triangle' : 'sine',
                delay: i * 0.006
            });
        });

        // Debris raining down.
        for (let i = 0; i < 7; i++)
        {
            this.burst({
                duration: 0.06,
                volume: 0.1,
                type: 'bandpass',
                freqFrom: 2000 + Math.random() * 5000,
                freqTo: 900,
                q: 2.5,
                delay: 0.06 + Math.random() * 0.4,
                attack: 0.001
            });
        }

        // Long tail so the room feels shaken.
        this.burst({ duration: 0.9, volume: 0.18, type: 'lowpass', freqFrom: 1800, freqTo: 90, q: 0.4, delay: 0.05 });
    }

    /**
     * Two tops locked together, grinding and winding each other up: a race
     * bike being revved. The engine note climbs, the firing pulse tightens and
     * the grind on top gets brighter until the break.
     */
    clashRev (duration: number): void
    {
        const ctx = this.ensure();
        if (!ctx || !this.master || !this.noise) return;

        this.stopClashRev();

        const t0 = this.now();

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.5, t0 + duration * 0.85);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + 0.1);
        gain.connect(this.master);

        // Cylinders firing: a pulse train that tightens as the revs climb.
        const fire = ctx.createGain();
        fire.gain.value = 0.45;

        const fireRate = ctx.createOscillator();
        fireRate.type = 'sawtooth';
        fireRate.frequency.setValueAtTime(26, t0);
        fireRate.frequency.exponentialRampToValueAtTime(190, t0 + duration);

        const fireDepth = ctx.createGain();
        fireDepth.gain.value = 0.5;
        fireRate.connect(this.pulseShaper(0.45)).connect(fireDepth).connect(fire.gain);
        fireRate.start(t0);
        fireRate.stop(t0 + duration + 0.15);

        fire.connect(gain);

        const drive = this.shaper(14);
        drive.connect(fire);

        const nodes: AudioScheduledSourceNode[] = [fireRate];

        // Engine note: two detuned saws climbing the rev range.
        for (const detune of [0, 11])
        {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.detune.value = detune;
            osc.frequency.setValueAtTime(95, t0);
            osc.frequency.exponentialRampToValueAtTime(640, t0 + duration);

            const g = ctx.createGain();
            g.gain.value = 0.5;

            osc.connect(g).connect(drive);
            osc.start(t0);
            osc.stop(t0 + duration + 0.15);
            nodes.push(osc);
        }

        // Metal grinding where the two rims are welded together.
        const grind = ctx.createBufferSource();
        grind.buffer = this.noise;
        grind.loop = true;

        const grindBand = ctx.createBiquadFilter();
        grindBand.type = 'bandpass';
        grindBand.Q.value = 2.2;
        grindBand.frequency.setValueAtTime(900, t0);
        grindBand.frequency.exponentialRampToValueAtTime(4200, t0 + duration);

        const grindGain = ctx.createGain();
        grindGain.gain.setValueAtTime(0.0001, t0);
        grindGain.gain.exponentialRampToValueAtTime(0.7, t0 + duration);

        grind.connect(grindBand).connect(grindGain).connect(drive);
        grind.start(t0);
        grind.stop(t0 + duration + 0.15);
        nodes.push(grind);

        // Sub rumble building under the whole thing.
        const rumble = ctx.createBufferSource();
        rumble.buffer = this.noise;
        rumble.loop = true;
        rumble.playbackRate.value = 0.3;

        const rumbleFilter = ctx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 95;

        const rumbleGain = ctx.createGain();
        rumbleGain.gain.setValueAtTime(0.0001, t0);
        rumbleGain.gain.exponentialRampToValueAtTime(2, t0 + duration);

        rumble.connect(rumbleFilter).connect(rumbleGain).connect(gain);
        rumble.start(t0);
        rumble.stop(t0 + duration + 0.15);
        nodes.push(rumble);

        this.clashVoice = { nodes, gain };
    }

    stopClashRev (): void
    {
        if (!this.clashVoice || !this.ctx) return;

        const t = this.ctx.currentTime;
        this.clashVoice.gain.gain.cancelScheduledValues(t);
        this.clashVoice.gain.gain.setTargetAtTime(0.0001, t, 0.02);

        for (const node of this.clashVoice.nodes)
        {
            node.stop(t + 0.15);
        }

        this.clashVoice = null;
    }

    /**
     * Two specials meeting head on and refusing to give: a sustained scream of
     * metal, an engine held at the limiter and a sub that never lets up. Runs
     * until stopped; `setDuelIntensity` tightens it as the duel goes on.
     */
    duelGrind (): void
    {
        const ctx = this.ensure();
        if (!ctx || !this.master || !this.noise) return;

        this.stopDuelGrind();

        const t0 = this.now();

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.42, t0 + 0.12);
        gain.connect(this.master);

        const drive = this.shaper(12);
        drive.connect(gain);

        // Pressure: rises every time someone lands a hit.
        const press = ctx.createGain();
        press.gain.value = 1;
        press.connect(drive);

        const nodes: AudioScheduledSourceNode[] = [];

        // Screaming contact between the two rims.
        const screamSrc = ctx.createBufferSource();
        screamSrc.buffer = this.noise;
        screamSrc.loop = true;

        const scream = ctx.createBiquadFilter();
        scream.type = 'bandpass';
        scream.frequency.value = 2200;
        scream.Q.value = 9;

        const screamGain = ctx.createGain();
        screamGain.gain.value = 0.9;

        screamSrc.connect(scream).connect(screamGain).connect(press);
        screamSrc.start(t0);
        nodes.push(screamSrc);

        // Engine held wide open under it.
        const engine = ctx.createOscillator();
        engine.type = 'sawtooth';
        engine.frequency.value = 320;

        const engineGain = ctx.createGain();
        engineGain.gain.value = 0.35;

        engine.connect(engineGain).connect(press);
        engine.start(t0);
        nodes.push(engine);

        // Sub bed.
        const rumble = ctx.createBufferSource();
        rumble.buffer = this.noise;
        rumble.loop = true;
        rumble.playbackRate.value = 0.28;

        const rumbleFilter = ctx.createBiquadFilter();
        rumbleFilter.type = 'lowpass';
        rumbleFilter.frequency.value = 90;

        const rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 1.6;

        rumble.connect(rumbleFilter).connect(rumbleGain).connect(gain);
        rumble.start(t0);
        nodes.push(rumble);

        this.duelVoice = { nodes, gain, scream, engine, press };
    }

    /** 0..1: how far along the duel is. Everything tightens as it climbs. */
    setDuelIntensity (value: number): void
    {
        if (!this.duelVoice || !this.ctx) return;

        const t = this.ctx.currentTime;
        const v = Math.min(1, Math.max(0, value));

        this.duelVoice.scream.frequency.setTargetAtTime(1800 + 2600 * v, t, 0.08);
        this.duelVoice.engine.frequency.setTargetAtTime(260 + 320 * v, t, 0.08);
        this.duelVoice.gain.gain.setTargetAtTime(0.4 + 0.25 * v, t, 0.1);
    }

    /** A flick of extra pressure, used on every landed press. */
    duelSurge (): void
    {
        if (!this.duelVoice || !this.ctx) return;

        const t = this.ctx.currentTime;
        this.duelVoice.press.gain.cancelScheduledValues(t);
        this.duelVoice.press.gain.setValueAtTime(1.9, t);
        this.duelVoice.press.gain.setTargetAtTime(1, t + 0.02, 0.09);
    }

    stopDuelGrind (): void
    {
        if (!this.duelVoice || !this.ctx) return;

        const t = this.ctx.currentTime;
        this.duelVoice.gain.gain.cancelScheduledValues(t);
        this.duelVoice.gain.gain.setTargetAtTime(0.0001, t, 0.03);

        for (const node of this.duelVoice.nodes)
        {
            node.stop(t + 0.2);
        }

        this.duelVoice = null;
    }

    /** The two specials meeting: one enormous strike. */
    duelStart (): void
    {
        this.stopCharge();
        this.stopRoar();

        this.burst({ duration: 0.05, volume: 1.1, type: 'highpass', freqFrom: 4200, freqTo: 9000, q: 0.5, attack: 0.0004, drive: 16 });
        this.burst({ duration: 0.7, volume: 0.9, type: 'lowpass', freqFrom: 9000, freqTo: 140, q: 0.5, attack: 0.001, drive: 12 });
        this.tone({ freq: 150, freqTo: 32, duration: 0.8, volume: 0.8, type: 'sine', drive: 8 });
        this.tone({ freq: 900, freqTo: 300, duration: 0.35, volume: 0.3, type: 'sawtooth', drive: 6 });
    }

    /**
     * One shove inside the duel. `index` climbs with the tally, so the strikes
     * get higher and more frantic as someone pulls ahead.
     */
    duelHit (index: number): void
    {
        const k = Math.min(1, index / 10);

        this.burst({
            duration: 0.03,
            volume: 0.55 + 0.35 * k,
            type: 'bandpass',
            freqFrom: 2600 + 3200 * k,
            freqTo: 1500,
            q: 1.1,
            attack: 0.0004,
            drive: 14
        });

        this.tone({
            freq: 420 + 380 * k,
            freqTo: 150,
            duration: 0.12,
            volume: 0.4,
            type: 'triangle',
            drive: 8
        });

        this.tone({
            freq: 1500 + 900 * k,
            freqTo: 1100,
            duration: 0.09,
            volume: 0.22,
            type: 'sine',
            delay: 0.006
        });

        this.duelSurge();
    }

    /** The lock breaks and the loser is thrown across the stadium. */
    duelBreak (): void
    {
        this.stopDuelGrind();

        this.burst({ duration: 0.06, volume: 1.2, type: 'highpass', freqFrom: 3800, freqTo: 9000, q: 0.5, attack: 0.0004, drive: 18 });
        this.burst({ duration: 0.85, volume: 1, type: 'lowpass', freqFrom: 9000, freqTo: 120, q: 0.5, attack: 0.001, drive: 14 });
        this.tone({ freq: 140, freqTo: 30, duration: 0.9, volume: 0.85, type: 'sine', drive: 8 });
        // The loser screaming away across the floor.
        this.burst({ duration: 0.5, volume: 0.45, type: 'bandpass', freqFrom: 2600, freqTo: 400, q: 1.2, delay: 0.05, drive: 8 });
    }

    /** The moment the loser lets go: blast first, then the top comes apart. */
    clashBreak (): void
    {
        this.stopClashRev();

        // Blast front.
        this.burst({ duration: 0.06, volume: 1.5, type: 'highpass', freqFrom: 3500, freqTo: 9000, q: 0.5, attack: 0.0004, drive: 18 });
        this.burst({ duration: 0.8, volume: 1.1, type: 'lowpass', freqFrom: 8000, freqTo: 120, q: 0.5, attack: 0.001, drive: 14 });
        this.tone({ freq: 130, freqTo: 28, duration: 0.9, volume: 0.9, type: 'sine', drive: 8 });

        // Then the metal itself letting go.
        this.shatter();
    }

    /** A top coming apart: metal cracking, then pieces skittering away. */
    shatter (): void
    {
        // The break itself.
        this.burst({ duration: 0.03, volume: 1, type: 'highpass', freqFrom: 3800, freqTo: 8000, q: 0.5, attack: 0.0005, drive: 16 });
        this.tone({ freq: 260, freqTo: 60, duration: 0.35, volume: 0.6, type: 'triangle', drive: 10 });

        // Cracking metal: inharmonic, all of it short.
        [1, 1.53, 2.17, 2.94, 3.88].forEach((ratio, i) =>
        {
            this.tone({
                freq: 900 * ratio * (1 + (Math.random() - 0.5) * 0.1),
                freqTo: 700 * ratio,
                duration: 0.25 / (1 + i * 0.5),
                volume: 0.28 / (1 + i * 0.8),
                type: i < 2 ? 'triangle' : 'sine',
                delay: i * 0.012
            });
        });

        // Fragments bouncing across the stadium floor.
        for (let i = 0; i < 12; i++)
        {
            this.burst({
                duration: 0.04,
                volume: 0.16 * (1 - i / 14),
                type: 'bandpass',
                freqFrom: 1800 + Math.random() * 4500,
                freqTo: 1200,
                q: 3,
                delay: 0.05 + Math.random() * 0.8,
                attack: 0.001
            });
        }
    }

    /** The tip dropping into the rail teeth and spooling up. */
    railEnter (): void
    {
        // The lock-in clack.
        this.burst({ duration: 0.05, volume: 0.45, type: 'bandpass', freqFrom: 1400, freqTo: 700, q: 3, attack: 0.0008, drive: 10 });
        // Teeth catching faster and faster as it accelerates.
        for (let i = 0; i < 12; i++)
        {
            this.burst({
                duration: 0.02,
                volume: 0.1 + 0.12 * (i / 12),
                type: 'bandpass',
                freqFrom: 1100 + i * 220,
                freqTo: 800,
                q: 4,
                delay: 0.28 * Math.pow(i / 12, 1.6),
                attack: 0.0006
            });
        }
        this.tone({ freq: 190, freqTo: 560, duration: 0.3, volume: 0.26, type: 'sawtooth', drive: 6 });
    }

    /** Leaving the rail, flung at the middle of the stadium. */
    railLaunch (): void
    {
        this.burst({ duration: 0.32, volume: 0.5, type: 'bandpass', freqFrom: 2600, freqTo: 380, q: 1, attack: 0.001, drive: 9 });
        this.tone({ freq: 560, freqTo: 130, duration: 0.3, volume: 0.32, type: 'sawtooth', drive: 6 });
        this.tone({ freq: 160, freqTo: 55, duration: 0.35, volume: 0.3, type: 'sine', drive: 4 });
    }

    ringOut (): void
    {
        this.burst({ duration: 0.35, volume: 0.32, type: 'bandpass', freqFrom: 1800, freqTo: 300, q: 1 });
        this.tone({ freq: 600, freqTo: 90, duration: 0.6, volume: 0.25, type: 'square' });
    }

    win (): void
    {
        [523, 659, 784, 1046].forEach((f, i) =>
        {
            this.tone({ freq: f, duration: 0.22, volume: 0.22, type: 'square', delay: i * 0.11 });
        });
    }

    lose (): void
    {
        [392, 330, 262, 196].forEach((f, i) =>
        {
            this.tone({ freq: f, duration: 0.28, volume: 0.22, type: 'square', delay: i * 0.13 });
        });
    }

    /** Cuts every looping sound, e.g. when the scene restarts. */
    stopAll (): void
    {
        this.stopCharge();
        this.stopRoar();
        this.stopClashRev();
        this.stopDuelGrind();
        this.stopDrone();
    }
}

/** Shared instance: the scene and the React UI talk to the same mixer. */
export const sfx = new Sfx();
