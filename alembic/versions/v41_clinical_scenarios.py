"""Link immutable case episodes to the existing physician-review workflow."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "v41_clinical_scenarios"
down_revision = "v40_telegram_mini_app_access"
branch_labels = None
depends_on = None

OLD_SOURCE = "(source_kind = 'assessment' AND assessment_id IS NOT NULL AND message_id IS NULL AND clinical_result_id IS NULL) OR (source_kind = 'support_request' AND message_id IS NOT NULL AND assessment_id IS NULL AND clinical_result_id IS NULL) OR (source_kind = 'clinical_assessment' AND clinical_result_id IS NOT NULL AND assessment_id IS NULL AND message_id IS NULL)"
NEW_SOURCE = "(source_kind = 'assessment' AND assessment_id IS NOT NULL AND message_id IS NULL AND clinical_result_id IS NULL AND scenario_episode_id IS NULL) OR (source_kind = 'support_request' AND message_id IS NOT NULL AND assessment_id IS NULL AND clinical_result_id IS NULL AND scenario_episode_id IS NULL) OR (source_kind = 'clinical_assessment' AND clinical_result_id IS NOT NULL AND assessment_id IS NULL AND message_id IS NULL AND scenario_episode_id IS NULL) OR (source_kind = 'clinical_scenario' AND scenario_episode_id IS NOT NULL AND clinical_result_id IS NULL AND assessment_id IS NULL AND message_id IS NULL)"


def upgrade():
    op.create_table("clinical_scenario_episodes", sa.Column("id",sa.Integer(),primary_key=True),
        sa.Column("patient_id",sa.Integer(),sa.ForeignKey("patients.id"),nullable=False),
        sa.Column("message_id",sa.Integer(),sa.ForeignKey("messages.id"),nullable=True,unique=True),
        sa.Column("case_key",sa.String(80),nullable=False),sa.Column("step_key",sa.String(80),nullable=False),
        sa.Column("snapshot",postgresql.JSONB(),nullable=False),sa.Column("occurred_at",sa.DateTime(timezone=True),nullable=False),
        sa.Column("created_at",sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.UniqueConstraint("patient_id","case_key","step_key",name="uq_scenario_episode"))
    op.create_index("ix_clinical_scenario_episodes_patient_id","clinical_scenario_episodes",["patient_id"])
    op.add_column("alerts",sa.Column("scenario_episode_id",sa.Integer(),sa.ForeignKey("clinical_scenario_episodes.id",name="fk_alert_scenario_episode")))
    op.drop_constraint("ck_alert_source","alerts",type_="check")
    op.create_check_constraint("ck_alert_source","alerts",NEW_SOURCE)


def downgrade():
    connection=op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM clinical_scenario_episodes")):
        raise RuntimeError("Scenario history exists; destructive downgrade refused. Keep the forward schema for rollback.")
    op.drop_constraint("ck_alert_source","alerts",type_="check")
    op.create_check_constraint("ck_alert_source","alerts",OLD_SOURCE)
    op.drop_column("alerts","scenario_episode_id")
    op.drop_index("ix_clinical_scenario_episodes_patient_id",table_name="clinical_scenario_episodes")
    op.drop_table("clinical_scenario_episodes")
