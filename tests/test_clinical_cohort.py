from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.modules.assessments.catalog import GAD7_KEY, PANIC_KEY, PHQ9_KEY
from app.modules.assessments.clinical_models import ClinicalResult
from app.modules.assessments.models import QuestionnaireResponse
from tests.test_clinical_instruments import assigned, values
from tests.test_clinical_review import complete, numeric_answers
from tests.test_coordinator_fallback import coordinators  # explicit additional roles fixture

PATH = '/analytics/clinical-instruments'


def edition(body, key):
    return next(item for item in body['instruments'] if item['key'] == key)


async def test_legacy_numeric_version_cannot_become_canonical_coverage_or_zero(client, headers, database):
    async with database() as session:
        session.add(QuestionnaireResponse(patient_id=1, form_type='phq9', form_version=PHQ9_KEY,
            answers=[3] * 9, score=27, risk_flags=[]))
        await session.commit()
    body = (await client.get(PATH, headers=headers('doctor'))).json()
    assert body['patients_total'] == 2 and not body['legacy_numeric_results_included']
    for item in body['instruments']:
        assert item['observed_patients'] == item['results'] == item['assigned_patients'] == 0
        assert item['coverage_percent'] is None and item['median_score'] is None
    directory = (await client.get('/patients/directory', headers=headers('doctor'))).json()['items']
    first = next(item for item in directory if item['id'] == 1)
    assert first['latest_clinical_result'] is None and first['last_observation_source'] == 'numeric_demo'


async def test_coverage_counts_patients_once_and_statistics_use_only_the_latest_same_edition(client, headers):
    await complete(client, headers, PHQ9_KEY, numeric_answers(0))
    first = edition((await client.get(PATH, headers=headers('doctor'))).json(), PHQ9_KEY)
    assert first['median_score'] == first['minimum_score'] == first['maximum_score'] == 0
    assert first['observed_patients'] == first['assigned_patients'] == 1
    await complete(client, headers, PHQ9_KEY, numeric_answers(16))
    await assigned(client, headers, PHQ9_KEY, 3)  # assignment without a response is unknown, not zero
    await complete(client, headers, GAD7_KEY, values(7, 1), patient_id=3)
    body = (await client.get(PATH, headers=headers('doctor'))).json()
    phq, gad = edition(body, PHQ9_KEY), edition(body, GAD7_KEY)
    assert phq['assigned_patients'] == 2 and phq['assignments'] == 3
    assert phq['observed_patients'] == 1 and phq['results'] == 2 and phq['repeat_patients'] == 1
    assert all(type(phq[field]) is int for field in ('assigned_patients', 'assignments', 'unanswered_assignments', 'observed_patients', 'results', 'repeat_patients'))
    assert phq['coverage_percent'] == 50 and phq['unanswered_assignments'] == 1
    assert phq['median_score'] == phq['minimum_score'] == phq['maximum_score'] == 16
    assert phq['patients_without_results'] == 1 and phq['baseline_selected_patients'] == 0
    assert phq['latest_review']['urgent_review'] == 1 and sum(phq['latest_review'].values()) == 1
    assert gad['median_score'] == 7 and gad['repeat_patients'] == 0
    assert gad['baseline_selected_patients'] is None and gad['observed_patients'] == 1


async def test_panic_has_no_numeric_median_and_a_historic_missing_rule_is_not_a_negative_result(client, headers, database):
    await complete(client, headers, PANIC_KEY, {'q1': 'n0'})
    async with database() as session:
        row = await session.scalar(select(ClinicalResult))
        row.result = {key: value for key, value in row.result.items() if key != 'triage'}
        await session.commit()
    item = edition((await client.get(PATH, headers=headers('doctor'))).json(), PANIC_KEY)
    assert item['median_score'] is None and item['numeric_latest_patients'] == 0
    assert item['criterion'] == {'met': 0, 'not_met': 1, 'unknown': 0}
    assert item['latest_review']['not_calculated'] == 1 and item['latest_review']['no_signal'] == 0
    latest = (await client.get('/patients/directory', headers=headers('doctor'))).json()['items'][0]['latest_clinical_result']
    assert latest['score'] is None and latest['maximum'] is None and latest['criterion_met'] is False


async def test_cohort_and_search_keep_doctor_scope_and_do_not_expand_administrator_or_coordinator_access(client, headers, coordinators):
    await complete(client, headers, PHQ9_KEY, numeric_answers(4))
    other_headers = lambda name: headers('doctor2' if name == 'doctor' else name)
    await complete(client, other_headers, PHQ9_KEY, numeric_answers(21), patient_id=2)
    own = (await client.get(PATH, headers=headers('doctor'))).json()
    other = (await client.get(PATH, headers=headers('doctor2'))).json()
    assert own['patients_total'] == 2 and edition(own, PHQ9_KEY)['median_score'] == 4
    assert other['patients_total'] == 1 and edition(other, PHQ9_KEY)['median_score'] == 21
    for role in ('patient1', 'admin', 'coordinator'):
        assert (await client.get(PATH, headers=headers(role))).status_code == 403
    searched = (await client.get(PATH + '?q=Иван', headers=headers('doctor'))).json()
    assert searched['patients_total'] == 1 and searched['search'] == 'Иван'
    for text in ('Мария', '%', '_'):
        body = (await client.get(PATH, params={'q': text}, headers=headers('doctor'))).json()
        assert body['patients_total'] == 0 and all(item['median_score'] is None for item in body['instruments'])
    assert (await client.get(PATH, params={'q': 'a' * 101}, headers=headers('doctor'))).status_code == 422


async def test_directory_shows_new_canonical_zero_and_preserves_later_legacy_provenance(client, headers, database):
    await complete(client, headers, PHQ9_KEY, numeric_answers(0))
    current = (await client.get('/patients/directory', headers=headers('doctor'))).json()['items'][0]
    assert current['last_observation_source'] == 'canonical_clinical'
    assert current['latest_clinical_result']['score'] == 0 and current['latest_clinical_result']['maximum'] == 27
    assert current['last_observation_at'] == current['latest_clinical_result']['created_at']
    assert 'Золотар' in current['latest_clinical_result']['version']
    async with database() as session:
        point = await session.scalar(select(ClinicalResult))
        point.created_at = datetime.now(timezone.utc) - timedelta(hours=2)
        session.add(QuestionnaireResponse(patient_id=1, form_type='gad7', form_version='numeric_demo', answers=[1] * 7,
            score=7, risk_flags=[], created_at=datetime.now(timezone.utc) - timedelta(hours=1)))
        await session.commit()
    later = (await client.get('/patients/directory', headers=headers('doctor'))).json()['items'][0]
    assert later['last_observation_source'] == 'numeric_demo'
    assert later['latest_clinical_result']['score'] == 0 and later['latest_clinical_result']['instrument_key'] == PHQ9_KEY
    assert later['last_observation_at'] != later['latest_clinical_result']['created_at']
    # Patients' base directory remains their own identity-only contract.
    patient = (await client.get('/patients', headers=headers('patient1'))).json()
    assert len(patient) == 1 and 'latest_clinical_result' not in patient[0]
