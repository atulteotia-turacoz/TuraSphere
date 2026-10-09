import json
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from app.core.database import get_db
from app.core.security import get_current_admin, get_super_admin, get_password_hash
from app.models.user import User
from app.models.hcp import HCPProfile
from app.models.assessment import Assessment
from app.models.audit_log import AuditLog
from app.models.assessment_score import AssessmentParameterScore
from app.models.subscription import UserSubscription, BillingProfile, Invoice, SubscriptionStatus
from app.schemas.user import UserCreate, UserUpdate, UserResponse
from app.core.services import (
    granted_for, effective_for, clamp_selection, parse_services, ALL_SERVICES,
)

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/dashboard")
def admin_dashboard(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    total_users = db.query(User).count()
    total_hcps = db.query(HCPProfile).count()
    total_assessments = db.query(Assessment).count()
    assessed_hcps = db.query(HCPProfile).filter(HCPProfile.status == "assessed").count()

    tier_distribution = db.query(Assessment.tier, func.count(Assessment.id)).group_by(
        Assessment.tier).all()

    avg_score = db.query(func.avg(Assessment.final_score)).scalar() or 0

    # Activity stats
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = today - timedelta(days=7)

    assessments_today = db.query(Assessment).filter(
        Assessment.created_at >= today
    ).count()

    assessments_this_week = db.query(Assessment).filter(
        Assessment.created_at >= week_ago
    ).count()

    # Active users = users who created assessments in last 7 days
    active_users = db.query(func.count(func.distinct(Assessment.assessed_by))).filter(
        Assessment.created_at >= week_ago
    ).scalar() or 0

    # Pending = HCPs in draft/submitted status (not yet assessed)
    pending_reviews = db.query(HCPProfile).filter(
        HCPProfile.status.in_(["draft", "submitted"])
    ).count()

    # ── Extra breakdowns for the admin dashboard ──
    # Who the users are, not just how many.
    role_rows = db.query(User.role, func.count(User.id)).group_by(User.role).all()
    users_by_role = {str(getattr(r, "value", r)): c for r, c in role_rows}
    new_users_this_week = db.query(User).filter(User.created_at >= week_ago).count()

    # Assessment volume per day for the last 14 days, oldest first. Counted in
    # Python rather than with a SQL date function so it stays portable across
    # MySQL and sqlite, and so days with no activity still appear as zero —
    # a sparkline with holes in it misreads as missing data.
    since = today - timedelta(days=13)
    recent_rows = db.query(Assessment.created_at).filter(Assessment.created_at >= since).all()
    per_day = {}
    for (created,) in recent_rows:
        if created:
            per_day[created.date().isoformat()] = per_day.get(created.date().isoformat(), 0) + 1
    assessments_by_day = [
        {"date": (since + timedelta(days=i)).date().isoformat(),
         "count": per_day.get((since + timedelta(days=i)).date().isoformat(), 0)}
        for i in range(14)
    ]

    # Where the HCP book is concentrated.
    specialty_rows = (
        db.query(HCPProfile.specialty, func.count(HCPProfile.id))
        .filter(HCPProfile.specialty.isnot(None), HCPProfile.specialty != "")
        .group_by(HCPProfile.specialty)
        .order_by(func.count(HCPProfile.id).desc())
        .limit(5)
        .all()
    )
    top_specialties = [{"specialty": s, "count": c} for s, c in specialty_rows]

    # How much of the book has been worked through.
    completion_rate = round((assessed_hcps / total_hcps) * 100, 1) if total_hcps else 0.0

    # CVs actually uploaded — a proxy for how much of the data is document-backed
    # rather than hand-typed.
    hcps_with_cv = db.query(HCPProfile).filter(
        HCPProfile.cv_file_path.isnot(None), HCPProfile.cv_file_path != ""
    ).count()

    active_subscriptions = db.query(UserSubscription).filter(
        UserSubscription.status == SubscriptionStatus.active
    ).count()

    # AuditLog columns are action / details / performed_by / assessment_id —
    # there is no entity_type or user_id on this model.
    recent_audit = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(6).all()
    recent_activity = [
        {
            "id": a.id,
            "action": a.action,
            "details": (a.details or "")[:120],
            "assessment_id": a.assessment_id,
            "performed_by": a.performed_by,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in recent_audit
    ]

    recent_assessments = db.query(Assessment).order_by(
        Assessment.created_at.desc()).limit(5).all()
    recent_list = []
    for a in recent_assessments:
        hcp = db.query(HCPProfile).filter(HCPProfile.id == a.hcp_id).first()
        recent_list.append({
            "id": a.id, "hcp_name": hcp.full_name if hcp else "", "tier": a.tier,
            "specialty": hcp.specialty if hcp else "",
            "final_score": a.final_score, "created_at": a.created_at.isoformat() if a.created_at else None,
        })

    return {
        "total_users": total_users,
        "total_hcps": total_hcps,
        "total_assessments": total_assessments,
        "assessed_hcps": assessed_hcps,
        "avg_score": round(avg_score, 1),
        "tier_distribution": {t: c for t, c in tier_distribution},
        "recent_assessments": recent_list,
        "assessments_today": assessments_today,
        "assessments_this_week": assessments_this_week,
        "active_users": active_users,
        "pending_reviews": pending_reviews,
        "users_by_role": users_by_role,
        "new_users_this_week": new_users_this_week,
        "assessments_by_day": assessments_by_day,
        "top_specialties": top_specialties,
        "completion_rate": completion_rate,
        "hcps_with_cv": hcps_with_cv,
        "active_subscriptions": active_subscriptions,
        "recent_activity": recent_activity,
    }


@router.get("/users", response_model=list[UserResponse])
def list_users(skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
               db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    return db.query(User).offset(skip).limit(limit).all()


@router.post("/users", response_model=UserResponse, status_code=201)
def create_user(data: UserCreate, db: Session = Depends(get_db),
                admin=Depends(get_super_admin)):
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    user = User(
        email=data.email, full_name=data.full_name,
        hashed_password=get_password_hash(data.password),
        role=data.role, organization=data.organization,
    )
    # The schema has always accepted these and this never wrote them, so every
    # admin-created user landed with NULL granted_services — which reads as
    # "unrestricted". Whatever the admin ticked at creation was discarded and
    # the new account got every module.
    #
    # `exclude_unset` matters: an omitted field stays NULL (unrestricted, for
    # API callers that predate entitlements), while an explicit [] means the
    # admin granted nothing and must store as nothing.
    supplied = data.model_dump(exclude_unset=True)
    for field in ('granted_services', 'allowed_services'):
        if field in supplied:
            value = supplied[field]
            setattr(user, field, json.dumps(value) if value is not None else None)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db),
                admin=Depends(get_super_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    update_data = data.model_dump(exclude_unset=True)
    previously_granted = set(granted_for(user))
    for key, value in update_data.items():
        if key in ('allowed_services', 'granted_services'):
            setattr(user, key, json.dumps(value) if value is not None else None)
        else:
            setattr(user, key, value)
    # Narrowing a grant must narrow the user's selection with it, or a module
    # the admin just revoked would stay switched on in allowed_services and keep
    # appearing in their sidebar. Widening it must switch the new modules on:
    # effective = granted ∩ selected, so a module absent from a stored selection
    # would otherwise stay invisible however many times the admin granted it.
    if 'granted_services' in update_data:
        current = parse_services(user.allowed_services)
        if current is not None:
            if 'allowed_services' not in update_data:
                current += [s for s in granted_for(user) if s not in previously_granted]
            user.allowed_services = json.dumps(clamp_selection(user, current))
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db),
                admin=Depends(get_super_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    # Delete related records to avoid FK constraint errors
    db.query(Invoice).filter(Invoice.user_id == user_id).delete()
    db.query(UserSubscription).filter(UserSubscription.user_id == user_id).delete()
    db.query(BillingProfile).filter(BillingProfile.user_id == user_id).delete()
    db.query(AuditLog).filter(AuditLog.performed_by == user_id).delete()
    db.query(Assessment).filter(Assessment.assessed_by == user_id).delete()
    db.query(HCPProfile).filter(HCPProfile.user_id == user_id).delete()

    db.delete(user)
    db.commit()
    return {"detail": "User deleted"}


@router.get("/users/{user_id}/detail")
def get_user_detail(user_id: int, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get user's HCPs
    hcps = db.query(HCPProfile).filter(HCPProfile.user_id == user_id).order_by(HCPProfile.created_at.desc()).all()
    hcp_list = [{"id": h.id, "full_name": h.full_name, "specialty": h.specialty, "institution": h.institution,
                 "status": h.status.value if hasattr(h.status, 'value') else h.status,
                 "created_at": h.created_at.isoformat() if h.created_at else None} for h in hcps]

    # Get user's assessments
    hcp_ids = [h.id for h in hcps]
    assessments_list = []
    if hcp_ids:
        assessments = db.query(Assessment).filter(Assessment.hcp_id.in_(hcp_ids)).order_by(Assessment.created_at.desc()).all()
        for a in assessments:
            hcp = next((h for h in hcps if h.id == a.hcp_id), None)
            assessments_list.append({"id": a.id, "hcp_id": a.hcp_id, "hcp_name": hcp.full_name if hcp else "",
                                     "final_score": a.final_score, "tier": a.tier,
                                     "created_at": a.created_at.isoformat() if a.created_at else None})

    # Get user's surveys
    from app.models.survey import Survey
    surveys = db.query(Survey).filter(Survey.user_id == user_id).order_by(Survey.created_at.desc()).all()
    survey_list = [{"id": s.id, "title": s.title, "status": s.status.value if hasattr(s.status, 'value') else s.status,
                    "question_count": len(s.questions), "response_count": len(s.responses),
                    "created_at": s.created_at.isoformat()} for s in surveys]

    # Get user's polls
    from app.models.poll import Poll
    polls = db.query(Poll).filter(Poll.user_id == user_id).order_by(Poll.created_at.desc()).all()
    poll_list = [{"id": p.id, "title": p.title, "status": p.status.value if hasattr(p.status, 'value') else p.status,
                  "vote_count": len(p.votes), "created_at": p.created_at.isoformat()} for p in polls]

    # Get user's form submissions
    from app.models.form_link import FormLink, FormSubmission
    form_links = db.query(FormLink).filter(FormLink.user_id == user_id).all()
    form_link_ids = [fl.id for fl in form_links]
    submissions_list = []
    if form_link_ids:
        submissions = db.query(FormSubmission).filter(FormSubmission.form_link_id.in_(form_link_ids)).order_by(FormSubmission.created_at.desc()).all()
        for sub_item in submissions:
            submissions_list.append({
                "id": sub_item.id, "full_name": sub_item.full_name or "--",
                "email": sub_item.email or "--", "specialty": sub_item.specialty or "--",
                "institution": sub_item.institution or "--",
                "designation": sub_item.designation or "--",
                "city": sub_item.city or "--",
                "years_of_experience": sub_item.years_of_experience,
                "key_clinical_interests": sub_item.key_clinical_interests or "--",
                "publications": sub_item.publications or "--",
                "conference_presentations": sub_item.conference_presentations or "--",
                "professional_memberships": sub_item.professional_memberships or "--",
                "awards_recognitions": sub_item.awards_recognitions or "--",
                "status": sub_item.status.value if hasattr(sub_item.status, 'value') else sub_item.status,
                "has_cv": bool(sub_item.cv_file_path),
                "created_at": sub_item.created_at.isoformat() if sub_item.created_at else None,
            })

    # Get subscription & billing
    sub = db.query(UserSubscription).filter(UserSubscription.user_id == user_id).first()
    billing = db.query(BillingProfile).filter(BillingProfile.user_id == user_id).first()
    invoices = db.query(Invoice).filter(Invoice.user_id == user_id).order_by(Invoice.created_at.desc()).all()

    try:
        services = json.loads(user.allowed_services) if user.allowed_services else None
    except (json.JSONDecodeError, TypeError):
        services = None

    return {
        "id": user.id, "email": user.email, "full_name": user.full_name,
        "role": user.role.value if hasattr(user.role, 'value') else user.role,
        "organization": user.organization, "is_active": user.is_active,
        "allowed_services": services,
        "ai_enabled": bool(getattr(user, "ai_enabled", True)),
        "granted_services": granted_for(user),
        "effective_services": effective_for(user),
        "all_services": ALL_SERVICES,
        "created_at": user.created_at.isoformat(),
        "hcps": hcp_list,
        "assessments": assessments_list,
        "surveys": survey_list,
        "polls": poll_list,
        "form_submissions": submissions_list,
        "subscription": {
            "plan_name": sub.plan.name if sub.plan else f"Plan #{sub.plan_id}",
            "status": sub.status.value if hasattr(sub.status, 'value') else sub.status,
            "cycle": sub.billing_cycle.value if hasattr(sub.billing_cycle, 'value') else sub.billing_cycle,
            "expires_at": sub.current_period_end.isoformat() if sub.current_period_end else None,
        } if sub else None,
        "billing": {
            "company_name": getattr(billing, 'company_name', None),
            "address": getattr(billing, 'address', None),
            "gst": getattr(billing, 'gst_number', None) or getattr(billing, 'gst', None),
        } if billing else None,
        "invoices": [{"id": inv.id, "amount": float(inv.amount) if inv.amount else 0,
                      "status": inv.status.value if hasattr(inv.status, 'value') else inv.status,
                      "created_at": inv.created_at.isoformat()} for inv in invoices],
    }


@router.get("/hcps")
def list_all_hcps(skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
                  search: Optional[str] = None, status: Optional[str] = None,
                  db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    query = db.query(HCPProfile)
    if search:
        query = query.filter(
            HCPProfile.full_name.ilike(f"%{search}%") |
            HCPProfile.specialty.ilike(f"%{search}%") |
            HCPProfile.country.ilike(f"%{search}%")
        )
    if status:
        query = query.filter(HCPProfile.status == status)
    total = query.count()
    items = query.order_by(HCPProfile.created_at.desc()).offset(skip).limit(limit).all()
    result = []
    for h in items:
        owner = db.query(User).filter(User.id == h.user_id).first() if h.user_id else None
        result.append({
            "id": h.id,
            "full_name": h.full_name,
            "email": h.email,
            "specialty": h.specialty,
            "country": h.country,
            "institution": h.institution,
            "hcp_type": h.hcp_type,
            "status": h.status.value if hasattr(h.status, 'value') else h.status,
            "user_id": h.user_id,
            "user_email": owner.email if owner else "--",
            "user_name": owner.full_name if owner else "--",
            "created_at": h.created_at.isoformat() if h.created_at else None,
        })
    return result


@router.delete("/hcps/{hcp_id}")
def delete_hcp(hcp_id: int, db: Session = Depends(get_db),
               admin=Depends(get_current_admin)):
    hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP not found")

    # Delete related assessments and their scores
    assessments = db.query(Assessment).filter(Assessment.hcp_id == hcp_id).all()
    for a in assessments:
        db.query(AssessmentParameterScore).filter(
            AssessmentParameterScore.assessment_id == a.id
        ).delete()
        db.query(AuditLog).filter(
            AuditLog.assessment_id == a.id
        ).delete()
    db.query(Assessment).filter(Assessment.hcp_id == hcp_id).delete()

    db.delete(hcp)
    db.commit()
    return {"detail": "HCP profile deleted"}


@router.get("/assessments")
def list_all_assessments(skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
                         tier: Optional[str] = None,
                         db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    query = db.query(Assessment)
    if tier:
        query = query.filter(Assessment.tier == tier)
    assessments = query.order_by(Assessment.created_at.desc()).offset(skip).limit(limit).all()
    result = []
    for a in assessments:
        hcp = db.query(HCPProfile).filter(HCPProfile.id == a.hcp_id).first()
        assessor = db.query(User).filter(User.id == a.assessed_by).first() if a.assessed_by else None
        result.append({
            "id": a.id,
            "hcp_id": a.hcp_id,
            "hcp_name": hcp.full_name if hcp else "",
            "specialty": hcp.specialty if hcp else "",
            "country": hcp.country if hcp else "",
            "base_score": a.base_score,
            "bonus_score": a.bonus_score,
            "final_score": a.final_score,
            "tier": a.tier,
            "justification": a.justification,
            "assessed_by": a.assessed_by,
            "assessed_by_email": assessor.email if assessor else "--",
            "assessed_by_name": assessor.full_name if assessor else "--",
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    return result


@router.get("/assessments/{assessment_id}")
def get_assessment_detail(assessment_id: int, db: Session = Depends(get_db),
                          admin=Depends(get_current_admin)):
    a = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Assessment not found")
    hcp = db.query(HCPProfile).filter(HCPProfile.id == a.hcp_id).first()

    # Try to load per-parameter scores
    from app.models.assessment_score import AssessmentParameterScore
    param_scores = db.query(AssessmentParameterScore).filter(
        AssessmentParameterScore.assessment_id == a.id
    ).all()

    return {
        "id": a.id,
        "hcp_id": a.hcp_id,
        "hcp_name": hcp.full_name if hcp else "",
        "specialty": hcp.specialty if hcp else "",
        "country": hcp.country if hcp else "",
        "institution": hcp.institution if hcp else "",
        "base_score": a.base_score,
        "bonus_score": a.bonus_score,
        "final_score": a.final_score,
        "tier": a.tier,
        "justification": a.justification,
        "confidence_flags": a.confidence_flags,
        "assessed_by": a.assessed_by,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "parameter_scores": [
            {
                "parameter_id": ps.parameter_id,
                "parameter_code": ps.parameter_code,
                "parameter_name": ps.parameter_name,
                "parameter_category": ps.parameter_category,
                "score": ps.score,
                "max_score": ps.max_score,
                "scoring_source": ps.scoring_source or "cv",
                "justification": ps.justification,
            }
            for ps in param_scores
        ],
    }


@router.delete("/assessments/{assessment_id}")
def delete_assessment(assessment_id: int, db: Session = Depends(get_db),
                      admin=Depends(get_current_admin)):
    a = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="Assessment not found")

    hcp_id = a.hcp_id

    # Delete related records
    db.query(AssessmentParameterScore).filter(
        AssessmentParameterScore.assessment_id == assessment_id
    ).delete()
    db.query(AuditLog).filter(
        AuditLog.assessment_id == assessment_id
    ).delete()

    db.delete(a)

    # If no more assessments for this HCP, reset status to draft
    remaining = db.query(Assessment).filter(Assessment.hcp_id == hcp_id).count()
    if remaining == 0:
        hcp = db.query(HCPProfile).filter(HCPProfile.id == hcp_id).first()
        if hcp:
            from app.models.hcp import HCPStatus
            hcp.status = HCPStatus.draft

    db.commit()
    return {"detail": "Assessment deleted"}


@router.get("/audit-logs")
def list_audit_logs(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500),
                    db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()
    return [{"id": l.id, "assessment_id": l.assessment_id, "action": l.action,
             "details": l.details, "performed_by": l.performed_by,
             "created_at": l.created_at.isoformat() if l.created_at else None} for l in logs]


@router.get("/invoices/{invoice_id}/pdf")
def admin_download_invoice_pdf(invoice_id: int, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """Admin can download any user's invoice PDF."""
    import io
    from fastapi.responses import StreamingResponse
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Generate text receipt
    lines = [
        "=" * 60, "                    INVOICE", "=" * 60, "",
        f"  Invoice Number:   {invoice.invoice_number}",
        f"  Date:             {invoice.created_at.strftime('%B %d, %Y') if invoice.created_at else 'N/A'}",
        f"  Status:           {invoice.status.value.upper() if hasattr(invoice.status, 'value') else str(invoice.status).upper()}", "",
        "-" * 60, "  BILLED TO", "-" * 60,
        f"  Name:             {invoice.billing_name or 'N/A'}",
        f"  Email:            {invoice.billing_email or 'N/A'}",
    ]
    if invoice.billing_company: lines.append(f"  Company:          {invoice.billing_company}")
    if invoice.billing_address: lines.append(f"  Address:          {invoice.billing_address}")
    lines += ["", "-" * 60, "  DETAILS", "-" * 60,
              f"  Plan:             {invoice.plan_name}",
              f"  Billing Cycle:    {invoice.billing_cycle.capitalize()}",
              "", "-" * 60, "  AMOUNT", "-" * 60,
              f"  Total:            {invoice.currency} {invoice.amount:.2f}", "",
              "=" * 60, "     TuraInsights KOL", "=" * 60]
    content = "\n".join(lines)

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=30*mm, bottomMargin=20*mm, leftMargin=20*mm, rightMargin=20*mm)
        styles = getSampleStyleSheet()
        elements = []
        elements.append(Paragraph("INVOICE", ParagraphStyle('T', parent=styles['Title'], fontSize=22, textColor=colors.HexColor('#4F46E5'), spaceAfter=6)))
        elements.append(Spacer(1, 4*mm))
        meta = Table([["Invoice #:", invoice.invoice_number], ["Date:", invoice.created_at.strftime('%B %d, %Y') if invoice.created_at else 'N/A'],
                       ["Status:", invoice.status.value.upper() if hasattr(invoice.status, 'value') else str(invoice.status).upper()]], colWidths=[40*mm, 120*mm])
        meta.setStyle(TableStyle([('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'), ('FONTSIZE', (0,0), (-1,-1), 10), ('BOTTOMPADDING', (0,0), (-1,-1), 4)]))
        elements.append(meta)
        elements.append(Spacer(1, 8*mm))
        elements.append(Paragraph("<b>BILLED TO</b>", styles['Heading4']))
        billed = [invoice.billing_name or 'N/A']
        if invoice.billing_email: billed.append(invoice.billing_email)
        if invoice.billing_company: billed.append(invoice.billing_company)
        elements.append(Paragraph("<br/>".join(billed), styles['Normal']))
        elements.append(Spacer(1, 8*mm))
        items = Table([["Description", "Amount"], [f"{invoice.plan_name} ({invoice.billing_cycle.capitalize()})", f"{invoice.currency} {invoice.amount:.2f}"]], colWidths=[130*mm, 40*mm])
        items.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,0), colors.HexColor('#4F46E5')), ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                                    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'), ('FONTSIZE', (0,0), (-1,-1), 10),
                                    ('ALIGN', (-1,0), (-1,-1), 'RIGHT'), ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E5E7EB')),
                                    ('BOTTOMPADDING', (0,0), (-1,-1), 8), ('TOPPADDING', (0,0), (-1,-1), 8)]))
        elements.append(items)
        elements.append(Spacer(1, 15*mm))
        elements.append(Paragraph("TuraInsights KOL — Thank you!", ParagraphStyle('F', parent=styles['Normal'], fontSize=9, textColor=colors.grey, alignment=1)))
        doc.build(elements)
        buffer.seek(0)
        return StreamingResponse(buffer, media_type="application/pdf",
                                  headers={"Content-Disposition": f'attachment; filename="invoice_{invoice.id}.pdf"'})
    except ImportError:
        buffer = io.BytesIO(content.encode('utf-8'))
        return StreamingResponse(buffer, media_type="text/plain",
                                  headers={"Content-Disposition": f'attachment; filename="invoice_{invoice.id}.txt"'})
