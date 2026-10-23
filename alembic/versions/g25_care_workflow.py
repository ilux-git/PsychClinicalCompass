"""Doctor-authored treatment status and delegated follow-up tasks.

Revision ID: g25_care_workflow
Revises: f24_analytics_collection
"""
from alembic import op
import sqlalchemy as sa

revision = "g25_care_workflow"
down_revision = "f24_analytics_collection"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'coordinator'")
    op.create_table("treatment_status_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("doctor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("client_request_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("reason", sa.String(2000), nullable=False),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("patient_id", "client_request_id", name="uq_treatment_request"),
        sa.CheckConstraint("status IN ('in_progress', 'completed', 'refused')", name="ck_treatment_status"))
    op.create_index("ix_treatment_status_changes_patient_id", "treatment_status_changes", ["patient_id"])
    for column in [
        sa.Column("client_request_id", sa.String(36)),
        sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_task_assignee")),
        sa.Column("kind", sa.String(24), nullable=False, server_default="clinical"),
        sa.Column("source_type", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("source_id", sa.Integer()),
        sa.Column("action_result", sa.String(2000), nullable=False, server_default=""),
        sa.Column("follow_up_at", sa.DateTime(timezone=True)),
        sa.Column("verification_status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("verification_comment", sa.String(2000), nullable=False, server_default=""),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("verified_by_id", sa.Integer(), sa.ForeignKey("users.id", name="fk_task_verifier")),
    ]:
        op.add_column("doctor_tasks", column)
    op.create_unique_constraint("uq_task_request", "doctor_tasks", ["doctor_id", "client_request_id"])


def downgrade():
    op.drop_constraint("uq_task_request", "doctor_tasks", type_="unique")
    for name in ["verified_by_id", "verified_at", "verification_comment", "verification_status", "follow_up_at",
                 "action_result", "source_id", "source_type", "kind", "assigned_to_id", "client_request_id"]:
        op.drop_column("doctor_tasks", name)
    op.drop_index("ix_treatment_status_changes_patient_id", table_name="treatment_status_changes")
    op.drop_table("treatment_status_changes")
    # PostgreSQL enum labels are retained on downgrade; existing user identities are never rewritten.
