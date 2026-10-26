"""Explicit PHQ-9 baselines and sourced review alerts with distinct deadlines."""
from alembic import op
import sqlalchemy as sa

revision = "s37_clinical_review"
down_revision = "r36_clinical_instruments"
branch_labels = depends_on = None


def upgrade():
    op.create_table("clinical_baselines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("instrument_key", sa.String(64), nullable=False),
        sa.Column("result_id", sa.Integer(), sa.ForeignKey("clinical_results.id")),
        sa.Column("selected_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("selected_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("patient_id", "instrument_key", name="uq_clinical_baseline_patient_key"),
        sa.CheckConstraint("revision >= 1", name="ck_clinical_baseline_revision"))
    op.add_column("alerts", sa.Column("clinical_result_id", sa.Integer(), sa.ForeignKey("clinical_results.id")))
    op.add_column("alerts", sa.Column("acknowledgement_due_at", sa.DateTime(timezone=True)))
    op.add_column("alerts", sa.Column("action_due_at", sa.DateTime(timezone=True)))
    op.drop_constraint("ck_alert_source", "alerts", type_="check")
    op.create_check_constraint("ck_alert_source", "alerts",
        "(source_kind = 'assessment' AND assessment_id IS NOT NULL AND message_id IS NULL AND clinical_result_id IS NULL) OR "
        "(source_kind = 'support_request' AND message_id IS NOT NULL AND assessment_id IS NULL AND clinical_result_id IS NULL) OR "
        "(source_kind = 'clinical_assessment' AND clinical_result_id IS NOT NULL AND assessment_id IS NULL AND message_id IS NULL)")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM clinical_baselines) OR EXISTS(SELECT 1 FROM alerts WHERE clinical_result_id IS NOT NULL OR acknowledgement_due_at IS NOT NULL OR action_due_at IS NOT NULL)")):
        raise RuntimeError("Clinical baselines or review alerts exist; preserve history and fix forward")
    op.drop_constraint("ck_alert_source", "alerts", type_="check")
    op.create_check_constraint("ck_alert_source", "alerts",
        "(source_kind = 'assessment' AND assessment_id IS NOT NULL AND message_id IS NULL) OR "
        "(source_kind = 'support_request' AND message_id IS NOT NULL AND assessment_id IS NULL)")
    op.drop_column("alerts", "action_due_at")
    op.drop_column("alerts", "acknowledgement_due_at")
    op.drop_column("alerts", "clinical_result_id")
    op.drop_table("clinical_baselines")
