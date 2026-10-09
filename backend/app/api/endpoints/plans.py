from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.security import get_current_admin
from app.models.subscription_plan import SubscriptionPlan
from app.models.configuration import SiteSetting
from app.schemas.subscription_plan import PlanCreate, PlanUpdate, PlanResponse

router = APIRouter(tags=["Plans"])


# ─── Public endpoints (no auth needed) ────────────────────────────

@router.get("/plans", response_model=List[PlanResponse])
def list_public_plans(db: Session = Depends(get_db)):
    """List all active plans for the public pricing page."""
    return (
        db.query(SubscriptionPlan)
        .filter(SubscriptionPlan.is_active == True)
        .order_by(SubscriptionPlan.sort_order.asc())
        .all()
    )


@router.get("/site-settings/{key}")
def get_site_setting(key: str, db: Session = Depends(get_db)):
    """Get a public site setting by key."""
    setting = db.query(SiteSetting).filter(SiteSetting.key == key).first()
    if not setting:
        return {"key": key, "value": None}
    return {"key": setting.key, "value": setting.value}


# ─── Admin CRUD ───────────────────────────────────────────────────

@router.get("/admin/plans", response_model=List[PlanResponse])
def list_all_plans(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """List all plans (including inactive) for admin."""
    return db.query(SubscriptionPlan).order_by(SubscriptionPlan.sort_order.asc()).all()


@router.get("/admin/plans/{plan_id}", response_model=PlanResponse)
def get_plan(plan_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@router.post("/admin/plans", response_model=PlanResponse, status_code=201)
def create_plan(data: PlanCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    existing = db.query(SubscriptionPlan).filter(SubscriptionPlan.slug == data.slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="A plan with this slug already exists")
    plan = SubscriptionPlan(**data.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.put("/admin/plans/{plan_id}", response_model=PlanResponse)
def update_plan(plan_id: int, data: PlanUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    update_data = data.model_dump(exclude_unset=True)
    if "slug" in update_data:
        existing = db.query(SubscriptionPlan).filter(
            SubscriptionPlan.slug == update_data["slug"],
            SubscriptionPlan.id != plan_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="A plan with this slug already exists")
    for key, val in update_data.items():
        setattr(plan, key, val)
    db.commit()
    db.refresh(plan)
    return plan


@router.delete("/admin/plans/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    plan = db.query(SubscriptionPlan).filter(SubscriptionPlan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    db.delete(plan)
    db.commit()
    return {"detail": "Plan deleted"}


# ─── Site Settings (Admin) ───────────────────────────────────────

@router.get("/admin/site-settings")
def list_site_settings(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """List all site settings for admin."""
    settings = db.query(SiteSetting).all()
    return {s.key: s.value for s in settings}


@router.put("/admin/site-settings/{key}")
def update_site_setting(key: str, body: dict, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """Create or update a site setting."""
    setting = db.query(SiteSetting).filter(SiteSetting.key == key).first()
    if not setting:
        setting = SiteSetting(key=key, value=body.get("value"))
        db.add(setting)
    else:
        setting.value = body.get("value")
    db.commit()
    db.refresh(setting)
    return {"key": setting.key, "value": setting.value}
