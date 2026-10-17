"""本組只用 PostgreSQL 報表資料，不啟動語音、向量索引或 Redis。"""

import datetime as dt
import re
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.db import SEMANTIC_LAYER, database_url, get_session
from app.main import app
from app.models import AppSetting, AppUser, Base, Customer, OrgUnit, Place, Product, ProductPhoto, PublicOutlet, OutletStorefront, Receivable, SalesTransaction, UserReportConfig, Visit


@pytest.fixture(autouse=True)
def _clear_route_lines():
    # 此組報表 API 不使用路線或 Redis；覆寫父層無關的路線快取清理。
    yield


@pytest.fixture(scope="session")
def interaction_engine():
    base = make_url(database_url())
    name = f"meddemo_report_interactions_{uuid.uuid4().hex[:12]}"
    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.exec_driver_sql(f'CREATE DATABASE "{name}"')
    engine = create_engine(base.set(database=name))
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS ltree")
        tables = [model.__table__ for model in (AppSetting, OrgUnit, Place, AppUser, Product, ProductPhoto, Customer, PublicOutlet, OutletStorefront, SalesTransaction, Receivable, Visit, UserReportConfig)]
        Base.metadata.create_all(engine, tables=tables)
        today_function = re.search(r"CREATE FUNCTION app_today\(\).*?\$\$;", SEMANTIC_LAYER.read_text(), re.S)
        assert today_function is not None
        with engine.begin() as conn:
            conn.exec_driver_sql(today_function.group())
            # 升級商品 View 會授權給此角色；本組不跑完整 seed，須自行補齊，不能依賴其他測試先建立。
            # 角色由整個 PostgreSQL 叢集共用，已有角色時保留原本的設定與權限。
            conn.exec_driver_sql("""DO $$ BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'semantic_reader') THEN
                    CREATE ROLE semantic_reader NOLOGIN;
                END IF;
            END $$;""")
        yield engine
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


def seed_interaction_data(session):
    session.add(OrgUnit(id="TW", name="全國", kind="root"))
    session.flush()
    session.add(OrgUnit(id="TW.N", name="北區", kind="region", parent_id="TW"))
    session.flush()
    session.add(Place(id="TPE", name="臺北", unit_id="TW.N"))
    session.add_all([AppUser(id=name, name=name, role="manager", region="北區", unit_id="TW.N", org_path=f"TW.N.{name}") for name in ("M1", "M2")])
    session.flush()
    session.add_all([AppUser(id=name, name=name, role="sales", region="北區", manager_id=manager, org_path=f"TW.N.{manager}.{name}") for name, manager in (("S1", "M1"), ("S2", "M1"), ("S3", "M2"))])
    session.add_all([Product(sku=name, name=name, category="測試", spec="盒", unit="盒", unit_price=100, unit_cost=40) for name in ("P1", "P2")])
    session.add(AppSetting(key="as_of_date", value="2031-04-17"))
    session.flush()
    for name, owner, kind in (("C1", "S1", "clinic"), ("C2", "S2", "independent"), ("C3", "S3", "chain"), ("C4", "S1", "chain")):
        session.add(Customer(id=name, name=name, type=kind, chain_group="連鎖" if kind == "chain" else None, region="北區", city="臺北", place_id="TPE", grade="A", owner_user_id=owner, area="中正", lat=25, lng=121, payment_term="RM06"))
    session.flush()
    for index, (customer, date, amount, sku) in enumerate((
        ("C1", "2031-01-15", 100, "P1"), ("C1", "2031-04-17", 400, "P1"),
        ("C2", "2031-01-15", 300, "P1"), ("C2", "2031-04-03", 700, "P1"),
        ("C3", "2031-04-03", 900, "P1"), ("C4", "2031-04-10", 250, "P2"),
    )):
        session.add(SalesTransaction(order_no=f"O{index}", customer_id=customer, date=dt.date.fromisoformat(date), sku=sku, qty=1, amount=amount, cost=amount / 2, listing_fee=0, channel_reward=0))
    session.flush()


@pytest.fixture
def interaction_session(interaction_engine):
    with interaction_engine.connect() as conn:
        outer = conn.begin()
        with Session(bind=conn, join_transaction_mode="create_savepoint") as session:
            seed_interaction_data(session)

            def request_session():
                with Session(bind=conn, join_transaction_mode="create_savepoint") as request:
                    yield request

            app.dependency_overrides[get_session] = request_session
            try:
                yield session
            finally:
                app.dependency_overrides.pop(get_session, None)
                outer.rollback()
