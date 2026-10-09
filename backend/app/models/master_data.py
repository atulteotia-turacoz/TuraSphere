import enum
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, Enum, UniqueConstraint, ForeignKey, Index
from sqlalchemy.sql import func
from app.core.database import Base


class MasterDataType(str, enum.Enum):
    therapeutic_area = "therapeutic_area"
    specialty = "specialty"
    hcp_type = "hcp_type"
    pharma_sponsor = "pharma_sponsor"
    region = "region"
    currency = "currency"


# User-managed types (per-user CRUD via /account/categories)
USER_MANAGED_TYPES = {
    MasterDataType.therapeutic_area,
    MasterDataType.pharma_sponsor,
    MasterDataType.region,
    MasterDataType.currency,
}


def parse_keywords(raw: str) -> list[str]:
    """Split a stored `keywords` blob into clean search terms.

    Accepts newline- or comma-separated text (users paste either), trims, drops
    blanks, and de-duplicates case-insensitively while keeping the author's order
    and original casing.
    """
    if not raw:
        return []
    out, seen = [], set()
    for chunk in raw.replace(",", "\n").splitlines():
        term = chunk.strip()
        if not term or term.lower() in seen:
            continue
        seen.add(term.lower())
        out.append(term)
    return out


class MasterData(Base):
    __tablename__ = "master_data"
    __table_args__ = (
        # user_id NULL = global / admin-seeded; otherwise per-user
        UniqueConstraint("type", "value", "user_id", name="uq_master_data_type_value_user"),
        Index("ix_master_data_user_id", "user_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    type = Column(Enum(MasterDataType), nullable=False, index=True)
    label = Column(String(255), nullable=False)
    value = Column(String(255), nullable=False)

    # Supporting search terms for this item, one per line. A therapeutic area is a
    # label ("Dermatology"), but a KOL search needs the many ways practitioners
    # actually describe themselves ("skin specialist", "DNB dermatology", …), so
    # the KOL scrape ORs these into its query and matches bios against them.
    # Free text rather than a relation: users edit it as a list in Account →
    # Categories, and nothing else joins on individual keywords.
    keywords = Column(Text, nullable=True)

    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
