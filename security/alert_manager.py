from database.models import (
    insert_alert as db_insert_alert,
    get_alerts as db_get_alerts,
    resolve_alert as db_resolve_alert,
)


def create_alert(device_id: int, alert_type: str, severity: str, message: str):
    db_insert_alert(device_id, alert_type, severity, message)


def get_all_alerts(resolved: int = None) -> list:
    return db_get_alerts(resolved)


def acknowledge_alert(alert_id: int) -> bool:
    return db_resolve_alert(alert_id)
