import { ScriptRegistry } from '../../core/ScriptRegistry';

// Test Script for Console and API verification
ScriptRegistry.register('test_api', ({ api, args }) => {
  api.log(`Test API Running... Args: ${args ? args.join(', ') : 'none'}`);

  // Test Quad Manipulation
  // Assume there is a Quad named 'Q1' in the scene. If not, this will warn.
  const targetName = args && args[0] ? args[0] : 'Q1';

  api.log(`Moving vertex 1 of ${targetName} to 100,100...`);

  const quad = api.getQuad(targetName);
  if (quad) {
    api.log('Saving Checkpoint 1...');
    api.saveCheckpoint();

    const success1 = quad.setVertex(1, 100, 100);
    if (success1) api.log('Vertex 1 updated.');
    else api.log('Failed to update Vertex 1 (Bound?).');

    api.log('Saving Checkpoint 2...');
    api.saveCheckpoint();

    // Example with Parallax (p)
    const success2 = quad.setVertex(2, 200, 200, 1.5);
    if (success2) api.log('Vertex 2 updated with P=1.5.');
    else api.log('Failed to update Vertex 2.');

    api.log('Saving Checkpoint 3...');
    api.saveCheckpoint();

    // Partial Update: Change only X of Vertex 3
    const success3 = quad.setVertex(3, 300); // Y and P implicitly undefined
    if (success3) api.log('Vertex 3 X updated to 300 (Y preserved).');

    // Partial Update: Change only Y of Vertex 0
    const success4 = quad.setVertex(0, undefined, 50);
    if (success4) api.log('Vertex 0 Y updated to 50 (X preserved).');
  } else {
    api.log(`Quad '${targetName}' not found.`);
  }

  api.log('Done.');
});
