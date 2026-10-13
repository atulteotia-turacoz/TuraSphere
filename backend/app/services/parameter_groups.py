"""Group caps for assessment parameters.

Some parameters are tiers of one criterion — "1-5 / 5-10 / 10+ speaking
engagements", "PageRank top 10% / top 25%". The scorers award each tier that
matches on its own, so without a cap an HCP with 12 engagements would collect
2 + 3 + 4. Parameters that share a `score_group` therefore count together, up
to the group's `group_max_score`. Ungrouped parameters count up to their own
`max_score`. With the standard parameter set the full scale is 50.
"""
from collections import OrderedDict

from sqlalchemy import or_


def capped_totals(rows):
    """Sum scores with group caps applied.

    `rows` are dicts with `score`, `max_score`, `score_group`, `group_max_score`
    and optionally `category`. Returns (total, max_possible, per_category) where
    per_category maps category -> {"score", "max"}; a group is counted under
    the category of its first row.
    """
    groups = OrderedDict()
    for i, r in enumerate(rows):
        key = r.get("score_group") or f"__row_{i}"
        g = groups.setdefault(key, {"score": 0.0, "max": 0.0, "cap": None,
                                    "category": r.get("category")})
        g["score"] += float(r.get("score") or 0)
        g["max"] += float(r.get("max_score") or 0)
        if r.get("score_group") and r.get("group_max_score") is not None:
            g["cap"] = max(g["cap"] or 0.0, float(r["group_max_score"]))

    total = max_possible = 0.0
    per_category = OrderedDict()
    for g in groups.values():
        cap = g["cap"] if g["cap"] is not None else g["max"]
        score = min(g["score"], cap)
        total += score
        max_possible += cap
        cat = per_category.setdefault(g["category"] or "Uncategorized", {"score": 0.0, "max": 0.0})
        cat["score"] += score
        cat["max"] += cap
    for cat in per_category.values():
        cat["score"] = round(cat["score"], 1)
        cat["max"] = round(cat["max"], 1)
    return round(total, 1), round(max_possible, 1), per_category


def param_group_map(db, parameter_ids):
    """parameter_id -> (score_group, group_max_score) for the given ids."""
    from app.models.assessment_parameter import AssessmentParameter

    ids = {i for i in parameter_ids if i}
    if not ids:
        return {}
    return {
        p.id: (p.score_group, p.group_max_score)
        for p in db.query(AssessmentParameter).filter(AssessmentParameter.id.in_(ids)).all()
    }


def full_scale(db, user_id=None):
    """The 'out of' figure: the capped maximum of every active parameter the
    account can use (standard ones plus its own custom ones), whether or not
    it is switched on. 50 for the standard set."""
    from app.models.assessment_parameter import AssessmentParameter

    q = db.query(AssessmentParameter).filter(AssessmentParameter.is_active == True)
    if user_id:
        q = q.filter(or_(AssessmentParameter.is_standard == True,
                         AssessmentParameter.created_by == user_id))
    else:
        q = q.filter(AssessmentParameter.is_standard == True)
    rows = [{"score": 0, "max_score": p.max_score, "score_group": p.score_group,
             "group_max_score": p.group_max_score}
            for p in q.order_by(AssessmentParameter.sort_order, AssessmentParameter.id).all()]
    return capped_totals(rows)[1]
