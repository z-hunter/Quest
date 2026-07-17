# Scanline SLM pipeline

The pipeline is deterministic for a fixed dataset and seed. It exports the runtime shadow log,
rejects unsafe/non-routine plans, deduplicates records, creates stable 80/10/10 splits, trains and
evaluates a compact GRU model, exports ONNX opset 17, and publishes a compatibility manifest.

```powershell
python -m pip install -r scripts/slm/requirements.txt
python scripts/slm/pipeline.py all
```

The source defaults to `logs/slm_shadow_dataset.jsonl`. Intermediate data and the checkpoint are
written below `artifacts/slm`; runtime artifacts are published as
`public/models/slm_routine_v1.onnx` and `slm_routine_v1.manifest.json`.

The manifest binds the model to the exact token vocabulary, tensor names/shapes, ONNX opset,
dataset fingerprint, model fingerprint, and held-out metrics. Runtime refuses an incompatible
artifact and falls back to the LLM.
