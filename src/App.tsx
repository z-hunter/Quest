import { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { UIOverlay } from './components/UIOverlay';
import { Game } from './core/Game';
import './index.css';

function App() {
  const [game, setGame] = useState<Game | null>(null);

  return (
    <div id="game-container">
      <GameCanvas onGameInit={setGame} />
      <UIOverlay game={game} />
    </div>
  );
}

export default App;
