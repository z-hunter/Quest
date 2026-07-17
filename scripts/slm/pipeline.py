#!/usr/bin/env python3
"""Reproducible Scanline SLM pipeline: export -> clean -> split -> train -> eval -> ONNX -> manifest."""
from __future__ import annotations

import argparse, hashlib, json, random, shutil
from pathlib import Path
from typing import Any

TOKENS = {
    "PAD": 0, "START": 1, "END": 2, "ESCALATE": 3,
    "MOVE_TO": 10, "TAKE": 11, "OPEN": 12, "CLOSE": 13, "PUT": 14,
    "COMMAND": 15, "TRAVERSE_EXIT": 16, "LOOK": 17, "EXAMINE": 18,
    "USE": 19, "WAIT": 20, "SAY": 21, "THINK_STRATEGY": 22,
    "REL_IN": 30, "REL_ON": 31, "REL_UNDER": 32, "REL_BEHIND": 33,
    "FLAG_REACHABLE": 40, "FLAG_HELD": 41, "FLAG_ROUTE_AVAILABLE": 42,
    "FLAG_UNREACHABLE": 43, "FLAG_CAN_OPEN": 44, "FLAG_CAN_CLOSE": 45,
    "FLAG_LOCKED": 46, "FLAG_KEY_HELD": 47, "FLAG_TARGET_OBJECTIVE": 48,
    "FLAG_ACTOR": 49, "DYNAMIC_ENTITY_BASE": 100,
}
SUPPORTED = {"MOVE_TO", "TAKE", "OPEN", "CLOSE", "PUT", "TRAVERSE_EXIT", "LOOK", "EXAMINE", "USE", "WAIT"}
SCHEMA_VERSION, VOCAB_VERSION = 1, "slm-v1"
MODEL_VOCAB_SIZE = 2048

def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def jsonl(path: Path) -> list[dict[str, Any]]:
    rows=[]
    with path.open(encoding="utf-8") as stream:
        for line_no, line in enumerate(stream, 1):
            if line.strip():
                try: rows.append(json.loads(line))
                except json.JSONDecodeError as exc: raise ValueError(f"{path}:{line_no}: {exc}") from exc
    return rows

def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(canonical(row)+"\n" for row in rows), encoding="utf-8")

def valid_row(row: dict[str, Any]) -> bool:
    plans=row.get("generatedPlans")
    return (row.get("outcome")=="plan_completed" and row.get("worldChanged") is True
            and isinstance(row.get("minifiedDynamicContext"), dict) and isinstance(plans,list) and len(plans)==1
            and isinstance(plans[0], dict)
            and isinstance(plans[0].get("steps"),list) and len(plans[0]["steps"])>0
            and all(isinstance(step, dict) and step.get("type") in SUPPORTED for step in plans[0]["steps"]))

def clean(source: Path, target: Path) -> list[dict[str, Any]]:
    unique={}
    for row in jsonl(source):
        if valid_row(row):
            key=digest({"context":row["minifiedDynamicContext"],"plans":row["generatedPlans"]})
            unique[key]=row
    rows=[unique[key] for key in sorted(unique)]
    write_jsonl(target, rows); return rows

def split(source: Path, out: Path, seed: int) -> dict[str,int]:
    rows=jsonl(source); random.Random(seed).shuffle(rows)
    n=len(rows); train_end=min(n, max(1 if n else 0, int(n*.8))); val_end=min(n, train_end+int(n*.1))
    groups={"train":rows[:train_end],"validation":rows[train_end:val_end],"test":rows[val_end:]}
    for name, values in groups.items(): write_jsonl(out/f"{name}.jsonl",values)
    return {name:len(values) for name,values in groups.items()}

def mapping(context: dict[str,Any]) -> tuple[dict[str,int],dict[int,str]]:
    ids=[]
    for entity in context.get("entities",[]): ids.append(entity.get("id"))
    ids += context.get("inventory",{}).get("itemIds",[]) + context.get("visibleItemIds",[])
    ids += [actor.get("id") for actor in context.get("actors",[])]
    ordered=[]
    for item in ids:
        if isinstance(item,str) and item not in ordered: ordered.append(item)
    forward={item:TOKENS["DYNAMIC_ENTITY_BASE"]+i for i,item in enumerate(ordered)}
    return forward,{value:key for key,value in forward.items()}

def encode_input(context: dict[str,Any]) -> tuple[list[int],dict[str,int]]:
    ids,_=mapping(context); result=[TOKENS["START"]]
    objectives=" ".join(context.get("objectives",[])).lower()
    for entity in context.get("entities",[]):
        entity_id=entity.get("id"); token=ids.get(entity_id)
        if token is None: continue
        words=(str(entity_id)+" "+str(entity.get("title",''))).lower().replace('_',' ').split()
        if any(len(word)>=3 and word in objectives for word in words): result += [TOKENS["FLAG_TARGET_OBJECTIVE"],token]
    for item in context.get("inventory",{}).get("itemIds",[]):
        if item in ids: result += [TOKENS["FLAG_HELD"],ids[item]]
    for entity in context.get("entities",[]):
        token=ids.get(entity.get("id"));
        if token is None: continue
        result.append(token)
        if entity.get("interaction") in ("reachable","held"): result.append(TOKENS["FLAG_REACHABLE"])
        if entity.get("approach") in ("route_available","already_reachable"): result.append(TOKENS["FLAG_ROUTE_AVAILABLE"])
        elif entity.get("approach")=="unreachable": result.append(TOKENS["FLAG_UNREACHABLE"])
        switch=entity.get("switch") or {}
        for field,name in (("canOpen","FLAG_CAN_OPEN"),("canClose","FLAG_CAN_CLOSE"),("locked","FLAG_LOCKED"),("keyHeld","FLAG_KEY_HELD")):
            if switch.get(field): result.append(TOKENS[name])
    for actor in context.get("actors",[]):
        if actor.get("id") in ids: result += [ids[actor["id"]],TOKENS["FLAG_ACTOR"]]
    return result+[TOKENS["END"]],ids

def encode_output(row: dict[str,Any], ids: dict[str,int]) -> list[int]:
    output=[TOKENS["START"]]
    for step in row["generatedPlans"][0]["steps"]:
        kind=step["type"]; output.append(TOKENS[kind])
        fields={"MOVE_TO":["targetId"],"TAKE":["targetId"],"OPEN":["targetId"],"CLOSE":["targetId"],
                "PUT":["itemId","targetId"],"TRAVERSE_EXIT":["targetId"],"LOOK":["targetId"],
                "EXAMINE":["targetId"],"USE":["itemId","targetId"],"WAIT":[]}[kind]
        for field in fields:
            target=step.get(field)
            if not isinstance(target,str) or target not in ids: return [TOKENS["START"],TOKENS["ESCALATE"],TOKENS["END"]]
            output.append(ids[target])
    return output+[TOKENS["END"]]

def tensors(rows: list[dict[str,Any]], max_input:int, max_output:int):
    encoded=[]
    oversized_count = 0
    for row in rows:
        inp,ids=encode_input(row["minifiedDynamicContext"]); out=encode_output(row,ids)
        if len(out) > max_output:
            oversized_count += 1
            out = [TOKENS["START"], TOKENS["ESCALATE"], TOKENS["END"]]
        encoded.append((inp[:max_input]+[0]*max(0,max_input-len(inp)),out[:max_output]+[0]*max(0,max_output-len(out))))
    if oversized_count > 0:
        import sys
        sys.stderr.write(f"Oversized output plans (escalated): {oversized_count}\n")
    return encoded

def require_torch():
    try: import torch
    except ImportError as exc: raise SystemExit("Training/export requires: pip install -r scripts/slm/requirements.txt") from exc
    return torch

def train(data:Path, checkpoint:Path, epochs:int, seed:int, max_input:int, max_output:int) -> dict[str,Any]:
    torch=require_torch(); torch.manual_seed(seed)
    rows=jsonl(data); pairs=tensors(rows,max_input,max_output)
    if not pairs: raise SystemExit("Training split is empty")
    highest=max(max(max(x),max(y)) for x,y in pairs)
    if highest >= MODEL_VOCAB_SIZE: raise SystemExit(f"Dynamic entity token {highest} exceeds model vocabulary capacity {MODEL_VOCAB_SIZE}")
    vocab=MODEL_VOCAB_SIZE
    class Model(torch.nn.Module):
        def __init__(self):
            super().__init__(); self.emb=torch.nn.Embedding(vocab,64,padding_idx=0); self.gru=torch.nn.GRU(64,96,batch_first=True); self.head=torch.nn.Linear(96,max_output*vocab)
        def forward(self,x):
            _,hidden=self.gru(self.emb(x.long())); return self.head(hidden[-1]).reshape(-1,max_output,vocab)
    model=Model(); opt=torch.optim.AdamW(model.parameters(),lr=2e-3); loss_fn=torch.nn.CrossEntropyLoss(ignore_index=0)
    x=torch.tensor([p[0] for p in pairs]); y=torch.tensor([p[1] for p in pairs])
    model.train(); loss=0.0
    for _ in range(epochs):
        opt.zero_grad(); logits=model(x); value=loss_fn(logits.reshape(-1,vocab),y.reshape(-1)); value.backward(); opt.step(); loss=float(value)
    checkpoint.parent.mkdir(parents=True,exist_ok=True)
    torch.save({"state":model.state_dict(),"vocab_size":vocab,"max_input":max_input,"max_output":max_output,"epochs":epochs,"loss":loss},checkpoint)
    return {"trainLoss":loss,"trainSamples":len(rows)}

def load_model(checkpoint:Path):
    torch=require_torch(); saved=torch.load(checkpoint,map_location="cpu",weights_only=True); vocab=saved["vocab_size"]; max_output=saved["max_output"]
    class Model(torch.nn.Module):
        def __init__(self):
            super().__init__(); self.emb=torch.nn.Embedding(vocab,64,padding_idx=0); self.gru=torch.nn.GRU(64,96,batch_first=True); self.head=torch.nn.Linear(96,max_output*vocab)
        def forward(self,x):
            _,hidden=self.gru(self.emb(x.long())); return self.head(hidden[-1]).reshape(-1,max_output,vocab).argmax(-1).to(torch.int32)
    model=Model(); model.load_state_dict(saved["state"]); model.eval(); return torch,model,saved

def evaluate(checkpoint:Path,data:Path) -> dict[str,Any]:
    torch,model,saved=load_model(checkpoint); pairs=tensors(jsonl(data),saved["max_input"],saved["max_output"])
    if not pairs:return {"samples":0,"exactSequenceAccuracy":None,"tokenAccuracy":None}
    x=torch.tensor([p[0] for p in pairs]); y=torch.tensor([p[1] for p in pairs]); pred=model(x); mask=y.ne(0)
    return {"samples":len(pairs),"exactSequenceAccuracy":float(((pred==y)|~mask).all(1).float().mean()),"tokenAccuracy":float((pred[mask]==y[mask]).float().mean())}

def export_onnx(checkpoint:Path,target:Path) -> dict[str,Any]:
    torch,model,saved=load_model(checkpoint); target.parent.mkdir(parents=True,exist_ok=True)
    torch.onnx.export(model,torch.zeros((1,saved["max_input"]),dtype=torch.int32),target,input_names=["input_ids"],output_names=["output_ids"],dynamic_axes={"input_ids":{0:"batch"},"output_ids":{0:"batch"}},opset_version=17)
    return saved

def manifest(model:Path,target:Path,saved:dict[str,Any],metrics:dict[str,Any],dataset:Path) -> None:
    body={"schemaVersion":SCHEMA_VERSION,"modelId":"slm_routine_v1","vocabularyVersion":VOCAB_VERSION,"vocabularySha256":digest(TOKENS),
          "modelSha256":hashlib.sha256(model.read_bytes()).hexdigest(),"datasetSha256":hashlib.sha256(dataset.read_bytes()).hexdigest(),
          "onnxOpset":17,"maxDynamicEntities":MODEL_VOCAB_SIZE-TOKENS["DYNAMIC_ENTITY_BASE"],"inputs":[{"name":"input_ids","dtype":"int32","shape":["batch",saved["max_input"]]}],
          "outputs":[{"name":"output_ids","dtype":"int32","shape":["batch",saved["max_output"]]}],"metrics":metrics}
    target.write_text(json.dumps(body,indent=2,sort_keys=True)+"\n",encoding="utf-8")

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("stage",choices=["export","clean","split","train","eval","onnx","all"])
    parser.add_argument("--source",type=Path,default=Path("logs/slm_shadow_dataset.jsonl")); parser.add_argument("--work",type=Path,default=Path("artifacts/slm")); parser.add_argument("--publish",type=Path,default=Path("public/models")); parser.add_argument("--seed",type=int,default=1337); parser.add_argument("--epochs",type=int,default=30); parser.add_argument("--max-input",type=int,default=256); parser.add_argument("--max-output",type=int,default=64)
    args=parser.parse_args(); raw=args.work/"export.jsonl"; cleaned=args.work/"clean.jsonl"; splits=args.work/"splits"; checkpoint=args.work/"slm_routine_v1.pt"; model=args.publish/"slm_routine_v1.onnx"; report=args.work/"eval.json"
    if args.stage in ("export","all"): raw.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(args.source,raw)
    if args.stage in ("clean","all"): clean(raw,cleaned)
    if args.stage in ("split","all"): print(split(cleaned,splits,args.seed))
    if args.stage in ("train","all"): print(train(splits/"train.jsonl",checkpoint,args.epochs,args.seed,args.max_input,args.max_output))
    metrics={}
    if args.stage in ("eval","all"): metrics=evaluate(checkpoint,splits/"test.jsonl"); report.write_text(json.dumps(metrics,indent=2)+"\n",encoding="utf-8"); print(metrics)
    if args.stage in ("onnx","all"): saved=export_onnx(checkpoint,model); manifest(model,args.publish/"slm_routine_v1.manifest.json",saved,metrics or evaluate(checkpoint,splits/"test.jsonl"),cleaned)

if __name__=="__main__": main()
