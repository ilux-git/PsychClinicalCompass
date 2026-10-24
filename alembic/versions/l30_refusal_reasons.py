"""Explicitly doctor-coded reasons for confirmed treatment refusal."""
from alembic import op
import sqlalchemy as sa

revision="l30_refusal_reasons"
down_revision="k29_demo_loyalty"
branch_labels=depends_on=None


def upgrade():
    op.add_column("treatment_status_changes",sa.Column("reason_category",sa.String(32)))
    op.create_check_constraint("ck_refusal_category","treatment_status_changes",
        "reason_category IS NULL OR reason_category IN ('financial','time','family','perceived_benefit','reported_discomfort','other','not_disclosed','unknown')")
    op.create_check_constraint("ck_refusal_category_status","treatment_status_changes","status = 'refused' OR reason_category IS NULL")


def downgrade():
    op.drop_constraint("ck_refusal_category_status","treatment_status_changes",type_="check")
    op.drop_constraint("ck_refusal_category","treatment_status_changes",type_="check")
    op.drop_column("treatment_status_changes","reason_category")
