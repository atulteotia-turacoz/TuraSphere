from sqlalchemy import Column, Integer, String, Boolean, Float, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class AIConfiguration(Base):
    __tablename__ = "ai_configurations"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), nullable=False)
    display_name = Column(String(100), nullable=False)
    api_key = Column(String(500), nullable=True)
    api_base_url = Column(String(500), nullable=True)
    model_name = Column(String(100), nullable=True)
    max_tokens = Column(Integer, default=4096)
    temperature = Column(Float, default=0.7)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class PubMedConfig(Base):
    __tablename__ = "pubmed_configurations"

    id = Column(Integer, primary_key=True, index=True)
    display_name = Column(String(100), nullable=False)
    api_key = Column(String(500), nullable=True)
    email = Column(String(255), nullable=True)
    base_url = Column(String(500), default="https://eutils.ncbi.nlm.nih.gov/entrez/eutils")
    requests_per_second = Column(Integer, default=3)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ClinicalTrialsConfig(Base):
    __tablename__ = "clinical_trials_configurations"

    id = Column(Integer, primary_key=True, index=True)
    display_name = Column(String(100), nullable=False)
    base_url = Column(String(500), default="https://clinicaltrials.gov/api/v2")
    requests_per_second = Column(Integer, default=3)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class WebSearchConfig(Base):
    """SerpAPI keys for the Find KOLs "Google search" method (Admin → Google Search).

    Every active key is tried in order (default first); when one is invalid or out
    of searches the next is used, and with none left the search falls back to free
    Brave / DuckDuckGo scraping — see services/web_search_service.py.
    """
    __tablename__ = "web_search_configurations"

    id = Column(Integer, primary_key=True, index=True)
    # NULL = platform key (super admin, Admin → Google Search); set = one account's
    # own key (Account → Google Search). An account's own keys are tried first.
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    display_name = Column(String(100), nullable=False)
    provider = Column(String(50), default="serpapi")  # serpapi
    api_key = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class GoogleScholarConfig(Base):
    __tablename__ = "google_scholar_configurations"

    id = Column(Integer, primary_key=True, index=True)
    # NULL = platform config (admin); set = one account's own (Account → Google Scholar).
    owner_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    display_name = Column(String(100), nullable=False)
    api_key = Column(String(500), nullable=True)  # SerpAPI key (optional)
    provider = Column(String(50), default="direct")  # direct / serpapi
    base_url = Column(String(500), default="https://scholar.google.com/scholar")
    proxy_url = Column(String(500), nullable=True)
    requests_per_minute = Column(Integer, default=10)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class LinkedInConfig(Base):
    __tablename__ = "linkedin_configurations"

    id = Column(Integer, primary_key=True, index=True)
    display_name = Column(String(100), nullable=False)
    client_id = Column(String(500), nullable=True)
    client_secret = Column(String(500), nullable=True)
    redirect_uri = Column(String(500), nullable=True)
    access_token = Column(Text, nullable=True)
    scopes = Column(String(500), default="r_liteprofile r_emailaddress")
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class SiteSetting(Base):
    __tablename__ = "site_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PaymentGateway(Base):
    __tablename__ = "payment_gateways"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(50), nullable=False)
    display_name = Column(String(100), nullable=False)
    api_key = Column(String(500), nullable=True)
    api_secret = Column(String(500), nullable=True)
    merchant_id = Column(String(200), nullable=True)
    is_live = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    supported_methods = Column(Text, nullable=True)
    supported_currencies = Column(Text, nullable=True)
    webhook_url = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class WebSearchUsage(Base):
    """One row per search-provider call (SerpAPI / Brave / DuckDuckGo), for the
    usage report on Admin → Google Search and Account → Google Search.

    SerpAPI's own account API only gives month-to-date totals per key; this log
    adds who ran the searches, which feature, and how often the free fallback
    had to step in.
    """
    __tablename__ = "web_search_usage"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    # web_search_configurations.id or google_scholar_configurations.id (see
    # `feature`); NULL for the free providers. No FK so history survives a deleted key.
    config_id = Column(Integer, nullable=True, index=True)
    key_scope = Column(String(20), nullable=True)      # platform | account
    feature = Column(String(40), nullable=False, default="find_kols")  # find_kols | scholar
    provider = Column(String(20), nullable=False)      # serpapi | brave | ddg | scholar_direct
    status = Column(String(20), nullable=False)        # ok | error | quota
    results = Column(Integer, default=0)
    query = Column(String(500), nullable=True)
    error = Column(String(255), nullable=True)

