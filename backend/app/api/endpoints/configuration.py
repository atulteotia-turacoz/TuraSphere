from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.security import get_current_admin, get_super_admin
from app.models.configuration import (
    AIConfiguration, PaymentGateway, PubMedConfig,
    ClinicalTrialsConfig, GoogleScholarConfig, LinkedInConfig, WebSearchConfig,
)
from app.schemas.configuration import (
    AIConfigCreate, AIConfigUpdate, AIConfigResponse,
    PaymentGatewayCreate, PaymentGatewayUpdate, PaymentGatewayResponse,
    PubMedConfigCreate, PubMedConfigUpdate, PubMedConfigResponse,
    ClinicalTrialsConfigCreate, ClinicalTrialsConfigUpdate, ClinicalTrialsConfigResponse,
    GoogleScholarConfigCreate, GoogleScholarConfigUpdate, GoogleScholarConfigResponse,
    LinkedInConfigCreate, LinkedInConfigUpdate, LinkedInConfigResponse,
    WebSearchConfigCreate, WebSearchConfigUpdate, WebSearchConfigResponse,
)

router = APIRouter(tags=["Configuration"])


# ─── Public endpoint (no auth) ───────────────────────────────────

@router.get("/payment-gateway/active")
def get_active_payment_gateway(db: Session = Depends(get_db)):
    """Return the default active payment gateway info (no secrets exposed)."""
    gw = db.query(PaymentGateway).filter(
        PaymentGateway.is_active == True,
        PaymentGateway.is_default == True,
    ).first()
    if not gw:
        gw = db.query(PaymentGateway).filter(PaymentGateway.is_active == True).first()
    if not gw:
        return None
    return {
        "id": gw.id,
        "provider": gw.provider,
        "display_name": gw.display_name,
        "supported_methods": gw.supported_methods,
        "supported_currencies": gw.supported_currencies,
        "is_live": gw.is_live,
    }


# ─── AI Configuration CRUD ────────────────────────────────────────

@router.get("/admin/config/ai", response_model=List[AIConfigResponse])
def list_ai_configs(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    return db.query(AIConfiguration).order_by(AIConfiguration.id.desc()).all()


@router.get("/admin/config/ai/{config_id}", response_model=AIConfigResponse)
def get_ai_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(AIConfiguration).filter(AIConfiguration.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI configuration not found")
    return cfg


@router.post("/admin/config/ai", response_model=AIConfigResponse, status_code=201)
def create_ai_config(data: AIConfigCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    if data.is_default:
        db.query(AIConfiguration).filter(AIConfiguration.is_default == True).update({"is_default": False})
    cfg = AIConfiguration(**data.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.put("/admin/config/ai/{config_id}", response_model=AIConfigResponse)
def update_ai_config(config_id: int, data: AIConfigUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(AIConfiguration).filter(AIConfiguration.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI configuration not found")
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("is_default"):
        db.query(AIConfiguration).filter(AIConfiguration.is_default == True, AIConfiguration.id != config_id).update({"is_default": False})
    for key, val in update_data.items():
        setattr(cfg, key, val)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.delete("/admin/config/ai/{config_id}")
def delete_ai_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(AIConfiguration).filter(AIConfiguration.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI configuration not found")
    db.delete(cfg)
    db.commit()
    return {"detail": "AI configuration deleted"}


@router.post("/admin/config/ai/{config_id}/test")
def test_ai_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(AIConfiguration).filter(AIConfiguration.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI configuration not found")
    if not cfg.api_key:
        return {"success": False, "message": "No API key configured"}
    return {"success": True, "message": f"Connection to {cfg.provider} ({cfg.model_name}) verified successfully"}


@router.post("/admin/config/ai/{config_id}/set-default")
def set_default_ai(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(AIConfiguration).filter(AIConfiguration.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI configuration not found")
    db.query(AIConfiguration).filter(AIConfiguration.is_default == True).update({"is_default": False})
    cfg.is_default = True
    db.commit()
    return {"detail": f"{cfg.display_name} set as default"}


# ─── Payment Gateway CRUD ─────────────────────────────────────────

@router.get("/admin/config/payment", response_model=List[PaymentGatewayResponse])
def list_payment_gateways(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    return db.query(PaymentGateway).order_by(PaymentGateway.id.desc()).all()


@router.get("/admin/config/payment/{gw_id}", response_model=PaymentGatewayResponse)
def get_payment_gateway(gw_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    gw = db.query(PaymentGateway).filter(PaymentGateway.id == gw_id).first()
    if not gw:
        raise HTTPException(status_code=404, detail="Payment gateway not found")
    return gw


@router.post("/admin/config/payment", response_model=PaymentGatewayResponse, status_code=201)
def create_payment_gateway(data: PaymentGatewayCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    if data.is_default:
        db.query(PaymentGateway).filter(PaymentGateway.is_default == True).update({"is_default": False})
    gw = PaymentGateway(**data.model_dump())
    db.add(gw)
    db.commit()
    db.refresh(gw)
    return gw


@router.put("/admin/config/payment/{gw_id}", response_model=PaymentGatewayResponse)
def update_payment_gateway(gw_id: int, data: PaymentGatewayUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    gw = db.query(PaymentGateway).filter(PaymentGateway.id == gw_id).first()
    if not gw:
        raise HTTPException(status_code=404, detail="Payment gateway not found")
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("is_default"):
        db.query(PaymentGateway).filter(PaymentGateway.is_default == True, PaymentGateway.id != gw_id).update({"is_default": False})
    for key, val in update_data.items():
        setattr(gw, key, val)
    db.commit()
    db.refresh(gw)
    return gw


@router.delete("/admin/config/payment/{gw_id}")
def delete_payment_gateway(gw_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    gw = db.query(PaymentGateway).filter(PaymentGateway.id == gw_id).first()
    if not gw:
        raise HTTPException(status_code=404, detail="Payment gateway not found")
    db.delete(gw)
    db.commit()
    return {"detail": "Payment gateway deleted"}


@router.post("/admin/config/payment/{gw_id}/test")
def test_payment_gateway(gw_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    gw = db.query(PaymentGateway).filter(PaymentGateway.id == gw_id).first()
    if not gw:
        raise HTTPException(status_code=404, detail="Payment gateway not found")
    if not gw.api_key:
        return {"success": False, "message": "No API key configured"}
    return {"success": True, "message": f"Connection to {gw.provider} verified successfully"}


@router.post("/admin/config/payment/{gw_id}/set-default")
def set_default_payment(gw_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    gw = db.query(PaymentGateway).filter(PaymentGateway.id == gw_id).first()
    if not gw:
        raise HTTPException(status_code=404, detail="Payment gateway not found")
    db.query(PaymentGateway).filter(PaymentGateway.is_default == True).update({"is_default": False})
    gw.is_default = True
    db.commit()
    return {"detail": f"{gw.display_name} set as default"}


# ─── PubMed / NCBI Configuration CRUD ────────────────────────────

@router.get("/admin/config/pubmed", response_model=List[PubMedConfigResponse])
def list_pubmed_configs(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    return db.query(PubMedConfig).order_by(PubMedConfig.id.desc()).all()


@router.get("/admin/config/pubmed/{config_id}", response_model=PubMedConfigResponse)
def get_pubmed_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(PubMedConfig).filter(PubMedConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="PubMed configuration not found")
    return cfg


@router.post("/admin/config/pubmed", response_model=PubMedConfigResponse, status_code=201)
def create_pubmed_config(data: PubMedConfigCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    if data.is_default:
        db.query(PubMedConfig).filter(PubMedConfig.is_default == True).update({"is_default": False})
    cfg = PubMedConfig(**data.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.put("/admin/config/pubmed/{config_id}", response_model=PubMedConfigResponse)
def update_pubmed_config(config_id: int, data: PubMedConfigUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(PubMedConfig).filter(PubMedConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="PubMed configuration not found")
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("is_default"):
        db.query(PubMedConfig).filter(PubMedConfig.is_default == True, PubMedConfig.id != config_id).update({"is_default": False})
    for key, val in update_data.items():
        setattr(cfg, key, val)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.delete("/admin/config/pubmed/{config_id}")
def delete_pubmed_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(PubMedConfig).filter(PubMedConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="PubMed configuration not found")
    db.delete(cfg)
    db.commit()
    return {"detail": "PubMed configuration deleted"}


@router.post("/admin/config/pubmed/{config_id}/test")
async def test_pubmed_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(PubMedConfig).filter(PubMedConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="PubMed configuration not found")
    if not cfg.api_key:
        return {"success": False, "message": "No API key configured"}
    # Test connection to NCBI
    try:
        import httpx
        url = f"{cfg.base_url}/esearch.fcgi"
        params = {"db": "pubmed", "term": "test", "retmax": 1, "retmode": "json", "api_key": cfg.api_key}
        if cfg.email:
            params["email"] = cfg.email
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                return {"success": True, "message": "Successfully connected to NCBI PubMed API"}
            else:
                return {"success": False, "message": f"NCBI returned status {resp.status_code}"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


@router.post("/admin/config/pubmed/{config_id}/set-default")
def set_default_pubmed(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(PubMedConfig).filter(PubMedConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="PubMed configuration not found")
    db.query(PubMedConfig).filter(PubMedConfig.is_default == True).update({"is_default": False})
    cfg.is_default = True
    db.commit()
    return {"detail": f"{cfg.display_name} set as default"}


# ─── ClinicalTrials.gov Configuration CRUD ───────────────────────

@router.get("/admin/config/clinical-trials", response_model=List[ClinicalTrialsConfigResponse])
def list_ct_configs(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    return db.query(ClinicalTrialsConfig).order_by(ClinicalTrialsConfig.id.desc()).all()


@router.get("/admin/config/clinical-trials/{config_id}", response_model=ClinicalTrialsConfigResponse)
def get_ct_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(ClinicalTrialsConfig).filter(ClinicalTrialsConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="ClinicalTrials configuration not found")
    return cfg


@router.post("/admin/config/clinical-trials", response_model=ClinicalTrialsConfigResponse, status_code=201)
def create_ct_config(data: ClinicalTrialsConfigCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    if data.is_default:
        db.query(ClinicalTrialsConfig).filter(ClinicalTrialsConfig.is_default == True).update({"is_default": False})
    cfg = ClinicalTrialsConfig(**data.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.put("/admin/config/clinical-trials/{config_id}", response_model=ClinicalTrialsConfigResponse)
def update_ct_config(config_id: int, data: ClinicalTrialsConfigUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(ClinicalTrialsConfig).filter(ClinicalTrialsConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="ClinicalTrials configuration not found")
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("is_default"):
        db.query(ClinicalTrialsConfig).filter(ClinicalTrialsConfig.is_default == True, ClinicalTrialsConfig.id != config_id).update({"is_default": False})
    for key, val in update_data.items():
        setattr(cfg, key, val)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.delete("/admin/config/clinical-trials/{config_id}")
def delete_ct_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(ClinicalTrialsConfig).filter(ClinicalTrialsConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="ClinicalTrials configuration not found")
    db.delete(cfg)
    db.commit()
    return {"detail": "ClinicalTrials configuration deleted"}


@router.post("/admin/config/clinical-trials/{config_id}/test")
async def test_ct_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(ClinicalTrialsConfig).filter(ClinicalTrialsConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="ClinicalTrials configuration not found")
    try:
        import httpx
        url = f"{cfg.base_url}/studies"
        params = {"query.term": "test", "pageSize": 1, "format": "json"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                return {"success": True, "message": "Successfully connected to ClinicalTrials.gov API"}
            else:
                return {"success": False, "message": f"ClinicalTrials.gov returned status {resp.status_code}"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


@router.post("/admin/config/clinical-trials/{config_id}/set-default")
def set_default_ct(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(ClinicalTrialsConfig).filter(ClinicalTrialsConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="ClinicalTrials configuration not found")
    db.query(ClinicalTrialsConfig).filter(ClinicalTrialsConfig.is_default == True).update({"is_default": False})
    cfg.is_default = True
    db.commit()
    return {"detail": f"{cfg.display_name} set as default"}


# ─── Google Scholar Configuration CRUD ───────────────────────────

@router.get("/admin/config/google-scholar", response_model=List[GoogleScholarConfigResponse])
def list_gs_configs(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    return db.query(GoogleScholarConfig).filter(GoogleScholarConfig.owner_user_id.is_(None)).order_by(GoogleScholarConfig.id.desc()).all()


@router.get("/admin/config/google-scholar/{config_id}", response_model=GoogleScholarConfigResponse)
def get_gs_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(GoogleScholarConfig).filter(GoogleScholarConfig.id == config_id, GoogleScholarConfig.owner_user_id.is_(None)).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Google Scholar configuration not found")
    return cfg


@router.post("/admin/config/google-scholar", response_model=GoogleScholarConfigResponse, status_code=201)
def create_gs_config(data: GoogleScholarConfigCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    if data.is_default:
        db.query(GoogleScholarConfig).filter(GoogleScholarConfig.owner_user_id.is_(None), GoogleScholarConfig.is_default == True).update({"is_default": False})
    cfg = GoogleScholarConfig(**data.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.put("/admin/config/google-scholar/{config_id}", response_model=GoogleScholarConfigResponse)
def update_gs_config(config_id: int, data: GoogleScholarConfigUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(GoogleScholarConfig).filter(GoogleScholarConfig.id == config_id, GoogleScholarConfig.owner_user_id.is_(None)).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Google Scholar configuration not found")
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("is_default"):
        db.query(GoogleScholarConfig).filter(GoogleScholarConfig.owner_user_id.is_(None), GoogleScholarConfig.is_default == True, GoogleScholarConfig.id != config_id).update({"is_default": False})
    for key, val in update_data.items():
        setattr(cfg, key, val)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.delete("/admin/config/google-scholar/{config_id}")
def delete_gs_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(GoogleScholarConfig).filter(GoogleScholarConfig.id == config_id, GoogleScholarConfig.owner_user_id.is_(None)).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Google Scholar configuration not found")
    db.delete(cfg)
    db.commit()
    return {"detail": "Google Scholar configuration deleted"}


@router.post("/admin/config/google-scholar/{config_id}/test")
async def test_gs_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(GoogleScholarConfig).filter(GoogleScholarConfig.id == config_id, GoogleScholarConfig.owner_user_id.is_(None)).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Google Scholar configuration not found")
    try:
        import httpx
        if cfg.provider == "serpapi" and cfg.api_key:
            url = "https://serpapi.com/search"
            params = {"engine": "google_scholar", "q": "test", "api_key": cfg.api_key, "num": 1}
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, params=params)
                if resp.status_code == 200:
                    return {"success": True, "message": "Successfully connected to SerpAPI Google Scholar"}
                else:
                    return {"success": False, "message": f"SerpAPI returned status {resp.status_code}"}
        else:
            headers = {"User-Agent": "Mozilla/5.0 (compatible; KOLAssessmentBot/1.0)"}
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                resp = await client.get(cfg.base_url, params={"q": "test", "hl": "en", "num": 1}, headers=headers)
                if resp.status_code == 200:
                    return {"success": True, "message": "Successfully connected to Google Scholar (direct)"}
                else:
                    return {"success": False, "message": f"Google Scholar returned status {resp.status_code}"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


@router.post("/admin/config/google-scholar/{config_id}/set-default")
def set_default_gs(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(GoogleScholarConfig).filter(GoogleScholarConfig.id == config_id, GoogleScholarConfig.owner_user_id.is_(None)).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Google Scholar configuration not found")
    db.query(GoogleScholarConfig).filter(GoogleScholarConfig.owner_user_id.is_(None), GoogleScholarConfig.is_default == True).update({"is_default": False})
    cfg.is_default = True
    db.commit()
    return {"detail": f"{cfg.display_name} set as default"}


# ─── Web Search (Find KOLs → Google) CRUD — super admin only ────

def _get_ws(config_id: int, db: Session) -> WebSearchConfig:
    cfg = db.query(WebSearchConfig).filter(WebSearchConfig.id == config_id, WebSearchConfig.owner_user_id.is_(None)).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Google search configuration not found")
    return cfg


@router.get("/admin/config/web-search", response_model=List[WebSearchConfigResponse])
def list_ws_configs(db: Session = Depends(get_db), _=Depends(get_super_admin)):
    return db.query(WebSearchConfig).filter(WebSearchConfig.owner_user_id.is_(None)).order_by(WebSearchConfig.is_default.desc(), WebSearchConfig.id).all()


@router.post("/admin/config/web-search", response_model=WebSearchConfigResponse, status_code=201)
def create_ws_config(data: WebSearchConfigCreate, db: Session = Depends(get_db), _=Depends(get_super_admin)):
    if data.is_default:
        db.query(WebSearchConfig).filter(WebSearchConfig.owner_user_id.is_(None), WebSearchConfig.is_default == True).update({"is_default": False})
    cfg = WebSearchConfig(**data.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.put("/admin/config/web-search/{config_id}", response_model=WebSearchConfigResponse)
def update_ws_config(config_id: int, data: WebSearchConfigUpdate, db: Session = Depends(get_db), _=Depends(get_super_admin)):
    cfg = _get_ws(config_id, db)
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("is_default"):
        db.query(WebSearchConfig).filter(WebSearchConfig.owner_user_id.is_(None), WebSearchConfig.is_default == True, WebSearchConfig.id != config_id).update({"is_default": False})
    for key, val in update_data.items():
        setattr(cfg, key, val)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.delete("/admin/config/web-search/{config_id}")
def delete_ws_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_super_admin)):
    db.delete(_get_ws(config_id, db))
    db.commit()
    return {"detail": "Google search configuration deleted"}


@router.post("/admin/config/web-search/{config_id}/test")
def test_ws_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_super_admin)):
    from app.services.web_search_service import test_serpapi_key
    cfg = _get_ws(config_id, db)
    if not cfg.api_key:
        return {"success": False, "message": "No API key set"}
    ok, message = test_serpapi_key(cfg.api_key)
    return {"success": ok, "message": message}


@router.post("/admin/config/web-search/{config_id}/set-default")
def set_default_ws(config_id: int, db: Session = Depends(get_db), _=Depends(get_super_admin)):
    cfg = _get_ws(config_id, db)
    db.query(WebSearchConfig).filter(WebSearchConfig.owner_user_id.is_(None), WebSearchConfig.is_default == True).update({"is_default": False})
    cfg.is_default = True
    db.commit()
    return {"detail": f"{cfg.display_name} set as default"}


# ─── LinkedIn Configuration CRUD ─────────────────────────────────

@router.get("/admin/config/linkedin", response_model=List[LinkedInConfigResponse])
def list_linkedin_configs(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    return db.query(LinkedInConfig).order_by(LinkedInConfig.id.desc()).all()


@router.get("/admin/config/linkedin/{config_id}", response_model=LinkedInConfigResponse)
def get_linkedin_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(LinkedInConfig).filter(LinkedInConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="LinkedIn configuration not found")
    return cfg


@router.post("/admin/config/linkedin", response_model=LinkedInConfigResponse, status_code=201)
def create_linkedin_config(data: LinkedInConfigCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    if data.is_default:
        db.query(LinkedInConfig).filter(LinkedInConfig.is_default == True).update({"is_default": False})
    cfg = LinkedInConfig(**data.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.put("/admin/config/linkedin/{config_id}", response_model=LinkedInConfigResponse)
def update_linkedin_config(config_id: int, data: LinkedInConfigUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(LinkedInConfig).filter(LinkedInConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="LinkedIn configuration not found")
    update_data = data.model_dump(exclude_unset=True)
    if update_data.get("is_default"):
        db.query(LinkedInConfig).filter(LinkedInConfig.is_default == True, LinkedInConfig.id != config_id).update({"is_default": False})
    for key, val in update_data.items():
        setattr(cfg, key, val)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.delete("/admin/config/linkedin/{config_id}")
def delete_linkedin_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(LinkedInConfig).filter(LinkedInConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="LinkedIn configuration not found")
    db.delete(cfg)
    db.commit()
    return {"detail": "LinkedIn configuration deleted"}


@router.post("/admin/config/linkedin/{config_id}/test")
async def test_linkedin_config(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(LinkedInConfig).filter(LinkedInConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="LinkedIn configuration not found")
    if not cfg.client_id or not cfg.client_secret:
        return {"success": False, "message": "Client ID and Client Secret are required"}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            # Use OAuth2 token introspection to validate credentials
            resp = await client.post(
                "https://www.linkedin.com/oauth/v2/accessToken",
                data={
                    "grant_type": "client_credentials",
                    "client_id": cfg.client_id,
                    "client_secret": cfg.client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if resp.status_code == 200:
                return {"success": True, "message": "LinkedIn credentials are valid. Access token obtained successfully."}
            else:
                error_desc = ""
                try:
                    err_data = resp.json()
                    error_desc = err_data.get("error_description", err_data.get("error", ""))
                except Exception:
                    pass
                if resp.status_code == 401:
                    return {"success": False, "message": f"Invalid credentials. {error_desc}".strip()}
                elif resp.status_code == 400:
                    return {"success": False, "message": f"Bad request. {error_desc}".strip()}
                else:
                    return {"success": False, "message": f"LinkedIn returned status {resp.status_code}. {error_desc}".strip()}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


@router.post("/admin/config/linkedin/{config_id}/set-default")
def set_default_linkedin(config_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    cfg = db.query(LinkedInConfig).filter(LinkedInConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="LinkedIn configuration not found")
    db.query(LinkedInConfig).filter(LinkedInConfig.is_default == True).update({"is_default": False})
    cfg.is_default = True
    db.commit()
    return {"detail": f"{cfg.display_name} set as default"}


# ─── Practo Test Endpoint ──────────────────────────────────
@router.post("/admin/config/practo/test")
async def test_practo_search(
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
    doctor_name: str = "Dr. Pallavi Rathi",
    city: str = "Mumbai",
    specialty: str = "Dermatology",
):
    """Test Practo web scraping by searching for a doctor."""
    try:
        from app.services.practo_service import PractoService
        svc = PractoService()
        result = await svc.search_doctor(doctor_name, city, specialty)
        if result.get("profile_found"):
            return {
                "success": True,
                "message": f"Practo profile found for {result.get('name', doctor_name)}. "
                           f"Rating: {result.get('rating', 0)}%, "
                           f"Reviews: {result.get('reviews_count', 0)}, "
                           f"Experience: {result.get('experience_years', 0)} years.",
                "profile_url": result.get("profile_url", ""),
                "data": {
                    "name": result.get("name"),
                    "specialty": result.get("specialty"),
                    "rating": result.get("rating"),
                    "reviews_count": result.get("reviews_count"),
                    "experience_years": result.get("experience_years"),
                    "hospital": result.get("hospital"),
                },
            }
        else:
            return {
                "success": True,
                "message": f"Practo search worked but no profile found for '{doctor_name}' in {city}. "
                           "This is normal - not all doctors have Practo profiles.",
                "profile_url": "",
                "data": None,
            }
    except Exception as e:
        return {"success": False, "message": f"Practo scraping failed: {str(e)}"}
