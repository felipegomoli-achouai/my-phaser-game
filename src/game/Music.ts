import { sfx } from './Sfx';

/**
 * Anime-opening rock, synthesised note by note: distorted guitar riff, driving
 * bass, and a live drum kit, all scheduled with a look-ahead sequencer so the
 * timing does not depend on the game's frame rate.
 *
 * There are no audio files: every voice is built from oscillators and noise,
 * and the whole thing runs through the same mixer as the sound effects, so the
 * mute key covers it too.
 */

const BPM = 168;
/** One sixteenth note. */
const STEP = 60 / BPM / 4;
const STEPS_PER_BAR = 16;
/** Eight bars before the riff comes back around. */
const LOOP_STEPS = STEPS_PER_BAR * 8;

const ROOT = 82.41; // E2

/** Nominal level of the whole track on its bus; ducking scales this. */
const MUSIC_LEVEL = 0.32;

/** Bar-by-bar chord roots, in semitones above the root: E E G A / E E D C. */
const PROGRESSION = [0, 0, 3, 5, 0, 0, 10, 8];

/** Palm-muted gallop: everything except the third sixteenth of each beat. */
const GUITAR_STEPS = [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15];
const BASS_STEPS = [0, 2, 4, 6, 8, 10, 12, 14];
const KICK_STEPS = [0, 3, 6, 8, 11, 14];
const SNARE_STEPS = [4, 12];

/** Lead line over the back half of the loop, in semitones above the root. */
const LEAD = [24, 27, 26, 24, 22, 24, 27, 29];

export class Music
{
    private ctx: AudioContext | null = null;
    private out: GainNode | null = null;

    /** Voice buses, built once: per-note distortion nodes were too expensive. */
    private guitarBus: GainNode | null = null;
    private bassBus: GainNode | null = null;
    private drumBus: GainNode | null = null;
    private noise: AudioBuffer | null = null;

    private timer: number | null = null;
    private nextNoteTime = 0;
    private step = 0;
    private playing = false;

    get isPlaying (): boolean
    {
        return this.playing;
    }

    /** Starts the track. Safe to call repeatedly. */
    start (): void
    {
        if (this.playing) return;

        const bus = sfx.musicBus();
        if (!bus) return;

        this.ctx = bus.ctx;
        this.out = bus.out;
        this.buildVoices();

        this.out.gain.value = MUSIC_LEVEL;
        this.playing = true;
        this.step = 0;
        this.nextNoteTime = this.ctx.currentTime + 0.12;

        this.timer = window.setInterval(() => this.schedule(), 25);
    }

    stop (): void
    {
        if (this.timer !== null)
        {
            window.clearInterval(this.timer);
            this.timer = null;
        }

        this.playing = false;

        if (this.out && this.ctx)
        {
            this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        }
    }

    /** Pulls the music down under a cinematic, then back up. 1 = full level. */
    duck (level: number): void
    {
        if (!this.out || !this.ctx) return;

        this.out.gain.setTargetAtTime(MUSIC_LEVEL * level, this.ctx.currentTime, 0.08);
    }

    // -- sequencer --------------------------------------------------------

    /**
     * Look-ahead scheduling: every 25 ms, queue every note that falls in the
     * next quarter second. The audio clock does the timing, not the timer.
     */
    private schedule (): void
    {
        const ctx = this.ctx;
        if (!ctx) return;

        while (this.nextNoteTime < ctx.currentTime + 0.25)
        {
            this.scheduleStep(this.step, this.nextNoteTime);
            this.nextNoteTime += STEP;
            this.step = (this.step + 1) % LOOP_STEPS;
        }
    }

    private scheduleStep (step: number, time: number): void
    {
        const bar = Math.floor(step / STEPS_PER_BAR);
        const beat = step % STEPS_PER_BAR;
        const chord = PROGRESSION[bar];

        // Drums.
        if (KICK_STEPS.includes(beat)) this.kick(time);
        if (SNARE_STEPS.includes(beat)) this.snare(time);
        if (beat % 2 === 0) this.hat(time, beat % 8 === 0);
        if (step === 0 || step === LOOP_STEPS / 2) this.crash(time);

        // Guitar: gallop, with the downbeats left ringing.
        if (GUITAR_STEPS.includes(beat))
        {
            const open = beat === 0 || beat === 8;
            this.guitar(time, this.hz(chord), open ? STEP * 3.2 : STEP * 0.75, open);
        }

        // Bass.
        if (BASS_STEPS.includes(beat))
        {
            const octave = beat === 6 || beat === 14 ? 12 : 0;
            this.bass(time, this.hz(chord - 12 + octave), STEP * 1.6);
        }

        // Lead over the second half of the loop, one note per half bar.
        if (bar >= 4 && (beat === 0 || beat === 8))
        {
            const index = (bar - 4) * 2 + (beat === 8 ? 1 : 0);
            this.lead(time, this.hz(LEAD[index % LEAD.length]), STEP * 3.4);
        }
    }

    private hz (semitones: number): number
    {
        return ROOT * Math.pow(2, semitones / 12);
    }

    // -- voices -----------------------------------------------------------

    private buildVoices (): void
    {
        const ctx = this.ctx!;
        if (this.guitarBus) return;

        // Noise for the drums.
        const length = Math.floor(ctx.sampleRate * 0.5);
        this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

        // Guitar: hard clipping into a speaker-ish band. Built once and shared.
        const guitar = ctx.createGain();
        guitar.gain.value = 0.14;

        const dist = ctx.createWaveShaper();
        dist.curve = this.distortionCurve(70);
        dist.oversample = '2x';

        const cabLow = ctx.createBiquadFilter();
        cabLow.type = 'lowpass';
        cabLow.frequency.value = 3200;
        cabLow.Q.value = 0.9;

        const cabHigh = ctx.createBiquadFilter();
        cabHigh.type = 'highpass';
        cabHigh.frequency.value = 110;

        const presence = ctx.createBiquadFilter();
        presence.type = 'peaking';
        presence.frequency.value = 1800;
        presence.Q.value = 1;
        presence.gain.value = 5;

        guitar.connect(dist).connect(cabHigh).connect(cabLow).connect(presence).connect(this.out!);
        this.guitarBus = guitar;

        // Bass: a little grit, mostly weight.
        const bass = ctx.createGain();
        bass.gain.value = 0.3;

        const bassDist = ctx.createWaveShaper();
        bassDist.curve = this.distortionCurve(8);

        const bassLow = ctx.createBiquadFilter();
        bassLow.type = 'lowpass';
        bassLow.frequency.value = 900;
        bassLow.Q.value = 0.7;

        bass.connect(bassDist).connect(bassLow).connect(this.out!);
        this.bassBus = bass;

        const drums = ctx.createGain();
        drums.gain.value = 0.4;
        drums.connect(this.out!);
        this.drumBus = drums;
    }

    private distortionCurve (amount: number): Float32Array
    {
        const n = 1024;
        const curve = new Float32Array(n);

        for (let i = 0; i < n; i++)
        {
            const x = (i * 2) / n - 1;
            curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
        }

        return curve;
    }

    /** Power chord: root plus fifth, the way a guitar actually plays it. */
    private guitar (time: number, freq: number, duration: number, open: boolean): void
    {
        const ctx = this.ctx!;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(open ? 1 : 0.7, time + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        gain.connect(this.guitarBus!);

        for (const [ratio, level, detune] of [[1, 1, -6], [1.4983, 0.8, 5], [2, 0.5, 0]] as const)
        {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = freq * ratio;
            osc.detune.value = detune;

            const g = ctx.createGain();
            g.gain.value = level;

            osc.connect(g).connect(gain);
            osc.start(time);
            osc.stop(time + duration + 0.05);
        }
    }

    private bass (time: number, freq: number, duration: number): void
    {
        const ctx = this.ctx!;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(1, time + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        gain.connect(this.bassBus!);

        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;

        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = freq / 2;

        const subGain = ctx.createGain();
        subGain.gain.value = 0.6;

        osc.connect(gain);
        sub.connect(subGain).connect(gain);

        osc.start(time);
        sub.start(time);
        osc.stop(time + duration + 0.05);
        sub.stop(time + duration + 0.05);
    }

    private lead (time: number, freq: number, duration: number): void
    {
        const ctx = this.ctx!;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.5, time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        gain.connect(this.guitarBus!);

        for (const detune of [-8, 7])
        {
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = freq;
            osc.detune.value = detune;
            osc.connect(gain);
            osc.start(time);
            osc.stop(time + duration + 0.05);
        }
    }

    private kick (time: number): void
    {
        const ctx = this.ctx!;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(0.9, time + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
        gain.connect(this.drumBus!);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, time);
        osc.frequency.exponentialRampToValueAtTime(44, time + 0.09);
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + 0.2);

        // Beater click, so it cuts through the guitars.
        const click = ctx.createBufferSource();
        click.buffer = this.noise!;

        const clickFilter = ctx.createBiquadFilter();
        clickFilter.type = 'highpass';
        clickFilter.frequency.value = 1800;

        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.35, time);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);

        click.connect(clickFilter).connect(clickGain).connect(this.drumBus!);
        click.start(time);
        click.stop(time + 0.05);
    }

    private snare (time: number): void
    {
        const ctx = this.ctx!;

        const noise = ctx.createBufferSource();
        noise.buffer = this.noise!;

        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 1900;
        band.Q.value = 0.8;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.9, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

        noise.connect(band).connect(gain).connect(this.drumBus!);
        noise.start(time);
        noise.stop(time + 0.25);

        // Shell tone under the crack.
        const body = ctx.createOscillator();
        body.type = 'triangle';
        body.frequency.setValueAtTime(210, time);
        body.frequency.exponentialRampToValueAtTime(150, time + 0.1);

        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(0.5, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

        body.connect(bodyGain).connect(this.drumBus!);
        body.start(time);
        body.stop(time + 0.2);
    }

    private hat (time: number, accent: boolean): void
    {
        const ctx = this.ctx!;

        const noise = ctx.createBufferSource();
        noise.buffer = this.noise!;
        noise.playbackRate.value = 1.6;

        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 7000;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(accent ? 0.34 : 0.18, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + (accent ? 0.07 : 0.04));

        noise.connect(filter).connect(gain).connect(this.drumBus!);
        noise.start(time);
        noise.stop(time + 0.12);
    }

    private crash (time: number): void
    {
        const ctx = this.ctx!;

        const noise = ctx.createBufferSource();
        noise.buffer = this.noise!;
        noise.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 4200;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.1);

        noise.connect(filter).connect(gain).connect(this.drumBus!);
        noise.start(time);
        noise.stop(time + 1.2);
    }
}

export const music = new Music();
