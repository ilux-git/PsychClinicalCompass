import asyncio

from sqlalchemy import select

from app.core.security import create_access_token, hash_password
from app.db.session import async_session_compass
from app.modules.access.models import User, UserRole
from app.modules.patients.models import Patient

PATIENT_NAMES: list[str] = [
    "Ivan Petrov",
    "Maria Ivanova",
    "Alexander Sokolov",
    "Elena Kuznetsova",
    "Dmitry Volkov",
    "Olga Smirnova",
    "Nikolai Fedorov",
    "Anna Lebedeva",
    "Sergei Morozov",
    "Tatiana Romanova",
]

PASSWORDS: dict[UserRole, str] = {
    UserRole.admin: "admin-pass-123",
    UserRole.doctor: "doctor-pass-123",
    UserRole.patient: "patient-pass-123",
}


async def get_or_create_user(session, role: UserRole) -> tuple[User, bool]:
    result = await session.execute(select(User).where(User.role == role).limit(1))
    user = result.scalar_one_or_none()
    if user is not None:
        return user, False
    user = User(role=role, hashed_password=hash_password(PASSWORDS[role]))
    session.add(user)
    await session.flush()
    return user, True


async def main() -> None:
    async with async_session_compass() as session:
        admin, admin_created = await get_or_create_user(session, UserRole.admin)
        doctor, doctor_created = await get_or_create_user(session, UserRole.doctor)
        patient_user, patient_created = await get_or_create_user(session, UserRole.patient)

        result = await session.execute(select(Patient).order_by(Patient.id))
        patients = list(result.scalars())

        if not patients:
            patients = [
                Patient(mis_id=index + 1, full_name=name, doctor_id=doctor.id)
                for index, name in enumerate(PATIENT_NAMES)
            ]
            session.add_all(patients)
            await session.flush()

        linked = next((p for p in patients if p.user_id == patient_user.id), None)
        if linked is None:
            linked = next((p for p in patients if p.user_id is None), patients[0])
            linked.user_id = patient_user.id
        linked.doctor_id = doctor.id

        await session.commit()

        print("=== Clinical Compass seed ===")
        print(f"admin   id={admin.id} password={PASSWORDS[UserRole.admin]} created={admin_created}")
        print(f"doctor  id={doctor.id} password={PASSWORDS[UserRole.doctor]} created={doctor_created}")
        print(f"patient id={patient_user.id} password={PASSWORDS[UserRole.patient]} created={patient_created}")
        print(f"linked_patient_id={linked.id} mis_id={linked.mis_id}")
        print(f"patients_total={len(patients)} doctor_id={doctor.id}")
        print(f"TOKEN_ADMIN={create_access_token(admin.id, admin.role.value)}")
        print(f"TOKEN_DOCTOR={create_access_token(doctor.id, doctor.role.value)}")
        print(f"TOKEN_PATIENT={create_access_token(patient_user.id, patient_user.role.value)}")


if __name__ == "__main__":
    asyncio.run(main())
