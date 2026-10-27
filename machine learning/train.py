"""Train the proctoring YOLO (phone + person). Run from machine learning/.

Stage presets:
    stage1  fresh train        python train.py --preset stage1
            (yolo11n.pt, imgsz 960, batch 8)
    stage2  video-domain tune  python train.py --preset stage2
            (train-7 best.pt, lr0 0.001, epochs 50, freeze 10)

Effective args are printed and saved next to the run; --eval-test runs
model.val(split="test") afterwards (needs prep_dataset.py --with-test).
"""
import argparse
import json
from pathlib import Path

import yaml
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent

DEFAULTS = dict(weights="yolo11n.pt", imgsz=960, batch=8, epochs=150,
                patience=30, lr0=None, freeze=None, workers=0, name=None)
PRESETS = {
    "stage1": {},
    "stage2": {"weights": "runs/detect/train-7/weights/best.pt",
               "lr0": 0.001, "epochs": 50, "freeze": 10},
}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--preset", choices=sorted(PRESETS))
    for key, val in DEFAULTS.items():
        if val is None:
            if key == "lr0":
                ap.add_argument("--lr0", type=float)
            elif key == "freeze":
                ap.add_argument("--freeze", type=int)
            else:
                ap.add_argument(f"--{key}")
        else:
            ap.add_argument(f"--{key}", type=int if isinstance(val, int) else str, default=val)
    ap.add_argument("--eval-test", action="store_true",
                    help="run model.val(split='test') after training")
    args = ap.parse_args()
    if args.preset:
        for key, val in PRESETS[args.preset].items():
            setattr(args, key, val)

    train_kwargs = dict(data="data/dataset.yaml", imgsz=args.imgsz,
                        batch=args.batch, epochs=args.epochs, patience=args.patience,
                        device=0, workers=args.workers, seed=42, name=args.name)
    if args.lr0 is not None:
        train_kwargs["lr0"] = args.lr0
    if args.freeze is not None:
        train_kwargs["freeze"] = args.freeze
    effective = {"weights": args.weights, **train_kwargs}
    print("effective train args:", json.dumps(effective, indent=2))

    model = YOLO(args.weights)  # checkpoint goes here, not in train()
    model.train(**train_kwargs)
    save_dir = Path(model.trainer.save_dir)
    (save_dir / "effective_args.json").write_text(json.dumps(effective, indent=2), encoding="utf-8")
    print(f"run dir: {save_dir}")

    if args.eval_test:
        cfg = yaml.safe_load((ROOT / "data" / "dataset.yaml").read_text(encoding="utf-8"))
        if "test" not in cfg:
            raise SystemExit("--eval-test: no test split in data/dataset.yaml — "
                             "run prep_dataset.py --with-test first")
        metrics = model.val(data="data/dataset.yaml", split="test")
        (save_dir / "test_metrics.json").write_text(
            json.dumps(metrics.results_dict, indent=2, default=str), encoding="utf-8")
        print("test metrics:", json.dumps(metrics.results_dict, default=str))


if __name__ == "__main__":
    # Guard required on Windows: dataloader workers re-import this module,
    # and without this guard they would re-run training recursively.
    main()
