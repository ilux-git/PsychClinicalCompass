"""Canonical clinical editions and immutable, submission-linked results."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "r36_clinical_instruments"
down_revision = "q35_emr_demo_documents"
branch_labels = depends_on = None


def upgrade():
    op.add_column("surveys", sa.Column("clinical_key", sa.String(64)))
    op.create_unique_constraint("uq_survey_doctor_clinical_key", "surveys", ["doctor_id", "clinical_key"])
    op.create_table("clinical_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("submission_id", sa.Integer(), sa.ForeignKey("survey_submissions.id"), nullable=False, unique=True),
        sa.Column("instrument_key", sa.String(64), nullable=False),
        sa.Column("definition", JSONB(), nullable=False),
        sa.Column("score", sa.Integer()),
        sa.Column("result", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("score IS NULL OR score >= 0", name="ck_clinical_result_score"))
    op.create_index("ix_clinical_results_patient_id", "clinical_results", ["patient_id"])


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM clinical_results) OR EXISTS (SELECT 1 FROM surveys WHERE clinical_key IS NOT NULL)")):
        raise RuntimeError("Clinical editions or results exist; preserve their provenance and fix forward")
    op.drop_index("ix_clinical_results_patient_id", table_name="clinical_results")
    op.drop_table("clinical_results")
    op.drop_constraint("uq_survey_doctor_clinical_key", "surveys", type_="unique")
    op.drop_column("surveys", "clinical_key")
