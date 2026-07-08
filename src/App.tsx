import { useState, useEffect } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { UIOverlay } from './components/UIOverlay';
import { HierarchyPanel } from './components/editor/HierarchyPanel';
import { PropertiesPanel } from './components/editor/PropertiesPanel';
import { EditorBottomMenu } from './components/editor/EditorBottomMenu';
import { SpritePropertiesPanel } from './components/tools/SpritePropertiesPanel';
import { SpriteBottomMenu } from './components/tools/SpriteBottomMenu';
import { PlayerInventoryPanel } from './components/inventory/PlayerInventoryPanel';
import { useEditorStore } from './store/editorStore';
import { Game } from './core/Game';
import './index.css';
import './editor.css';

function App() {
  const [game, setGame] = useState<Game | null>(null);
  const { enabled: editorEnabled, spriteEditorEnabled, toggleSpriteEditor } = useEditorStore();

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#sprite-editor') {
        toggleSpriteEditor(true);
      } else {
        toggleSpriteEditor(false);
      }
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [toggleSpriteEditor]);

  useEffect(() => {
    if (!spriteEditorEnabled && window.location.hash === '#sprite-editor') {
      window.location.hash = '';
    }
  }, [spriteEditorEnabled]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const isSceneDirty = Game.instance?.editor?.persistenceManager?.isCurrentSceneDirty?.();
      const isSpriteDirty = Game.instance?.spriteEditor?.isDirty;

      if (isSceneDirty || isSpriteDirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const showLayout = (editorEnabled || spriteEditorEnabled) && game !== null;

  return (
    <div className="app-container">
      <div className="workspace-row">
        {/* Left Panel - Hierarchy or Empty/SpriteList */}
        {showLayout && (editorEnabled && !spriteEditorEnabled ? <HierarchyPanel /> : null)}
        {/* TODO: Sprite List? */}

        {/* Center Column: Game + Bottom Menu */}
        <div className="editor-center-column">
          {/* Center Game Area */}
          <div className="game-wrapper">
            <div id="game-container">
              <GameCanvas onGameInit={setGame} />
              {/* UIOverlay sits ABSOLUTELY on top of the GameCanvas inside this wrapper */}
              <UIOverlay game={game} />
              {!showLayout && game ? <PlayerInventoryPanel game={game} /> : null}
            </div>
          </div>

          {/* Bottom Bar - moved INSIDE the center column */}
          {showLayout &&
            (spriteEditorEnabled ? (
              <SpriteBottomMenu />
            ) : editorEnabled ? (
              <EditorBottomMenu />
            ) : null)}
        </div>

        {/* Right Panel - Properties */}
        {showLayout &&
          (spriteEditorEnabled ? (
            <SpritePropertiesPanel />
          ) : editorEnabled ? (
            <PropertiesPanel />
          ) : null)}
      </div>
    </div>
  );
}

export default App;
