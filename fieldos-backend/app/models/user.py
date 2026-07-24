from datetime import datetime
from sqlalchemy import String, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import DateTime
from enum import Enum as PyEnum

from app.database import Base


class UserRole(str, PyEnum):
    FIELD_OFFICER = "field_officer"
    BRANCH_MANAGER = "branch_manager"
    AREA_MANAGER = "area_manager"
    ADMIN = "admin"


# --- Org matrix axes (PILOT_SCOPE_V2.md §2) -------------------------------
# `role` (above) stays the RBAC primitive auth_deps/security already depend on.
# These three axes are layered ORTHOGONALLY on top; department = kind of work,
# data_scope = reach, permission_set = capability. A single role enum can't
# express "reads across the whole org but manages no one" (audit) — hence this.

class Department(str, PyEnum):
    OPERATIONS = "operations"      # officers, branch managers — write the money loop
    AUDIT = "audit"               # monitoring — reads across all branches, flags, never edits
    ADMIN_IT = "admin_it"         # users/devices/config — walled off from financial data
    HEAD_OFFICE = "head_office"   # org-wide operational + strategic; launches feedback campaigns


class DataScope(str, PyEnum):
    OWN = "own"        # only own records
    BRANCH = "branch"  # everything in one branch
    REGION = "region"  # a region subtree (resolved via OrgUnit)
    ORG = "org"        # the whole institution (audit / head_office)


class PermissionSet(str, PyEnum):
    READ = "read"
    WRITE = "write"
    FLAG = "flag"    # can raise/escalate exceptions + feedback, but not edit financial data
    ADMIN = "admin"  # user/device/config administration


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    staff_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_ne: Mapped[str | None] = mapped_column(String(200), nullable=True)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default=UserRole.FIELD_OFFICER.value)
    hashed_pin: Mapped[str] = mapped_column(String(200), nullable=False)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    # --- Org matrix axes (see enums above + PILOT_SCOPE_V2.md §2) ---
    # Defaults keep every pre-existing row a valid operations/field user until backfilled.
    department: Mapped[str] = mapped_column(String(30), nullable=False, default=Department.OPERATIONS.value)
    data_scope: Mapped[str] = mapped_column(String(20), nullable=False, default=DataScope.OWN.value)
    # Comma-separated PermissionSet values (composable), e.g. "read,flag". Mirrors the
    # comma-separated `Branch.office_ip` convention already in the codebase.
    permission_set: Mapped[str] = mapped_column(String(60), nullable=False, default=PermissionSet.WRITE.value)
    # OPERATIONS reporting chain ONLY (officer -> branch_mgr -> region). Audit/HO get
    # scope-based access via OrgUnit, NOT a chain — leave this null for them.
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Which OrgUnit this user sits at (resolves region/org scope to a real subtree).
    org_unit_id: Mapped[int | None] = mapped_column(ForeignKey("org_units.id"), nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Face-verification enrollment (attendance clock-in — decision 2026-07-14).
    # Reference face embedding stored as a JSON array of floats, computed on-device
    # (MobileFaceNet). Used as a backup so a re-installed app can re-fetch the template;
    # verification itself happens on-device against the locally cached copy.
    face_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    face_enrolled_at: Mapped[str | None] = mapped_column(String(30), nullable=True)

    branch = relationship("Branch", back_populates="users")
    # Operations reporting chain (self-referential). `reports` = direct subordinates.
    manager = relationship("User", remote_side=[id], back_populates="reports")
    reports = relationship("User", back_populates="manager")
    org_unit = relationship("OrgUnit")
    devices = relationship("Device", back_populates="user")
    tasks = relationship("TaskAssignment", back_populates="assigned_user")
    eod_reports = relationship("EndOfDayReport", back_populates="officer")
