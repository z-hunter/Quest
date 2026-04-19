const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not visible in this shell.');
  console.error('PowerShell example:');
  console.error('  $env:ANTHROPIC_API_KEY="sk-ant-..."');
  console.error('  node scripts/check-anthropic.mjs');
  process.exit(2);
}

const maskedPrefix = `${apiKey.slice(0, Math.min(7, apiKey.length))}...`;
console.log(`ANTHROPIC_API_KEY visible: length=${apiKey.length}, prefix=${maskedPrefix}`);
console.log(`Testing Anthropic Messages API with model: ${model}`);

const startedAt = performance.now();

try {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 64,
      system: 'Reply with exactly: ANTHROPIC_OK',
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });

  const elapsedMs = Math.round(performance.now() - startedAt);
  const bodyText = await response.text();

  console.log(`HTTP ${response.status} ${response.statusText} in ${elapsedMs}ms`);

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    console.log('Non-JSON response body:');
    console.log(bodyText);
    process.exit(response.ok ? 0 : 1);
  }

  if (!response.ok) {
    console.log('Anthropic error response:');
    console.log(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  const text = Array.isArray(parsed.content)
    ? parsed.content
        .map((block) => (block && block.type === 'text' ? block.text : ''))
        .join('')
        .trim()
    : '';

  console.log(`Model response: ${text || '(empty)'}`);
  console.log(`Usage: ${JSON.stringify(parsed.usage || {})}`);

  if (text === 'ANTHROPIC_OK') {
    console.log('Anthropic API smoke test passed.');
  } else {
    console.log('Anthropic API responded, but not with the exact expected text.');
  }
} catch (error) {
  console.error('Anthropic API request failed before an HTTP response:');
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
