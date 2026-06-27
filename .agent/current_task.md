# Current Task: Local LLM Inference Migration (CPU / Ollama)

## Status: COMPLETED & PRESERVED (Temporarily switched back to Claude Haiku) ✅

## Summary of the local LLM stack
- Fully tuned `OllamaProvider.ts` (JSON mode + Grammar constraints + KV Prompt Caching).
- Verified local 3B model inference without timeouts (`qwen2.5:3b`).
- Currently switched back to `AnthropicProvider` (Claude Haiku) in `Parser.ts` and `Game.ts` per user request, with `new OllamaProvider()` left commented out right next to it.

## How to switch back to local LLM (Ollama)
1. In `src/mechanics/Parser.ts` line ~84:
   Change `new AnthropicProvider(), // new OllamaProvider(),` to `new OllamaProvider(),`
2. In `src/core/Game.ts` line ~227:
   Change `new AnthropicProvider() /* new OllamaProvider() */` to `new OllamaProvider()`
