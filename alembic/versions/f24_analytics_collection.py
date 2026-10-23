"""Survey opening, private observation dimensions and voluntary diary.

Revision ID: f24_analytics_collection
Revises: e23_alert_presentations
"""
from alembic import op
import sqlalchemy as sa

revision = "f24_analytics_collection"
down_revision = "e23_alert_presentations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("survey_assignments", sa.Column("first_opened_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("doctor_notes", sa.Column("dimension", sa.String(40), nullable=True))
    op.create_table(
        "diary_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("client_request_id", sa.String(36), nullable=False),
        sa.Column("text", sa.String(4000), nullable=False),
        sa.Column("shared_with_doctor", sa.Boolean(), nullable=False),
        sa.Column("initial_shared_with_doctor", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("patient_id", "client_request_id", name="uq_diary_request"),
    )
    op.create_index("ix_diary_entries_patient_id", "diary_entries", ["patient_id"])


def downgrade() -> None:
    op.drop_index("ix_diary_entries_patient_id", table_name="diary_entries")
    op.drop_table("diary_entries")
    op.drop_column("doctor_notes", "dimension")
    op.drop_column("survey_assignments", "first_opened_at")
