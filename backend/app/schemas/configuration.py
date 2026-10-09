from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class AIConfigBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    provider: str
    display_name: str
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    model_name: Optional[str] = None
    max_tokens: int = 4096
    temperature: float = 0.7
    is_active: bool = True
    is_default: bool = False
    description: Optional[str] = None


class AIConfigCreate(AIConfigBase):
    pass


class AIConfigUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    provider: Optional[str] = None
    display_name: Optional[str] = None
    api_key: Optional[str] = None
    api_base_url: Optional[str] = None
    model_name: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    description: Optional[str] = None


class AIConfigResponse(AIConfigBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())


class PubMedConfigBase(BaseModel):
    display_name: str
    api_key: Optional[str] = None
    email: Optional[str] = None
    base_url: str = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    requests_per_second: int = 3
    is_active: bool = True
    is_default: bool = False
    description: Optional[str] = None


class PubMedConfigCreate(PubMedConfigBase):
    pass


class PubMedConfigUpdate(BaseModel):
    display_name: Optional[str] = None
    api_key: Optional[str] = None
    email: Optional[str] = None
    base_url: Optional[str] = None
    requests_per_second: Optional[int] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    description: Optional[str] = None


class PubMedConfigResponse(PubMedConfigBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ─── ClinicalTrials.gov ──────────────────────────────────────────

class ClinicalTrialsConfigBase(BaseModel):
    display_name: str
    base_url: str = "https://clinicaltrials.gov/api/v2"
    requests_per_second: int = 3
    is_active: bool = True
    is_default: bool = False
    description: Optional[str] = None


class ClinicalTrialsConfigCreate(ClinicalTrialsConfigBase):
    pass


class ClinicalTrialsConfigUpdate(BaseModel):
    display_name: Optional[str] = None
    base_url: Optional[str] = None
    requests_per_second: Optional[int] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    description: Optional[str] = None


class ClinicalTrialsConfigResponse(ClinicalTrialsConfigBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ─── Google Scholar ──────────────────────────────────────────────

class GoogleScholarConfigBase(BaseModel):
    display_name: str
    api_key: Optional[str] = None
    provider: str = "direct"
    base_url: str = "https://scholar.google.com/scholar"
    proxy_url: Optional[str] = None
    requests_per_minute: int = 10
    is_active: bool = True
    is_default: bool = False
    description: Optional[str] = None


class GoogleScholarConfigCreate(GoogleScholarConfigBase):
    pass


class GoogleScholarConfigUpdate(BaseModel):
    display_name: Optional[str] = None
    api_key: Optional[str] = None
    provider: Optional[str] = None
    base_url: Optional[str] = None
    proxy_url: Optional[str] = None
    requests_per_minute: Optional[int] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    description: Optional[str] = None


class GoogleScholarConfigResponse(GoogleScholarConfigBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ─── Web search (Find KOLs → Google) ───────────────────────────

class WebSearchConfigBase(BaseModel):
    display_name: str
    provider: str = "serpapi"
    api_key: Optional[str] = None
    is_active: bool = True
    is_default: bool = False
    description: Optional[str] = None


class WebSearchConfigCreate(WebSearchConfigBase):
    pass


class WebSearchConfigUpdate(BaseModel):
    display_name: Optional[str] = None
    provider: Optional[str] = None
    api_key: Optional[str] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    description: Optional[str] = None


class WebSearchConfigResponse(WebSearchConfigBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ─── LinkedIn ───────────────────────────────────────────────────

class LinkedInConfigBase(BaseModel):
    display_name: str
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    redirect_uri: Optional[str] = None
    access_token: Optional[str] = None
    scopes: str = "r_liteprofile r_emailaddress"
    is_active: bool = True
    is_default: bool = False
    description: Optional[str] = None


class LinkedInConfigCreate(LinkedInConfigBase):
    pass


class LinkedInConfigUpdate(BaseModel):
    display_name: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    redirect_uri: Optional[str] = None
    access_token: Optional[str] = None
    scopes: Optional[str] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    description: Optional[str] = None


class LinkedInConfigResponse(LinkedInConfigBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)


# ─── Payment Gateway ────────────────────────────────────────────

class PaymentGatewayBase(BaseModel):
    provider: str
    display_name: str
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    merchant_id: Optional[str] = None
    is_live: bool = False
    is_active: bool = True
    is_default: bool = False
    supported_methods: Optional[str] = None
    supported_currencies: Optional[str] = None
    webhook_url: Optional[str] = None
    description: Optional[str] = None


class PaymentGatewayCreate(PaymentGatewayBase):
    pass


class PaymentGatewayUpdate(BaseModel):
    provider: Optional[str] = None
    display_name: Optional[str] = None
    api_key: Optional[str] = None
    api_secret: Optional[str] = None
    merchant_id: Optional[str] = None
    is_live: Optional[bool] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    supported_methods: Optional[str] = None
    supported_currencies: Optional[str] = None
    webhook_url: Optional[str] = None
    description: Optional[str] = None


class PaymentGatewayResponse(PaymentGatewayBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)
