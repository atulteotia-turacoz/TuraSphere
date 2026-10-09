"""
KOL Assessment Scoring Engine
Implements the SAS-style scoring model for C.1-C.9 criteria.
Base score from C.1-C.4 (max 40 points), Bonus from C.5-C.9 (max 15 points).
Final score capped at 55.
"""
import json
from typing import Dict, Any, Optional, Tuple

class ScoringEngine:
    """Rules-based scoring engine replicating Excel workbook logic."""

    # C.1 Leadership Scoring (max 10 points)
    @staticmethod
    def score_c1_leadership(data: dict) -> Tuple[float, dict]:
        """Score leadership based on board memberships, society roles, etc."""
        score = 0
        details = {}

        if data.get("board_member", False):
            score += 2
            details["board_member"] = "Board member of medical association(s) (+2)"
        if data.get("advisory_board", False):
            score += 2
            details["advisory_board"] = "Participates in industry advisory boards (+2)"
        if data.get("professor", False):
            score += 2
            details["professor"] = "Chief/Full professor at teaching hospital (+2)"
        if data.get("society_leader", False):
            score += 2
            details["society_leader"] = "Past/current leader of national/intl society (+2)"
        if data.get("executive_body", False):
            score += 2
            details["executive_body"] = "Member of executive/governing body in last 5 years (+2)"

        return min(score, 10), details

    # C.2 Presentations Scoring (max 10 points)
    @staticmethod
    def score_c2_presentations(data: dict) -> Tuple[float, dict]:
        """Score presentations based on count and level."""
        score = 0
        details = {}
        count = data.get("presentations_count", 0)
        level = data.get("presentation_level", "domestic")

        # Count-based scoring
        if count >= 10:
            score += 4
            details["count"] = f"{count} presentations in last 5 years (+4)"
        elif count >= 5:
            score += 3
            details["count"] = f"{count} presentations in last 5 years (+3)"
        elif count >= 1:
            score += 2
            details["count"] = f"{count} presentations in last 5 years (+2)"
        else:
            details["count"] = "No presentations recorded (0)"

        # Level-based scoring
        if level == "committee":
            score += 6
            details["level"] = "International committee/society talks (+6)"
        elif level == "international":
            score += 4
            details["level"] = "International speaking engagements (+4)"
        elif level == "domestic":
            score += 2
            details["level"] = "Domestic speaking engagements (+2)"

        return min(score, 10), details

    # C.3 Publications Scoring (max 10 points)
    @staticmethod
    def score_c3_publications(data: dict) -> Tuple[float, dict]:
        """Score publications based on volume, quality, and editorial roles."""
        score = 0
        details = {}
        count = data.get("publications_count", 0)

        if count >= 10:
            score += 4
            details["volume"] = f"{count} peer-reviewed articles in last 5 years (+4)"
        elif count >= 5:
            score += 3
            details["volume"] = f"{count} peer-reviewed articles in last 5 years (+3)"
        elif count >= 1:
            score += 2
            details["volume"] = f"{count} peer-reviewed articles in last 5 years (+2)"
        else:
            details["volume"] = "No publications recorded (0)"

        if data.get("editorial_board", False):
            score += 2
            details["editorial"] = "Editorial board member / systematic reviews (+2)"
        if data.get("intl_journal", False):
            score += 2
            details["intl_journal"] = "Intl peer-reviewed journal / intl clinical research (+2)"
        if data.get("textbook_contributor", False):
            score += 2
            details["textbook"] = "Textbook contributor (editor/author) (+2)"

        return min(score, 10), details

    # C.4 Clinical Experience Scoring (max 10 points)
    @staticmethod
    def score_c4_clinical(data: dict) -> Tuple[float, dict]:
        """Score clinical experience: years, procedures, unique expertise."""
        score = 0
        details = {}
        years = data.get("years_experience", 0)
        procedures = data.get("procedures_per_year", 0)

        # Years of experience (max 4)
        if years >= 15:
            score += 4
            details["years"] = f"{years} years of experience (+4)"
        elif years >= 10:
            score += 3
            details["years"] = f"{years} years of experience (+3)"
        elif years >= 5:
            score += 2
            details["years"] = f"{years} years of experience (+2)"
        elif years >= 1:
            score += 1
            details["years"] = f"{years} years of experience (+1)"

        # Procedures per year (max 4, for surgeons)
        if procedures >= 500:
            score += 4
            details["procedures"] = f"{procedures} procedures/year (+4)"
        elif procedures >= 200:
            score += 3
            details["procedures"] = f"{procedures} procedures/year (+3)"
        elif procedures >= 100:
            score += 2
            details["procedures"] = f"{procedures} procedures/year (+2)"
        elif procedures > 0:
            score += 1
            details["procedures"] = f"{procedures} procedures/year (+1)"

        # Unique expertise
        if data.get("unique_expertise", False):
            score += 2
            details["unique_expertise"] = "Unique clinical expertise (+2)"

        return min(score, 10), details

    # C.5 Citation Velocity (max 3 bonus points)
    @staticmethod
    def score_c5_citation_velocity(pubs_per_year: float) -> Tuple[float, dict]:
        """Score citation velocity based on avg pubs/year 2024-2026."""
        details = {}
        if pubs_per_year >= 10:
            score = 3
            details["velocity"] = f"Avg {pubs_per_year:.1f} pubs/year (>=10) (+3)"
        elif pubs_per_year >= 5:
            score = 2
            details["velocity"] = f"Avg {pubs_per_year:.1f} pubs/year (5-10) (+2)"
        elif pubs_per_year >= 2:
            score = 1
            details["velocity"] = f"Avg {pubs_per_year:.1f} pubs/year (2-5) (+1)"
        else:
            score = 0
            details["velocity"] = f"Avg {pubs_per_year:.1f} pubs/year (<2) (0)"
        return score, details

    # C.6 Network Centrality (max 4 bonus points)
    @staticmethod
    def score_c6_network_centrality(pagerank_percentile: Optional[float], coauthor_count: int) -> Tuple[float, dict]:
        """Score network centrality using PageRank and co-author count."""
        details = {}
        if pagerank_percentile is not None and pagerank_percentile >= 90:
            score = 4
            details["centrality"] = f"Top {100-pagerank_percentile:.0f}% PageRank (+4)"
        elif pagerank_percentile is not None and pagerank_percentile >= 75:
            score = 3
            details["centrality"] = f"Top {100-pagerank_percentile:.0f}% PageRank (+3)"
        elif coauthor_count > 20:
            score = 2
            details["centrality"] = f"{coauthor_count} co-authors (>20) (+2)"
        else:
            score = 0
            details["centrality"] = f"PageRank: {pagerank_percentile}, Co-authors: {coauthor_count} (0)"
        return score, details

    # C.7 Patient Impact (max 3 bonus points)
    @staticmethod
    def score_c7_patient_impact(trials_led: int) -> Tuple[float, dict]:
        """Score patient impact from clinical trials led."""
        details = {}
        if trials_led >= 5:
            score = 3
            details["trials"] = f"{trials_led} trials led (>=5) (+3)"
        elif trials_led >= 3:
            score = 2
            details["trials"] = f"{trials_led} trials led (3-4) (+2)"
        elif trials_led >= 1:
            score = 1
            details["trials"] = f"{trials_led} trials led (1-2) (+1)"
        else:
            score = 0
            details["trials"] = "No trials led (0)"
        return score, details

    # C.8 Guideline Authority (max 3 bonus points)
    @staticmethod
    def score_c8_guideline_authority(intl_guidelines: bool, national_guidelines: bool) -> Tuple[float, dict]:
        """Score guideline authority from authorship."""
        details = {}
        if intl_guidelines:
            score = 3
            details["guidelines"] = "International guideline author/committee member (+3)"
        elif national_guidelines:
            score = 2
            details["guidelines"] = "National guideline/consensus author (+2)"
        else:
            score = 0
            details["guidelines"] = "No guideline authorship detected (0)"
        return score, details

    # C.9 Emerging Leader (max 2 bonus points)
    @staticmethod
    def score_c9_emerging_leader(pub_growth_rate: Optional[float], age: Optional[int], has_publications: bool) -> Tuple[float, dict]:
        """Score emerging leader potential."""
        score = 0
        details = {}
        if pub_growth_rate is not None and pub_growth_rate > 20:
            score += 2
            details["growth"] = f"Publication growth rate {pub_growth_rate:.1f}%/yr (>20%) (+2)"
        elif age is not None and age < 45 and has_publications:
            score += 1
            details["emerging"] = f"Age ~{age}, has publications (+1)"
        else:
            details["emerging"] = "Does not meet emerging leader criteria (0)"
        return min(score, 2), details

    @classmethod
    def calculate_full_assessment(cls, manual_data: dict, automated_data: Optional[dict] = None, db=None) -> dict:
        """Run full scoring across all criteria. Returns complete assessment dict."""
        result = {}

        # C.1-C.4 Base scoring
        c1_score, c1_details = cls.score_c1_leadership({
            "board_member": manual_data.get("c1_board_member", False),
            "advisory_board": manual_data.get("c1_advisory_board", False),
            "professor": manual_data.get("c1_professor", False),
            "society_leader": manual_data.get("c1_society_leader", False),
            "executive_body": manual_data.get("c1_executive_body", False),
        })

        c2_score, c2_details = cls.score_c2_presentations({
            "presentations_count": manual_data.get("c2_presentations_count", 0),
            "presentation_level": manual_data.get("c2_presentation_level", "domestic"),
        })

        c3_score, c3_details = cls.score_c3_publications({
            "publications_count": manual_data.get("c3_publications_count", 0),
            "editorial_board": manual_data.get("c3_editorial_board", False),
            "intl_journal": manual_data.get("c3_intl_journal", False),
            "textbook_contributor": manual_data.get("c3_textbook_contributor", False),
        })

        c4_score, c4_details = cls.score_c4_clinical({
            "years_experience": manual_data.get("c4_years_experience", 0),
            "procedures_per_year": manual_data.get("c4_procedures_per_year", 0),
            "unique_expertise": manual_data.get("c4_unique_expertise", False),
        })

        base_score = c1_score + c2_score + c3_score + c4_score

        # C.5-C.9 Bonus (from automated data or manual override)
        auto = automated_data or {}
        confidence_flags = {}

        c5_score, c5_details = cls.score_c5_citation_velocity(auto.get("pubs_per_year", 0))
        if "pubs_per_year" not in auto:
            confidence_flags["c5"] = "data_not_available"

        c6_score, c6_details = cls.score_c6_network_centrality(
            auto.get("pagerank_percentile"), auto.get("coauthor_count", 0)
        )
        if "pagerank_percentile" not in auto:
            confidence_flags["c6"] = "data_not_available"

        c7_score, c7_details = cls.score_c7_patient_impact(auto.get("trials_led", 0))
        if "trials_led" not in auto:
            confidence_flags["c7"] = "data_not_available"

        c8_score, c8_details = cls.score_c8_guideline_authority(
            auto.get("intl_guidelines", False), auto.get("national_guidelines", False)
        )
        if "intl_guidelines" not in auto and "national_guidelines" not in auto:
            confidence_flags["c8"] = "data_not_available"

        c9_score, c9_details = cls.score_c9_emerging_leader(
            auto.get("pub_growth_rate"),
            manual_data.get("age_estimate"),
            manual_data.get("c3_publications_count", 0) > 0 or auto.get("pubs_per_year", 0) > 0,
        )
        if "pub_growth_rate" not in auto:
            confidence_flags["c9"] = "data_not_available"

        bonus_score = c5_score + c6_score + c7_score + c8_score + c9_score
        final_score = min(base_score + bonus_score, 55)

        # Determine tier
        tier = cls.determine_tier(final_score, db=db)

        # Build justification
        justification_parts = []
        if c1_score > 0:
            justification_parts.append(f"Leadership: {c1_score}/10")
        if c6_score >= 3:
            justification_parts.append(f"Top PageRank network centrality")
        if c5_score >= 2:
            justification_parts.append(f">{auto.get('pubs_per_year', 0):.0f} pubs/year")
        if c7_score >= 2:
            justification_parts.append(f"{auto.get('trials_led', 0)} trials led")
        if c8_score >= 2:
            justification_parts.append("Guideline author")
        justification = "; ".join(justification_parts) if justification_parts else "Assessment based on available data"

        return {
            "c1_leadership_score": c1_score,
            "c1_details": json.dumps(c1_details),
            "c2_presentations_score": c2_score,
            "c2_details": json.dumps(c2_details),
            "c3_publications_score": c3_score,
            "c3_details": json.dumps(c3_details),
            "c4_clinical_experience_score": c4_score,
            "c4_details": json.dumps(c4_details),
            "c5_citation_velocity_score": c5_score,
            "c5_details": json.dumps(c5_details),
            "c6_network_centrality_score": c6_score,
            "c6_details": json.dumps(c6_details),
            "c7_patient_impact_score": c7_score,
            "c7_details": json.dumps(c7_details),
            "c8_guideline_authority_score": c8_score,
            "c8_details": json.dumps(c8_details),
            "c9_emerging_leader_score": c9_score,
            "c9_details": json.dumps(c9_details),
            "base_score": base_score,
            "bonus_score": bonus_score,
            "final_score": final_score,
            "tier": tier,
            "justification": justification,
            "confidence_flags": json.dumps(confidence_flags),
        }

    @staticmethod
    def determine_tier(score: float, db=None, user_id=None) -> str:
        """Map a score to a tier code.

        Bands live in `kol_tiers` and are editable from Account -> KOL Tiers.
        Bands are per-account, so `user_id` selects whose. Without it — or
        without a session — this falls back to the shared template rows and
        then to the six bands that were hardcoded here before.
        """
        if db is not None:
            try:
                from app.models.kol_tier import KolTier
                q = db.query(KolTier).filter(KolTier.is_active == True)  # noqa: E712
                tiers = (
                    q.filter(KolTier.user_id == user_id).order_by(KolTier.min_score.desc()).all()
                    if user_id is not None else []
                )
                if not tiers:
                    # No bands for this account yet: use the shared template.
                    tiers = (
                        db.query(KolTier)
                        .filter(KolTier.user_id.is_(None), KolTier.is_active == True)  # noqa: E712
                        .order_by(KolTier.min_score.desc())
                        .all()
                    )
                for tier in tiers:
                    upper = tier.max_score if tier.max_score is not None else float("inf")
                    if tier.min_score <= score <= upper:
                        return tier.code
                # Bands are configured but none covers this score — the ranges
                # leave a gap, e.g. Strategic 35-45 and Global 55+ with nothing
                # between. Falling back to the built-in bands here would hand
                # back a tier the account has deliberately re-banded, so use the
                # highest configured band the score clears instead. The UI warns
                # about the gap separately.
                if tiers:
                    for tier in tiers:  # already ordered by min_score desc
                        if score >= tier.min_score:
                            return tier.code
                    return tiers[-1].code
            except Exception:
                pass

        if score >= 45:
            return "GLOBAL_KOL"
        elif score >= 35:
            return "STRATEGIC_KOL"
        elif score >= 25:
            return "NATIONAL_KOL"
        elif score >= 15:
            return "EMERGING_KOL"
        elif score >= 5:
            return "LOCAL_KOL"
        else:
            return "NON_KOL"
