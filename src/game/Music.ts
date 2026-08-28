import { sfx } from './Sfx';

/**
 * "Iron Rotor" - an original action-game loop, written to 16-bit constraints
 * rather than filtered to sound like them.
 *
 * The rules the piece is composed under:
 *   - eight voices maximum at any instant (kit, hats, bass, riff, lead,
 *     answer, stab, and one spare), so every layer has to earn its place;
 *   - short samples means short envelopes: fast attacks, low sustain, quick
 *     releases, nothing left ringing into the next bar;
 *   - the riff drives the harmony over a pedal, instead of a chord progression
 *     carrying a melody;
 *   - density expands and contracts by section, which is how a small voice
 *     count still reads as an arrangement;
 *   - a short, dark delay is the only ambience.
 *
 * Everything is synthesised note by note through the same mixer as the sound
 * effects, so the mute key covers it too.
 */

const BPM = 160;
/** One sixteenth note. */
const STEP = 60 / BPM / 4;
const STEPS_PER_BAR = 16;

/** E1. Low enough for the bass, high enough to stay out of modern sub range. */
const ROOT = 41.2;

/** Nominal level of the whole track on its bus; ducking scales this. */
const MUSIC_LEVEL = 0.26;

// -- patterns -------------------------------------------------------------

/** Sixteen sixteenths per bar; -1 is a rest, numbers are semitones. */
type StepPattern = number[];

interface DrumPattern
{
    kick: number[];
    snare: number[];
    /** Quiet snare taps that push the groove along. */
    ghost?: number[];
    hat: number[];
    openHat?: number[];
}

const R = -1;

/**
 * Riffs: percussive cells, mostly root and fifth, with a flat second and a
 * flat fifth for the mechanical, unfriendly colour.
 */
const RIFF_A: StepPattern = [0, R, 0, R, 0, 0, R, 7, R, 0, R, 0, 1, R, 0, R];
const RIFF_B: StepPattern = [0, 0, R, 7, R, 5, R, 0, 0, R, 6, R, 0, R, 3, R];
const RIFF_DRIVE: StepPattern = [0, R, 12, R, 0, R, 7, R, 0, 0, R, 12, R, 7, R, 6];
const RIFF_HITS: StepPattern = [0, R, R, R, R, R, R, 0, R, R, R, R, 0, R, R, R];

/** Bass: octaves, repeats, chromatic approaches, syncopation, small gaps. */
const BASS_A: StepPattern = [0, R, 0, 12, 0, R, 0, R, 0, R, 12, R, 0, 1, 2, R];
const BASS_B: StepPattern = [0, 0, R, 0, 7, R, 0, R, 12, R, 10, R, 8, R, 7, R];
const BASS_DRIVE: StepPattern = [0, 12, 0, 12, 0, R, 0, 7, 0, 12, 0, 12, 3, R, 1, R];
const BASS_SPARSE: StepPattern = [0, R, R, R, R, R, 0, R, R, R, 12, R, R, R, 0, R];

const DRUMS_INTRO: DrumPattern = { kick: [0, 8], snare: [4, 12], hat: [0, 4, 8, 12] };
const DRUMS_MAIN: DrumPattern = {
    kick: [0, 3, 8, 10],
    snare: [4, 12],
    ghost: [7],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [14]
};
const DRUMS_PUSH: DrumPattern = {
    kick: [0, 3, 6, 8, 11, 14],
    snare: [4, 12],
    ghost: [10],
    hat: [0, 2, 4, 6, 8, 10, 12, 14]
};
const DRUMS_BREAK: DrumPattern = { kick: [0, 8], snare: [], hat: [4, 12] };
const DRUMS_CLIMAX: DrumPattern = {
    kick: [0, 2, 3, 6, 8, 10, 11, 14],
    snare: [4, 12],
    ghost: [7, 15],
    hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    openHat: [6]
};

/**
 * Melody: eight eighth notes per bar, -1 for a rest. Short motifs with real
 * gaps in them, repeated with small changes rather than spun out forever.
 */
const M = R;

/** Section A: tight, insistent, sitting on the pedal. */
const LEAD_A1 = [12, M, 15, 14, M, 12, M, M];
const LEAD_A2 = [10, M, 12, M, 14, M, M, M];
const LEAD_A3 = [12, M, 15, 17, M, 15, 14, M];
const LEAD_A4 = [12, M, 10, M, M, M, M, M];
const LEAD_A3B = [12, M, 15, 17, 19, M, 17, M];
const LEAD_A4B = [18, M, 17, M, 15, M, M, M];

/** Section B: opens up, climbs, leaves more air between phrases. */
const LEAD_B1 = [19, M, M, 17, M, 19, M, M];
const LEAD_B2 = [22, M, M, M, 19, M, 17, M];
const LEAD_B3 = [15, 17, 19, M, 22, M, M, M];
const LEAD_B4 = [24, M, M, M, M, M, M, M];
const LEAD_B3B = [19, 22, 24, M, 26, M, 24, M];
const LEAD_B4B = [22, M, 19, M, 17, M, M, M];

/** Climax: the A motif pushed an octave up and roughed up with the flat five. */
const LEAD_C1 = [24, M, 27, 26, M, 24, M, M];
const LEAD_C2 = [22, M, 24, M, 26, M, M, M];
const LEAD_C3 = [24, M, 27, 29, M, 30, 29, M];
const LEAD_C4 = [27, M, 24, M, M, M, M, M];

/** The second voice only answers: it never runs alongside the melody. */
const ANSWER_1 = [M, M, M, M, 7, M, 5, M];
const ANSWER_2 = [M, M, M, M, 12, 11, 10, M];
const ANSWER_3 = [M, M, M, M, 19, M, 17, 15];

interface Bar
{
    /** Pedal or riff root for this bar, in semitones above ROOT. */
    root: number;
    riff: StepPattern | null;
    bass: StepPattern | null;
    drums: DrumPattern;
    lead: number[] | null;
    answer: number[] | null;
    stab: boolean;
    /** Short fill across the last beat, leading into the next section. */
    fill: boolean;
}

const bar = (
    root: number,
    riff: StepPattern | null,
    bass: StepPattern | null,
    drums: DrumPattern,
    lead: number[] | null = null,
    answer: number[] | null = null,
    stab = false,
    fill = false
): Bar => ({ root, riff, bass, drums, lead, answer, stab, fill });

/**
 * Arrangement. Forty bars: intro, main riff, variation, a break that thins out,
 * the climax, then a turnaround that feeds straight back into the main riff.
 */
const SONG: Bar[] = [
    // INTRO - kit and bass only, riff joins on the third bar.
    bar(0, null, BASS_SPARSE, DRUMS_INTRO),
    bar(0, null, BASS_SPARSE, DRUMS_INTRO),
    bar(0, RIFF_HITS, BASS_A, DRUMS_MAIN),
    bar(1, RIFF_HITS, BASS_A, DRUMS_MAIN, null, null, false, true),

    // A - main riff, melody in short phrases.
    bar(0, RIFF_A, BASS_A, DRUMS_MAIN, LEAD_A1),
    bar(0, RIFF_A, BASS_A, DRUMS_MAIN, LEAD_A2),
    bar(3, RIFF_A, BASS_A, DRUMS_MAIN, LEAD_A3),
    bar(1, RIFF_A, BASS_A, DRUMS_MAIN, LEAD_A4, ANSWER_1),
    bar(0, RIFF_A, BASS_A, DRUMS_PUSH, LEAD_A1),
    bar(0, RIFF_A, BASS_A, DRUMS_PUSH, LEAD_A2),
    bar(3, RIFF_A, BASS_A, DRUMS_PUSH, LEAD_A3B),
    bar(5, RIFF_A, BASS_A, DRUMS_PUSH, LEAD_A4B, ANSWER_2, false, true),

    // B - riff moves, melody opens out and climbs.
    bar(0, RIFF_B, BASS_B, DRUMS_MAIN, LEAD_B1),
    bar(0, RIFF_B, BASS_B, DRUMS_MAIN, LEAD_B2),
    bar(5, RIFF_B, BASS_B, DRUMS_MAIN, LEAD_B3),
    bar(3, RIFF_B, BASS_B, DRUMS_MAIN, LEAD_B4, ANSWER_1),
    bar(0, RIFF_B, BASS_B, DRUMS_PUSH, LEAD_B1),
    bar(0, RIFF_B, BASS_B, DRUMS_PUSH, LEAD_B2),
    bar(6, RIFF_B, BASS_B, DRUMS_PUSH, LEAD_B3B),
    bar(1, RIFF_B, BASS_B, DRUMS_PUSH, LEAD_B4B, ANSWER_3, false, true),

    // BREAK - drums thin out, no melody, stabs climb chromatically.
    bar(0, RIFF_HITS, BASS_SPARSE, DRUMS_BREAK, null, null, true),
    bar(1, RIFF_HITS, BASS_SPARSE, DRUMS_BREAK, null, null, true),
    bar(3, RIFF_HITS, BASS_SPARSE, DRUMS_PUSH, null, null, true),
    bar(5, RIFF_HITS, BASS_DRIVE, DRUMS_PUSH, null, null, true, true),

    // CLIMAX - everything at once, melody an octave up.
    bar(0, RIFF_DRIVE, BASS_DRIVE, DRUMS_CLIMAX, LEAD_C1, null, true),
    bar(0, RIFF_DRIVE, BASS_DRIVE, DRUMS_CLIMAX, LEAD_C2, null, true),
    bar(3, RIFF_DRIVE, BASS_DRIVE, DRUMS_CLIMAX, LEAD_C3, null, true),
    bar(1, RIFF_DRIVE, BASS_DRIVE, DRUMS_CLIMAX, LEAD_C4, ANSWER_2, true),
    bar(0, RIFF_DRIVE, BASS_DRIVE, DRUMS_CLIMAX, LEAD_C1, null, true),
    bar(0, RIFF_DRIVE, BASS_DRIVE, DRUMS_CLIMAX, LEAD_C2, null, true),
    bar(6, RIFF_DRIVE, BASS_DRIVE, DRUMS_CLIMAX, LEAD_C3, null, true),
    bar(5, RIFF_DRIVE, BASS_DRIVE, DRUMS_CLIMAX, LEAD_C4, ANSWER_3, true, true),

    // TURNAROUND - stabs drop out, the riff walks the loop back to A.
    bar(0, RIFF_A, BASS_A, DRUMS_PUSH, LEAD_A1),
    bar(0, RIFF_A, BASS_A, DRUMS_PUSH, LEAD_A2),
    bar(3, RIFF_A, BASS_B, DRUMS_PUSH, LEAD_A3B),
    bar(1, RIFF_A, BASS_B, DRUMS_PUSH, LEAD_A4B, ANSWER_1),
    bar(0, RIFF_B, BASS_DRIVE, DRUMS_PUSH, null, null),
    bar(3, RIFF_B, BASS_DRIVE, DRUMS_PUSH, null, ANSWER_2),
    bar(5, RIFF_DRIVE, BASS_DRIVE, DRUMS_PUSH, null, null),
    bar(6, RIFF_DRIVE, BASS_DRIVE, DRUMS_PUSH, null, null, false, true)
];

/** The loop comes back to the main riff, never to the intro. */
const LOOP_START_BAR = 4;
const TOTAL_STEPS = SONG.length * STEPS_PER_BAR;
const LOOP_START_STEP = LOOP_START_BAR * STEPS_PER_BAR;

export class Music
{
    private ctx: AudioContext | null = null;
    private out: GainNode | null = null;

    /** One bus per voice, built once. Per-note filter chains were too costly. */
    private guitarBus: GainNode | null = null;
    private bassBus: GainNode | null = null;
    private leadBus: GainNode | null = null;
    private answerBus: GainNode | null = null;
    private stabBus: GainNode | null = null;
    private drumBus: GainNode | null = null;
    private hatBus: GainNode | null = null;
    private echoIn: GainNode | null = null;
    private vibrato: GainNode | null = null;
    private noise: AudioBuffer | null = null;

    private timer: number | null = null;
    private nextNoteTime = 0;
    private step = 0;
    private playing = false;

    get isPlaying (): boolean
    {
        return this.playing;
    }

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
     * Look-ahead scheduling: every 25 ms, queue every note landing in the next
     * quarter second. The audio clock keeps time, not the timer.
     */
    private schedule (): void
    {
        const ctx = this.ctx;
        if (!ctx) return;

        while (this.nextNoteTime < ctx.currentTime + 0.25)
        {
            this.scheduleStep(this.step, this.nextNoteTime);
            this.nextNoteTime += STEP;

            this.step++;
            if (this.step >= TOTAL_STEPS) this.step = LOOP_START_STEP;
        }
    }

    private scheduleStep (step: number, time: number): void
    {
        const barIndex = Math.floor(step / STEPS_PER_BAR);
        const beat = step % STEPS_PER_BAR;
        const current = SONG[barIndex];

        this.playDrums(current, beat, time);

        // Riff: short, percussive, palm-muted except on the downbeat.
        if (current.riff)
        {
            const note = current.riff[beat];

            if (note >= 0)
            {
                const open = beat === 0;
                this.guitar(time, this.hz(current.root + note + 24), open ? STEP * 1.9 : STEP * 0.62);
            }
        }

        // Bass: its own line, sharing the riff's rhythmic attitude.
        if (current.bass)
        {
            const note = current.bass[beat];
            if (note >= 0) this.bass(time, this.hz(current.root + note + 12), STEP * 1.25);
        }

        // Chord stabs: off-beat, very short, only in the loud sections.
        if (current.stab && (beat === 2 || beat === 10))
        {
            this.stab(time, current.root + 24);
        }

        // Melody and answer, on eighths.
        if (beat % 2 === 0)
        {
            const slot = beat / 2;

            if (current.lead)
            {
                const note = current.lead[slot];
                if (note >= 0) this.lead(time, this.hz(note + 36), this.holdLength(current.lead, slot));
            }

            if (current.answer)
            {
                const note = current.answer[slot];
                if (note >= 0) this.answer(time, this.hz(note + 36), this.holdLength(current.answer, slot) * 0.8);
            }
        }
    }

    private playDrums (current: Bar, beat: number, time: number): void
    {
        const kit = current.drums;

        // A fill takes over the last beat of the bar it is written on.
        if (current.fill && beat >= 12)
        {
            if (beat === 12) this.snare(time, 0.85);
            else this.snare(time, 0.4 + (beat - 12) * 0.15);
            if (beat === 12 || beat === 14) this.kick(time);

            return;
        }

        if (kit.kick.includes(beat)) this.kick(time);
        if (kit.snare.includes(beat)) this.snare(time, 0.9);
        if (kit.ghost?.includes(beat)) this.snare(time, 0.22);
        if (kit.openHat?.includes(beat)) this.hat(time, 'open');
        else if (kit.hat.includes(beat)) this.hat(time, beat % 4 === 0 ? 'accent' : 'closed');
        if (beat === 0 && current.stab) this.crash(time);
    }

    /** A note rings until the next event in its own line, never past that. */
    private holdLength (line: number[], slot: number): number
    {
        let held = 1;

        while (line[slot + held] === R && held < 8) held++;

        return STEP * 2 * held * 0.85;
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

        const length = Math.floor(ctx.sampleRate * 0.5);
        this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

        // Short, dark echo: one repeat, duller than the source. The only space
        // in the mix - no reverb anywhere.
        const echo = ctx.createGain();
        echo.gain.value = 1;

        const delay = ctx.createDelay(1);
        delay.delayTime.value = STEP * 3;

        const damp = ctx.createBiquadFilter();
        damp.type = 'lowpass';
        damp.frequency.value = 1900;

        const feedback = ctx.createGain();
        feedback.gain.value = 0.26;

        const echoLevel = ctx.createGain();
        echoLevel.gain.value = 0.3;

        echo.connect(delay);
        delay.connect(damp).connect(feedback).connect(delay);
        delay.connect(echoLevel).connect(this.out!);
        this.echoIn = echo;

        // Slight, constant instability on the lead: the digital wobble.
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 5.4;

        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 7; // cents
        lfo.connect(lfoDepth);
        lfo.start();
        this.vibrato = lfoDepth;

        // Guitar: hard clipping into a narrow speaker band, panned a little
        // left so the lead has the middle.
        this.guitarBus = this.chain({
            level: 0.16,
            pan: -0.24,
            nodes: [
                this.distortion(60),
                this.filter('highpass', 190),
                this.filter('lowpass', 2900, 0.9)
            ],
            echoSend: 0.18
        });

        // Bass: centred, gritty, deliberately not extended into modern sub.
        this.bassBus = this.chain({
            level: 0.34,
            pan: 0,
            nodes: [
                this.distortion(6),
                this.filter('highpass', 55),
                this.filter('lowpass', 1300, 0.8)
            ]
        });

        // Lead: centred, mid-forward, no low end of its own.
        this.leadBus = this.chain({
            level: 0.2,
            pan: 0,
            nodes: [
                this.distortion(4),
                this.filter('highpass', 320),
                this.filter('lowpass', 4600, 1.1)
            ],
            echoSend: 0.34
        });

        // Second voice: thinner, panned right, clearly a different singer.
        this.answerBus = this.chain({
            level: 0.15,
            pan: 0.38,
            nodes: [
                this.filter('highpass', 500),
                this.filter('lowpass', 3800, 0.9)
            ],
            echoSend: 0.3
        });

        // Stabs: synthetic strings, short, slightly right of centre.
        this.stabBus = this.chain({
            level: 0.11,
            pan: 0.22,
            nodes: [
                this.filter('highpass', 380),
                this.filter('lowpass', 3400, 0.8)
            ],
            echoSend: 0.2
        });

        // Kit: dry and close. Hats sit slightly off centre for separation.
        this.drumBus = this.chain({ level: 0.42, pan: 0, nodes: [] });
        this.hatBus = this.chain({ level: 0.3, pan: 0.24, nodes: [this.filter('highpass', 6000)] });
    }

    /** Builds a voice bus: gain -> processing -> panner -> out (+ echo send). */
    private chain (config: {
        level: number;
        pan: number;
        nodes: AudioNode[];
        echoSend?: number;
    }): GainNode
    {
        const ctx = this.ctx!;
        const input = ctx.createGain();
        input.gain.value = config.level;

        let tail: AudioNode = input;
        for (const node of config.nodes)
        {
            tail.connect(node);
            tail = node;
        }

        const panner = ctx.createStereoPanner();
        panner.pan.value = config.pan;
        tail.connect(panner);
        panner.connect(this.out!);

        if (config.echoSend && this.echoIn)
        {
            const send = ctx.createGain();
            send.gain.value = config.echoSend;
            panner.connect(send).connect(this.echoIn);
        }

        return input;
    }

    private filter (type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode
    {
        const node = this.ctx!.createBiquadFilter();
        node.type = type;
        node.frequency.value = frequency;
        node.Q.value = q;

        return node;
    }

    private distortion (amount: number): WaveShaperNode
    {
        const ctx = this.ctx!;
        const shaper = ctx.createWaveShaper();
        const n = 1024;
        const curve = new Float32Array(n);

        for (let i = 0; i < n; i++)
        {
            const x = (i * 2) / n - 1;
            curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
        }

        shaper.curve = curve;
        shaper.oversample = '2x';

        return shaper;
    }

    /** Fast attack, quick decay, low sustain, short release. */
    private envelope (time: number, duration: number, peak: number, sustain: number): GainNode
    {
        const ctx = this.ctx!;
        const gain = ctx.createGain();

        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(peak, time + 0.004);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * sustain), time + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

        return gain;
    }

    /** Power chord: root and fifth, plus the octave for bite. */
    private guitar (time: number, freq: number, duration: number): void
    {
        const ctx = this.ctx!;
        const gain = this.envelope(time, duration, 1, 0.35);
        gain.connect(this.guitarBus!);

        for (const [ratio, level, detune] of [[1, 1, -7], [1.4983, 0.75, 6], [2, 0.4, 0]] as const)
        {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = freq * ratio;
            osc.detune.value = detune;

            const g = ctx.createGain();
            g.gain.value = level;
            osc.connect(g).connect(gain);
            osc.start(time);
            osc.stop(time + duration + 0.03);
        }
    }

    private bass (time: number, freq: number, duration: number): void
    {
        const ctx = this.ctx!;
        const gain = this.envelope(time, duration, 1, 0.55);
        gain.connect(this.bassBus!);

        const body = ctx.createOscillator();
        body.type = 'sawtooth';
        body.frequency.value = freq;

        const edge = ctx.createOscillator();
        edge.type = 'square';
        edge.frequency.value = freq;
        edge.detune.value = 6;

        const edgeGain = ctx.createGain();
        edgeGain.gain.value = 0.4;

        body.connect(gain);
        edge.connect(edgeGain).connect(gain);

        body.start(time);
        edge.start(time);
        body.stop(time + duration + 0.03);
        edge.stop(time + duration + 0.03);
    }

    /** Pulse-and-saw lead with a touch of scoop and constant vibrato. */
    private lead (time: number, freq: number, duration: number): void
    {
        const ctx = this.ctx!;
        const gain = this.envelope(time, duration, 1, 0.75);
        gain.connect(this.leadBus!);

        for (const [type, detune, mix] of [['square', -6, 0.7], ['sawtooth', 7, 0.45]] as const)
        {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.detune.value = detune;
            osc.frequency.setValueAtTime(freq * 0.99, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + 0.025);
            this.vibrato?.connect(osc.detune);

            const g = ctx.createGain();
            g.gain.value = mix;
            osc.connect(g).connect(gain);
            osc.start(time);
            osc.stop(time + duration + 0.03);
        }
    }

    /** The answering voice: single pulse, thinner, no scoop. */
    private answer (time: number, freq: number, duration: number): void
    {
        const ctx = this.ctx!;
        const gain = this.envelope(time, duration, 1, 0.6);
        gain.connect(this.answerBus!);

        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + duration + 0.03);
    }

    /** Short synthetic string stab: moderate attack, no long tail. */
    private stab (time: number, semitones: number): void
    {
        const ctx = this.ctx!;
        const duration = STEP * 1.6;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(1, time + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.5, time + duration * 0.5);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        gain.connect(this.stabBus!);

        // Root, fifth, octave: a fifth-based stack, not a pop triad.
        for (const [offset, detune] of [[0, -8], [7, 5], [12, 0]] as const)
        {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = this.hz(semitones + offset);
            osc.detune.value = detune;
            osc.connect(gain);
            osc.start(time);
            osc.stop(time + duration + 0.03);
        }
    }

    private kick (time: number): void
    {
        const ctx = this.ctx!;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(1, time + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.13);
        gain.connect(this.drumBus!);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(160, time);
        osc.frequency.exponentialRampToValueAtTime(48, time + 0.07);
        osc.connect(gain);
        osc.start(time);
        osc.stop(time + 0.16);

        const click = ctx.createBufferSource();
        click.buffer = this.noise!;

        const clickGain = ctx.createGain();
        clickGain.gain.setValueAtTime(0.4, time);
        clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.015);

        click.connect(this.filter('highpass', 2200)).connect(clickGain).connect(this.drumBus!);
        click.start(time);
        click.stop(time + 0.04);
    }

    private snare (time: number, level: number): void
    {
        const ctx = this.ctx!;

        const noise = ctx.createBufferSource();
        noise.buffer = this.noise!;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(level, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);

        noise.connect(this.filter('bandpass', 2000, 0.9)).connect(gain).connect(this.drumBus!);
        noise.start(time);
        noise.stop(time + 0.16);

        const body = ctx.createOscillator();
        body.type = 'triangle';
        body.frequency.setValueAtTime(230, time);
        body.frequency.exponentialRampToValueAtTime(160, time + 0.06);

        const bodyGain = ctx.createGain();
        bodyGain.gain.setValueAtTime(level * 0.5, time);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);

        body.connect(bodyGain).connect(this.drumBus!);
        body.start(time);
        body.stop(time + 0.12);
    }

    private hat (time: number, kind: 'closed' | 'accent' | 'open'): void
    {
        const ctx = this.ctx!;
        const decay = kind === 'open' ? 0.16 : 0.03;
        const level = kind === 'accent' ? 0.5 : kind === 'open' ? 0.42 : 0.28;

        const noise = ctx.createBufferSource();
        noise.buffer = this.noise!;
        noise.playbackRate.value = 1.7;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(level, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);

        noise.connect(gain).connect(this.hatBus!);
        noise.start(time);
        noise.stop(time + decay + 0.03);
    }

    private crash (time: number): void
    {
        const ctx = this.ctx!;

        const noise = ctx.createBufferSource();
        noise.buffer = this.noise!;
        noise.loop = true;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.4, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.7);

        noise.connect(this.filter('highpass', 4800)).connect(gain).connect(this.hatBus!);
        noise.start(time);
        noise.stop(time + 0.8);
    }
}

export const music = new Music();
