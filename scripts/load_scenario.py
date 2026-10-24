"""Prepare isolated synthetic data and exercise authenticated concurrent role workflows.

Never resets a database. Seed requires empty *_load_test databases, a matching
run marker and a separate MIS fixture-owner connection; the application keeps SELECT-only MIS.
The run command refuses ordinary app targets before sending any workflow writes.
"""
import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import platform
import random
import subprocess
import sys
import time
from urllib.parse import urlsplit
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def load_environment():
    from app.core.config import get_settings
    settings = get_settings()
    if not settings.load_test_mode:
        raise ValueError('LOAD_TEST_MODE must be explicitly enabled')
    return settings


def dsn(url):
    return url.replace('postgresql+asyncpg://','postgresql://')


async def seed(args):
    import asyncpg
    settings = load_environment()
    if os.getenv('ALLOW_LOAD_TEST_SEED') != '1':
        raise ValueError('Explicit ALLOW_LOAD_TEST_SEED=1 required')
    mis_admin = os.environ['LOAD_MIS_ADMIN_DATABASE_URL']
    admin_target, reader_target = urlsplit(mis_admin), urlsplit(settings.mis_database_url)
    if (admin_target.hostname,admin_target.port,admin_target.path) != (reader_target.hostname,reader_target.port,reader_target.path):
        raise ValueError('MIS fixture owner and application reader must target the same isolated database')
    connection = await asyncpg.connect(dsn(settings.compass_database_url))
    try:
        if await connection.fetchval("SELECT to_regclass('public.users')"):
            raise ValueError('Refusing to seed a nonempty schema; use new isolated databases')
    finally: await connection.close()
    result = subprocess.run([sys.executable,'-m','alembic','upgrade','head'],cwd=ROOT,capture_output=True)
    if result.returncode: raise RuntimeError('Load database migrations failed; no fixture reset attempted')
    from app.core.security import hash_password
    from app.db.demo_data import BARRIER_QUESTIONS
    from app.modules.assessments.service import score_answers
    now = datetime.now(timezone.utc)
    password_hash = hash_password('synthetic-load-only-password')
    count, doctors = args.patients, 20
    users = [(i+1,f'load_doctor_{i+1}',f'Нагрузочный врач {i+1}','doctor',password_hash,'available') for i in range(doctors)]
    users += [(21,'load_admin','Нагрузочный аналитик','admin',password_hash,'offline'),
              (22,'load_coordinator','Нагрузочный координатор','coordinator',password_hash,'offline')]
    users += [(1000+i,f'load_patient_{i}',f'Нагрузочный пациент {i:04d}','patient',password_hash,'offline') for i in range(1,count+1)]
    source = json.loads((ROOT/'app/modules/integration/fixtures/mis_v1.json').read_text(encoding='utf-8'))
    originals = source['patients']; source['patients'] = []
    for i in range(1,count+1):
        fixture = json.loads(json.dumps(originals[(i-1)%len(originals)]))
        fixture['mis_id'] = i
        source['patients'].append(fixture)
    fixture_path = Path(os.environ['SYNTHETIC_MIS_FIXTURE_PATH']).resolve()
    if fixture_path.exists(): raise ValueError('Fixture path already exists; refusing overwrite')
    fixture_path.parent.mkdir(parents=True,exist_ok=True)
    fixture_path.write_text(json.dumps(source,ensure_ascii=False),encoding='utf-8')
    connection = await asyncpg.connect(dsn(settings.compass_database_url))
    try:
        async with connection.transaction():
            await connection.copy_records_to_table('users',records=users,columns=['id','username','display_name','role','hashed_password','availability'])
            await connection.copy_records_to_table('patients',records=[(i,i,f'Нагрузочный пациент {i:04d}',(i-1)%doctors+1,1000+i) for i in range(1,count+1)],columns=['id','mis_id','full_name','doctor_id','user_id'])
            await connection.copy_records_to_table('patient_mappings',records=[(i,i) for i in range(1,count+1)],columns=['compass_patient_id','mis_id'])
            await connection.copy_records_to_table('surveys',records=[(i,i,'Нагрузочный опрос','Синтетические вопросы для проверки работы', 'barriers',json.dumps(BARRIER_QUESTIONS),1,now-timedelta(days=10)) for i in range(1,doctors+1)],columns=['id','doctor_id','title','description','purpose','questions','version','published_at'])
            assignments = [(i,(i-1)%doctors+1,i,str(uuid4()),now+timedelta(days=2), 'assigned', now-timedelta(days=3)) for i in range(1,count+1)]
            await connection.copy_records_to_table('survey_assignments',records=assignments,columns=['id','survey_id','patient_id','client_request_id','due_at','status','created_at'])
            responses = []
            for i in range(1,count+1):
                for form,length in [('phq9',9),('gad7',7)]:
                    for day in range(5):
                        answers = [((i+day)%3)]*length
                        scored = score_answers(form,answers)
                        responses.append((i,str(uuid4()),form,'load_numeric_v1',json.dumps(answers),scored.score,json.dumps(scored.risk_flags),now-timedelta(days=28-day*7)))
            await connection.copy_records_to_table('questionnaire_responses',records=responses,columns=['patient_id','client_request_id','form_type','form_version','answers','score','risk_flags','created_at'])
            await connection.copy_records_to_table('doctor_tasks',records=[(i,(i-1)%doctors+1,(i-1)%doctors+1,'Нагрузочная задача','clinical', 'manual',('open','in_progress','done')[i%3], 'Синтетическое выполненное действие' if i%3 == 2 else '') for i in range(1,count+1)],columns=['patient_id','doctor_id','assigned_to_id','title','kind','source_type','status','action_result'])
            await connection.execute("INSERT INTO privacy_policy_changes(actor_id,client_request_id,min_group_size,reason) VALUES (21,$1,5,'Изолированная синтетическая нагрузка')",str(uuid4()))
            # Explicit IDs must not collide with subsequent API inserts.
            for table in ('users','patients','surveys','survey_assignments'):
                await connection.execute(f"SELECT setval(pg_get_serial_sequence('{table}','id'),(SELECT max(id) FROM {table}))")
    finally: await connection.close()
    connection = await asyncpg.connect(dsn(mis_admin))
    try:
        if await connection.fetchval("SELECT to_regclass('public.patients')"):
            raise ValueError('MIS fixture table already exists; refusing to overwrite')
        reader = urlsplit(settings.mis_database_url).username
        if not reader or not reader.replace('_','').isalnum(): raise ValueError('Unsupported reader role name')
        async with connection.transaction():
            await connection.execute("CREATE TABLE patients(id BIGSERIAL PRIMARY KEY,full_name varchar(255) NOT NULL,diagnoses jsonb NOT NULL,prescriptions jsonb NOT NULL)")
            await connection.copy_records_to_table('patients',records=[(i,f'Нагрузочный пациент {i:04d}',json.dumps(['SYNTHETIC-LOAD']),json.dumps(['Синтетическое назначение'])) for i in range(1,count+1)],columns=['id','full_name','diagnoses','prescriptions'])
            await connection.execute(f'GRANT USAGE ON SCHEMA public TO "{reader}"; GRANT SELECT ON patients TO "{reader}"')
    finally: await connection.close()
    reader = await asyncpg.connect(dsn(settings.mis_database_url))
    try:
        assert await reader.fetchval("SELECT has_table_privilege(current_user,'patients','SELECT')")
        assert not await reader.fetchval("SELECT has_table_privilege(current_user,'patients','INSERT')")
        assert not await reader.fetchval("SELECT has_table_privilege(current_user,'patients','UPDATE')")
    finally: await reader.close()
    manifest = {'run_id':settings.load_test_run_id,'synthetic':True,'patients':count,'doctors':doctors,
                'source_fixture_sha256':sha256(fixture_path.read_bytes()).hexdigest(), 'created_at':now.isoformat(),
                'mis_application_read_only_verified':True,'authenticated_user_model':'patient user ID = 1000 + patient ID; doctor IDs 1..20; analyst 21'}
    args.manifest.parent.mkdir(parents=True,exist_ok=True)
    args.manifest.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    print(json.dumps(manifest),flush=True)


def percentile(values,fraction):
    return round(sorted(values)[max(0, math.ceil(len(values)*fraction)-1)],3) if values else None


async def run(args):
    import httpx
    from app.core.security import create_access_token
    settings = load_environment()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    if manifest['run_id'] != settings.load_test_run_id: raise ValueError('Manifest/run marker mismatch')
    if args.users > manifest['patients']: raise ValueError('Not enough distinct patient identities in the fixture')
    stats, statuses, errors = defaultdict(list), defaultdict(Counter), Counter()
    active, inflight, peaks = 0, 0, {'active_users':0,'inflight_requests':0}
    rng = random.Random(42)
    durations = []
    limits = httpx.Limits(max_connections=args.users+50,max_keepalive_connections=args.users+50)
    async with httpx.AsyncClient(base_url=args.base_url,limits=limits,timeout=20,follow_redirects=False) as client:
        context = await client.get('/_load-test/context')
        if context.status_code != 200 or context.json().get('run_id') != manifest['run_id']:
            raise ValueError('Target is not the matching isolated load-test API; no workflow writes sent')
        async def request(label,method,path,token,body=None):
            nonlocal inflight
            inflight += 1; peaks['inflight_requests'] = max(peaks['inflight_requests'],inflight)
            start = time.perf_counter()
            try:
                response = await client.request(method,path,headers={'Authorization':'Bearer '+token},json=body)
                statuses[label][str(response.status_code)] += 1
                if response.status_code >= 400: errors[label] += 1
            except httpx.HTTPError:
                errors[label] += 1; statuses[label]['transport_error'] += 1
            finally:
                stats[label].append((time.perf_counter()-start)*1000); inflight -= 1
        starts_at = time.perf_counter()
        end = starts_at+args.ramp+args.duration
        async def patient_vu(index):
            nonlocal active
            await asyncio.sleep(args.ramp*index/args.users)
            active += 1; peaks['active_users'] = max(peaks['active_users'],active)
            token = create_access_token(1000+index,'patient')
            steps = [('assignments','GET','/survey-assignments',None),
                     ('points','GET','/participation/points',None),
                     ('history','GET',f'/patients/{index}/assessments',None),
                     ('medications','GET',f'/patients/{index}/medications',None),
                     ('diary_write','POST','/diary/entries','diary'),
                     ('message_outbox','POST',f'/conversations/{index}/messages','message')]
            cycle = index % len(steps)
            while time.perf_counter() < end:
                label,method,path,kind = steps[cycle % len(steps)]
                payload = ({'text':'Синтетическая нагрузочная запись','client_request_id':str(uuid4())} if kind == 'diary' else
                           {'text':'Синтетическое сообщение нагрузки','channel':'tg_patient','client_request_id':str(uuid4())} if kind == 'message' else None)
                await request(label,method,path,token,payload)
                cycle += 1
                await asyncio.sleep(args.think*(.8+.4*rng.random()))
            active -= 1
        async def doctor_vu(index):
            nonlocal active
            await asyncio.sleep(args.ramp)
            active += 1; peaks['active_users'] = max(peaks['active_users'],active)
            token = create_access_token(index,'doctor'); iteration = index
            paths = [('directory','/patients/directory'),('task_board','/coordination/board?stage=open'),
                     ('doctor_care','/analytics/care'),('doctor_engagement','/analytics/engagement')]
            while time.perf_counter() < end:
                label,path = paths[iteration%len(paths)]
                await request(label,'GET',path,token); iteration += 1
                await asyncio.sleep(args.think)
            active -= 1
        async def analyst_vu():
            nonlocal active
            await asyncio.sleep(args.ramp)
            active += 1; peaks['active_users'] = max(peaks['active_users'],active)
            token = create_access_token(21,'admin')
            while time.perf_counter() < end:
                await request('clinic_analytics','GET','/analytics/clinic',token)
                await asyncio.sleep(max(1,args.think))
            active -= 1
        print(f"RUN {args.users} distinct patient sessions + 20 doctors + 1 analyst, {args.duration}s steady state",flush=True)
        await asyncio.gather(*[patient_vu(i) for i in range(1,args.users+1)],*[doctor_vu(i) for i in range(1,21)],analyst_vu())
        wall = time.perf_counter()-starts_at
    all_times = [v for values in stats.values() for v in values]
    report = {'run_id':manifest['run_id'],'verified_at':datetime.now(timezone.utc).isoformat(),'synthetic':True,
        'source_fixture_sha256':manifest['source_fixture_sha256'],'python':platform.python_version(),'platform':platform.platform(),
        'patient_sessions':args.users,'doctor_sessions':20,'analyst_sessions':1,'peaks':peaks,
        'ramp_seconds':args.ramp,'steady_seconds':args.duration,'think_seconds':args.think,'wall_seconds':round(wall,3),
        'scope':'Authenticated HTTP workflows; excludes login burst and 1000 rendered browsers. Includes client scheduling and connection latency.',
        'requests':len(all_times),'requests_per_second':round(len(all_times)/wall,2),'errors':sum(errors.values()),
        'latency_ms':{'p50':percentile(all_times,.5),'p95':percentile(all_times,.95),'p99':percentile(all_times,.99),'maximum':round(max(all_times),3)},
        'limit_ms':500,'all_requests_within_limit':all(v<=500 for v in all_times),
        'operations':[{ 'operation':label,'requests':len(values),'errors':errors[label],'statuses':dict(statuses[label]),
            'p50_ms':percentile(values,.5),'p95_ms':percentile(values,.95),'p99_ms':percentile(values,.99),'max_ms':round(max(values),3),
            'over_500ms':sum(v>500 for v in values)} for label,values in stats.items()]}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='operations'},ensure_ascii=True),flush=True)
    return report['errors'] == 0 and report['all_requests_within_limit']


async def export_k6_users(args):
    import asyncpg
    from app.core.security import create_access_token
    settings = load_environment()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    if not settings.load_test_mode or settings.load_test_run_id != manifest['run_id']:
        raise ValueError('Isolated load mode and matching manifest required')
    target = args.output.resolve()
    if target.exists() or not any(target.is_relative_to(ROOT / name) for name in ('work','outputs')):
        raise ValueError('Use a new ignored work/ or outputs/ file for test credentials')
    connection = await asyncpg.connect(dsn(settings.compass_database_url))
    try:
        patients = await connection.fetch("SELECT u.id,p.id AS patient_id FROM users u JOIN patients p ON p.user_id=u.id "
                                          "WHERE u.username LIKE 'load_patient_%' ORDER BY p.id")
        doctors = await connection.fetch("SELECT id FROM users WHERE username LIKE 'load_doctor_%' ORDER BY id")
        analyst = await connection.fetchval("SELECT id FROM users WHERE username='load_admin' AND role='admin'")
    finally:
        await connection.close()
    if len(patients)!=1000 or len(doctors)!=20 or analyst is None:
        raise ValueError('Expected the complete isolated 1000/20/1 fixture')
    users = [{'role':'patient','patient_id':row['patient_id'],'token':create_access_token(row['id'],'patient')} for row in patients]
    users += [{'role':'doctor','token':create_access_token(row['id'],'doctor')} for row in doctors]
    users.append({'role':'admin','token':create_access_token(analyst,'admin')})
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(users),encoding='utf-8')
    print('Temporary tokens exported to ignored file; no credentials printed',flush=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['seed','run','export-k6-users'])
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--patients',type=int,default=1000)
    parser.add_argument('--users',type=int,default=1000)
    parser.add_argument('--duration',type=float,default=60)
    parser.add_argument('--ramp',type=float,default=10)
    parser.add_argument('--think',type=float,default=1)
    parser.add_argument('--base-url',default='http://127.0.0.1:8791')
    parser.add_argument('--output',type=Path,default=ROOT/'outputs/load-test/report.json')
    args=parser.parse_args()
    if not 1<=args.users<=1000 or not 1<=args.patients<=1000 or not 5<=args.duration<=600 or not 0<=args.ramp<=120 or not .1<=args.think<=30:
        parser.error('Invalid bounded workload parameters')
    try:
        result=asyncio.run(seed(args) if args.command=='seed' else export_k6_users(args) if args.command=='export-k6-users' else run(args))
    except Exception as exc:
        print(f'Load scenario stopped: {type(exc).__name__}. No credentials or response bodies are printed.',file=sys.stderr)
        raise SystemExit(1)
    if args.command=='run' and not result: raise SystemExit(2)


if __name__=='__main__': main()
