import pytest
from pydantic import ValidationError

from app.modules.assessments.schemas import AssessmentCreate
from app.modules.assessments.service import score_answers
from app.modules.surveys.models import Survey
from app.modules.surveys.schemas import SurveyWrite
from app.modules.surveys.service import validate_answers
from app.db.demo_data import BARRIER_QUESTIONS
from fastapi import HTTPException


@pytest.mark.parametrize("form,answers,total,flags", [
    ("phq9", [0]*9, 0, []), ("phq9", [3]*9, 27, ["depression_risk", "phq9_item9_positive"]),
    ("phq9", [0]*8+[1], 1, ["phq9_item9_positive"]), ("gad7", [3]*7, 21, ["anxiety_risk"]),
    ("gad7", [3,3,3,0,0,0,0], 9, []), ("gad7", [3,3,3,1,0,0,0], 10, ["anxiety_risk"]),
])
def test_existing_scoring_boundaries(form, answers, total, flags):
    result = score_answers(form, answers)
    assert (result.score, result.risk_flags) == (total, flags)


@pytest.mark.parametrize("answers", [[0]*8, [4]*9, [-1]*9, [True]*9, [1.0]*9, ["1"]*9])
def test_invalid_clinical_answers(answers):
    with pytest.raises(ValidationError):
        AssessmentCreate(form_type="phq9", answers=answers)


def test_pure_scoring_also_validates():
    with pytest.raises(ValueError):
        score_answers("phq9", [1]*8)


def test_author_form_does_not_turn_into_clinical_score():
    survey = Survey(title="Барьер", doctor_id=1, purpose="barriers", questions=BARRIER_QUESTIONS, version=1)
    assert validate_answers(survey, {"barriers": ["cost"], "details": "  Слишком дорого  "}) == {
        "barriers": ["cost"], "details": "Слишком дорого"}
    with pytest.raises(HTTPException):
        validate_answers(survey, {"barriers": ["invented"]})
    with pytest.raises(HTTPException):
        validate_answers(survey, {"barriers": ["cost", "cost"]})
    with pytest.raises(HTTPException):
        validate_answers(survey, {"barriers": [], "private_extra": "x"})


def test_duplicate_question_ids_rejected():
    with pytest.raises(ValidationError):
        SurveyWrite(title="Test", questions=[BARRIER_QUESTIONS[0], BARRIER_QUESTIONS[0]])
