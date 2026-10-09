import os
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, Form
from sqlalchemy.orm import Session, joinedload
from typing import Optional
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.hcp import HCPProfile
from app.models.form_link import FormLink, FormSubmission, FormSubmissionStatus
from app.services.cv_parser import CVParser
from app.services import cv_rule_extractor
from app.models.assessment import Assessment
from app.models.audit_log import AuditLog
from app.services.hcp_duplicates import (
    cv_fingerprint,
    duplicate_report,
    describe_match,
    AUTO_MERGE_CONFIDENCES,
)

router = APIRouter(tags=["Form Links"])


# ── Schemas ──────────────────────────────────────────────

class FormLinkCreate(BaseModel):
    title: Optional[str] = None


class FormLinkResponse(BaseModel):
    id: int
    token: str
    title: Optional[str]
    is_active: bool
    created_at: str
    submission_count: int

    class Config:
        from_attributes = True


class FormSubmissionResponse(BaseModel):
    id: int
    form_link_id: int
    full_name: Optional[str]
    email: Optional[str]
    city: Optional[str]
    specialty: Optional[str]
    institution: Optional[str]
    designation: Optional[str]
    years_of_experience: Optional[int]
    key_clinical_interests: Optional[str]
    publications: Optional[str]
    conference_presentations: Optional[str]
    professional_memberships: Optional[str]
    awards_recognitions: Optional[str]
    has_cv: bool
    status: str
    hcp_id: Optional[int]
    created_at: str
    form_link_title: Optional[str] = None

    class Config:
        from_attributes = True


class PublicFormInfo(BaseModel):
    title: Optional[str]
    is_active: bool


# ── Authenticated Endpoints ──────────────────────────────

@router.post("/form-links", status_code=201)
def create_form_link(
    data: FormLinkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a new shareable form link."""
    token = uuid.uuid4().hex
    link = FormLink(
        user_id=current_user.id,
        token=token,
        title=data.title or "HCP Assessment Form",
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return {
        "id": link.id,
        "token": link.token,
        "title": link.title,
        "is_active": link.is_active,
        "created_at": link.created_at.isoformat(),
    }


@router.get("/form-links")
def list_form_links(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all form links created by current user."""
    links = db.query(FormLink).filter(
        FormLink.user_id == current_user.id
    ).order_by(FormLink.created_at.desc()).all()

    result = []
    for link in links:
        count = db.query(FormSubmission).filter(
            FormSubmission.form_link_id == link.id
        ).count()
        result.append({
            "id": link.id,
            "token": link.token,
            "title": link.title,
            "is_active": link.is_active,
            "created_at": link.created_at.isoformat(),
            "submission_count": count,
        })
    return result


@router.delete("/form-links/{link_id}")
def delete_form_link(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    link = db.query(FormLink).filter(
        FormLink.id == link_id, FormLink.user_id == current_user.id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Form link not found")
    db.delete(link)
    db.commit()
    return {"detail": "Form link deleted"}


@router.put("/form-links/{link_id}/toggle")
def toggle_form_link(
    link_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    link = db.query(FormLink).filter(
        FormLink.id == link_id, FormLink.user_id == current_user.id
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Form link not found")
    link.is_active = not link.is_active
    db.commit()
    return {"is_active": link.is_active}


@router.get("/form-links/submissions")
def list_submissions(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all form submissions for the current user's form links."""
    query = db.query(FormSubmission).join(FormLink).filter(
        FormLink.user_id == current_user.id
    )
    if status:
        query = query.filter(FormSubmission.status == status)
    subs = query.order_by(FormSubmission.created_at.desc()).all()

    result = []
    for s in subs:
        link = db.query(FormLink).filter(FormLink.id == s.form_link_id).first()
        result.append({
            "id": s.id,
            "form_link_id": s.form_link_id,
            "full_name": s.full_name,
            "email": s.email,
            "city": s.city,
            "specialty": s.specialty,
            "institution": s.institution,
            "designation": s.designation,
            "years_of_experience": s.years_of_experience,
            "key_clinical_interests": s.key_clinical_interests,
            "publications": s.publications,
            "conference_presentations": s.conference_presentations,
            "professional_memberships": s.professional_memberships,
            "awards_recognitions": s.awards_recognitions,
            "has_cv": bool(s.cv_file_path),
            "status": s.status.value if hasattr(s.status, 'value') else s.status,
            "hcp_id": s.hcp_id,
            "created_at": s.created_at.isoformat(),
            "form_link_title": link.title if link else None,
        })
    return result


def _existing_hcp_for_submission(db: Session, current_user, sub):
    """The HCP this submission is for, if we already hold one.

    Only a confident match counts (the same CV file, registration number, email
    or mobile). A shared name is not enough to silently merge two people's
    submissions into one record, so a weak match creates the profile as before.
    """
    try:
        cv_hash = None
        if sub.cv_file_path and os.path.exists(sub.cv_file_path):
            with open(sub.cv_file_path, "rb") as fh:
                cv_hash = cv_fingerprint(fh.read())
        report = duplicate_report(
            db, current_user,
            full_name=sub.full_name,
            email=sub.email,
            mobile=getattr(sub, "mobile", None),
            medical_registration_no=getattr(sub, "medical_registration_no", None),
            city=sub.city,
            institution=sub.institution,
            cv_hash=cv_hash,
        )
    except Exception as e:
        # Never let identity matching block an assessment; worst case is the
        # behaviour that existed before — a new record.
        print(f"[form submission duplicate check] skipped: {e}")
        return None

    best = report.get("best_match")
    if not best or best["confidence"] not in AUTO_MERGE_CONFIDENCES:
        return None
    hcp = db.query(HCPProfile).filter(HCPProfile.id == best["hcp_id"]).first()
    if hcp is None:
        return None

    latest = (
        db.query(Assessment)
        .filter(Assessment.hcp_id == hcp.id)
        .order_by(Assessment.created_at.desc())
        .first()
    )
    db.add(AuditLog(
        assessment_id=latest.id if latest else None,
        action="duplicate_detected",
        details=(
            f"Form submission #{sub.id} matched an HCP already on file "
            f"(#{hcp.id} — {hcp.full_name or 'unnamed'}) on {describe_match(best)}. "
            f"No new record was created — this profile is being re-assessed."
        ),
        performed_by=current_user.id,
    ))
    db.commit()
    return hcp


@router.post("/form-links/submissions/{submission_id}/start-assessment")
def start_assessment_from_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Convert a form submission into an HCP profile. Frontend then calls score-ai."""
    sub = db.query(FormSubmission).join(FormLink).filter(
        FormSubmission.id == submission_id,
        FormLink.user_id == current_user.id,
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if sub.status == FormSubmissionStatus.assessed and sub.hcp_id:
        return {"hcp_id": sub.hcp_id, "status": "already_assessed"}
    # Allow retry if processing (previous attempt may have failed mid-way)
    if sub.status == FormSubmissionStatus.processing and sub.hcp_id:
        # HCP already created — just return it so frontend can retry scoring
        return {"hcp_id": sub.hcp_id, "status": "created"}

    sub.status = FormSubmissionStatus.processing
    db.commit()

    try:
        # Same identity rule as the New Assessment form: a submission for an HCP
        # already on file re-assesses that record rather than adding a second
        # one. Public form links are exactly where a duplicate is most likely —
        # the same doctor is sent the link twice, or fills it in again months
        # later — and nothing here previously noticed.
        existing = _existing_hcp_for_submission(db, current_user, sub)
        if existing is not None:
            sub.hcp_id = existing.id
            db.commit()
            return {"hcp_id": existing.id, "status": "matched_existing"}

        # Create HCP profile from submission data
        hcp = HCPProfile(
            user_id=current_user.id,
            full_name=sub.full_name or "Unnamed HCP",
            email=sub.email,
            city=sub.city,
            specialty=sub.specialty,
            institution=sub.institution,
            designation=sub.designation,
            years_of_experience=sub.years_of_experience,
            key_clinical_interests=sub.key_clinical_interests,
            publications=sub.publications,
            conference_presentations=sub.conference_presentations,
            professional_memberships=sub.professional_memberships,
            awards_recognitions=sub.awards_recognitions,
            cv_file_path=sub.cv_file_path,
            cv_parsed_data=sub.cv_parsed_data,
            hcp_type="non_surgeon_doctor",
            status="draft",
        )
        db.add(hcp)
        db.commit()
        db.refresh(hcp)

        sub.hcp_id = hcp.id
        db.commit()

        return {"hcp_id": hcp.id, "status": "created"}
    except Exception as e:
        sub.status = FormSubmissionStatus.failed
        db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to create HCP: {str(e)}")


@router.delete("/form-links/submissions/{submission_id}")
def delete_submission(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a form submission."""
    role = current_user.role.value if hasattr(current_user.role, 'value') else current_user.role
    if role in ('super_admin', 'admin'):
        sub = db.query(FormSubmission).filter(FormSubmission.id == submission_id).first()
    else:
        sub = db.query(FormSubmission).join(FormLink).filter(
            FormSubmission.id == submission_id,
            FormLink.user_id == current_user.id,
        ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    # Clean up CV file if exists
    if sub.cv_file_path and os.path.exists(sub.cv_file_path):
        os.remove(sub.cv_file_path)
    db.delete(sub)
    db.commit()
    return {"detail": "Submission deleted"}


@router.get("/form-links/submissions/{submission_id}/download-cv")
def download_submission_cv(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download CV file from a form submission."""
    from fastapi.responses import FileResponse
    sub = db.query(FormSubmission).filter(FormSubmission.id == submission_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    if not sub.cv_file_path or not os.path.exists(sub.cv_file_path):
        raise HTTPException(status_code=404, detail="No CV file found for this submission")
    filename = os.path.basename(sub.cv_file_path)
    return FileResponse(sub.cv_file_path, filename=filename, media_type="application/octet-stream")


@router.put("/form-links/submissions/{submission_id}/mark-assessed")
def mark_submission_assessed(
    submission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a submission as assessed after scoring completes."""
    sub = db.query(FormSubmission).join(FormLink).filter(
        FormSubmission.id == submission_id,
        FormLink.user_id == current_user.id,
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    sub.status = FormSubmissionStatus.assessed
    db.commit()
    return {"status": "assessed"}


# ── Public Endpoints (No Auth) ───────────────────────────

@router.get("/public/form/{token}")
def get_public_form(token: str, db: Session = Depends(get_db)):
    """Get public form info (no auth required)."""
    link = db.query(FormLink).filter(FormLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Form not found")
    if not link.is_active:
        raise HTTPException(status_code=410, detail="This form link is no longer active")
    return {"title": link.title, "is_active": link.is_active}


@router.post("/public/form/{token}/extract-cv")
async def extract_cv_public(
    token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Extract fields from CV for public form (no auth required)."""
    link = db.query(FormLink).filter(FormLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Form not found")
    if not link.is_active:
        raise HTTPException(status_code=410, detail="This form link is no longer active")

    # Reuse the extraction logic from hcp endpoint
    from app.api.endpoints.hcp import (
        _empty_extraction, _normalize_extracted,
        _call_vision_openai, _call_vision_anthropic, EXTRACTION_PROMPT,
        EXTRACTION_TEMPERATURE, EXTRACTION_MAX_TOKENS,
        _pdf_pages_as_png, _merge_extractions,
    )
    from app.models.configuration import AIConfiguration
    from app.services.ai_scoring_service import call_anthropic, call_openai
    import tempfile, logging

    logger = logging.getLogger(__name__)
    ext = os.path.splitext(file.filename or "")[1].lower()
    IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif", ".webp"}

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        content = await file.read()
        tmp.write(content)
        temp_path = tmp.name

    try:
        # The form link belongs to an account. If that account has AI off, a CV
        # arriving through its public form must not be sent to a model either —
        # otherwise "zero AI" leaks through the one door the account holder
        # does not personally operate.
        owner = db.query(User).filter(User.id == link.user_id).first()
        if owner is not None and not getattr(owner, "ai_enabled", True):
            # Read it here instead of returning nothing: the rule engine never
            # leaves the server, so the HCP filling the form still gets their
            # details pre-filled rather than an empty form.
            raw_text = CVParser.parse_file(temp_path).get("raw_text", "").strip()
            logger.info(
                f"Form link {link.id}: AI disabled for owner {owner.id}, "
                f"rule-based extraction over {len(raw_text)} chars"
            )
            if not raw_text:
                return _empty_extraction()
            return _normalize_extracted(cv_rule_extractor.extract_fields(raw_text))

        config = db.query(AIConfiguration).filter(AIConfiguration.is_default == True).first()

        if ext in IMAGE_EXTS:
            if not config:
                return _empty_extraction()
            import base64
            image_b64 = base64.b64encode(content).decode("utf-8")
            media_type = f"image/{ext.lstrip('.')}"
            if media_type == "image/jpg":
                media_type = "image/jpeg"
            try:
                provider = (config.provider or "").lower()
                if provider in ("anthropic", "claude"):
                    result = _call_vision_anthropic(config, image_b64, media_type)
                else:
                    result = _call_vision_openai(config, image_b64, media_type)
            except Exception:
                return _empty_extraction()
            return _normalize_extracted(result)

        parsed = CVParser.parse_file(temp_path)
        raw_text = parsed.get("raw_text", "").strip()

        # Same scanned-PDF fallback as /hcp/new. An HCP filling the public form
        # is the likeliest person to upload a phone photo or a scan, and this
        # path had no vision fallback at all.
        if not raw_text and ext == ".pdf" and config:
            import base64
            pages = _pdf_pages_as_png(temp_path)
            if pages:
                merged = _empty_extraction()
                provider = (config.provider or "").lower()
                for png in pages:
                    b64 = base64.b64encode(png).decode("utf-8")
                    try:
                        if provider in ("anthropic", "claude"):
                            page_result = _call_vision_anthropic(config, b64, "image/png")
                        else:
                            page_result = _call_vision_openai(config, b64, "image/png")
                    except Exception:
                        continue
                    merged = _merge_extractions(merged, page_result)
                return _normalize_extracted(merged)

        if not raw_text:
            return _empty_extraction()

        if not config:
            regex_fields = parsed.get("parsed", {})
            fallback = _empty_extraction()
            fallback["specialty"] = regex_fields.get("specialty")
            fallback["designation"] = regex_fields.get("faculty_positions")
            fallback["years_of_experience"] = regex_fields.get("years_of_experience")
            return fallback

        text_prompt = f"{EXTRACTION_PROMPT}\n\n## CV Content:\n{raw_text[:8000]}"
        try:
            provider = (config.provider or "").lower()
            # Same EXTRACTION_PROMPT as /hcp/new, so the same pinned
            # temperature — this path was running it at the account's
            # configured value (commonly 0.7) while /hcp/new used 0.1, so an
            # identical CV extracted differently depending on which door it
            # came through.
            if provider in ("anthropic", "claude"):
                result = call_anthropic(config, text_prompt, temperature=EXTRACTION_TEMPERATURE, max_tokens=EXTRACTION_MAX_TOKENS)
            else:
                result = call_openai(config, text_prompt, temperature=EXTRACTION_TEMPERATURE, max_tokens=EXTRACTION_MAX_TOKENS)
        except Exception:
            regex_fields = parsed.get("parsed", {})
            fallback = _empty_extraction()
            fallback["specialty"] = regex_fields.get("specialty")
            fallback["designation"] = regex_fields.get("faculty_positions")
            fallback["years_of_experience"] = regex_fields.get("years_of_experience")
            return fallback

        return _normalize_extracted(result)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@router.post("/public/form/{token}/submit")
async def submit_public_form(
    token: str,
    full_name: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    city: Optional[str] = Form(None),
    specialty: Optional[str] = Form(None),
    institution: Optional[str] = Form(None),
    designation: Optional[str] = Form(None),
    years_of_experience: Optional[str] = Form(None),
    key_clinical_interests: Optional[str] = Form(None),
    publications: Optional[str] = Form(None),
    conference_presentations: Optional[str] = Form(None),
    professional_memberships: Optional[str] = Form(None),
    awards_recognitions: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """Submit HCP data via public form (no auth required)."""
    link = db.query(FormLink).filter(FormLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Form not found")
    if not link.is_active:
        raise HTTPException(status_code=410, detail="This form link is no longer active")

    # Parse years_of_experience to int
    years_exp_int = None
    if years_of_experience:
        try:
            years_exp_int = int(years_of_experience)
        except (ValueError, TypeError):
            years_exp_int = None

    # Validate: at least name or CV
    has_data = any([full_name, email, specialty, institution, designation])
    if not has_data and not file:
        raise HTTPException(status_code=400, detail="Please provide HCP details or upload a CV")

    cv_file_path = None
    cv_parsed_data = None

    if file:
        allowed_ext = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".tiff", ".bmp"}
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in allowed_ext:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

        upload_dir = os.path.join(settings.UPLOAD_DIR, "form_submissions")
        os.makedirs(upload_dir, exist_ok=True)
        filename = f"{uuid.uuid4().hex}{ext}"
        cv_file_path = os.path.join(upload_dir, filename)

        with open(cv_file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        parsed = CVParser.parse_file(cv_file_path)
        if parsed.get("raw_text", "").strip():
            cv_parsed_data = json.dumps(parsed)

    submission = FormSubmission(
        form_link_id=link.id,
        full_name=full_name or (file.filename.replace(os.path.splitext(file.filename)[1], '').replace('_', ' ').replace('-', ' ') if file else None),
        email=email,
        city=city,
        specialty=specialty,
        institution=institution,
        designation=designation,
        years_of_experience=years_exp_int,
        key_clinical_interests=key_clinical_interests,
        publications=publications,
        conference_presentations=conference_presentations,
        professional_memberships=professional_memberships,
        awards_recognitions=awards_recognitions,
        cv_file_path=cv_file_path,
        cv_parsed_data=cv_parsed_data,
        status=FormSubmissionStatus.pending,
    )
    db.add(submission)
    db.commit()
    return {"detail": "Submission received successfully", "id": submission.id}
