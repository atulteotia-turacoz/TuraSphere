from sqlalchemy import Column, Integer, String, Boolean, Float, Text, DateTime
from sqlalchemy.sql import func
from app.core.database import Base


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    description = Column(Text, nullable=True)
    price_monthly = Column(Float, default=0)
    price_yearly = Column(Float, default=0)
    currency = Column(String(10), default="USD")
    max_assessments = Column(Integer, default=0)  # 0 = unlimited
    max_hcps = Column(Integer, default=0)  # 0 = unlimited
    features = Column(Text, nullable=True)  # JSON array of feature strings
    is_active = Column(Boolean, default=True)
    is_popular = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    badge_text = Column(String(50), nullable=True)  # e.g. "Most Popular", "Best Value"
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
