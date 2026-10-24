"""Explicit patient support requests and atomic doctor handling."""
from alembic import op
import sqlalchemy as sa

revision = "m31_explicit_support"
down_revision = "l30_refusal_reasons"
branch_labels = depends_on = None


def upgrade():
    op.add_column("messages", sa.Column("support_requested", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_check_constraint("ck_support_patient", "messages", "NOT support_requested OR sender_role = 'patient'")
    op.alter_column("alerts", "assessment_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("alerts", sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id")))
    op.add_column("alerts", sa.Column("source_kind", sa.String(24), nullable=False, server_default="assessment"))
    op.create_check_constraint("ck_alert_source", "alerts",
        "(source_kind = 'assessment' AND assessment_id IS NOT NULL AND message_id IS NULL) OR "
        "(source_kind = 'support_request' AND message_id IS NOT NULL AND assessment_id IS NULL)")
    op.create_table("alert_handling",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("doctor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("alert_id", sa.Integer(), sa.ForeignKey("alerts.id"), nullable=False),
        sa.Column("client_request_id", sa.String(36), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("doctor_tasks.id"), nullable=False),
        sa.Column("reply_message_id", sa.Integer(), sa.ForeignKey("messages.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("doctor_id", "client_request_id", name="uq_alert_handling_request"))
    op.create_index("ix_alert_handling_alert_id", "alert_handling", ["alert_id"])


def downgrade():
    # Refuse a lossy downgrade: these are genuine manual requests, not assessments.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM alerts WHERE source_kind <> 'assessment') "
                                 "OR EXISTS (SELECT 1 FROM messages WHERE support_requested) "
                                 "OR EXISTS (SELECT 1 FROM alert_handling)")):
        raise RuntimeError("Support requests exist; export/reconcile them before a lossy downgrade")
    op.drop_table("alert_handling")
    op.drop_constraint("ck_alert_source", "alerts", type_="check")
    op.drop_column("alerts", "source_kind")
    op.drop_column("alerts", "message_id")
    op.alter_column("alerts", "assessment_id", existing_type=sa.Integer(), nullable=False)
    op.drop_constraint("ck_support_patient", "messages", type_="check")
    op.drop_column("messages", "support_requested")
