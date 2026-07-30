# LLM provider contracts

`src/mechanics/llm/ILlmProvider.ts` задаёт общий boundary облачной и локальной модели:

- `LlmProviderMessage`, `LlmProviderContent` (`string` или text blocks);
- `sendMessage` и `sendMessageStream(systemPrompt, messages, onDelta)`;
- `LlmProviderResponse`: `ok`, text/model/duration и token-cache metrics;
- `LlmProviderErrorReason`: `api_error` или `timeout`;
- `isAvailable`, `getProviderName`, `getModelName`.

`AnthropicProvider` разбирает SSE, поддерживает cache-control и потоковые delta. `OllamaProvider` отправляет локальный HTTP-запрос, JSON-формат ответа, `num_ctx`/`keep_alive` и timeout.

Provider не знает Scene API и не меняет игру. Он возвращает текст в orchestrator, где выполняются JSON extraction, schema/plan validation и retry policy.

`Game` создаёт один provider через `createLlmProvider`; Parser и NPC Puppet Master получают тот же экземпляр. Build setting `VITE_LLM_PROVIDER` принимает `anthropic` (default) или `ollama`.

В packaged Tauri provider вызывает Rust command `invoke_llm`, а не browser fetch: Anthropic key остаётся в `ANTHROPIC_API_KEY` процесса, Ollama берёт `OLLAMA_BASE_URL` или `http://localhost:11434/v1/chat/completions`. Dev web продолжает использовать Vite proxy/direct fetch.

[[Game-Master-Implementation]] · [[AI-Validation-and-Guardrails]] · [[Parser-Implementation]]
