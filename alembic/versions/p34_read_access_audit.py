"""Metadata-only access history for authenticated reads."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "p34_read_access_audit"
down_revision = "o33_access_safeguards"
branch_labels = depends_on = None


def upgrade():
    op.create_table("read_access_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("actor_role", sa.String(20), nullable=False),
        sa.Column("route", sa.String(200), nullable=False),
        sa.Column("resource_ids", JSONB(), nullable=False),
        sa.Column("http_status", sa.SmallInteger(), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("http_status BETWEEN 100 AND 599", name="ck_read_access_http_status"))
    op.create_index("ix_read_access_actor_created", "read_access_events", ["actor_id", "created_at"])


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM read_access_events)")):
        raise RuntimeError("Read-access history exists; preserve it and fix forward")
    op.drop_index("ix_read_access_actor_created", table_name="read_access_events")
    op.drop_table("read_access_events")
