import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { startGame } from './game';

const root = document.getElementById('root')!;
const gameDiv = document.createElement('div');
gameDiv.id = 'game-container';
root.appendChild(gameDiv);

const uiDiv = document.createElement('div');
root.appendChild(uiDiv);

startGame(gameDiv);
createRoot(uiDiv).render(<App />);
