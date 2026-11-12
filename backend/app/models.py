from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import String, Date, DateTime, ForeignKey, JSON, Numeric, Boolean, Integer, UniqueConstraint, BigInteger, Identity, Index
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc)


class Entity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)


class User(Entity, Base):
    __tablename__ = 'users'
    email: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    password: Mapped[str]


class Project(Entity, Base):
    __tablename__ = 'projects'
    code: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    description: Mapped[str] = mapped_column(default='')
    start_date: Mapped[datetime] = mapped_column(Date)
    end_date: Mapped[datetime] = mapped_column(Date)
    timezone: Mapped[str] = mapped_column(default='Europe/Moscow')
    archived: Mapped[bool] = mapped_column(default=False)
    demo_base_date: Mapped[datetime] = mapped_column(Date)


class Contractor(Entity, Base):
    __tablename__ = 'contractors'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    name: Mapped[str]


class Membership(Entity, Base):
    __tablename__ = 'memberships'
    __table_args__ = (UniqueConstraint('project_id', 'user_id'),)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    roles: Mapped[list] = mapped_column(JSON)
    contractor_id: Mapped[str | None] = mapped_column(ForeignKey('contractors.id'))


class Axis(Entity, Base):
    __tablename__ = 'axes'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    name: Mapped[str]
    path: Mapped[str]
    start_m: Mapped[int]
    end_m: Mapped[int]


class Work(Entity, Base):
    __tablename__ = 'works'
    __table_args__ = (UniqueConstraint('project_id', 'code'),)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    code: Mapped[str]
    title: Mapped[str]
    section: Mapped[str] = mapped_column(default='Основные работы')
    contractor_id: Mapped[str] = mapped_column(ForeignKey('contractors.id'))
    responsible_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    linear: Mapped[bool] = mapped_column(default=True)
    axis_id: Mapped[str | None] = mapped_column(ForeignKey('axes.id'))
    start_m: Mapped[int | None]
    end_m: Mapped[int | None]
    location: Mapped[str] = mapped_column(default='')
    start_date: Mapped[datetime] = mapped_column(Date)
    end_date: Mapped[datetime] = mapped_column(Date)
    actual_start: Mapped[datetime | None] = mapped_column(Date)
    actual_end: Mapped[datetime | None] = mapped_column(Date)
    unit: Mapped[str]
    planned: Mapped[float] = mapped_column(Numeric(14, 3))
    status: Mapped[str] = mapped_column(default='planned')
    version: Mapped[int] = mapped_column(default=1)
    archived: Mapped[bool] = mapped_column(default=False)


class Dependency(Entity, Base):
    __tablename__ = 'dependencies'
    __table_args__ = (UniqueConstraint('predecessor', 'successor'),)
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    predecessor: Mapped[str] = mapped_column(ForeignKey('works.id'))
    successor: Mapped[str] = mapped_column(ForeignKey('works.id'))


class Equipment(Entity, Base):
    __tablename__ = 'equipment'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    contractor_id: Mapped[str] = mapped_column(ForeignKey('contractors.id'))
    name: Mapped[str]
    inventory: Mapped[str]
    axis_id: Mapped[str] = mapped_column(ForeignKey('axes.id'))
    sim_state: Mapped[str] = mapped_column(default='stopped')
    sim_step: Mapped[int] = mapped_column(default=0)


class Camera(Entity, Base):
    __tablename__ = 'cameras'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    equipment_id: Mapped[str] = mapped_column(ForeignKey('equipment.id'))
    name: Mapped[str]
    available: Mapped[bool] = mapped_column(default=True)


class Point(Entity, Base):
    __tablename__ = 'points'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    equipment_id: Mapped[str] = mapped_column(ForeignKey('equipment.id'))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    latitude: Mapped[float]
    longitude: Mapped[float]
    offset_m: Mapped[int]
    source: Mapped[str] = mapped_column(default='simulated')


class Media(Entity, Base):
    __tablename__ = 'media'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    author_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    camera_id: Mapped[str | None] = mapped_column(ForeignKey('cameras.id'))
    name: Mapped[str]
    content_type: Mapped[str]
    size: Mapped[int]
    key: Mapped[str] = mapped_column(unique=True)
    checksum: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration: Mapped[float | None]
    source: Mapped[str] = mapped_column(default='uploaded')
    contractor_visible: Mapped[bool] = mapped_column(default=False)
    archived: Mapped[bool] = mapped_column(default=False)


class Inspection(Entity, Base):
    __tablename__ = 'inspections'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    work_id: Mapped[str] = mapped_column(ForeignKey('works.id'))
    author_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    start_m: Mapped[int | None]
    end_m: Mapped[int | None]
    outcome: Mapped[str]
    reason: Mapped[str] = mapped_column(default='')
    comment: Mapped[str] = mapped_column(default='')
    proposed: Mapped[float] = mapped_column(Numeric(14, 3), default=0)
    materials: Mapped[list] = mapped_column(JSON, default=list)
    previous_id: Mapped[str | None] = mapped_column(ForeignKey('inspections.id'))


class Progress(Entity, Base):
    __tablename__ = 'progress'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    work_id: Mapped[str] = mapped_column(ForeignKey('works.id'))
    inspection_id: Mapped[str | None] = mapped_column(ForeignKey('inspections.id'), unique=True)
    author_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    delta: Mapped[float] = mapped_column(Numeric(14, 3))
    reason: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Remark(Entity, Base):
    __tablename__ = 'remarks'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    work_id: Mapped[str] = mapped_column(ForeignKey('works.id'))
    inspection_id: Mapped[str | None] = mapped_column(ForeignKey('inspections.id'))
    author_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    responsible_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    start_m: Mapped[int | None]
    end_m: Mapped[int | None]
    title: Mapped[str]
    due_date: Mapped[datetime] = mapped_column(Date)
    status: Mapped[str] = mapped_column(default='open')
    replies: Mapped[list] = mapped_column(JSON, default=list)


class Audit(Entity, Base):
    __tablename__ = 'audit'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    author_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    action: Mapped[str]
    entity_id: Mapped[str]
    entity_type: Mapped[str]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(default='')
    inspection_id: Mapped[str | None]


class TraceSession(Entity, Base):
    __tablename__ = 'trace_sessions'
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    label: Mapped[str] = mapped_column(default='Рабочая сессия')
    mode: Mapped[str] = mapped_column(default='human')
    initial_state: Mapped[dict] = mapped_column(JSON)
    initial_view: Mapped[dict] = mapped_column(JSON, default=dict)


class TraceEvent(Entity, Base):
    __tablename__ = 'trace_events'
    __table_args__ = (Index('ix_trace_session_order', 'session_id', 'ordinal'),)
    ordinal: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    session_id: Mapped[str] = mapped_column(ForeignKey('trace_sessions.id'))
    project_id: Mapped[str] = mapped_column(ForeignKey('projects.id'))
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    client_seq: Mapped[int | None]
    action_id: Mapped[str | None]
    origin: Mapped[str]
    kind: Mapped[str]
    client_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    observation: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)
