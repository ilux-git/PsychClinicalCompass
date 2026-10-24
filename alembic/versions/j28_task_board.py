"""Task board stages and concurrent-edit revision.

Revision ID: j28_task_board
Revises: i27_participation_privacy
"""
from alembic import op
import sqlalchemy as sa

revision = "j28_task_board"
down_revision = "i27_participation_privacy"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("doctor_tasks", sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("doctor_tasks", sa.Column("started_at", sa.DateTime(timezone=True)))
    op.add_column("doctor_tasks", sa.Column("updated_at", sa.DateTime(timezone=True)))
    op.create_check_constraint("ck_task_stage", "doctor_tasks", "status IN ('open', 'in_progress', 'done')")


def downgrade():
    # Stage detail is lost on downgrade, but tasks and action history are retained.
    op.execute("UPDATE doctor_tasks SET status = 'open' WHERE status = 'in_progress'")
    op.drop_constraint("ck_task_stage", "doctor_tasks", type_="check")
    for name in ("updated_at", "started_at", "revision"):
        op.drop_column("doctor_tasks", name)
