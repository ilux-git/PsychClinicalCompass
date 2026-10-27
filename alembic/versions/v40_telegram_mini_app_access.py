"""Persistent Mini App access and account disabling; preserve existing links and users."""
from alembic import op
import sqlalchemy as sa

revision = 'v40_telegram_mini_app_access'
down_revision = 'u39_support_lookup_indexes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False))
    op.alter_column('telegram_bindings', 'telegram_chat_id', existing_type=sa.BigInteger(), nullable=True)


def downgrade() -> None:
    # A Mini App-only link has no confirmed bot chat. Do not invent chat IDs or silently delete these links.
    connection = op.get_bind()
    if connection.scalar(sa.text('SELECT count(*) FROM telegram_bindings WHERE telegram_chat_id IS NULL')):
        raise RuntimeError('Unlink Mini App-only accounts explicitly before downgrading; no links were deleted')
    if connection.scalar(sa.text('SELECT count(*) FROM users WHERE is_active IS FALSE')):
        raise RuntimeError('Disabled accounts cannot be represented by the old schema; downgrade refused')
    op.alter_column('telegram_bindings', 'telegram_chat_id', existing_type=sa.BigInteger(), nullable=False)
    op.drop_column('users', 'is_active')
