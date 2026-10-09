import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token, get_current_user
from app.models.user import User
from app.core.services import granted_for, effective_for
from app.schemas.user import UserCreate, UserLogin, UserResponse, Token

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=201)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        email=user_data.email,
        full_name=user_data.full_name,
        hashed_password=get_password_hash(user_data.password),
        role=user_data.role,
        organization=user_data.organization,
        allowed_services=json.dumps(user_data.allowed_services) if user_data.allowed_services else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")
    role_str = user.role.value if hasattr(user.role, 'value') else str(user.role)
    token = create_access_token(data={"sub": str(user.id), "role": role_str})
    try:
        services = json.loads(user.allowed_services) if user.allowed_services else None
    except (json.JSONDecodeError, TypeError):
        services = None

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "role": role_str,
            "organization": user.organization,
            "allowed_services": services,
            "granted_services": granted_for(user),
            "effective_services": effective_for(user),
        }
    }


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    # Attached to the instance, not stored — Pydantic picks them up via
    # from_attributes and the UI gets ready-made lists.
    current_user.granted_service_list = granted_for(current_user)
    current_user.effective_services = effective_for(current_user)
    return current_user
