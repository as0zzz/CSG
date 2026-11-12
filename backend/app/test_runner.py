"""Run API tests in a new isolated PostgreSQL database, then drop only that DB."""
import os
import uuid
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url


def main():
    base = make_url(os.environ['DATABASE_URL'])
    name = 'aksg_test_' + uuid.uuid4().hex
    admin = create_engine(base.set(database='postgres'), isolation_level='AUTOCOMMIT')
    with admin.connect() as db:
        db.exec_driver_sql(f'CREATE DATABASE "{name}"')
    os.environ['DATABASE_URL'] = base.set(database=name).render_as_string(hide_password=False)
    try:
        from app.db import Base, engine
        from app import models  # noqa
        with engine.begin() as db:
            db.exec_driver_sql('CREATE EXTENSION IF NOT EXISTS postgis')
        Base.metadata.create_all(engine)
        from app.seed import seed
        seed()
        from app.plan_seed import seed_plan
        seed_plan()
        import pytest
        result = pytest.main(['-q', 'tests'])
    finally:
        from app.db import engine
        engine.dispose()
        # Name is generated above and cannot address a non-test database.
        assert name.startswith('aksg_test_') and name[10:].isalnum()
        with admin.connect() as db:
            db.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()
    raise SystemExit(result)


if __name__ == '__main__':
    main()
