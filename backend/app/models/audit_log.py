from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    assessment_id = Column(Integer, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=True, index=True)
    action = Column(String(255), nullable=False)
    details = Column(Text, nullable=True)
    performed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    assessment = relationship("Assessment", back_populates="audit_logs", foreign_keys=[assessment_id])
    performer = relationship("User", back_populates="audit_logs", foreign_keys=[performed_by])

    def __repr__(self):
        return f"<AuditLog(id={self.id}, action='{self.action}', assessment_id={self.assessment_id})>"
