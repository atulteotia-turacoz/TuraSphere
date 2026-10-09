import io
import json
from app.core.services import clamp_selection, granted_for, effective_for
import hmac
import hashlib
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.subscription_plan import SubscriptionPlan
from app.models.configuration import PaymentGateway
from app.models.subscription import (
    UserSubscription, BillingProfile, Invoice,
    SubscriptionStatus, InvoiceStatus,
)
from app.schemas.subscription import (
    SubscribeRequest, SubscriptionResponse, BillingProfileUpdate,
    BillingProfileResponse, InvoiceResponse, UserProfileUpdate,
)

router = APIRouter(prefix="/account", tags=["Account & Subscription"])


# ─── Profile ──────────────────────────────────────────────────────

@router.get("/profile")
def get_profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role_str = user.role.value if hasattr(user.role, 'value') else str(user.role)
    return {
        "id": user.id, "email": user.email, "full_name": user.full_name,
        "organization": user.organization, "role": role_str,
        "created_at": user.created_at,
    }


@router.put("/profile")
def update_profile(data: UserProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.organization is not None:
        user.organization = data.organization
    if data.allowed_services is not None:
        # Clamped to what an admin granted. This endpoint is guarded only by
        # "is logged in", so before the clamp any user could POST themselves
        # every module — the Dissemination Toolkit was effectively a
        # self-service permission grant.
        user.allowed_services = json.dumps(clamp_selection(user, data.allowed_services))
    db.commit()
    db.refresh(user)
    role_str = user.role.value if hasattr(user.role, 'value') else str(user.role)
    return {
        "id": user.id, "email": user.email, "full_name": user.full_name,
        "organization": user.organization, "role": role_str,
    }


# ─── Billing Profile ─────────────────────────────────────────────

@router.get("/billing", response_model=BillingProfileResponse)
def get_billing(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bp = db.query(BillingProfile).filter(BillingProfile.user_id == user.id).first()
    if not bp:
        bp = BillingProfile(user_id=user.id)
        db.add(bp)
        db.commit()
        db.refresh(bp)
    return bp


@router.put("/billing", response_model=BillingProfileResponse)
def update_billing(data: BillingProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    bp = db.query(BillingProfile).filter(BillingProfile.user_id == user.id).first()
    if not bp:
        bp = BillingProfile(user_id=user.id)
        db.add(bp)
        db.flush()
    for key, val in data.model_dump(exclude_unset=True).items():
        setattr(bp, key, val)
    db.commit()
    db.refresh(bp)
    return bp


# ─── Subscription ────────────────────────────────────────────────

@router.get("/subscription")
def get_subscription(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = (
        db.query(UserSubscription)
        .filter(UserSubscription.user_id == user.id, UserSubscription.status == SubscriptionStatus.active)
        .first()
    )
    if not sub:
        return {"subscription": None}
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == sub.plan_id).first()
    return {
        "subscription": {
            "id": sub.id, "plan_id": sub.plan_id, "status": sub.status.value,
            "billing_cycle": sub.billing_cycle,
            "current_period_start": sub.current_period_start,
            "current_period_end": sub.current_period_end,
            "created_at": sub.created_at,
            "plan_name": plan.name if plan else None,
            "plan_price": plan.price_monthly if sub.billing_cycle == "monthly" else plan.price_yearly if plan else 0,
            "plan_features": plan.features if plan else "[]",
        }
    }


@router.post("/subscribe")
def subscribe(data: SubscribeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == data.plan_id, SubscriptionPlan.is_active == True).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found or inactive")

    # Cancel existing active subscription
    existing = (
        db.query(UserSubscription)
        .filter(UserSubscription.user_id == user.id, UserSubscription.status == SubscriptionStatus.active)
        .first()
    )
    if existing:
        existing.status = SubscriptionStatus.cancelled
        existing.cancelled_at = datetime.utcnow()

    now = datetime.utcnow()
    if data.billing_cycle == "yearly":
        period_end = now + timedelta(days=365)
        amount = plan.price_yearly
    else:
        period_end = now + timedelta(days=30)
        amount = plan.price_monthly

    sub = UserSubscription(
        user_id=user.id, plan_id=plan.id, status=SubscriptionStatus.active,
        billing_cycle=data.billing_cycle,
        current_period_start=now, current_period_end=period_end,
    )
    db.add(sub)
    db.flush()

    # Create invoice
    bp = db.query(BillingProfile).filter(BillingProfile.user_id == user.id).first()
    address_parts = []
    if bp:
        if bp.address_line1:
            address_parts.append(bp.address_line1)
        if bp.address_line2:
            address_parts.append(bp.address_line2)
        if bp.city:
            address_parts.append(bp.city)
        if bp.state:
            address_parts.append(bp.state)
        if bp.zip_code:
            address_parts.append(bp.zip_code)
        if bp.country:
            address_parts.append(bp.country)

    inv_count = db.query(Invoice).count() + 1
    invoice = Invoice(
        invoice_number=f"INV-{now.strftime('%Y%m')}-{inv_count:05d}",
        subscription_id=sub.id, user_id=user.id,
        plan_name=plan.name, billing_cycle=data.billing_cycle,
        amount=amount, currency=plan.currency,
        status=InvoiceStatus.paid,
        billing_name=user.full_name, billing_email=user.email,
        billing_company=bp.company_name if bp else user.organization,
        billing_address=", ".join(address_parts) if address_parts else None,
        billing_tax_id=bp.tax_id if bp else None,
        period_start=now, period_end=period_end,
        paid_at=now,
    )
    db.add(invoice)
    db.commit()

    return {
        "message": f"Subscribed to {plan.name} ({data.billing_cycle}) successfully",
        "subscription_id": sub.id,
        "invoice_number": invoice.invoice_number,
    }


@router.post("/create-order")
def create_razorpay_order(data: SubscribeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a Razorpay order for the selected plan."""
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == data.plan_id, SubscriptionPlan.is_active == True).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found or inactive")

    amount = plan.price_yearly if data.billing_cycle == "yearly" else plan.price_monthly
    if amount == 0:
        raise HTTPException(status_code=400, detail="Free plan does not require payment")

    # Get active payment gateway
    gw = db.query(PaymentGateway).filter(
        PaymentGateway.is_active == True, PaymentGateway.is_default == True
    ).first()
    if not gw:
        gw = db.query(PaymentGateway).filter(PaymentGateway.is_active == True).first()
    if not gw or not gw.api_key or not gw.api_secret:
        raise HTTPException(status_code=500, detail="Payment gateway not configured. Please contact admin.")

    try:
        import razorpay
        client = razorpay.Client(auth=(gw.api_key, gw.api_secret))
        # Use the plan's own currency
        currency = (plan.currency or "USD").upper()

        order_data = {
            "amount": int(amount * 100),  # Convert to smallest currency unit (paise/cents)
            "currency": currency,
            "receipt": f"order_{user.id}_{plan.id}_{data.billing_cycle}",
            "notes": {
                "user_id": str(user.id),
                "plan_id": str(plan.id),
                "billing_cycle": data.billing_cycle,
            },
        }
        order = client.order.create(data=order_data)
        return {
            "order_id": order["id"],
            "amount": order["amount"],
            "currency": order["currency"],
            "key_id": gw.api_key,
            "plan_name": plan.name,
            "user_email": user.email,
            "user_name": user.full_name,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create order: {str(e)}")


@router.post("/verify-payment")
def verify_payment_and_subscribe(
    payload: dict,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Verify Razorpay payment signature and activate subscription."""
    razorpay_order_id = payload.get("razorpay_order_id")
    razorpay_payment_id = payload.get("razorpay_payment_id")
    razorpay_signature = payload.get("razorpay_signature")
    plan_id = payload.get("plan_id")
    billing_cycle = payload.get("billing_cycle", "monthly")

    if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_id]):
        raise HTTPException(status_code=400, detail="Missing payment verification data")

    # Get gateway secret for verification
    gw = db.query(PaymentGateway).filter(
        PaymentGateway.is_active == True, PaymentGateway.is_default == True
    ).first()
    if not gw:
        gw = db.query(PaymentGateway).filter(PaymentGateway.is_active == True).first()
    if not gw or not gw.api_secret:
        raise HTTPException(status_code=500, detail="Payment gateway not configured")

    # Verify signature
    message = f"{razorpay_order_id}|{razorpay_payment_id}"
    expected_signature = hmac.new(
        gw.api_secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if expected_signature != razorpay_signature:
        raise HTTPException(status_code=400, detail="Payment verification failed. Invalid signature.")

    # Payment verified — activate subscription
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id, SubscriptionPlan.is_active == True).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Cancel existing active subscription
    existing = (
        db.query(UserSubscription)
        .filter(UserSubscription.user_id == user.id, UserSubscription.status == SubscriptionStatus.active)
        .first()
    )
    if existing:
        existing.status = SubscriptionStatus.cancelled
        existing.cancelled_at = datetime.utcnow()

    now = datetime.utcnow()
    if billing_cycle == "yearly":
        period_end = now + timedelta(days=365)
        amount = plan.price_yearly
    else:
        period_end = now + timedelta(days=30)
        amount = plan.price_monthly

    sub = UserSubscription(
        user_id=user.id, plan_id=plan.id, status=SubscriptionStatus.active,
        billing_cycle=billing_cycle,
        current_period_start=now, current_period_end=period_end,
    )
    db.add(sub)
    db.flush()

    # Create invoice
    bp = db.query(BillingProfile).filter(BillingProfile.user_id == user.id).first()
    address_parts = []
    if bp:
        for field in [bp.address_line1, bp.address_line2, bp.city, bp.state, bp.zip_code, bp.country]:
            if field:
                address_parts.append(field)

    inv_count = db.query(Invoice).count() + 1
    invoice = Invoice(
        invoice_number=f"INV-{now.strftime('%Y%m')}-{inv_count:05d}",
        subscription_id=sub.id, user_id=user.id,
        plan_name=plan.name, billing_cycle=billing_cycle,
        amount=amount, currency=plan.currency,
        status=InvoiceStatus.paid,
        billing_name=user.full_name, billing_email=user.email,
        billing_company=bp.company_name if bp else user.organization,
        billing_address=", ".join(address_parts) if address_parts else None,
        billing_tax_id=bp.tax_id if bp else None,
        period_start=now, period_end=period_end,
        paid_at=now,
    )
    db.add(invoice)
    db.commit()

    return {
        "message": f"Payment verified! Subscribed to {plan.name} ({billing_cycle}) successfully",
        "subscription_id": sub.id,
        "invoice_number": invoice.invoice_number,
        "payment_id": razorpay_payment_id,
    }


@router.post("/cancel-subscription")
def cancel_subscription(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = (
        db.query(UserSubscription)
        .filter(UserSubscription.user_id == user.id, UserSubscription.status == SubscriptionStatus.active)
        .first()
    )
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription found")
    sub.status = SubscriptionStatus.cancelled
    sub.cancelled_at = datetime.utcnow()
    db.commit()
    return {"message": "Subscription cancelled successfully"}


# ─── Invoices ─────────────────────────────────────────────────────

@router.get("/invoices", response_model=List[InvoiceResponse])
def list_invoices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Invoice)
        .filter(Invoice.user_id == user.id)
        .order_by(Invoice.created_at.desc())
        .all()
    )


@router.get("/invoices/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id, Invoice.user_id == user.id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    # Generate simple PDF-like text content (plain text formatted as receipt)
    # Using a simple approach without external PDF library
    lines = []
    lines.append("=" * 60)
    lines.append("                    INVOICE")
    lines.append("=" * 60)
    lines.append("")
    lines.append(f"  Invoice Number:   {invoice.invoice_number}")
    lines.append(f"  Date:             {invoice.created_at.strftime('%B %d, %Y') if invoice.created_at else 'N/A'}")
    lines.append(f"  Status:           {invoice.status.value.upper() if hasattr(invoice.status, 'value') else str(invoice.status).upper()}")
    lines.append("")
    lines.append("-" * 60)
    lines.append("  BILLED TO")
    lines.append("-" * 60)
    lines.append(f"  Name:             {invoice.billing_name or 'N/A'}")
    lines.append(f"  Email:            {invoice.billing_email or 'N/A'}")
    if invoice.billing_company:
        lines.append(f"  Company:          {invoice.billing_company}")
    if invoice.billing_address:
        lines.append(f"  Address:          {invoice.billing_address}")
    if invoice.billing_tax_id:
        lines.append(f"  Tax ID:           {invoice.billing_tax_id}")
    lines.append("")
    lines.append("-" * 60)
    lines.append("  SUBSCRIPTION DETAILS")
    lines.append("-" * 60)
    lines.append(f"  Plan:             {invoice.plan_name}")
    lines.append(f"  Billing Cycle:    {invoice.billing_cycle.capitalize()}")
    if invoice.period_start:
        lines.append(f"  Period:           {invoice.period_start.strftime('%b %d, %Y')} - {invoice.period_end.strftime('%b %d, %Y') if invoice.period_end else 'N/A'}")
    lines.append("")
    lines.append("-" * 60)
    lines.append("  AMOUNT")
    lines.append("-" * 60)
    lines.append(f"  Total:            {invoice.currency} {invoice.amount:.2f}")
    if invoice.paid_at:
        lines.append(f"  Paid on:          {invoice.paid_at.strftime('%B %d, %Y')}")
    lines.append("")
    lines.append("=" * 60)
    lines.append("          TuraQuant")
    lines.append("     Thank you for your subscription!")
    lines.append("=" * 60)

    content = "\n".join(lines)

    # Try to generate real PDF
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

        # Title
        title_style = ParagraphStyle('InvoiceTitle', parent=styles['Title'], fontSize=22, textColor=colors.HexColor('#4F46E5'), spaceAfter=6)
        elements.append(Paragraph("INVOICE", title_style))
        elements.append(Spacer(1, 4*mm))

        # Invoice meta
        meta_data = [
            ["Invoice Number:", invoice.invoice_number],
            ["Date:", invoice.created_at.strftime('%B %d, %Y') if invoice.created_at else 'N/A'],
            ["Status:", invoice.status.value.upper() if hasattr(invoice.status, 'value') else str(invoice.status).upper()],
        ]
        meta_table = Table(meta_data, colWidths=[40*mm, 120*mm])
        meta_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        elements.append(meta_table)
        elements.append(Spacer(1, 8*mm))

        # Billed To
        elements.append(Paragraph("<b>BILLED TO</b>", styles['Heading4']))
        billed_lines = [f"{invoice.billing_name or 'N/A'}"]
        if invoice.billing_email:
            billed_lines.append(invoice.billing_email)
        if invoice.billing_company:
            billed_lines.append(invoice.billing_company)
        if invoice.billing_address:
            billed_lines.append(invoice.billing_address)
        if invoice.billing_tax_id:
            billed_lines.append(f"Tax ID: {invoice.billing_tax_id}")
        elements.append(Paragraph("<br/>".join(billed_lines), styles['Normal']))
        elements.append(Spacer(1, 8*mm))

        # Line items table
        item_data = [
            ["Description", "Period", "Amount"],
            [
                f"{invoice.plan_name} ({invoice.billing_cycle.capitalize()})",
                f"{invoice.period_start.strftime('%b %d, %Y') if invoice.period_start else ''} - {invoice.period_end.strftime('%b %d, %Y') if invoice.period_end else ''}",
                f"{invoice.currency} {invoice.amount:.2f}",
            ],
        ]
        item_table = Table(item_data, colWidths=[70*mm, 60*mm, 40*mm])
        item_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4F46E5')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ALIGN', (-1, 0), (-1, -1), 'RIGHT'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E5E7EB')),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
        ]))
        elements.append(item_table)
        elements.append(Spacer(1, 6*mm))

        # Total
        total_data = [["Total:", f"{invoice.currency} {invoice.amount:.2f}"]]
        total_table = Table(total_data, colWidths=[130*mm, 40*mm])
        total_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 12),
            ('ALIGN', (-1, 0), (-1, -1), 'RIGHT'),
            ('LINEABOVE', (0, 0), (-1, 0), 1, colors.HexColor('#4F46E5')),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(total_table)
        elements.append(Spacer(1, 15*mm))

        # Footer
        footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontSize=9, textColor=colors.grey, alignment=1)
        elements.append(Paragraph("TuraQuant — Thank you for your subscription!", footer_style))

        doc.build(elements)
        buffer.seek(0)

        return StreamingResponse(
            buffer,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{invoice.invoice_number}.pdf"'},
        )
    except ImportError:
        # Fallback to text file if reportlab not installed
        buffer = io.BytesIO(content.encode('utf-8'))
        return StreamingResponse(
            buffer,
            media_type="text/plain",
            headers={"Content-Disposition": f'attachment; filename="{invoice.invoice_number}.txt"'},
        )
