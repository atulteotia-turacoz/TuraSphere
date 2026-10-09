"""Whole-CV regression check for the zero-AI reader, against a real corpus.

`test_cv_rule_extractor.py` pins individual defects in short synthetic strings.
This one is the blunt instrument beside it: run every CV we hold through
`extract_fields` and compare the whole result against a recorded snapshot.

Why both. A rule engine is tuned per format, so the day a client sends a CV
shaped like nothing here, someone will add a rule for it. The risk is not that
the new rule fails — it is that it quietly breaks one of the formats that
already worked. Loosening a floor by one point cost CV 4 and CV 11 a faculty row
each, and nothing but this comparison would have said so.

The CVs are not in the repository: they are masked samples that live outside it.
When the corpus is missing the check skips rather than fails, so it never blocks
a deployment on a machine that has not got them.

    ./venv/bin/python tests/test_cv_corpus.py              # check
    ./venv/bin/python tests/test_cv_corpus.py --update     # re-record

**Re-record deliberately, never to make a red run go green.** Read the diff it
prints first: every line is a field the engine now reads differently, and the
whole point is to decide, case by case, whether that is a fix or a regression.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.cv_parser import CVParser  # noqa: E402
from app.services import cv_rule_extractor  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SNAPSHOT = os.path.join(HERE, "cv_corpus_snapshot.json")
# Override with HCP_CV_CORPUS when the masked samples live somewhere else.
CORPUS = os.environ.get(
    "HCP_CV_CORPUS", os.path.expanduser("~/Downloads/Masked HCP CVs"))

READABLE = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg",
            ".tiff", ".bmp"}
# Recorded row by row: short tables, and the ones the form leans on hardest —
# `faculty_positions` is where the frontend derives the current post from, so a
# status flipping here renames the employer on screen.
DETAILED_ROWS = ("faculty_positions", "office_bearer_positions", "advisory_board")
# Recorded as a count and a digest: these run to hundreds of entries per CV, and
# a diff that long tells the reader nothing. The digest still moves if any one
# of them changes — re-run the reader to see which.
BULK_ROWS = ("publications", "conference_presentations", "textbooks")
ROW_KEYS = DETAILED_ROWS + BULK_ROWS


def read_corpus() -> dict:
    """Every CV in the corpus, as {filename: summarised extraction}."""
    summary = {}
    for name in sorted(os.listdir(CORPUS)):
        if os.path.splitext(name)[1].lower() not in READABLE:
            continue
        text = CVParser.parse_file(os.path.join(CORPUS, name)).get("raw_text", "")
        if not text.strip():
            # A scan with no text layer cannot be read without AI at all. That
            # is a legitimate outcome, and worth recording as one.
            summary[name] = {"unreadable_without_ai": True}
            continue
        result = cv_rule_extractor.extract_fields(text)
        summary[name] = {
            **{k: v for k, v in result.items() if k not in ROW_KEYS},
            **{k: result[k] for k in DETAILED_ROWS},
            **{f"{k}__count": len(result[k]) for k in BULK_ROWS},
            **{f"{k}__digest": digest(result[k]) for k in BULK_ROWS},
        }
    return summary


def digest(rows: list) -> str:
    blob = json.dumps(rows, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]


def diff(expected: dict, actual: dict) -> list:
    lines = []
    for name in sorted(set(expected) | set(actual)):
        if name not in expected:
            lines.append(f"{name}: not in the snapshot — re-record to accept it")
            continue
        if name not in actual:
            lines.append(f"{name}: missing from the corpus on this machine")
            continue
        for field in sorted(set(expected[name]) | set(actual[name])):
            was, now = expected[name].get(field), actual[name].get(field)
            if was == now:
                continue
            if isinstance(was, list) and isinstance(now, list):
                # Row by row, so a single changed status does not print two
                # fifteen-row tables and hide itself between them.
                lines.append(f"{name} :: {field} ({len(was)} -> {len(now)} rows)")
                for index in range(max(len(was), len(now))):
                    old_row = was[index] if index < len(was) else None
                    new_row = now[index] if index < len(now) else None
                    if old_row != new_row:
                        lines.append(f"     [{index}] was: {old_row}")
                        lines.append(f"         now: {new_row}")
                continue
            lines.append(f"{name} :: {field}\n     was: {was}\n     now: {now}")
    return lines


def test_corpus_matches_snapshot():
    if not os.path.isdir(CORPUS):
        print(f"SKIP: no CV corpus at {CORPUS} (set HCP_CV_CORPUS to point at it)")
        return
    if not os.path.exists(SNAPSHOT):
        print(f"SKIP: no snapshot yet — run with --update to record one")
        return
    with open(SNAPSHOT) as fh:
        expected = json.load(fh)
    changes = diff(expected, read_corpus())
    assert not changes, "the reader's output moved:\n\n" + "\n".join(changes)


def main() -> int:
    if not os.path.isdir(CORPUS):
        print(f"SKIP: no CV corpus at {CORPUS}")
        print("      set HCP_CV_CORPUS to the folder holding the masked samples")
        return 0
    actual = read_corpus()
    if "--update" in sys.argv:
        with open(SNAPSHOT, "w") as fh:
            json.dump(actual, fh, indent=2, sort_keys=True, ensure_ascii=False)
            fh.write("\n")
        print(f"recorded {len(actual)} CVs to {os.path.basename(SNAPSHOT)}")
        return 0
    if not os.path.exists(SNAPSHOT):
        print("no snapshot yet — run with --update to record one")
        return 0
    with open(SNAPSHOT) as fh:
        expected = json.load(fh)
    changes = diff(expected, actual)
    for line in changes:
        print(f"  {line}")
    print(f"\n{len(actual)} CVs checked, {len(changes)} field(s) changed")
    return 1 if changes else 0


if __name__ == "__main__":
    raise SystemExit(main())
