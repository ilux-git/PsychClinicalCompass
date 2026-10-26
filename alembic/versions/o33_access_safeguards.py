"""Durable login budgets and per-credential access-token revocation."""
from alembic import op
import sqlalchemy as sa

revision = "o33_access_safeguards"
down_revision = "n32_patient_survey_drafts"
branch_labels = depends_on = None


def upgrade():
    op.create_table("revoked_access_tokens",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index("ix_revoked_access_tokens_expires_at", "revoked_access_tokens", ["expires_at"])
    op.create_table("auth_login_buckets",
        sa.Column("bucket_key", sa.String(64), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("attempts >= 1", name="ck_auth_login_bucket_attempts"))


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM revoked_access_tokens WHERE expires_at > CURRENT_TIMESTAMP)")):
        raise RuntimeError("Active token revocations exist; preserve them and fix forward")
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM auth_login_buckets)")):
        raise RuntimeError("Login guard state exists; reconcile it before a security-weakening downgrade")
    op.drop_table("auth_login_buckets")
    op.drop_index("ix_revoked_access_tokens_expires_at", table_name="revoked_access_tokens")
    op.drop_table("revoked_access_tokens")
