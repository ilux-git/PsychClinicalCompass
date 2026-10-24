"""Private, revisioned working answers for assigned patient surveys."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "n32_patient_survey_drafts"
down_revision = "m31_explicit_support"
branch_labels = depends_on = None


def upgrade():
    op.create_table("survey_drafts",
        sa.Column("assignment_id", sa.Integer(), sa.ForeignKey("survey_assignments.id"), primary_key=True),
        sa.Column("answers", postgresql.JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_survey_draft_revision"))


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM survey_drafts)")):
        raise RuntimeError("Private survey drafts exist; export/reconcile them before a lossy downgrade")
    op.drop_table("survey_drafts")
