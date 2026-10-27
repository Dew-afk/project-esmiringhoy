"""Prepare the multi-class dataset (phone + person) for Ultralytics YOLO training.

Sources (never modified):
    phone  — images: dataset/image dataset/phone/*.jpg
             annotations: dataset/image dataset/phone/phoneanon/annotations.xml (CVAT 1.1)
    person — images: dataset/image dataset/secondperson/*.jpg
             annotations: dataset/image dataset/secondperson/secondpersonanon/annotations.xml (CVAT 1.1)

Class mapping: 0 = phone, 1 = person (person source labels are remapped 0 -> 1).

Negatives:
    - Unannotated CVAT images are excluded by default and listed in
      data/unannotated_review.csv; --include-unannotated-as-negatives adds them
      with empty label files after a verify-they're-really-negative warning.
    - Staged video frames (data/_video_frames, built by extract_frames.py) are
      added as negatives only for paths listed in data/negatives_approved.txt,
      split by PERSON per dataset/video dataset/splits.json — never by frame.

Outputs (under data/, cleared and rebuilt):
    images/{train,val[,test]} + labels/{train,val[,test]}
    unlabeled_phone.txt / unlabeled_person.txt / unannotated_review.csv
    dataset.yaml (regenerated; test: included when that split has images)
    suspected_duplicates.csv (cross-split dhash pairs)

--exclude FILE skips listed image stems entirely (one stem or path per line,
# comments) — raw data is never touched.

Splits: seeded (42) per-class shuffle; 80/20, or 70/15/15 with --with-test.
A final check fails loudly if any file name or video session spans splits, and
reports suspected near-duplicates (dhash) across splits.

Re-runnable: the data/images and data/labels output dirs are cleared first.
"""
import argparse
import csv
import itertools
import json
import random
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data"
STAGING = OUT / "_video_frames"
SEED = 42
DHASH_DIST = 4

SOURCES = [
    {
        "name": "phone",
        "images": ROOT / "dataset" / "image dataset" / "phone",
        "annotations": ROOT / "dataset" / "image dataset" / "phone" / "phoneanon" / "annotations.xml",
        "class_id": 0,
        "unlabeled_file": "unlabeled_phone.txt",
    },
    {
        "name": "person",
        "images": ROOT / "dataset" / "image dataset" / "secondperson",
        "annotations": ROOT / "dataset" / "image dataset" / "secondperson" / "secondpersonanon" / "annotations.xml",
        "class_id": 1,
        "unlabeled_file": "unlabeled_person.txt",
    },
]


def check_lines(stem: str, lines: list[str]) -> None:
    """Validate YOLO-format lines: 'cls x y w h', cls == 0, coords in [0, 1]."""
    for i, line in enumerate(lines, 1):
        parts = line.split()
        if len(parts) != 5:
            raise SystemExit(f"{stem}:{i} expected 5 values, got {len(parts)}: {line!r}")
        cls, *coords = map(float, parts)
        if int(cls) != 0:
            raise SystemExit(f"{stem}:{i} unexpected class {cls} (source class must be 0)")
        if any(not 0.0 <= c <= 1.0 for c in coords):
            raise SystemExit(f"{stem}:{i} coords outside [0,1]: {line!r}")


def load_cvat_xml(xml_path: Path) -> dict[str, list[str]]:
    """Parse a CVAT 1.1 annotations.xml -> {stem: ['0 cx cy w h', ...]}.

    CVAT boxes are pixel corners (xtl/ytl/xbr/ybr); converted to normalized
    center/size YOLO lines. Empty entries (no <box>) count as unannotated.
    """
    tree = ET.parse(xml_path)
    labels: dict[str, list[str]] = {}
    for im in tree.getroot().findall("image"):
        stem = Path(im.get("name")).stem
        w = float(im.get("width"))
        h = float(im.get("height"))
        lines = []
        for b in im.findall("box"):
            xtl, ytl = float(b.get("xtl")), float(b.get("ytl"))
            xbr, ybr = float(b.get("xbr")), float(b.get("ybr"))
            cx = (xtl + xbr) / 2 / w
            cy = (ytl + ybr) / 2 / h
            bw = (xbr - xtl) / w
            bh = (ybr - ytl) / h
            if not (0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0 and 0.0 <= bw <= 1.0 and 0.0 <= bh <= 1.0):
                raise SystemExit(f"{stem}: box outside image bounds: {b.attrib}")
            lines.append(f"0 {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
        if lines:  # empty entries are treated as unannotated, not background
            labels[stem] = lines
    return labels


def dhash(path: Path) -> int:
    """64-bit dhash of an image: 9x8 grayscale, bit = left pixel > right pixel."""
    g = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2GRAY)
    small = cv2.resize(g, (9, 8), interpolation=cv2.INTER_AREA)
    h = 0
    for row in small:
        for a, b in zip(row[:-1], row[1:]):
            h = (h << 1) | int(a > b)
    return h


def read_approved() -> list[Path]:
    """Approved video-frame paths from data/negatives_approved.txt (ROOT-relative)."""
    f = OUT / "negatives_approved.txt"
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        p = Path(line)
        if not p.is_absolute():
            p = ROOT / p
        out.append(p.resolve())
    return out


def read_stems(path: Path) -> set[str]:
    """One image stem (or path) per line from an --exclude file, # comments allowed."""
    out = set()
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.add(Path(line).stem)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--with-test", action="store_true",
                    help="add a held-out test split (70/15/15 instead of 80/20)")
    ap.add_argument("--include-unannotated-as-negatives", action="store_true",
                    help="add CVAT images without boxes as negatives (empty labels) — "
                         "verify they truly contain no phone/person first")
    ap.add_argument("--limit", type=int, default=None,
                    help="cap the per-source image pool (smoke runs)")
    ap.add_argument("--exclude", default=None,
                    help="file listing image stems to skip (one per line, # comments)")
    args = ap.parse_args()

    ratios = (0.7, 0.15, 0.15) if args.with_test else (0.8, 0.2)
    split_names = ("train", "val", "test") if args.with_test else ("train", "val")

    for split in ("train", "val", "test"):  # clear test too: re-runnable across flag changes
        shutil.rmtree(OUT / "images" / split, ignore_errors=True)
        shutil.rmtree(OUT / "labels" / split, ignore_errors=True)
        (OUT / "images" / split).mkdir(parents=True)
        (OUT / "labels" / split).mkdir(parents=True)

    rng = random.Random(SEED)
    counts = {s: {"pos": 0, "neg": 0} for s in split_names}
    review_rows = []
    excluded = read_stems(Path(args.exclude)) if args.exclude else set()
    excluded_used = set()

    for src in SOURCES:
        images = {p.stem: p for p in src["images"].glob("*.jpg")}
        labels = load_cvat_xml(src["annotations"])

        for stem, lines in labels.items():
            check_lines(stem, lines)

        excl = images.keys() & excluded
        excluded_used |= excl
        annotated = sorted(images.keys() & labels.keys() - excl)
        unlabeled = sorted(images.keys() - labels.keys() - excl)
        (OUT / src["unlabeled_file"]).write_text("\n".join(unlabeled) + "\n")
        review_rows += [(str(images[s].relative_to(ROOT)), src["name"]) for s in unlabeled]

        pool = list(annotated)
        if args.include_unannotated_as_negatives:
            print(f"WARNING: adding {len(unlabeled)} unannotated {src['name']} images as "
                  f"negatives. Verify in data/unannotated_review.csv that none actually "
                  f"contain a phone/person (missed labels become false negatives).")
            pool += unlabeled
        rng.shuffle(pool)
        if args.limit:
            pool = pool[:args.limit]

        n_test = round(len(pool) * ratios[2]) if args.with_test else 0
        n_val = round(len(pool) * ratios[1])
        n_train = len(pool) - n_test - n_val
        parts = [("train", n_train), ("val", n_val)] + (([("test", n_test)]) if args.with_test else [])

        idx = 0
        for split, n in parts:
            for stem in pool[idx:idx + n]:
                shutil.copy2(images[stem], OUT / "images" / split / f"{stem}.jpg")
                if stem in labels:
                    remapped = "\n".join(
                        " ".join([str(src["class_id"])] + line.split()[1:])
                        for line in labels[stem]
                    ) + "\n"
                    (OUT / "labels" / split / f"{stem}.txt").write_text(remapped)
                    counts[split]["pos"] += 1
                else:
                    (OUT / "labels" / split / f"{stem}.txt").write_text("")  # background
                    counts[split]["neg"] += 1
            idx += n

        print(f"{src['name']:<7} images {len(images):>3} | pool {len(pool):>3} -> "
              + " / ".join(f"{s} {n}" for s, n in parts)
              + f" | unlabeled {len(unlabeled)} ({OUT / src['unlabeled_file']})"
              + (f" | excluded {len(excl)}" if excl else ""))

    if excluded:
        unmatched = excluded - excluded_used
        if unmatched:
            shown = ", ".join(sorted(unmatched)[:10])
            print(f"note: {len(unmatched)} exclude entries matched no image: {shown}"
                  + (" ..." if len(unmatched) > 10 else ""))

    with open(OUT / "unannotated_review.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["path", "source"])
        w.writerows(review_rows)

    # --- video-frame negatives (only approved paths, split by person) ---
    frame_splits = json.loads((ROOT / "dataset" / "video dataset" / "splits.json").read_text(encoding="utf-8"))
    person_split = {person: split for split, people in frame_splits.items() for person in people}
    approved = read_approved()
    frames = [p.resolve() for p in sorted(STAGING.glob("*/*/*.jpg"))]
    if frames and not approved:
        print(f"note: {len(frames)} staged video frames exist but data/negatives_approved.txt "
              f"is absent - not used as negatives")
    missing = sorted(str(p.relative_to(ROOT)) for p in set(approved) - set(frames))
    if missing:
        raise SystemExit(f"approved frames missing from staging: {missing} — "
                         f"extract_frames.py was re-run?")
    vf_counts = {s: 0 for s in split_names}
    for f in frames:
        if f not in set(approved):
            continue
        person, session = f.parent.parent.name, f.parent.name
        if person not in person_split:
            raise SystemExit(f"{person} (session {session}) not in splits.json — add them first")
        split = person_split[person]
        name = f"vf_{person}_{session}_{f.stem}"
        shutil.copy2(f, OUT / "images" / split / f"{name}.jpg")
        (OUT / "labels" / split / f"{name}.txt").write_text("")  # background
        counts[split]["neg"] += 1
        vf_counts[split] += 1
    if approved:
        print("video-frame negatives: " + " / ".join(f"{s} {n}" for s, n in vf_counts.items()))

    # --- dataset.yaml (regenerated) ---
    yaml_lines = [
        "# Generated by prep_dataset.py - re-run after changing splits.",
        "# `path` resolves from the cwd: always run from machine learning/.",
        "path: data",
        "train: images/train",
        "val: images/val",
    ]
    if any((OUT / "images" / "test").iterdir()):
        yaml_lines.append("test: images/test")
    yaml_lines += ["", "names:", "  0: phone", "  1: person", ""]
    (OUT / "dataset.yaml").write_text("\n".join(yaml_lines), encoding="utf-8")

    # --- leakage checks ---
    seen: dict[str, list[str]] = {}
    for split in split_names:
        for p in (OUT / "images" / split).iterdir():
            seen.setdefault(p.name, []).append(split)
    dup = {n: ss for n, ss in seen.items() if len(ss) > 1}
    if dup:
        raise SystemExit("same file name in multiple splits: "
                         + ", ".join(f"{n} in {ss}" for n, ss in sorted(dup.items())))

    vf_seen: dict[str, set[str]] = {}
    for split in split_names:
        for p in (OUT / "images" / split).glob("vf_*.jpg"):
            vf_seen.setdefault("_".join(p.stem.split("_")[1:3]), set()).add(split)
    vdup = {k: v for k, v in vf_seen.items() if len(v) > 1}
    if vdup:
        raise SystemExit("video session frames span multiple splits: "
                         + ", ".join(f"{k} in {sorted(v)}" for k, v in sorted(vdup.items())))

    # near-duplicate report across splits (suspected only — manual review)
    hashes = {}
    for split in split_names:
        hashes[split] = {p.name: dhash(p) for p in (OUT / "images" / split).glob("*.jpg")}
    pairs = []
    for a, b in itertools.combinations(split_names, 2):
        for na, ha in hashes[a].items():
            for nb, hb in hashes[b].items():
                d = bin(ha ^ hb).count("1")
                if d <= DHASH_DIST:
                    pairs.append((na, a, nb, b, d))
    if pairs:
        by_d = {}
        for *_, d in pairs:
            by_d[d] = by_d.get(d, 0) + 1
        print(f"suspected near-duplicates across splits (dhash <= {DHASH_DIST}, review manually):")
        print("  distance histogram: " + ", ".join(f"d={d}: {by_d[d]}" for d in sorted(by_d)))
        with open(OUT / "suspected_duplicates.csv", "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["image_a", "split_a", "image_b", "split_b", "hamming"])
            w.writerows(pairs)
        print(f"  all {len(pairs)} pairs: {OUT / 'suspected_duplicates.csv'}")
        close = [(na, a, nb, b, d) for na, a, nb, b, d in pairs if d <= 2]
        for na, a, nb, b, d in sorted(close, key=lambda x: x[4])[:20]:
            print(f"  {na} [{a}] ~ {nb} [{b}] (hamming {d})")
        if len(close) > 20:
            print(f"  ... and {len(close) - 20} more at d <= 2")

    print("\nsplit totals (positives / negatives):")
    for s in split_names:
        print(f"  {s:<5} pos {counts[s]['pos']:>4} | neg {counts[s]['neg']:>4}")
    print("leakage check passed")


if __name__ == "__main__":
    main()
