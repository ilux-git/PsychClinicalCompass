"""Single migration/seed owner. Compose waits for this before API and worker."""
import asyncio

from alembic import command
from alembic.config import Config


def main() -> None:
    command.upgrade(Config('alembic.ini'), 'head')
    # Import after migration and before starting a separate event loop.
    from app.db.seed import seed_demo
    from app.db.session import dispose_engines
    async def populate() -> None:
        try:
            await seed_demo()
        finally:
            await dispose_engines()
    asyncio.run(populate())
    print('Synthetic demo ready; migration and seed complete')


if __name__ == '__main__':
    main()
