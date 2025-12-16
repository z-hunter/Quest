import { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { UIOverlay } from './components/UIOverlay';
import { HierarchyPanel } from './components/editor/HierarchyPanel';
import { PropertiesPanel } from './components/editor/PropertiesPanel';
import { EditorBottomMenu } from './components/editor/EditorBottomMenu';
import { SpritePropertiesPanel } from './components/tools/SpritePropertiesPanel';
import { SpriteBottomMenu } from './components/tools/SpriteBottomMenu';
import { useEditorStore } from './store/editorStore';
import { Game } from './core/Game';
import './index.css';
import './editor.css';


function App() {
  const [game, setGame] = useState<Game | null>(null);
  const { enabled: editorEnabled, spriteEditorEnabled } = useEditorStore();

  const showLayout = editorEnabled || spriteEditorEnabled;

  return (
    <div className="app-container">
      <div className="workspace-row">
        {/* Left Panel - Hierarchy or Empty/SpriteList */}
        {showLayout && (
          editorEnabled && !spriteEditorEnabled ? <HierarchyPanel /> : null // TODO: Sprite List?
        )}

        {/* Center Game Area */}
        <div className="game-wrapper">
          <div id="game-container">
            <GameCanvas onGameInit={setGame} />
            {/* UIOverlay sits ABSOLUTELY on top of the GameCanvas inside this wrapper */}
            <UIOverlay game={game} />
          </div>
        </div>

        {/* Right Panel - Properties */}
        {showLayout && (
          spriteEditorEnabled ? <SpritePropertiesPanel /> : (editorEnabled ? <PropertiesPanel /> : null)
        )}
      </div>

      {/* Bottom Bar */}
      {showLayout && (
        spriteEditorEnabled ? <SpriteBottomMenu /> : (editorEnabled ? <EditorBottomMenu /> : null)
      )}
    </div>
  );
}

export default App;
