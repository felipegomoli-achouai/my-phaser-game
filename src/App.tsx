import { useEffect, useRef, useState } from 'react';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { EventBus } from './game/EventBus';
import { sfx } from './game/Sfx';
import { net, type NetState } from './game/Net';

interface BattleResult
{
    title: string;
    score: { win: number; loss: number };
}

const OFFLINE: NetState = {
    status: 'offline',
    role: null,
    code: '',
    error: '',
    ping: 0
};

function App()
{
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [result, setResult] = useState<BattleResult | null>(null);
    const [muted, setMuted] = useState(false);
    const [netState, setNetState] = useState<NetState>(OFFLINE);
    const [codeInput, setCodeInput] = useState('');

    // The scene reads net.role in create(), so the match has to be rebuilt the
    // moment a connection comes up or goes down.
    const wasOnline = useRef(false);

    useEffect(() =>
    {
        const onOver = (payload: BattleResult) => setResult(payload);
        const onReady = () => setResult(null);

        const onNet = (state: NetState) =>
        {
            setNetState(state);

            const online = state.status === 'online';

            if (online !== wasOnline.current)
            {
                wasOnline.current = online;

                // Online and offline are different opponents, so the running
                // tally starts over rather than carrying the AI's rounds in.
                phaserRef.current?.game?.registry.set('score', { win: 0, loss: 0 });
                setResult(null);
                phaserRef.current?.scene?.scene.restart();
            }
        };

        EventBus.on('battle-over', onOver);
        EventBus.on('current-scene-ready', onReady);
        EventBus.on('audio-muted', setMuted);
        EventBus.on('net-state', onNet);

        return () =>
        {
            EventBus.off('battle-over', onOver);
            EventBus.off('current-scene-ready', onReady);
            EventBus.off('audio-muted', setMuted);
            EventBus.off('net-state', onNet);
        };
    }, []);

    const restart = () =>
    {
        sfx.unlock();
        phaserRef.current?.scene?.scene.restart();
    };

    const toggleMute = () =>
    {
        sfx.unlock();
        setMuted(sfx.toggleMute());
    };

    const createRoom = () =>
    {
        sfx.unlock();
        net.host().catch(() => undefined);
    };

    const joinRoom = () =>
    {
        sfx.unlock();
        net.join(codeInput).catch(() => undefined);
    };

    const leaveRoom = () =>
    {
        net.leave();
    };

    const copyCode = () =>
    {
        navigator.clipboard?.writeText(netState.code).catch(() => undefined);
    };

    // Phaser listens on the window, so typing a room code would otherwise
    // drive the top around and trip the R / M shortcuts.
    const setGameKeys = (enabled: boolean) =>
    {
        const keyboard = phaserRef.current?.game?.input.keyboard;

        if (keyboard) keyboard.enabled = enabled;
    };

    const busy = netState.status === 'starting' || netState.status === 'connecting';
    const online = netState.status === 'online';

    return (
        <div id="app">
            <PhaserGame ref={phaserRef} />
            <div className="sidebar">
                <h1>BEYBLADE PROTO</h1>
                <p>
                    Jogue o oponente pelos buracos ao norte e ao sul, ou zere o giro dele.
                    Os trilhos laterais prendem a ponta, aceleram e lançam contra o centro.
                </p>
                <ul>
                    <li><b>WASD / setas</b> — mover</li>
                    <li><b>Espaço</b> — investida (gasta giro)</li>
                    <li><b>Shift</b> — especial (barra amarela cheia)</li>
                    <li><b>Shift</b> durante o especial do oponente — revida e abre o duelo</li>
                    <li><b>Espaço</b> no duelo — 10 pancadas primeiro vence</li>
                    <li><b>R</b> — reiniciar</li>
                    <li><b>M</b> — mudo</li>
                </ul>

                <div className="net">
                    <h2>Online (2 jogadores)</h2>

                    {online ? (
                        <>
                            <p className="net-status">
                                Conectado como <b>{netState.role === 'host' ? 'anfitrião' : 'visitante'}</b>
                                {' '}— {netState.ping} ms
                            </p>
                            <p className="net-code">
                                Sala <b>{netState.code}</b>
                            </p>
                            <button className="button" onClick={leaveRoom}>Sair da sala</button>
                        </>
                    ) : netState.status === 'waiting' ? (
                        <>
                            <p className="net-status">
                                Passe este código para o outro jogador:
                            </p>
                            <p className="net-code"><b>{netState.code}</b></p>
                            <button className="button" onClick={copyCode}>Copiar código</button>
                            <button className="button" onClick={leaveRoom}>Cancelar</button>
                        </>
                    ) : (
                        <>
                            <p className="net-status">
                                Crie uma sala e passe o código, ou entre com o código de
                                alguém. A conexão é direta entre os dois navegadores.
                            </p>
                            <button className="button" onClick={createRoom} disabled={busy}>
                                {netState.status === 'starting' ? 'Criando…' : 'Criar sala'}
                            </button>
                            <div className="net-join">
                                <input
                                    className="net-input"
                                    value={codeInput}
                                    maxLength={5}
                                    placeholder="CÓDIGO"
                                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                                    onFocus={() => setGameKeys(false)}
                                    onBlur={() => setGameKeys(true)}
                                    onKeyDown={(e) =>
                                    {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') joinRoom();
                                    }}
                                />
                                <button className="button" onClick={joinRoom} disabled={busy}>
                                    {netState.status === 'connecting' ? 'Entrando…' : 'Entrar'}
                                </button>
                            </div>
                        </>
                    )}

                    {netState.error && <p className="net-error">{netState.error}</p>}
                </div>

                <p className="score">
                    Placar: {result ? `${result.score.win} - ${result.score.loss}` : '0 - 0'}
                </p>
                <button className="button" onClick={restart}>Reiniciar</button>
                <button className="button" onClick={toggleMute}>
                    {muted ? 'Som: off' : 'Som: on'}
                </button>
            </div>
        </div>
    )
}

export default App
