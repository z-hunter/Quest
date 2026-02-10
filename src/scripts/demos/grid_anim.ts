import { ScriptRegistry } from '../../core/ScriptRegistry';

/**
 * Grid Animation Script
 * 
 * Jitters vertices of a 6x6 grid of Quads (q1-1 to q6-6).
 * Usage: RUN grid_anim [jitterAmount] [interval]
 */
ScriptRegistry.register('grid_anim', ({ api, args }) => {
  const jitter = args && args[0] ? parseFloat(args[0]) : 5;
  const interval = args && args[1] ? parseInt(args[1]) : 0;

  api.log(`Starting Grid Animation (jitter: ${jitter}, interval: ${interval}ms)...`);

  // Helper to get random number in range [-jitter, jitter]
  const randOffset = () => (Math.random() * 2 - 1) * jitter;

  // Use a timer to run the animation in the background
  // We use api.setInterval so it can be tracked and stopped by HALT
  api.setInterval(() => {
    // Pick a random quad in the 6x6 grid
    const x = Math.floor(Math.random() * 6) + 1;
    const y = Math.floor(Math.random() * 6) + 1;
    const quadId = `q${x}-${y}`;

    const quad = api.getQuad(quadId);
    if (quad) {
      // Pick a random vertex (0-3)
      const vIdx = Math.floor(Math.random() * 4);

      // Randomly decide to jitter X, Y, or both
      const currentV = (quad as any).vertices[vIdx];
      if (currentV) {
        const newX = currentV.x + randOffset();
        const newY = currentV.y + randOffset();

        // setVertex returns false if bound, ensuring we don't break things
        quad.setVertex(vIdx, newX, newY);
      }
    }
  }, interval);

  // No longer need manual global timer tracking


  api.log('Animation running. Use browser console to stop: clearInterval(window._gridAnimTimer)');
});
