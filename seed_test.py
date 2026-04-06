"""Seed the state store with test templates and connections."""
import asyncio
import sys
from pathlib import Path
from io import BytesIO

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import UploadFile
from backend.app.services.templates import TemplateService
from backend.app.services.config import get_settings
from backend.app.repositories import state_store

REPORTS = Path("/home/rohith/desktop/Neurareport V2/new reports")

def register_connections():
    pairs = [
        ("recipe-log", REPORTS / "recipe_log (1).sqlite3"),
        ("test-copy", REPORTS / "test - Copy.db"),
        ("test-copy-3", REPORTS / "test - Copy (3).db"),
    ]
    ids = {}
    for name, db_path in pairs:
        r = state_store.upsert_connection(
            conn_id=None, name=name, db_type="sqlite",
            database_path=str(db_path),
            secret_payload={"database": str(db_path)},
        )
        ids[name] = r["id"]
        print(f"  Conn: {name} => {r['id']}")
    return ids


async def import_templates():
    s = get_settings()
    svc = TemplateService(
        uploads_root=s.uploads_dir,
        excel_uploads_root=s.excel_uploads_dir,
        max_bytes=s.max_upload_bytes,
    )
    zips = [
        "scale2-batch-report-v2.zip",
        "scale2-consumption-per-batch.zip",
        "scale2-consumption-report.zip",
        "recipe-batch-report-da31dc-pdf.zip",
        "c5598348-4d89-445e-a2f9-43a3aa6382ee-d1fdde (1).zip",
        "c5598348-4d89-445e-a2f9-43a3aa6382ee-d1fdde_2 (1).zip",
        "db3dcb43-65e5-4bb3-9740-c86bcd5d44c4-af2ec4 (1).zip",
        "temperature report.zip",
        "c5598348-4d89-445e-a2f9-43a3aa6382ee-machine_runtime (1).zip",
        "flowmeter-table-datewise.zip",
    ]
    for z in zips:
        p = REPORTS / z
        if not p.exists():
            print(f"  SKIP (not found): {z}")
            continue
        u = UploadFile(filename=z, file=BytesIO(p.read_bytes()))
        r = await svc.import_zip(u, display_name=None, correlation_id=None)
        print(f"  Template: {z[:50]:50s} => {r.get('template_id', 'FAIL')}")


if __name__ == "__main__":
    print("Registering connections...")
    conn_ids = register_connections()
    print(f"\nImporting templates...")
    asyncio.run(import_templates())
    print(f"\nDone. Templates: {len(state_store.list_templates())}, Connections: {len(state_store.list_connections())}")
