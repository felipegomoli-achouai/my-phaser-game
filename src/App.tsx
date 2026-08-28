import { useEffect, useRef, useState } from 'react';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { EventBus } from './game/EventBus';
import { sfx } from './game/Sfx';

interface BattleResult
{
    title: string;
    score: { win: number; loss: number };
}

function App()
{
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [result, setResult] = useState<BattleResult | null>(null);
    const [muted, setMuted] = useState(false);

    useEffect(() =>
    {
        const onOver = (payload: BattleResult) => setResult(payload);
        const onReady = () => setResult(null);

        EventBus.on('battle-over', onOver);
        EventBus.on('current-scene-ready', onReady);
        EventBus.on('audio-muted', setMuted);

        return () =>
        {
            EventBus.off('battle-over', onOver);
            EventBus.off('current-scene-ready', onReady);
            EventBus.off('audio-muted', setMuted);
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
                    <li><b>R</b> — reiniciar</li>
                    <li><b>M</b> — mudo</li>
                </ul>
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
