"""Explicit doctor-selected ID-only coordinator fallback."""
from alembic import op
import sqlalchemy as sa

revision = "t38_coordinator_fallback"
down_revision = "s37_clinical_review"
branch_labels = depends_on = None


def upgrade():
    op.create_table("doctor_escalation_routes",
        sa.Column("doctor_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("coordinator_id", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_escalation_route_revision"))
    op.create_table("coordinator_notices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("alert_id", sa.Integer(), sa.ForeignKey("alerts.id"), unique=True, nullable=False),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("doctor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("coordinator_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("route_revision", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("reason IN ('doctor_unavailable', 'acknowledgement_overdue')", name="ck_coordinator_notice_reason"))
    op.create_index("ix_coordinator_notices_recipient", "coordinator_notices", ["coordinator_id", "id"])


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM doctor_escalation_routes) OR EXISTS(SELECT 1 FROM coordinator_notices)")):
        raise RuntimeError("Coordinator routing history exists; preserve it and fix forward")
    op.drop_index("ix_coordinator_notices_recipient", table_name="coordinator_notices")
    op.drop_table("coordinator_notices")
    op.drop_table("doctor_escalation_routes")
