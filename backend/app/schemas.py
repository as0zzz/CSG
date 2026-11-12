from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Login(Input):
    email: str
    password: str


class ProjectInput(Input):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    description: str = ''
    start_date: date
    end_date: date


class MemberInput(Input):
    user_id: str = ''
    email: str = ''
    roles: list[Literal['ProjectAdmin', 'Planner', 'RemoteInspector', 'CustomerViewer', 'ContractorManager']]
    contractor_id: str | None = None


class WorkInput(Input):
    code: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=250)
    section: str = 'Основные работы'
    contractor_id: str
    responsible_id: str
    linear: bool = True
    axis_id: str | None = None
    start_m: int | None = Field(default=None, strict=True)
    end_m: int | None = Field(default=None, strict=True)
    location: str = ''
    start_date: date
    end_date: date
    actual_start: date | None = None
    actual_end: date | None = None
    unit: Literal['м', 'м³', 'м²', 'шт', 'т'] = 'м'
    planned: Decimal = Field(gt=0, max_digits=14, decimal_places=3, allow_inf_nan=False)
    status: Literal['planned', 'in_progress', 'suspended', 'completed'] = 'planned'
    version: int = 1
    archived: bool = False
    reason: str = ''


class DependencyInput(Input):
    predecessor: str
    successor: str


class MaterialLink(Input):
    id: str
    from_s: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    to_s: float | None = Field(default=None, ge=0, allow_inf_nan=False)


class InspectionInput(Input):
    work_id: str
    observed_at: datetime
    start_m: int | None = Field(default=None, strict=True)
    end_m: int | None = Field(default=None, strict=True)
    outcome: Literal['confirmed', 'deviation', 'inconclusive']
    reason: Literal['', 'needs_on_site_check', 'needs_clarification'] = ''
    comment: str = ''
    proposed: Decimal = Field(default=Decimal(0), ge=0, max_digits=14, decimal_places=3, allow_inf_nan=False)
    materials: list[MaterialLink] = Field(default_factory=list)
    previous_id: str | None = None


class ProgressInput(Input):
    delta: Decimal = Field(max_digits=14, decimal_places=3, allow_inf_nan=False)
    reason: str = Field(min_length=3, max_length=2000)


class ReasonInput(Input):
    reason: str = Field(min_length=3, max_length=2000)


class RemarkInput(Input):
    work_id: str
    inspection_id: str | None = None
    title: str = Field(min_length=3, max_length=2000)
    responsible_id: str
    start_m: int | None = Field(default=None, strict=True)
    end_m: int | None = Field(default=None, strict=True)
    due_date: date


class ReplyInput(Input):
    status: Literal['open', 'in_progress', 'resolved']
    text: str = Field(min_length=3, max_length=2000)


class EquipmentInput(Input):
    name: str = Field(min_length=1)
    inventory: str = Field(min_length=1)
    contractor_id: str
    axis_id: str


class CameraInput(Input):
    name: str = Field(min_length=1)
    equipment_id: str
    available: bool = True
