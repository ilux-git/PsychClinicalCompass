"""Index explicit support history and its event linkage without changing data."""
from alembic import op
import sqlalchemy as sa

revision = "u39_support_lookup_indexes"
down_revision = "t38_coordinator_fallback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Separate commits are required by PostgreSQL's concurrent index build.
    # A failed build must be inspected before retrying; never skip an invalid index.
    with op.get_context().autocommit_block():
        op.create_index("ix_alerts_message_id", "alerts", ["message_id"], postgresql_concurrently=True)
        op.create_index("ix_messages_patient_support_recent", "messages", ["patient_id", "id"],
                        postgresql_where=sa.text("support_requested IS TRUE"), postgresql_concurrently=True)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index("ix_messages_patient_support_recent", table_name="messages", postgresql_concurrently=True)
        op.drop_index("ix_alerts_message_id", table_name="alerts", postgresql_concurrently=True)
