window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.start();

    // Expose game instance for debugging
    window.game = game;
});
