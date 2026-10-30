"""Net Promoter Score for `nps` survey questions.

One calculation for every place that shows it — the team's Survey Results page
and the engagement dashboard (organizer + client portal) — so they cannot
disagree. Answers are stored as "0".."10" in survey_answers.answer_text.

    Detractors 0-6 · Passives 7-8 · Promoters 9-10
    NPS = % promoters - % detractors, a whole number from -100 to +100
"""


def _parse_score(answer):
    """The 0-10 score in a stored answer, or None for a blank/invalid one. The
    public endpoints don't validate per type, so a hand-posted "11" must not
    reach the score."""
    s = str(answer if answer is not None else "").strip()
    if not s.isdecimal() or not 0 <= int(s) <= 10:
        return None
    return int(s)


def nps_summary(answers):
    """Roll up raw answer texts. `distribution` is the count per score, index 0-10.
    `score` is None (not 0, which is a real result) when nobody has answered."""
    distribution = [0] * 11
    for answer in answers:
        score = _parse_score(answer)
        if score is not None:
            distribution[score] += 1
    total = sum(distribution)
    detractors = sum(distribution[:7])
    passives = sum(distribution[7:9])
    promoters = sum(distribution[9:])
    return {
        "score": round(100 * (promoters - detractors) / total) if total else None,
        "total": total,
        "detractors": detractors,
        "passives": passives,
        "promoters": promoters,
        "distribution": distribution,
    }
