"""Record in-app presentation separately from a doctor's acknowledgement.

Revision ID: e23_alert_presentations
Revises: d22_retention_mvp
"""
from alembic import op
import sqlalchemy as sa

revision = "e23_alert_presentations"
down_revision = "d22_retention_mvp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alert_presentations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("alert_id", sa.Integer(), sa.ForeignKey("alerts.id"), nullable=False),
        sa.Column("doctor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("presented_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("alert_id", "doctor_id", name="uq_alert_presentation_doctor"),
    )


def downgrade() -> None:
    op.drop_table("alert_presentations")
