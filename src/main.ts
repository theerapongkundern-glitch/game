import '@fontsource-variable/baloo-2';
import '@fontsource-variable/rubik';
import './ui/ui.css';
import './ui/menu.css';
import { Game } from './core/Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const ui = document.getElementById('ui-root') as HTMLElement;

function fail(message: string) {
  ui.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:24px;font:600 18px system-ui">
    <div><h1 style="font-size:36px;margin:0 0 12px">Prism Rush</h1><p>${message}</p></div></div>`;
}

try {
  const test = document.createElement('canvas');
  if (!test.getContext('webgl2')) throw new Error('no webgl2');
  const game = new Game(canvas, ui);
  (window as unknown as { __game: Game }).__game = game;
  game.start();
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fail('The graphics context was lost. Please reload the page.');
  });
} catch (err) {
  console.error(err);
  fail('Your browser needs WebGL 2 to run Prism Rush. Try the latest Chrome, Edge, Firefox or Safari.');
}
