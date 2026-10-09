"""Practo-based scoring service.
Uses scraped Practo profile data to score patient influence parameters."""

import json
import logging
from typing import Dict, List, Any
from app.services.practo_service import PractoService

logger = logging.getLogger(__name__)


async def fetch_practo_data(
    doctor_name: str,
    city: str = "",
    specialty: str = "",
) -> Dict[str, Any]:
    """Fetch doctor profile data from Practo."""
    practo = PractoService()
    return await practo.search_doctor(doctor_name, city, specialty)


def score_practo_parameters(
    parameters: List[Dict],
    practo_data: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Score Practo-related parameters using scraped profile data."""
    results = []

    profile_found = practo_data.get("profile_found", False)
    rating = practo_data.get("rating", 0.0)
    reviews_count = practo_data.get("reviews_count", 0)
    recommendations_count = practo_data.get("recommendations_count", 0)
    experience_years = practo_data.get("experience_years", 0)

    source_summary = json.dumps({
        "profile_found": profile_found,
        "profile_url": practo_data.get("profile_url", ""),
        "name": practo_data.get("name", ""),
        "specialty": practo_data.get("specialty", ""),
        "experience_years": experience_years,
        "rating": rating,
        "reviews_count": reviews_count,
        "recommendations_count": recommendations_count,
        "hospital": practo_data.get("hospital", ""),
        "locality": practo_data.get("locality", ""),
        "consultation_fee": practo_data.get("consultation_fee", ""),
        "qualifications": practo_data.get("qualifications", []),
        "services_count": len(practo_data.get("services", [])),
    })

    for p in parameters:
        code = p["code"]
        max_score = p["max_score"]
        score = 0.0
        justification = ""

        if not profile_found:
            justification = "No Practo profile found for this doctor."
            results.append({
                "parameter_id": p["id"],
                "parameter_code": code,
                "parameter_name": p["name"],
                "parameter_category": p["category"],
                "score": 0,
                "max_score": max_score,
                "justification": justification,
                "scoring_source": "practo",
                "source_data": source_summary,
            })
            continue

        # Patient Reviews Volume
        if code == "PRACTO_REVIEWS_HIGH":
            if reviews_count >= 100:
                score = max_score
                justification = f"High patient engagement: {reviews_count} reviews on Practo."
            elif reviews_count >= 50:
                score = round(max_score * 0.6, 1)
                justification = f"Moderate patient engagement: {reviews_count} reviews on Practo (50-99 range)."
            else:
                justification = f"Found {reviews_count} reviews on Practo (below 100 threshold)."

        elif code == "PRACTO_REVIEWS_MODERATE":
            if reviews_count >= 25:
                score = max_score
                justification = f"Found {reviews_count} patient reviews on Practo (≥25 threshold met)."
            elif reviews_count >= 10:
                score = round(max_score * 0.5, 1)
                justification = f"Found {reviews_count} reviews on Practo (10-24 range)."
            else:
                justification = f"Found {reviews_count} reviews on Practo (below 25 threshold)."

        # Patient Rating
        elif code == "PRACTO_RATING_HIGH":
            # Rating is typically a percentage (e.g., 98%) on Practo
            effective_rating = rating
            if effective_rating > 5:
                # It's a percentage, normalize
                effective_rating = rating / 20  # Convert 0-100% to 0-5 scale
            if effective_rating >= 4.5:
                score = max_score
                justification = f"Excellent patient rating: {rating}% on Practo."
            elif effective_rating >= 4.0:
                score = round(max_score * 0.6, 1)
                justification = f"Good patient rating: {rating}% on Practo."
            else:
                justification = f"Patient rating: {rating}% on Practo (below high threshold)."

        # Recommendations
        elif code == "PRACTO_RECOMMENDATIONS":
            if recommendations_count >= 50:
                score = max_score
                justification = f"Strong peer/patient recommendations: {recommendations_count} on Practo."
            elif recommendations_count >= 20:
                score = round(max_score * 0.5, 1)
                justification = f"Found {recommendations_count} recommendations on Practo (20-49 range)."
            else:
                justification = f"Found {recommendations_count} recommendations on Practo (below 50 threshold)."

        # Experience verification via Practo
        elif code == "PRACTO_EXPERIENCE":
            if experience_years >= 15:
                score = max_score
                justification = f"Extensive experience: {experience_years} years listed on Practo."
            elif experience_years >= 10:
                score = round(max_score * 0.7, 1)
                justification = f"Significant experience: {experience_years} years listed on Practo."
            elif experience_years >= 5:
                score = round(max_score * 0.4, 1)
                justification = f"Moderate experience: {experience_years} years listed on Practo."
            else:
                justification = f"Experience: {experience_years} years listed on Practo (below 15-year threshold)."

        else:
            justification = f"Parameter {code} not handled by Practo scoring."

        results.append({
            "parameter_id": p["id"],
            "parameter_code": code,
            "parameter_name": p["name"],
            "parameter_category": p["category"],
            "score": min(round(score, 1), max_score),
            "max_score": max_score,
            "justification": justification,
            "scoring_source": "practo",
            "source_data": source_summary,
        })

    return results
