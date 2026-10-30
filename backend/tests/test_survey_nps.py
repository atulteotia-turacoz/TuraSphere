"""Tests for the NPS roll-up behind the survey results and engagement dashboard.

Run it directly (no pytest needed):

    ./venv/bin/python tests/test_survey_nps.py

The function names follow pytest's convention too, so `pytest tests/` picks them
up unchanged if pytest is ever added to requirements.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.survey_nps import nps_summary


def test_band_edges():
    s = nps_summary(["0", "6", "7", "8", "9", "10"])
    assert (s["detractors"], s["passives"], s["promoters"]) == (2, 2, 2)
    assert s["total"] == 6
    assert s["score"] == 0


def test_score_is_promoters_minus_detractors():
    # 5 promoters, 3 passives, 2 detractors out of 10 → 50% - 20%.
    s = nps_summary(["10"] * 3 + ["9"] * 2 + ["8"] * 3 + ["3"] * 2)
    assert s["score"] == 30


def test_extremes():
    assert nps_summary(["10", "9"])["score"] == 100
    assert nps_summary(["0", "6"])["score"] == -100


def test_zero_is_an_answer_not_a_blank():
    s = nps_summary(["0"])
    assert s["total"] == 1
    assert s["distribution"][0] == 1
    assert s["score"] == -100


def test_no_answers_is_no_score_rather_than_zero():
    s = nps_summary([])
    assert s["score"] is None
    assert s["total"] == 0


def test_invalid_answers_are_ignored():
    s = nps_summary(["11", "-1", "abc", "", None, "7.5", "²", " 9 "])
    assert s["total"] == 1
    assert s["promoters"] == 1


def test_distribution_has_a_slot_per_score():
    s = nps_summary([str(n) for n in range(11)])
    assert s["distribution"] == [1] * 11


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_")]
    for name, fn in tests:
        fn()
        print(f"ok  {name}")
    print(f"{len(tests)} passed")
