import json
import csv
import io
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional, List
from pydantic import BaseModel
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.hcp import HCPProfile, HCPStatus
from app.models.assessment import Assessment
from app.models.audit_log import AuditLog
from app.models.assessment_parameter import AssessmentParameter, UserParameterPreference
from app.models.assessment_score import AssessmentParameterScore
from app.services.parameter_groups import capped_totals, param_group_map, full_scale
from app.schemas.assessment import ManualScoreInput, AssessmentResponse
from app.services.scoring_engine import ScoringEngine
from app.services.pubmed_service import PubMedService
from app.services.clinical_trials_service import ClinicalTrialsService
from app.services.network_service import NetworkService
from app.services.scholar_service import ScholarService
from app.services.ai_scoring_service import score_cv_with_ai
from app.services.rule_scoring_service import score_parameters as score_by_rules
from app.services.pubmed_scoring_service import (
    get_default_pubmed_config, fetch_pubmed_data,
    score_pubmed_parameters, score_clinical_trials_parameters, publications_from_cv,
    score_google_scholar_parameters,
)
from app.services.practo_scoring_service import fetch_practo_data, score_practo_parameters
from app.services.cross_source_enrichment import enrich_scores_cross_source
from app.services.linkedin_service import LinkedInService
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assessments", tags=["Assessments"])


@router.post("/{hcp_id}/score-manual", response_model=AssessmentResponse)
def score_manual(hcp_id: int, data: ManualScoreInput,
                 db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")

    manual_data = data.model_dump()
    manual_data["age_estimate"] = hcp.age_estimate
    result = ScoringEngine.calculate_full_assessment(manual_data, db=db)

    assessment = Assessment(
        hcp_id=hcp_id,
        assessed_by=current_user.id,
        **result,
    )
    db.add(assessment)

    hcp.status = HCPStatus.assessed

    audit = AuditLog(
        assessment_id=None,
        action="manual_assessment",
        details=f"Manual scoring completed. Tier: {result['tier']}, Score: {result['final_score']}",
        performed_by=current_user.id,
    )
    db.add(audit)
    db.commit()
    db.refresh(assessment)

    audit.assessment_id = assessment.id
    db.commit()

    return assessment


@router.post("/{hcp_id}/score-automated", response_model=AssessmentResponse)
async def score_automated(hcp_id: int, data: ManualScoreInput,
                          db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")

    # Fetch public data
    automated_data = {}
    pubmed_raw = {}
    trials_raw = {}
    network_raw = {}

    try:
        pubmed = PubMedService(api_key=settings.PUBMED_API_KEY, email=settings.NCBI_EMAIL)
        author_name = hcp.full_name
        affiliation = hcp.institution or ""

        pubs_per_year = await pubmed.get_pubs_per_year_recent(author_name, affiliation)
        automated_data["pubs_per_year"] = pubs_per_year

        coauthors = await pubmed.get_coauthors(author_name, affiliation)
        automated_data["coauthor_count"] = len(coauthors)

        if coauthors:
            percentile, _ = NetworkService.analyze_author_network(coauthors, author_name)
            automated_data["pagerank_percentile"] = percentile

        history = await pubmed.get_publication_history(author_name, affiliation, years_back=5)
        growth = PubMedService.calculate_growth_rate(history)
        if growth is not None:
            automated_data["pub_growth_rate"] = growth

        pubmed_raw = {"pubs_per_year": pubs_per_year, "history": history,
                      "coauthor_count": len(coauthors)}
    except Exception as e:
        pubmed_raw = {"error": str(e)}

    try:
        ct_service = ClinicalTrialsService()
        trial_data = await ct_service.get_trial_details(hcp.full_name)
        automated_data["trials_led"] = trial_data["trials_led"]
        trials_raw = trial_data
    except Exception as e:
        trials_raw = {"error": str(e)}

    try:
        scholar = ScholarService(user_id=getattr(hcp, "user_id", None))
        guideline_data = await scholar.search_guidelines(hcp.full_name, hcp.specialty or "")
        automated_data["intl_guidelines"] = guideline_data.get("intl_guidelines", False)
        automated_data["national_guidelines"] = guideline_data.get("national_guidelines", False)
    except Exception as e:
        pass

    manual_data = data.model_dump()
    manual_data["age_estimate"] = hcp.age_estimate
    result = ScoringEngine.calculate_full_assessment(manual_data, automated_data, db=db)

    assessment = Assessment(
        hcp_id=hcp_id,
        assessed_by=current_user.id,
        pubmed_data=json.dumps(pubmed_raw, default=str),
        clinical_trials_data=json.dumps(trials_raw, default=str),
        network_data=json.dumps(network_raw, default=str),
        **result,
    )
    db.add(assessment)
    hcp.status = HCPStatus.assessed

    audit = AuditLog(
        action="automated_assessment",
        details=f"Automated scoring. Tier: {result['tier']}, Score: {result['final_score']}",
        performed_by=current_user.id,
    )
    db.add(audit)
    db.commit()
    db.refresh(assessment)

    audit.assessment_id = assessment.id
    db.commit()

    return assessment


# ─── Additional Categories (bonus) ──────────────────────────
ADDITIONAL_CATEGORIES = {"C.5 Citation Velocity", "C.6 Network Centrality", "C.7 Patient Impact", "C.8 Guideline Authority", "C.9 Emerging Leader", "C.10 Practo Patient Influence"}


# ─── AI-Powered CV Scoring ──────────────────────────────────

class AIScoreResponse(BaseModel):
    assessment_id: int
    hcp_id: int
    final_score: float
    tier: str
    justification: Optional[str] = None
    profile_extracted: Optional[dict] = None
    parameter_scores: List[dict] = []


@router.post("/{hcp_id}/score-ai", response_model=AIScoreResponse)
async def score_with_ai(
    hcp_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Score an HCP using multi-source scoring: CV (AI), PubMed, ClinicalTrials, Google Scholar."""
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")

    # Get CV text (optional now — form data alone is sufficient)
    cv_text = ""
    if hcp.cv_parsed_data:
        try:
            parsed = json.loads(hcp.cv_parsed_data) if isinstance(hcp.cv_parsed_data, str) else hcp.cv_parsed_data
            cv_text = parsed.get("raw_text", "")
        except (json.JSONDecodeError, TypeError):
            cv_text = ""

    # Build form data context from HCP profile fields
    form_data = {}
    if hcp.full_name:
        form_data["full_name"] = hcp.full_name
    if hcp.city:
        form_data["city"] = hcp.city
    if hcp.specialty:
        form_data["specialty"] = hcp.specialty
    if hcp.institution:
        form_data["institution"] = hcp.institution
    if hcp.designation:
        form_data["designation"] = hcp.designation
    # Career history, current and past. Previously stored (by the CV regex parser)
    # but never passed to the prompt, so SC_FACULTY_POSITIONS had nothing to read.
    if getattr(hcp, "faculty_positions", None):
        form_data["faculty_positions"] = hcp.faculty_positions
    if hcp.years_of_experience:
        form_data["years_of_experience"] = str(hcp.years_of_experience)
    # Qualifications: the column existed and was never passed, so SC_GRADUATION
    # and SC_POST_GRADUATION (6 points) had nothing to read and scored 0 on CVs
    # that plainly state MBBS and MD. A manual assessor reads them off page one.
    if getattr(hcp, "education", None):
        form_data["education"] = hcp.education
    # Columns that existed but were never written and never passed. Six
    # parameters read them — SC_UNIQUE_EXPERTISE (4), C4_UNIQUE_EXPERTISE (2),
    # SC_SURGERIES_PER_YEAR (4), SC_SURGICAL_DESCRIPTION (4),
    # C4_PROCEDURES_PER_YEAR (4) and C9_YOUNG_PROLIFIC — so an HCP entered
    # without a CV file could not earn any of them, because the only place the
    # information ever appeared was the raw CV text.
    if getattr(hcp, "unique_expertise", None):
        form_data["unique_expertise"] = hcp.unique_expertise
    if getattr(hcp, "procedures_per_year", None):
        form_data["procedures_per_year"] = str(hcp.procedures_per_year)
    if getattr(hcp, "age_estimate", None):
        form_data["age_estimate"] = str(hcp.age_estimate)
    if hcp.key_clinical_interests:
        form_data["key_clinical_interests"] = hcp.key_clinical_interests
    if hcp.publications:
        form_data["publications"] = hcp.publications
    if hcp.conference_presentations:
        form_data["conference_presentations"] = hcp.conference_presentations
    if getattr(hcp, "advisory_board", None):
        form_data["advisory_board"] = hcp.advisory_board
    if getattr(hcp, "textbooks", None):
        form_data["textbooks"] = hcp.textbooks
    if getattr(hcp, "office_bearer_positions", None):
        form_data["office_bearer_positions"] = hcp.office_bearer_positions
    if hcp.medical_registration_no:
        form_data["medical_registration_no"] = hcp.medical_registration_no
    if getattr(hcp, "affiliated_to_government", None):
        form_data["affiliated_to_government"] = hcp.affiliated_to_government
    if hcp.professional_memberships:
        form_data["professional_memberships"] = hcp.professional_memberships
    if hcp.awards_recognitions:
        form_data["awards_recognitions"] = hcp.awards_recognitions

    has_cv = bool(cv_text.strip())
    has_form = bool(form_data)

    if not has_cv and not has_form:
        raise HTTPException(status_code=400, detail="No data available. Please provide HCP details or upload a CV.")

    # ── Fetch LinkedIn profile in background ──
    linkedin_data = {}
    try:
        linkedin_svc = LinkedInService()
        linkedin_data = await linkedin_svc.find_profile(
            full_name=hcp.full_name or "",
            institution=hcp.institution or "",
            specialty=hcp.specialty or "",
            city=hcp.city or "",
        )
        if linkedin_data.get("profile_found"):
            logger.info(f"LinkedIn profile found for {hcp.full_name}: {linkedin_data.get('profile_url')}")
            # Add LinkedIn info to form data so AI can use it
            li_info = []
            if linkedin_data.get("headline"):
                li_info.append(f"LinkedIn Headline: {linkedin_data['headline']}")
            if linkedin_data.get("snippet"):
                li_info.append(f"LinkedIn Summary: {linkedin_data['snippet']}")
            if linkedin_data.get("profile_url"):
                li_info.append(f"LinkedIn URL: {linkedin_data['profile_url']}")
            if li_info:
                form_data["linkedin_info"] = "; ".join(li_info)
    except Exception as e:
        logger.warning(f"LinkedIn search failed for {hcp.full_name}: {e}")
        linkedin_data = {"error": str(e)}

    # Get user's enabled parameters
    params = db.query(AssessmentParameter).filter(
        or_(
            AssessmentParameter.is_standard == True,
            AssessmentParameter.created_by == current_user.id,
        ),
        AssessmentParameter.is_active == True,
    ).order_by(AssessmentParameter.sort_order, AssessmentParameter.id).all()

    prefs = db.query(UserParameterPreference).filter(
        UserParameterPreference.user_id == current_user.id
    ).all()
    pref_map = {p.parameter_id: p.is_enabled for p in prefs}

    enabled_params = []
    for p in params:
        default_enabled = p.category not in ADDITIONAL_CATEGORIES
        is_enabled = pref_map.get(p.id, default_enabled)
        if is_enabled:
            enabled_params.append({
                "id": p.id,
                "code": p.code,
                "name": p.name,
                "category": p.category,
                "description": p.description,
                "max_score": p.max_score,
                "score_group": p.score_group,
                "group_max_score": p.group_max_score,
                "scoring_source": p.scoring_source or "cv",
            })

    if not enabled_params:
        raise HTTPException(status_code=400, detail="No assessment parameters are enabled.")

    # ── Split parameters by scoring source ──
    cv_params = [p for p in enabled_params if p["scoring_source"] == "cv"]
    pubmed_params = [p for p in enabled_params if p["scoring_source"] == "pubmed"]
    ct_params = [p for p in enabled_params if p["scoring_source"] == "clinical_trials"]
    scholar_params = [p for p in enabled_params if p["scoring_source"] == "google_scholar"]
    practo_params = [p for p in enabled_params if p["scoring_source"] == "practo"]

    # ── 1. Score CV/form-based parameters with AI ──
    profile_data = {}
    ai_summary = "Assessment completed."
    cv_scores = []
    # The account owning this HCP decides whether a model may see the CV at all.
    # With AI off, the same parameters are scored by rule from the structured
    # fields — deterministic, and nothing leaves the system.
    owner = db.query(User).filter(User.id == hcp.user_id).first()
    ai_allowed = bool(getattr(owner, "ai_enabled", True)) if owner else True

    if cv_params and not ai_allowed:
        cv_scores = score_by_rules(cv_params, form_data)
        ai_summary = (
            "Scored from the recorded profile using the rule engine. AI is turned "
            "off for this account, so no CV text was sent to a model."
        )
        logger.info(f"Rule-based scoring for HCP {hcp_id}: {len(cv_scores)} params")
    elif cv_params and (has_cv or has_form):
        try:
            ai_result = score_cv_with_ai(db, cv_text, cv_params, hcp.full_name, form_data=form_data)
            profile_data = ai_result.get("profile", {})
            ai_summary = ai_result.get("overall_summary", ai_summary)
            scores_map = {s["parameter_id"]: s for s in ai_result.get("scores", [])}
            for p in cv_params:
                ai_score_data = scores_map.get(p["id"], {})
                score = min(float(ai_score_data.get("score", 0)), p["max_score"])
                cv_scores.append({
                    "parameter_id": p["id"],
                    "parameter_code": p["code"],
                    "parameter_name": p["name"],
                    "parameter_category": p["category"],
                    "score": round(score, 1),
                    "max_score": p["max_score"],
                    "justification": ai_score_data.get("justification", "No evidence found in CV"),
                    "scoring_source": "cv",
                    "source_data": None,
                })
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"AI scoring failed: {e}")
            raise HTTPException(status_code=500, detail=f"AI scoring failed: {str(e)}")

    # ── 2. Score PubMed-based parameters with NCBI API ──
    # Always fetch PubMed data (needed for cross-source enrichment)
    pubmed_scores = []
    all_pubmed_data = {}
    pubmed_config = get_default_pubmed_config(db)
    api_key = pubmed_config.api_key if pubmed_config else ""
    email = pubmed_config.email if pubmed_config else ""
    author_name = hcp.full_name
    affiliation = hcp.institution or ""

    try:
        all_pubmed_data = await fetch_pubmed_data(author_name, affiliation, api_key, email)

        # PubMed is the preferred source, but it finds nothing for an author it
        # cannot match — a name spelled differently, an anonymised CV, or
        # journals it does not index. Those parameters then scored 0 while a
        # manual assessor, reading the same CV, counted the papers listed on it.
        # Fall back to the HCP's own publication rows, which now carry a year
        # and a journal each, and say plainly which source was used.
        found_on_pubmed = (all_pubmed_data or {}).get("total_publications", 0)
        if not found_on_pubmed:
            from_cv = publications_from_cv(getattr(hcp, "publications", None))
            if from_cv:
                logger.info(
                    f"PubMed found nothing for {author_name}; scoring publications from the CV "
                    f"({from_cv['total_publications']} listed, {from_cv['publications_last_5_years']} in window)"
                )
                all_pubmed_data = {**all_pubmed_data, **from_cv}

        if pubmed_params:
            pubmed_scores = score_pubmed_parameters(pubmed_params, all_pubmed_data)
            if all_pubmed_data.get("_source") == "cv":
                for entry in pubmed_scores:
                    entry["justification"] = (
                        entry.get("justification", "").replace("on PubMed", "on the CV")
                        + " (PubMed had no matching record; counted from the CV's publication list.)"
                    )
            logger.info(f"Publication scoring complete for {author_name}: {len(pubmed_scores)} params scored")
    except Exception as e:
        logger.error(f"PubMed scoring failed: {e}")
        all_pubmed_data = {"error": str(e)}
        for p in pubmed_params:
            pubmed_scores.append({
                "parameter_id": p["id"],
                "parameter_code": p["code"],
                "parameter_name": p["name"],
                "parameter_category": p["category"],
                "score": 0,
                "max_score": p["max_score"],
                "justification": f"PubMed scoring unavailable: {str(e)}",
                "scoring_source": "pubmed",
                "source_data": None,
            })

    # ── 3. Score Clinical Trials parameters ──
    ct_scores = []
    all_ct_data = {}
    try:
        ct_scores = await score_clinical_trials_parameters(ct_params, hcp.full_name) if ct_params else []
        # Extract trial data for cross-source enrichment
        if ct_scores:
            try:
                sd = json.loads(ct_scores[0].get("source_data", "{}"))
                all_ct_data = sd
            except (json.JSONDecodeError, TypeError, IndexError):
                pass
        if not all_ct_data:
            ct_service = ClinicalTrialsService()
            all_ct_data = await ct_service.get_trial_details(hcp.full_name)
        if ct_params:
            logger.info(f"ClinicalTrials scoring complete: {len(ct_scores)} params scored")
    except Exception as e:
        logger.error(f"ClinicalTrials scoring failed: {e}")
        all_ct_data = {"error": str(e)}
        for p in ct_params:
            ct_scores.append({
                "parameter_id": p["id"],
                "parameter_code": p["code"],
                "parameter_name": p["name"],
                "parameter_category": p["category"],
                "score": 0,
                "max_score": p["max_score"],
                "justification": f"ClinicalTrials.gov scoring unavailable: {str(e)}",
                "scoring_source": "clinical_trials",
                "source_data": None,
            })

    # ── 4. Score Google Scholar parameters ──
    scholar_scores = []
    all_scholar_data = {}
    try:
        if scholar_params:
            scholar_scores = await score_google_scholar_parameters(
                scholar_params, hcp.full_name, hcp.specialty or "",
                user_id=getattr(hcp, "user_id", None),
            )
            logger.info(f"Google Scholar scoring complete: {len(scholar_scores)} params scored")
            # Extract scholar data for cross-source enrichment
            try:
                sd = json.loads(scholar_scores[0].get("source_data", "{}"))
                all_scholar_data = sd
            except (json.JSONDecodeError, TypeError, IndexError):
                pass
        if not all_scholar_data:
            scholar_svc = ScholarService()
            all_scholar_data = await scholar_svc.search_guidelines(hcp.full_name, hcp.specialty or "")
    except Exception as e:
        logger.error(f"Google Scholar scoring failed: {e}")
        all_scholar_data = {"error": str(e)}
        for p in scholar_params:
            scholar_scores.append({
                "parameter_id": p["id"],
                "parameter_code": p["code"],
                "parameter_name": p["name"],
                "parameter_category": p["category"],
                "score": 0,
                "max_score": p["max_score"],
                "justification": f"Google Scholar scoring unavailable: {str(e)}",
                "scoring_source": "google_scholar",
                "source_data": None,
            })

    # ── 5. Fetch Practo data (always — needed for cross-source enrichment) ──
    practo_scores = []
    all_practo_data = {}
    try:
        all_practo_data = await fetch_practo_data(
            hcp.full_name, hcp.city or "", hcp.specialty or ""
        )
        if practo_params:
            practo_scores = score_practo_parameters(practo_params, all_practo_data)
            logger.info(f"Practo scoring complete: {len(practo_scores)} params scored")
    except Exception as e:
        logger.error(f"Practo scoring failed: {e}")
        all_practo_data = {"error": str(e)}
        for p in practo_params:
            practo_scores.append({
                "parameter_id": p["id"],
                "parameter_code": p["code"],
                "parameter_name": p["name"],
                "parameter_category": p["category"],
                "score": 0,
                "max_score": p["max_score"],
                "justification": f"Practo scoring unavailable: {str(e)}",
                "scoring_source": "practo",
                "source_data": None,
            })

    # ── Merge all scores ──
    param_scores_out = cv_scores + pubmed_scores + ct_scores + scholar_scores + practo_scores

    # ── 6. Cross-source enrichment: fill zero-scored params from any available source ──
    param_scores_out = enrich_scores_cross_source(
        param_scores_out,
        pubmed_data=all_pubmed_data,
        practo_data=all_practo_data,
        clinical_trials_data=all_ct_data,
        scholar_data=all_scholar_data,
    )

    # Update HCP profile with extracted info from CV/AI
    if profile_data:
        if profile_data.get("full_name") and hcp.full_name and (hcp.full_name == hcp.full_name.replace(".", " ").strip()):
            extracted_name = profile_data.get("full_name")
            if extracted_name and len(extracted_name) > 2:
                hcp.full_name = extracted_name
        if profile_data.get("email") and not hcp.email:
            hcp.email = profile_data["email"]
        if profile_data.get("specialty") and not hcp.specialty:
            hcp.specialty = profile_data["specialty"]
        if profile_data.get("institution") and not hcp.institution:
            hcp.institution = profile_data["institution"]
        if profile_data.get("country") and not hcp.country:
            hcp.country = profile_data["country"]
        if profile_data.get("years_of_experience") and not hcp.years_of_experience:
            hcp.years_of_experience = profile_data["years_of_experience"]
        if profile_data.get("education") and not hcp.education:
            hcp.education = profile_data["education"]
        if profile_data.get("designation") and not hcp.designation:
            hcp.designation = profile_data["designation"]
        if profile_data.get("key_clinical_interests") and not hcp.key_clinical_interests:
            hcp.key_clinical_interests = profile_data["key_clinical_interests"]

    # Store LinkedIn profile URL if found
    if linkedin_data.get("profile_found") and linkedin_data.get("profile_url"):
        profile_data["linkedin_url"] = linkedin_data["profile_url"]
        profile_data["linkedin_headline"] = linkedin_data.get("headline")

    # Calculate total score. Tiers of one criterion share a group and count
    # together up to the group's cap, so the standard set totals 50.
    _groups = {p["id"]: (p["score_group"], p["group_max_score"]) for p in enabled_params}
    total_score, _, _ = capped_totals([
        {"score": ps["score"], "max_score": ps["max_score"],
         "score_group": _groups.get(ps["parameter_id"], (None, None))[0],
         "group_max_score": _groups.get(ps["parameter_id"], (None, None))[1]}
        for ps in param_scores_out
    ])
    max_possible = full_scale(db, current_user.id)
    tier = ScoringEngine.determine_tier(total_score, db=db, user_id=hcp.user_id)

    # Build scoring method summary
    sources_used = list(set(ps.get("scoring_source", "cv") for ps in param_scores_out))
    if linkedin_data.get("profile_found"):
        sources_used.append("linkedin")
    scoring_meta = {
        # Named for what actually ran. The audit trail is the evidence an
        # account with AI off can show, so it must not say "ai" when no model
        # was called — the CV parameters were scored by the rule engine.
        "scoring_method": "multi_source" if ai_allowed else "multi_source_rules",
        "ai_used": bool(ai_allowed),
        "sources_used": sources_used,
        "parameters_scored": len(param_scores_out),
        "cv_params": len(cv_scores),
        "pubmed_params": len(pubmed_scores),
        "clinical_trials_params": len(ct_scores),
        "google_scholar_params": len(scholar_scores),
        "practo_params": len(practo_scores),
        "practo_profile_found": all_practo_data.get("profile_found", False),
        "practo_profile_url": all_practo_data.get("profile_url", ""),
        "has_cv": has_cv,
        "has_form_data": has_form,
        "linkedin_found": linkedin_data.get("profile_found", False),
        "linkedin_url": linkedin_data.get("profile_url"),
    }

    # The most recent prior assessment, captured BEFORE the new row is added —
    # it is what makes this a re-assessment and supplies the before/after values
    # for the audit entry.
    prior_assessment = (
        db.query(Assessment)
        .filter(Assessment.hcp_id == hcp_id)
        .order_by(Assessment.created_at.desc())
        .first()
    )

    # Create assessment record
    assessment = Assessment(
        hcp_id=hcp_id,
        assessed_by=current_user.id,
        final_score=round(total_score, 1),
        tier=tier,
        justification=ai_summary,
        confidence_flags=json.dumps(scoring_meta),
    )
    db.add(assessment)
    hcp.status = HCPStatus.assessed
    db.flush()

    # Belt and braces: clear anything already filed against this assessment id
    # before writing. Without a FK cascade a recycled id can arrive carrying an
    # older run's rows, and the results page would then show each parameter
    # twice — once scored, once stale.
    db.query(AssessmentParameterScore).filter(
        AssessmentParameterScore.assessment_id == assessment.id
    ).delete(synchronize_session=False)

    # Save per-parameter scores (inject search context into source_data for traceability)
    search_context = {
        "_author_name": hcp.full_name,
        "_institution": hcp.institution or "",
        "_specialty": hcp.specialty or "",
        "_linkedin_url": linkedin_data.get("profile_url") or "",
    }
    for ps in param_scores_out:
        raw_source = ps.get("source_data")
        if raw_source:
            try:
                sd = json.loads(raw_source) if isinstance(raw_source, str) else raw_source
                sd.update(search_context)
                enriched_source = json.dumps(sd)
            except (json.JSONDecodeError, TypeError):
                enriched_source = raw_source
        else:
            enriched_source = None
        score_record = AssessmentParameterScore(
            assessment_id=assessment.id,
            parameter_id=ps["parameter_id"],
            parameter_code=ps["parameter_code"],
            parameter_name=ps["parameter_name"],
            parameter_category=ps["parameter_category"],
            score=ps["score"],
            max_score=ps["max_score"],
            justification=ps["justification"],
            scoring_source=ps.get("scoring_source", "cv"),
            source_data=enriched_source,
        )
        db.add(score_record)

    # Audit log. A re-run is recorded as its own action: "who scored this and
    # when" and "who scored it AGAIN, and what changed" are different questions,
    # and collapsing them into one action makes the second unanswerable.
    engine = "AI" if ai_allowed else "rule engine, no AI"
    if prior_assessment is not None:
        action = "reassessment"
        moved = (f"{prior_assessment.tier} → {tier}"
                 if prior_assessment.tier != tier else f"{tier} (unchanged)")
        details = (f"Re-assessment ({engine}). "
                   f"Sources: {', '.join(sources_used)}. "
                   f"Score {prior_assessment.final_score} → {round(total_score, 1)}/{max_possible}. "
                   f"Tier {moved}.")
    else:
        action = "ai_assessment" if ai_allowed else "rule_assessment"
        details = (f"Multi-source scoring completed"
                   f"{'' if ai_allowed else ' (rule engine, no AI)'}. "
                   f"Sources: {', '.join(sources_used)}. "
                   f"Tier: {tier}, Score: {round(total_score, 1)}/{max_possible}")
    audit = AuditLog(action=action, details=details, performed_by=current_user.id)
    db.add(audit)
    db.commit()
    db.refresh(assessment)

    audit.assessment_id = assessment.id
    db.commit()

    return AIScoreResponse(
        assessment_id=assessment.id,
        hcp_id=hcp_id,
        final_score=round(total_score, 1),
        tier=tier,
        justification=ai_summary,
        profile_extracted=profile_data,
        parameter_scores=param_scores_out,
    )


@router.get("/{hcp_id}/parameter-scores")
def get_parameter_scores(
    hcp_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get per-parameter scores for the latest assessment of an HCP."""
    assessment = db.query(Assessment).filter(
        Assessment.hcp_id == hcp_id
    ).order_by(Assessment.created_at.desc()).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="No assessment found for this HCP")

    scores = db.query(AssessmentParameterScore).filter(
        AssessmentParameterScore.assessment_id == assessment.id
    ).all()
    groups = param_group_map(db, [s.parameter_id for s in scores])
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    _, _, category_totals = capped_totals([
        {"score": s.score, "max_score": s.max_score, "category": s.parameter_category,
         "score_group": groups.get(s.parameter_id, (None, None))[0],
         "group_max_score": groups.get(s.parameter_id, (None, None))[1]}
        for s in scores
    ])

    return {
        "assessment_id": assessment.id,
        "hcp_id": hcp_id,
        "final_score": assessment.final_score,
        "tier": assessment.tier,
        "justification": assessment.justification,
        # Same UTC marker as the audit trail below. Without it "Assessed on"
        # can show the WRONG DAY: an assessment stored at 20:00 UTC is 01:30 the
        # next day in IST, but a naive string is read as local and renders the
        # earlier date.
        "created_at": assessment.created_at.isoformat() + "Z" if assessment.created_at else None,
        "scoring_meta": json.loads(assessment.confidence_flags) if assessment.confidence_flags else {},
        # The "out of" figure (50 for the standard set) and per-category totals
        # with group caps applied — summing max_score row by row double-counts tiers.
        "max_possible": full_scale(db, hcp.user_id if hcp else None),
        "category_totals": category_totals,
        "parameter_scores": [
            {
                "id": s.id,
                "parameter_id": s.parameter_id,
                "parameter_code": s.parameter_code,
                "parameter_name": s.parameter_name,
                "parameter_category": s.parameter_category,
                "score": s.score,
                "max_score": s.max_score,
                "score_group": groups.get(s.parameter_id, (None, None))[0],
                "group_max_score": groups.get(s.parameter_id, (None, None))[1],
                "justification": s.justification,
                "scoring_source": s.scoring_source or "cv",
                "source_data": json.loads(s.source_data) if s.source_data else None,
                "is_verified": s.is_verified or False,
                "verified_by": s.verified_by,
                "verified_at": str(s.verified_at) if s.verified_at else None,
            }
            for s in scores
        ],
    }


@router.get("/stats")
def assessment_stats(db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    """Tier mix, average score and top specialties for the caller's own book.

    ⚠️ Declared BEFORE `/{hcp_id}`: FastAPI matches in definition order, so with
    this below it the path would bind hcp_id="stats" and 422 on the int parse.

    Aggregated in SQL rather than by pulling every row into the dashboard — a
    user with a few thousand assessments should not download them to draw one
    bar chart.
    """
    query = db.query(Assessment)
    # Same scoping rule as list_assessments: a plain user sees only assessments
    # for HCPs they own.
    if current_user.role == "user":
        hcp_ids = [h.id for h in db.query(HCPProfile).filter(
            HCPProfile.user_id == current_user.id).all()]
        query = query.filter(Assessment.hcp_id.in_(hcp_ids))
        hcp_query = db.query(HCPProfile).filter(HCPProfile.user_id == current_user.id)
    else:
        hcp_query = db.query(HCPProfile)

    total = query.count()
    avg_score = query.with_entities(func.avg(Assessment.final_score)).scalar() or 0

    tier_rows = query.with_entities(
        Assessment.tier, func.count(Assessment.id)
    ).group_by(Assessment.tier).all()
    tier_counts = {str(t): c for t, c in tier_rows if t}

    specialty_rows = (
        hcp_query.with_entities(HCPProfile.specialty, func.count(HCPProfile.id))
        .filter(HCPProfile.specialty.isnot(None), HCPProfile.specialty != "")
        .group_by(HCPProfile.specialty)
        .order_by(func.count(HCPProfile.id).desc())
        .limit(5)
        .all()
    )

    return {
        "total": total,
        "avg_score": round(float(avg_score), 1),
        "tier_counts": tier_counts,
        "top_specialties": [{"specialty": sp, "count": c} for sp, c in specialty_rows],
    }


@router.get("/{hcp_id}", response_model=AssessmentResponse)
def get_assessment(hcp_id: int, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    assessment = db.query(Assessment).filter(
        Assessment.hcp_id == hcp_id
    ).order_by(Assessment.created_at.desc()).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="No assessment found for this HCP")
    return assessment


@router.get("/")
def list_assessments(skip: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=1000),
                     tier: Optional[str] = None,
                     db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    query = db.query(Assessment)
    if current_user.role == "user":
        hcp_ids = [h.id for h in db.query(HCPProfile).filter(HCPProfile.user_id == current_user.id).all()]
        query = query.filter(Assessment.hcp_id.in_(hcp_ids))
    if tier:
        query = query.filter(Assessment.tier == tier)
    total = query.count()
    assessments = query.order_by(Assessment.created_at.desc()).offset(skip).limit(limit).all()
    result = []
    for a in assessments:
        hcp = db.query(HCPProfile).filter(HCPProfile.id == a.hcp_id).first()
        result.append({
            "id": a.id,
            "hcp_id": a.hcp_id,
            "hcp_name": hcp.full_name if hcp else "",
            "specialty": hcp.specialty if hcp else "",
            "final_score": a.final_score,
            "tier": a.tier,
            "justification": a.justification,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    return {"total": total, "items": result}


@router.get("/{hcp_id}/export-csv")
def export_assessment_csv(hcp_id: int, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    assessment = db.query(Assessment).filter(Assessment.hcp_id == hcp_id).order_by(
        Assessment.created_at.desc()).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="No assessment found")

    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Field", "Value"])
    writer.writerow(["HCP Name", hcp.full_name if hcp else ""])
    writer.writerow(["Specialty", hcp.specialty if hcp else ""])
    writer.writerow(["Country", hcp.country if hcp else ""])
    writer.writerow(["C.1 Leadership Score", assessment.c1_leadership_score])
    writer.writerow(["C.2 Presentations Score", assessment.c2_presentations_score])
    writer.writerow(["C.3 Publications Score", assessment.c3_publications_score])
    writer.writerow(["C.4 Clinical Experience Score", assessment.c4_clinical_experience_score])
    writer.writerow(["Base Score", assessment.base_score])
    writer.writerow(["C.5 Citation Velocity", assessment.c5_citation_velocity_score])
    writer.writerow(["C.6 Network Centrality", assessment.c6_network_centrality_score])
    writer.writerow(["C.7 Patient Impact", assessment.c7_patient_impact_score])
    writer.writerow(["C.8 Guideline Authority", assessment.c8_guideline_authority_score])
    writer.writerow(["C.9 Emerging Leader", assessment.c9_emerging_leader_score])
    writer.writerow(["Bonus Score", assessment.bonus_score])
    writer.writerow(["Final Score", assessment.final_score])
    writer.writerow(["Tier", assessment.tier])
    writer.writerow(["Justification", assessment.justification])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=assessment_hcp_{hcp_id}.csv"}
    )


@router.get("/{hcp_id}/audit")
def get_audit_trail(hcp_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    assessments = db.query(Assessment).filter(Assessment.hcp_id == hcp_id).all()
    assessment_ids = [a.id for a in assessments]
    if not assessment_ids:
        return []
    logs = db.query(AuditLog).filter(AuditLog.assessment_id.in_(assessment_ids)).order_by(
        AuditLog.created_at.desc()).all()
    result = []
    for l in logs:
        user = db.query(User).filter(User.id == l.performed_by).first() if l.performed_by else None
        result.append({
            "id": l.id, "action": l.action, "details": l.details,
            "performed_by": l.performed_by,
            "performed_by_name": (user.full_name or user.email) if user else "-",
            # ISO-8601 with an explicit UTC marker. These are stored via
            # datetime.utcnow(), and `str(dt)` emits "2026-09-04 11:39:31" with
            # no offset — which every browser then parses as LOCAL time, showing
            # the trail 5.5h behind in IST. The Z is what makes the client
            # convert instead of mislabel.
            "created_at": l.created_at.isoformat() + "Z" if l.created_at else None,
        })
    return result


class ParameterScoreOverride(BaseModel):
    score: float
    justification: Optional[str] = None


@router.put("/parameter-score/{score_id}")
def override_parameter_score(
    score_id: int,
    data: ParameterScoreOverride,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set one parameter's score by hand and re-total the assessment.

    Needed for the four judgement-based criteria the rule engine cannot decide
    ("unique clinical expertise", "top institution" and so on): they score 0
    with "needs manual review", and until now there was no way to correct them —
    `verify` only toggled a flag. Also lets a reviewer correct any score they
    disagree with, AI-produced or not.
    """
    score = db.query(AssessmentParameterScore).filter(
        AssessmentParameterScore.id == score_id
    ).first()
    if not score:
        raise HTTPException(status_code=404, detail="Parameter score not found")

    assessment = db.query(Assessment).filter(Assessment.id == score.assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    hcp = db.query(HCPProfile).filter(HCPProfile.id == assessment.hcp_id).first()
    if current_user.role == "user" and hcp and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    if data.score < 0 or data.score > float(score.max_score):
        raise HTTPException(
            status_code=400,
            detail=f"Score must be between 0 and {score.max_score} for this parameter.",
        )

    previous = score.score
    score.score = data.score
    score.justification = (data.justification or "").strip() or (
        f"Set manually by {current_user.full_name or current_user.email}."
    )
    score.scoring_source = "manual"
    score.is_verified = True
    score.verified_by = current_user.id
    from datetime import datetime as _dt
    score.verified_at = _dt.utcnow()
    db.flush()

    # The assessment total is the sum of its parameter rows, so it has to move
    # with them — and the tier is derived from the total.
    rows = db.query(AssessmentParameterScore).filter(
        AssessmentParameterScore.assessment_id == assessment.id
    ).all()
    groups = param_group_map(db, [r.parameter_id for r in rows])
    total, _, _ = capped_totals([
        {"score": r.score, "max_score": r.max_score,
         "score_group": groups.get(r.parameter_id, (None, None))[0],
         "group_max_score": groups.get(r.parameter_id, (None, None))[1]}
        for r in rows
    ])
    assessment.final_score = round(total, 1)
    assessment.tier = ScoringEngine.determine_tier(
        total, db=db, user_id=hcp.user_id if hcp else None
    )

    db.add(AuditLog(
        assessment_id=assessment.id,
        action="parameter_score_override",
        details=(f"{score.parameter_code}: {previous} -> {data.score}. "
                 f"Assessment total now {assessment.final_score} ({assessment.tier})."),
        performed_by=current_user.id,
    ))
    db.commit()
    db.refresh(score)
    return {
        "id": score.id,
        "parameter_code": score.parameter_code,
        "score": score.score,
        "max_score": score.max_score,
        "justification": score.justification,
        "assessment_total": assessment.final_score,
        "tier": assessment.tier,
    }


@router.put("/parameter-score/{score_id}/verify")
def verify_parameter_score(
    score_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle verification status of a parameter score."""
    from datetime import datetime

    score = db.query(AssessmentParameterScore).filter(
        AssessmentParameterScore.id == score_id
    ).first()
    if not score:
        raise HTTPException(status_code=404, detail="Parameter score not found")

    # Toggle verification
    if score.is_verified:
        score.is_verified = False
        score.verified_by = None
        score.verified_at = None
    else:
        score.is_verified = True
        score.verified_by = current_user.id
        score.verified_at = datetime.utcnow()

    db.commit()
    db.refresh(score)
    return {
        "id": score.id,
        "is_verified": score.is_verified,
        "verified_by": score.verified_by,
        "verified_at": str(score.verified_at) if score.verified_at else None,
    }


@router.post("/{assessment_id}/approve")
def approve_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verify every outstanding parameter score in one call, and audit it once.

    The page used to approve by firing one `verify` request per parameter, so a
    25-criterion assessment meant 25 round trips and — because `verify` writes
    no audit row — left NO record that the assessment was ever approved. One
    call, one audit entry, one answer to "when was this approved and by whom".
    """
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    hcp = db.query(HCPProfile).filter(HCPProfile.id == assessment.hcp_id).first()
    if current_user.role == "user" and hcp and hcp.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    scores = db.query(AssessmentParameterScore).filter(
        AssessmentParameterScore.assessment_id == assessment_id
    ).all()

    # A score still flagged for manual review has not been decided by anyone, and
    # approving it would verify a number nobody set.
    pending = [s for s in scores if s.justification and "needs manual review" in s.justification.lower()]
    if pending:
        raise HTTPException(
            status_code=400,
            detail=f"{len(pending)} criterion/criteria still need a reviewer's score before approval.",
        )

    now = datetime.utcnow()
    newly = 0
    for s in scores:
        if not s.is_verified:
            s.is_verified = True
            s.verified_by = current_user.id
            s.verified_at = now
            newly += 1

    db.add(AuditLog(
        assessment_id=assessment.id,
        action="assessment_approved",
        details=(f"Assessment approved. {newly} criterion/criteria verified "
                 f"({len(scores)} total). Tier: {assessment.tier}, "
                 f"Score: {assessment.final_score}"),
        performed_by=current_user.id,
    ))
    db.commit()
    return {
        "assessment_id": assessment.id,
        "verified_count": len(scores),
        "newly_verified": newly,
        "approved_at": now.isoformat() + "Z",
    }
