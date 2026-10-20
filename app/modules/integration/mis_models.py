from sqlalchemy import Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import MISBase


class MISPatient(MISBase):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255))
    diagnoses: Mapped[list[str]] = mapped_column(JSONB)
    prescriptions: Mapped[list[str]] = mapped_column(JSONB)
