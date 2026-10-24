"""A tiny decision tree (CART, Gini, depth <= 4) trained on confirmed verdict labels.
Pure Python so the phone can evaluate the same JSON without numpy/scikit-learn."""
from __future__ import annotations

from collections import Counter

FEATURES = ["devShare", "prodShare", "networkShare", "untaggedShare", "sustained", "idleSignal"]
CLASSES = ["Waste", "Misconfig", "Growth"]
MIN_LABELS = 20  # below this the rule-based model stays in charge


def _gini(labels: list[str]) -> float:
    n = len(labels)
    return 1 - sum((c / n) ** 2 for c in Counter(labels).values()) if n else 0.0


def _leaf(labels: list[str]) -> dict:
    c = Counter(labels)
    n = len(labels) or 1
    return {"leaf": {k: round(c.get(k, 0) / n, 4) for k in CLASSES}, "n": len(labels)}


def _grow(xs: list[dict], ys: list[str], depth: int, max_depth: int, min_leaf: int) -> dict:
    if depth >= max_depth or len(set(ys)) <= 1 or len(ys) < 2 * min_leaf:
        return _leaf(ys)
    best = None
    for f in FEATURES:
        for t in sorted({x[f] for x in xs}):
            left = [y for x, y in zip(xs, ys) if x[f] <= t]
            right = [y for x, y in zip(xs, ys) if x[f] > t]
            if len(left) < min_leaf or len(right) < min_leaf:
                continue
            g = (len(left) * _gini(left) + len(right) * _gini(right)) / len(ys)
            if best is None or g < best[0] - 1e-12:
                best = (g, f, t)
    if best is None or best[0] >= _gini(ys) - 1e-9:
        return _leaf(ys)
    _, f, t = best
    li = [i for i, x in enumerate(xs) if x[f] <= t]
    ri = [i for i, x in enumerate(xs) if x[f] > t]
    return {"feature": f, "threshold": t,
            "left": _grow([xs[i] for i in li], [ys[i] for i in li], depth + 1, max_depth, min_leaf),
            "right": _grow([xs[i] for i in ri], [ys[i] for i in ri], depth + 1, max_depth, min_leaf)}


def train(samples: list[tuple[dict, str]], max_depth: int = 4, min_leaf: int = 2, version: int = 1) -> dict:
    xs = [{f: float(x.get(f, 0.0)) for f in FEATURES} for x, _ in samples]
    ys = [y for _, y in samples]
    return {"kind": "decision-tree", "version": version, "features": FEATURES, "classes": CLASSES,
            "trainedOn": len(ys), "labelCounts": dict(Counter(ys)), "maxDepth": max_depth, "tree": _grow(xs, ys, 0, max_depth, min_leaf)}


class TreeModel:
    """Evaluates a trained tree JSON; `scores` has the same shape as the rule model."""

    def __init__(self, model: dict):
        self.model = model
        self.name = f"learned decision tree v{model.get('version', 1)} ({model.get('trainedOn', 0)} labels)"

    def scores(self, x: dict) -> dict:
        node = self.model["tree"]
        while "leaf" not in node:
            node = node["left"] if float(x.get(node["feature"], 0.0)) <= node["threshold"] else node["right"]
        return dict(node["leaf"])
