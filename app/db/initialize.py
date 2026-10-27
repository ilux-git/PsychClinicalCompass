"""Single migration/seed owner. Compose waits for this before API and worker."""
import asyncio

from alembic import command
from alembic.config import Config


def main() -> None:
    command.upgrade(Config('alembic.ini'), 'head')
    # Import after migration and before starting a separate event loop.
    from app.db.seed import seed_demo
    from app.db.seed_aviandr import seed_scenarios
    from app.modules.assessments.scenarios import scenario_catalog
    from app.db.session import dispose_engines, async_session_compass
    from types import SimpleNamespace
    async def populate() -> None:
        try:
            await seed_demo()
            sources=[SimpleNamespace(id=case["mis_id"],full_name=case["full_name"],diagnoses=case["diagnoses"])
                     for case in scenario_catalog()["cases"]]
            async with async_session_compass() as session,session.begin():
                await seed_scenarios(session,sources,apply=True)
        finally:
            await dispose_engines()
    asyncio.run(populate())
    print('Synthetic demo ready; migration and seed complete')


if __name__ == '__main__':
    main()
