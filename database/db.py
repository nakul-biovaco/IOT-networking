import sqlite3
import os
import threading

from config import DATABASE_PATH

_local = threading.local()
db_write_lock = threading.RLock()


def get_connection() -> sqlite3.Connection:
    if not hasattr(_local, "connection") or _local.connection is None:
        conn = sqlite3.connect(DATABASE_PATH, timeout=30.0, check_same_thread=False, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=30000")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA wal_autocheckpoint=100")
        except Exception:
            pass
        _local.connection = conn
    return _local.connection


def close_connection():
    if hasattr(_local, "connection") and _local.connection is not None:
        try:
            _local.connection.close()
        except Exception:
            pass
        _local.connection = None


def init_db():
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    conn = get_connection()
    with open(schema_path, "r") as f:
        conn.executescript(f.read())
    
    # Safe migrations for mesh networking
    for col, col_type in [
        ("parent_device_id", "INTEGER DEFAULT NULL"),
        ("mesh_layer", "INTEGER DEFAULT 0"),
        ("mesh_role", "TEXT DEFAULT NULL"),
        ("router_ssid", "TEXT DEFAULT NULL")
    ]:
        try:
            conn.execute(f"ALTER TABLE devices ADD COLUMN {col} {col_type}")
        except Exception:
            pass

    conn.commit()

