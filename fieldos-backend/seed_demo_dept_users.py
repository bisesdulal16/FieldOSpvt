"""Add demo Head-Office + Monitoring accounts to an EXISTING live DB.

Purpose: the live pilot DB has field/branch users but no audit/head_office
account, so the department-gated feedback views (Rollup, Campaigns) 403 for
everyone. This seeds a minimal HO org node + two org-wide demo accounts so
those views are demoable — WITHOUT touching existing pilot data.

Idempotent: re-running updates the same rows (matched by staff_id / code)
instead of duplicating. Run inside the backend container:

    docker exec fieldos-backend python seed_demo_dept_users.py

Demo logins (PIN 1234):
    HO-DEMO   — head_office, org-wide  (sees Rollup + creates Campaigns)
    MON-DEMO  — audit/monitoring, org-wide (sees Rollup, sees author identity)
"""
import asyncio
import logging

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.org_unit import OrgUnit, OrgUnitType
from app.models.user import User, Department, DataScope, PermissionSet
from app.services.auth_service import hash_pin

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _get_or_create_ho(s) -> OrgUnit:
    ho = (await s.execute(
        select(OrgUnit).where(OrgUnit.code == "000")
    )).scalar_one_or_none()
    if ho is None:
        ho = OrgUnit(type=OrgUnitType.HO.value, name="Head Office (demo)",
                     name_ne="प्रधान कार्यालय", code="000")
        s.add(ho)
        await s.flush()
        logger.info("Created HO org unit (code 000, id=%s)", ho.id)
    else:
        logger.info("HO org unit already present (id=%s)", ho.id)
    return ho


async def _upsert_user(s, *, staff_id, name, role, department, permission_set, org_unit_id):
    u = (await s.execute(
        select(User).where(User.staff_id == staff_id)
    )).scalar_one_or_none()
    if u is None:
        u = User(staff_id=staff_id, hashed_pin=hash_pin("1234"), is_active=True)
        s.add(u)
        logger.info("Creating %s", staff_id)
    else:
        logger.info("Updating existing %s", staff_id)
    u.name = name
    u.role = role
    u.department = department
    u.data_scope = DataScope.ORG.value       # org-wide (decision: see across all branches)
    u.permission_set = permission_set
    u.org_unit_id = org_unit_id
    u.branch_id = None                        # HO/monitoring don't sit at a branch
    return u


async def main():
    async with AsyncSessionLocal() as s:
        ho = await _get_or_create_ho(s)

        await _upsert_user(
            s, staff_id="HO-DEMO", name="Head Office (demo)",
            role="admin", department=Department.HEAD_OFFICE.value,
            permission_set=f"{PermissionSet.READ.value},{PermissionSet.WRITE.value}",
            org_unit_id=ho.id,
        )
        await _upsert_user(
            s, staff_id="MON-DEMO", name="Monitoring (demo)",
            role="area_manager", department=Department.AUDIT.value,
            permission_set=f"{PermissionSet.READ.value},{PermissionSet.FLAG.value}",
            org_unit_id=ho.id,
        )
        await s.commit()
        logger.info("Done. Demo logins (PIN 1234): HO-DEMO (head_office), MON-DEMO (audit).")


if __name__ == "__main__":
    asyncio.run(main())
