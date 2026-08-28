import Peer, { type DataConnection } from 'peerjs';
import { EventBus } from './EventBus';

/**
 * Two-player networking over a WebRTC data channel, brokered by the public
 * PeerJS signalling server. Nothing of ours runs on a server: the broker only
 * introduces the two browsers, after which the packets go peer to peer.
 *
 * The model is host authority. The host runs the real match; the guest runs a
 * local copy for responsiveness and is corrected by the host's snapshots. This
 * side of the code knows nothing about the game - it is a typed pipe plus a
 * room code.
 */

export type NetRole = 'host' | 'guest';
export type NetStatus =
    | 'offline'
    | 'starting'
    | 'waiting'
    | 'connecting'
    | 'online'
    | 'error';

export interface NetState
{
    status: NetStatus;
    role: NetRole | null;
    code: string;
    error: string;
    ping: number;
}

/** Room ids share the broker's global namespace, so keep ours distinctive. */
const ID_PREFIX = 'beyproto-x7-';

/** No 0/O/1/I/L/S/5/B/8/2/Z: the code gets read out loud or typed from a chat. */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
const CODE_LENGTH = 5;

const HANDSHAKE_TIMEOUT = 20000;
const PING_INTERVAL = 1000;

/** Anything the game wants to put on the wire. */
export type NetMessage = Record<string, unknown> & { t: string };

type Handler = (message: NetMessage) => void;

function makeCode (): string
{
    let code = '';

    for (let i = 0; i < CODE_LENGTH; i++)
    {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }

    return code;
}

class Net
{
    private peer: Peer | null = null;
    private conn: DataConnection | null = null;
    private handlers = new Set<Handler>();
    private pingTimer: number | null = null;

    public role: NetRole | null = null;
    public status: NetStatus = 'offline';
    public code = '';
    public error = '';
    public ping = 0;

    get online (): boolean
    {
        return this.status === 'online' && this.conn !== null && this.conn.open;
    }

    get state (): NetState
    {
        return {
            status: this.status,
            role: this.role,
            code: this.code,
            error: this.error,
            ping: this.ping
        };
    }

    /** Opens a room and waits for the other player. Resolves with the code. */
    async host (): Promise<string>
    {
        this.leave();
        this.role = 'host';
        this.set('starting');

        const code = makeCode();

        try
        {
            const peer = await this.openPeer(ID_PREFIX + code);

            this.peer = peer;
            this.code = code;
            this.set('waiting');

            const conn = await new Promise<DataConnection>((resolve, reject) =>
            {
                const timer = window.setTimeout(
                    () => reject(new Error('Ninguem entrou na sala.')),
                    5 * 60 * 1000
                );

                peer.once('connection', (c) =>
                {
                    window.clearTimeout(timer);
                    resolve(c);
                });

                peer.once('error', (err) =>
                {
                    window.clearTimeout(timer);
                    reject(err);
                });
            });

            await this.adopt(conn);

            return code;
        }
        catch (err)
        {
            this.fail(err);
            throw err;
        }
    }

    /** Joins an open room by its code. */
    async join (rawCode: string): Promise<void>
    {
        const code = rawCode.trim().toUpperCase();

        if (code.length !== CODE_LENGTH)
        {
            this.role = 'guest';
            this.fail(new Error(`O codigo tem ${CODE_LENGTH} caracteres.`));
            throw new Error('bad code');
        }

        this.leave();
        this.role = 'guest';
        this.code = code;
        this.set('connecting');

        try
        {
            const peer = await this.openPeer();

            this.peer = peer;

            const conn = peer.connect(ID_PREFIX + code, {
                reliable: true,
                serialization: 'json'
            });

            // An empty room shows up as a broker error on the peer, not on the
            // connection, which would otherwise just sit there until it timed
            // out with a much less useful message.
            await Promise.race([
                this.adopt(conn),
                new Promise<never>((_, reject) =>
                {
                    peer.once('error', (err) => reject(err));
                })
            ]);
        }
        catch (err)
        {
            this.fail(err);
            throw err;
        }
    }

    /** Tears the connection down and goes back to single player. */
    leave (): void
    {
        if (this.pingTimer !== null)
        {
            window.clearInterval(this.pingTimer);
            this.pingTimer = null;
        }

        this.conn?.close();
        this.peer?.destroy();
        this.conn = null;
        this.peer = null;
        this.role = null;
        this.code = '';
        this.ping = 0;
        this.error = '';
        this.set('offline');
    }

    send (message: NetMessage): void
    {
        if (!this.conn || !this.conn.open) return;

        try
        {
            this.conn.send(message);
        }
        catch
        {
            // A channel that died mid-send surfaces through the close handler.
        }
    }

    on (handler: Handler): () => void
    {
        this.handlers.add(handler);

        return () => this.handlers.delete(handler);
    }

    // -- internals --------------------------------------------------------

    /** Wraps the callback-based Peer constructor in a promise. */
    private openPeer (id?: string): Promise<Peer>
    {
        return new Promise((resolve, reject) =>
        {
            const peer = id ? new Peer(id) : new Peer();

            const timer = window.setTimeout(() =>
            {
                peer.destroy();
                reject(new Error('O servidor de sinalizacao nao respondeu.'));
            }, HANDSHAKE_TIMEOUT);

            peer.once('open', () =>
            {
                window.clearTimeout(timer);
                resolve(peer);
            });

            peer.once('error', (err) =>
            {
                window.clearTimeout(timer);
                peer.destroy();
                reject(err);
            });
        });
    }

    /** Waits for the data channel to open, then wires it up. */
    private adopt (conn: DataConnection): Promise<void>
    {
        return new Promise((resolve, reject) =>
        {
            const timer = window.setTimeout(
                () => reject(new Error('Nao foi possivel abrir o canal de dados.')),
                HANDSHAKE_TIMEOUT
            );

            const ready = () =>
            {
                window.clearTimeout(timer);

                this.conn = conn;
                this.error = '';
                this.set('online');
                this.startPings();

                resolve();
            };

            conn.on('data', (data) => this.receive(data as NetMessage));

            conn.on('close', () =>
            {
                window.clearTimeout(timer);
                this.drop('A conexao caiu.');
            });

            conn.on('error', (err) =>
            {
                window.clearTimeout(timer);
                this.drop(err instanceof Error ? err.message : 'Erro na conexao.');
            });

            if (conn.open)
            {
                ready();
            }
            else
            {
                conn.once('open', ready);
            }
        });
    }

    private receive (message: NetMessage): void
    {
        if (!message || typeof message.t !== 'string') return;

        // Round trip time, measured from both ends.
        if (message.t === 'ping')
        {
            this.send({ t: 'pong', at: message.at as number });
            return;
        }

        if (message.t === 'pong')
        {
            this.ping = Math.round(performance.now() - (message.at as number));
            EventBus.emit('net-state', this.state);
            return;
        }

        for (const handler of this.handlers)
        {
            handler(message);
        }
    }

    private startPings (): void
    {
        if (this.pingTimer !== null) window.clearInterval(this.pingTimer);

        this.pingTimer = window.setInterval(() =>
        {
            this.send({ t: 'ping', at: performance.now() });
        }, PING_INTERVAL);
    }

    /** The other side went away: back to offline, but say why. */
    private drop (reason: string): void
    {
        if (this.status === 'offline') return;

        const wasOnline = this.status === 'online';

        this.leave();
        this.error = wasOnline ? reason : '';
        this.status = wasOnline ? 'error' : 'offline';

        EventBus.emit('net-state', this.state);
        EventBus.emit('net-closed', reason);
    }

    private fail (err: unknown): void
    {
        const message = err instanceof Error ? err.message : String(err);

        this.conn?.close();
        this.peer?.destroy();
        this.conn = null;
        this.peer = null;
        this.error = this.friendly(message);
        this.set('error');
    }

    /** PeerJS error strings are not something a player should have to read. */
    private friendly (message: string): string
    {
        if (message.includes('Could not connect to peer')
            || message.includes('peer-unavailable'))
        {
            return 'Sala nao encontrada. Confira o codigo.';
        }

        if (message.includes('unavailable-id'))
        {
            return 'Esse codigo ja esta em uso. Tente criar de novo.';
        }

        if (message.includes('network') || message.includes('server'))
        {
            return 'Sem conexao com o servidor de salas.';
        }

        return message;
    }

    private set (status: NetStatus): void
    {
        this.status = status;
        EventBus.emit('net-state', this.state);
    }
}

export const net = new Net();
