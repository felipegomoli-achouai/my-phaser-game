import { Game as MainGame } from './scenes/Game';
import { sfx } from './Sfx';
import { AUTO, Game, Types } from 'phaser';

// Find out more information about the Game Config at:
// https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Types.Core.GameConfig = {
    type: AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#05080d',
    // All sound is synthesised in Sfx.ts, so Phaser's own audio stack is dead weight.
    audio: { noAudio: true },
    scene: [
        MainGame
    ]
};

const StartGame = (parent: string) => {
    const game = new Game({ ...config, parent });

    if (import.meta.env.DEV)
    {
        // Handy for poking at the battle from the browser console.
        (window as unknown as { game: Game; sfx: typeof sfx }).game = game;
        (window as unknown as { game: Game; sfx: typeof sfx }).sfx = sfx;
    }

    return game;
}

export default StartGame;
