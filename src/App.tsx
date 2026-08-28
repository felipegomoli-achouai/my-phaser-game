import { useEffect, useRef, useState } from 'react';
import { IRefPhaserGame, PhaserGame } from './PhaserGame';
import { EventBus } from './game/EventBus';

interface BattleResult
{
    title: string;
    score: { win: number; loss: number };
}

function App()
{
    const phaserRef = useRef<IRefPhaserGame | null>(null);
    const [result, setResult] = useState<BattleResult | null>(null);

    useEffect(() =>
    {
        const onOver = (payload: BattleResult) => setResult(payload);
        const onReady = () => setResult(null);

        EventBus.on('battle-over', onOver);
        EventBus.on('current-scene-ready', onReady);

        return () =>
        {
            EventBus.off('battle-over', onOver);
            EventBus.off('current-scene-ready', onReady);
        };
    }, []);

    const restart = () =>
    {
        phaserRef.current?.scene?.scene.restart();
    };

    return (
        <div id="app">
            <PhaserGame ref={phaserRef} />
            <div className="sidebar">
                <h1>BEYBLADE PROTO</h1>
                <p>Empurre o oponente para fora ou zere o giro dele.</p>
                <ul>
                    <li><b>WASD / setas</b> — mover</li>
                    <li><b>Espaço</b> — investida (gasta giro)</li>
                    <li><b>R</b> — reiniciar</li>
                </ul>
                <p className="score">
                    Placar: {result ? `${result.score.win} - ${result.score.loss}` : '0 - 0'}
                </p>
                <button className="button" onClick={restart}>Reiniciar</button>
            </div>
        </div>
    )
}

export default App
