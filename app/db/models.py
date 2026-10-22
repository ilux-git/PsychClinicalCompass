"""Register domain models for migrations, the API and background workers."""
from app.modules.access.models import User, TelegramBinding
from app.modules.patients.models import Patient, PatientMapping
from app.modules.assessments.models import QuestionnaireResponse, OutboxEvent
from app.modules.messaging.models import Message
from app.modules.audit.models import AuditEvent
from app.modules.surveys.models import Survey, SurveyAssignment, SurveySubmission
from app.modules.adherence.models import AdherenceReport
from app.modules.alerts.models import Alert, ClinicalDecision
from app.modules.notes.models import DoctorNote, DoctorTask
