"""Physician-approved synthetic EMR envelopes and separate local receipts."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "q35_emr_demo_documents"
down_revision = "p34_read_access_audit"
branch_labels = depends_on = None


def upgrade():
    op.create_table("emr_demo_documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("doctor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("doctor_tasks.id"), nullable=False),
        sa.Column("task_revision", sa.Integer(), nullable=False),
        sa.Column("client_request_id", sa.String(36), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("content", JSONB(), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("doctor_id", "client_request_id", name="uq_emr_demo_approval_request"))
    op.create_index("ix_emr_demo_documents_patient_id", "emr_demo_documents", ["patient_id"])
    op.create_index("ix_emr_demo_documents_task_id", "emr_demo_documents", ["task_id"])
    op.create_table("emr_demo_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("emr_demo_documents.id"), nullable=False, unique=True),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM emr_demo_documents) OR EXISTS (SELECT 1 FROM emr_demo_receipts)")):
        raise RuntimeError("Approved EMR demo history exists; preserve it and fix forward")
    op.drop_table("emr_demo_receipts")
    op.drop_index("ix_emr_demo_documents_task_id", table_name="emr_demo_documents")
    op.drop_index("ix_emr_demo_documents_patient_id", table_name="emr_demo_documents")
    op.drop_table("emr_demo_documents")
