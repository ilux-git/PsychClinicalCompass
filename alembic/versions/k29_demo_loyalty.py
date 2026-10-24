"""Simulated discount coupons and voluntary presentation preferences."""
from alembic import op
import sqlalchemy as sa

revision = "k29_demo_loyalty"
down_revision = "j28_task_board"
branch_labels = depends_on = None


def upgrade():
    op.create_table("demo_loyalty_coupons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), nullable=False),
        sa.Column("client_request_id", sa.String(36), nullable=False),
        sa.Column("catalog_version", sa.String(40), nullable=False),
        sa.Column("offer_id", sa.String(32), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("discount_percent", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="issued"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("patient_id", "client_request_id", name="uq_demo_coupon_request"),
        sa.UniqueConstraint("code", name="uq_demo_coupon_code"),
        sa.CheckConstraint("status IN ('issued', 'cancelled')", name="ck_demo_coupon_status"),
        sa.CheckConstraint("points > 0 AND discount_percent > 0 AND discount_percent <= 100", name="ck_demo_coupon_value"))
    op.create_index("ix_demo_loyalty_coupons_patient_id", "demo_loyalty_coupons", ["patient_id"])
    op.create_table("participation_preferences",
        sa.Column("patient_id", sa.Integer(), sa.ForeignKey("patients.id"), primary_key=True),
        sa.Column("patient_choice", sa.String(16)),
        sa.Column("doctor_recommendation", sa.String(16)),
        sa.CheckConstraint("patient_choice IS NULL OR patient_choice IN ('map','rhythm','calm')", name="ck_patient_game_mode"),
        sa.CheckConstraint("doctor_recommendation IS NULL OR doctor_recommendation IN ('map','rhythm','calm')", name="ck_doctor_game_mode"))


def downgrade():
    op.drop_table("participation_preferences")
    op.drop_index("ix_demo_loyalty_coupons_patient_id", table_name="demo_loyalty_coupons")
    op.drop_table("demo_loyalty_coupons")
