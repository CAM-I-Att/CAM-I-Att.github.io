from __future__ import annotations

import csv
import json
import mimetypes
import os
import uuid
from html import escape as xml_escape
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
STATE_FILE = DATA_DIR / "state.json"
DETAIL_CSV = DATA_DIR / "attendance.csv"
SUMMARY_CSV = DATA_DIR / "attendance_summary.csv"
XLSX_FILE = DATA_DIR / "attendance.xlsx"
PUBLIC_STATE_FILE = ROOT / "public" / "data" / "public-state.json"
PORT = int(os.environ.get("ATTENDANCE_PORT", "8000"))

EVENT_TYPES = {
    "official": {"label": "공식 출사 / 행사", "units": 1.0},
    "photo": {"label": "사진 번개", "units": 0.5},
}
STATUS_LABELS = {
    "present": "출석",
    "late": "지각·늦참",
    "contact_absent": "사전 연락 불참",
    "unexcused_absent": "무단 결석",
}
FINE_BY_STATUS = {
    "present": 0,
    "late": 2000,
    "contact_absent": 3000,
    "unexcused_absent": 5000,
}
MEMBER_ROLES = {"운영진", "일반 회원"}
MEMBER_DEPARTMENTS = {"총괄", "정보", "홍보", "총무", "출결"}


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def month_key(value: str) -> str:
    return value[:7] if value else ""


def event_units(event: dict[str, Any], status: str) -> float:
    if status not in ("present", "late"):
        return 0.0
    return float(EVENT_TYPES.get(event.get("type"), EVENT_TYPES["official"])["units"])


def fine_won(status: str) -> int:
    return int(FINE_BY_STATUS.get(status, 0))


def status_label(status: str | None) -> str:
    return STATUS_LABELS.get(status or "", "미입력")


def seed_state() -> dict[str, Any]:
    today = date.today()
    current_month = today.replace(day=1)
    def d(month_offset: int, day: int) -> str:
        month = current_month.month + month_offset
        year = current_month.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        return date(year, month, min(day, 28)).isoformat()

    members = [
        {"id": "M001", "name": "김민지", "note": "일반 회원", "department": "", "active": True},
        {"id": "M002", "name": "박서준", "note": "일반 회원", "department": "", "active": True},
        {"id": "M003", "name": "이하은", "note": "일반 회원", "department": "", "active": True},
        {"id": "M004", "name": "정도윤", "note": "일반 회원", "department": "", "active": True},
        {"id": "M005", "name": "최유진", "note": "일반 회원", "department": "", "active": True},
    ]
    events = [
        {"id": "E001", "date": d(-2, 16), "name": "여름 정기 출사", "type": "official", "startTime": "14:00", "location": "서울숲", "note": ""},
        {"id": "E002", "date": d(-1, 7), "name": "도심 야경 출사", "type": "official", "startTime": "14:00", "location": "을지로", "note": ""},
        {"id": "E003", "date": d(-1, 22), "name": "주말 사진 번개", "type": "photo", "startTime": "14:00", "location": "한강공원", "note": ""},
        {"id": "E004", "date": d(0, 2), "name": "정기 모임", "type": "official", "startTime": "14:00", "location": "클럽룸", "note": ""},
        {"id": "E005", "date": d(0, 6), "name": "비 오는 날 번개", "type": "photo", "startTime": "14:00", "location": "성수동", "note": ""},
    ]
    records: list[dict[str, Any]] = []
    statuses = {
        "E001": ["present", "late", "contact_absent", "unexcused_absent", "present"],
        "E002": ["present", "present", "late", "contact_absent", "unexcused_absent"],
        "E003": ["present", "present", "present", "late", "contact_absent"],
        "E004": ["present", "late", "present", "present", "contact_absent"],
        "E005": ["present", "present", "late", "unexcused_absent", "present"],
    }
    for event in events:
        for index, member in enumerate(members):
            status = statuses[event["id"]][index]
            records.append({
                "id": f"R-{event['id']}-{member['id']}",
                "eventId": event["id"],
                "memberId": member["id"],
                "status": status,
                "attendanceTime": "14:15" if status == "late" else ("13:50" if status == "present" else ""),
                "note": "샘플 데이터" if event["id"] == "E001" else "",
                "recordedAt": now_iso(),
            })
    return {
        "version": 1,
        "sampleData": True,
        "members": members,
        "events": events,
        "records": records,
    }


def clean_state(raw: dict[str, Any]) -> dict[str, Any]:
    members = []
    for item in raw.get("members", []):
        if not isinstance(item, dict):
            continue
        member_id = str(item.get("id", "")).strip()
        name = str(item.get("name", "")).strip()
        if member_id and name:
            note = str(item.get("note", "")).strip()
            normalized_note = note if note in MEMBER_ROLES else "일반 회원"
            department = str(item.get("department", "")).strip()
            if normalized_note != "운영진" or department not in MEMBER_DEPARTMENTS:
                department = ""
            members.append({
                "id": member_id,
                "name": name,
                "note": normalized_note,
                "department": department,
                "active": bool(item.get("active", True)),
            })
    events = []
    for item in raw.get("events", []):
        if not isinstance(item, dict):
            continue
        event_id = str(item.get("id", "")).strip()
        event_date = str(item.get("date", "")).strip()
        name = str(item.get("name", "")).strip()
        if event_id and event_date and name:
            events.append({
                "id": event_id,
                "date": event_date,
                "name": name,
                "type": item.get("type") if item.get("type") in EVENT_TYPES else "official",
                "startTime": str(item.get("startTime", "14:00")).strip() or "14:00",
                "location": str(item.get("location", "")).strip(),
                "note": str(item.get("note", "")).strip(),
            })
    member_ids = {member["id"] for member in members}
    event_ids = {event["id"] for event in events}
    records = []
    for item in raw.get("records", []):
        if not isinstance(item, dict):
            continue
        event_id = str(item.get("eventId", "")).strip()
        member_id = str(item.get("memberId", "")).strip()
        status = str(item.get("status", "")).strip()
        if event_id in event_ids and member_id in member_ids and status in STATUS_LABELS:
            attendance_time = str(item.get("attendanceTime", item.get("checkInTime", ""))).strip()
            if status == "present" and len(attendance_time) == 5 and attendance_time > "14:00":
                status = "late"
            records.append({
                "id": str(item.get("id", "")) or f"R-{uuid.uuid4().hex[:12]}",
                "eventId": event_id,
                "memberId": member_id,
                "status": status,
                "attendanceTime": attendance_time,
                "note": str(item.get("note", "")).strip(),
                "recordedAt": str(item.get("recordedAt", now_iso())),
            })
    return {
        "version": 1,
        "sampleData": bool(raw.get("sampleData", False)),
        "members": members,
        "events": events,
        "records": records,
    }


def load_state() -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STATE_FILE.exists():
        state = seed_state()
        save_state(state)
        return state
    try:
        state = clean_state(json.loads(STATE_FILE.read_text(encoding="utf-8")))
        STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        write_exports(state)
        return state
    except (OSError, json.JSONDecodeError):
        state = seed_state()
        save_state(state)
        return state


def cumulative_units(state: dict[str, Any], member_id: str, through_date: str, month: str) -> tuple[float, float]:
    records = {(record["eventId"], record["memberId"]): record for record in state["records"]}
    monthly = 0.0
    total = 0.0
    for event in state["events"]:
        if event["date"] > through_date:
            continue
        record = records.get((event["id"], member_id))
        if not record:
            continue
        units = event_units(event, record["status"])
        total += units
        if month_key(event["date"]) == month:
            monthly += units
    return round(monthly, 2), round(total, 2)


def detail_rows(state: dict[str, Any]) -> list[list[Any]]:
    members = {member["id"]: member for member in state["members"]}
    records = {(record["eventId"], record["memberId"]): record for record in state["records"]}
    rows = []
    for event in sorted(state["events"], key=lambda item: (item["date"], item["id"]), reverse=True):
        for member in sorted(state["members"], key=lambda item: item["name"]):
            record = records.get((event["id"], member["id"]))
            status = record["status"] if record else ""
            monthly_units, total_units = cumulative_units(state, member["id"], event["date"], month_key(event["date"]))
            rows.append([
                record["id"] if record else "",
                event["date"],
                event["name"],
                EVENT_TYPES[event["type"]]["label"],
                member["id"],
                member["name"],
                member.get("note", ""),
                member.get("department", ""),
                status_label(status),
                record.get("attendanceTime", "") if record else "",
                monthly_units if record else "",
                total_units if record else "",
                fine_won(status) if record else "",
                record.get("note", "") if record else "",
                record.get("recordedAt", "") if record else "",
            ])
    return rows


def calculate_member_month(state: dict[str, Any], member_id: str, month: str) -> dict[str, Any]:
    events = [event for event in state["events"] if month_key(event["date"]) == month]
    event_map = {event["id"]: event for event in state["events"]}
    record_map = {(record["eventId"], record["memberId"]): record for record in state["records"]}
    monthly_units = 0.0
    monthly_fine = 0
    missing = 0
    for event in events:
        record = record_map.get((event["id"], member_id))
        if not record:
            missing += 1
            continue
        monthly_units += event_units(event, record["status"])
        monthly_fine += fine_won(record["status"])
    all_events = [event for event in state["events"] if event["date"] <= f"{month}-31"]
    all_units = 0.0
    all_fine = 0
    for event in all_events:
        record = record_map.get((event["id"], member_id))
        if record:
            all_units += event_units(event, record["status"])
            all_fine += fine_won(record["status"])
    monthly_rate = monthly_units / len(events) if events else 0.0
    all_rate = all_units / len(all_events) if all_events else 0.0
    monthly_pass = bool(events) and monthly_rate >= 0.5 and all_rate >= 0.5
    return {
        "month": month,
        "eventCount": len(events),
        "participationUnits": round(monthly_units, 2),
        "monthlyRate": round(monthly_rate, 4),
        "allEventCount": len(all_events),
        "allParticipationUnits": round(all_units, 2),
        "allRate": round(all_rate, 4),
        "monthlyPass": monthly_pass,
        "missingCount": missing,
        "fineWon": monthly_fine,
        "allFineWon": all_fine,
    }


def summary_rows(state: dict[str, Any]) -> list[list[Any]]:
    months = sorted({month_key(event["date"]) for event in state["events"]})
    rows = []
    for month in months:
        for member in sorted(state["members"], key=lambda item: item["name"]):
            stats = calculate_member_month(state, member["id"], month)
            active_months = [item for item in months if item <= month and any(month_key(event["date"]) == item for event in state["events"])]
            under_count = sum(
                1 for item in active_months
                if not calculate_member_month(state, member["id"], item)["monthlyPass"]
            )
            rows.append([
                month,
                member["id"],
                member["name"],
                member.get("note", ""),
                member.get("department", ""),
                stats["eventCount"],
                stats["participationUnits"],
                f"{stats['monthlyRate']:.1%}",
                stats["allEventCount"],
                stats["allParticipationUnits"],
                f"{stats['allRate']:.1%}",
                "충족" if stats["monthlyPass"] else "미달",
                stats["missingCount"],
                under_count,
                max(0, under_count - 1),
                stats["fineWon"],
            ])
    return rows


def public_snapshot(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": 1,
        "generatedAt": now_iso(),
        "members": [
            {
                "id": member["id"],
                "name": member["name"],
                "note": member.get("note", ""),
                "department": member.get("department", ""),
            }
            for member in state["members"]
        ],
        "events": [
            {
                "id": event["id"],
                "date": event["date"],
                "name": event["name"],
                "type": event["type"],
                "startTime": event.get("startTime", "14:00"),
                "location": event.get("location", ""),
            }
            for event in state["events"]
        ],
        "records": [
            {
                "eventId": record["eventId"],
                "memberId": record["memberId"],
                "status": record["status"],
                "attendanceTime": record.get("attendanceTime", ""),
            }
            for record in state["records"]
        ],
    }


def write_csv_file(path: Path, headers: list[str], rows: list[list[Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


def excel_column(index: int) -> str:
    result = ""
    number = index + 1
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def xlsx_sheet_xml(headers: list[str], rows: list[list[Any]]) -> str:
    all_rows = [headers, *rows]
    xml_rows = []
    for row_index, row in enumerate(all_rows, start=1):
        cells = []
        for col_index, value in enumerate(row):
            if value is None or value == "":
                continue
            ref = f"{excel_column(col_index)}{row_index}"
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                text_value = xml_escape(str(value), quote=False)
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{text_value}</t></is></c>')
        xml_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheetData>{"".join(xml_rows)}</sheetData></worksheet>'
    )


def write_xlsx_file(path: Path, detail_headers: list[str], detail: list[list[Any]], summary_headers: list[str], summary: list[list[Any]]) -> None:
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="출결기록" sheetId="1" r:id="rId1"/>'
        '<sheet name="월별요약" sheetId="2" r:id="rId2"/></sheets></workbook>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '</Relationships>'
    )
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/worksheets/sheet1.xml", xlsx_sheet_xml(detail_headers, detail))
        archive.writestr("xl/worksheets/sheet2.xml", xlsx_sheet_xml(summary_headers, summary))


def write_exports(state: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    detail_headers = ["기록ID", "행사일", "행사명", "행사유형", "회원ID", "회원명", "비고", "부서", "출결상태", "출석 시간", "이달의 누적 출석", "전체 누적 출석", "벌금(원)", "출결 메모", "기록시각"]
    summary_headers = ["월", "회원ID", "회원명", "비고", "부서", "월 행사수", "이달의 누적 출석", "월 참여율", "전체 행사수", "전체 누적 출석", "전체 참여율", "기준", "미입력 행사수", "미달 월수", "누적 경고", "월 벌금(원)"]
    detail = detail_rows(state)
    summary = summary_rows(state)
    write_csv_file(
        DETAIL_CSV,
        detail_headers,
        detail,
    )
    write_csv_file(
        SUMMARY_CSV,
        summary_headers,
        summary,
    )
    write_xlsx_file(XLSX_FILE, detail_headers, detail, summary_headers, summary)
    PUBLIC_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_STATE_FILE.write_text(json.dumps(public_snapshot(state), ensure_ascii=False, indent=2), encoding="utf-8")


def validate_members(state: dict[str, Any]) -> None:
    info_count = sum(
        1 for member in state["members"]
        if member.get("note") == "운영진" and member.get("department") == "정보"
    )
    if info_count > 2:
        raise ValueError("정보 부서는 최대 2명까지 등록할 수 있습니다.")
    for member in state["members"]:
        if member.get("note") == "운영진" and member.get("department") not in MEMBER_DEPARTMENTS:
            raise ValueError("운영진 회원은 부서를 선택해야 합니다.")


def save_state(raw_state: dict[str, Any]) -> dict[str, Any]:
    state = clean_state(raw_state)
    validate_members(state)
    state["sampleData"] = False
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    write_exports(state)
    return state


class AppHandler(BaseHTTPRequestHandler):
    server_version = "AttendanceManager/1.0"

    def _send(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8", extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        if extra:
            for key, value in extra.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self) -> None:
        self._send(204, b"", extra={"Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type"})

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            state = load_state()
            self._json(200, {"state": state, "sync": sync_info()})
            return
        if parsed.path == "/api/sync-status":
            self._json(200, sync_info())
            return
        if parsed.path == "/api/export/attendance":
            self._serve_download(DETAIL_CSV, "attendance.csv")
            return
        if parsed.path == "/api/export/summary":
            self._serve_download(SUMMARY_CSV, "attendance_summary.csv")
            return
        if parsed.path == "/api/export/xlsx":
            self._serve_download(XLSX_FILE, "attendance.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            return
        self._serve_static(parsed.path)

    def _serve_download(self, path: Path, download_name: str, content_type: str = "text/csv; charset=utf-8") -> None:
        if not path.exists():
            write_exports(load_state())
        try:
            body = path.read_bytes()
        except OSError:
            self._json(500, {"error": "CSV 파일을 읽지 못했습니다."})
            return
        self._send(200, body, content_type, {"Content-Disposition": f'attachment; filename="{download_name}"'})

    def _serve_static(self, raw_path: str) -> None:
        relative = raw_path.lstrip("/") or "index.html"
        if relative.startswith("data/") or ".." in Path(relative).parts:
            self._json(404, {"error": "Not found"})
            return
        path = ROOT / relative
        if not path.is_file():
            self._json(404, {"error": "Not found"})
            return
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        self._send(200, path.read_bytes(), f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/state":
            self._json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            payload = json.loads(body.decode("utf-8"))
            state = save_state(payload)
            self._json(200, {"state": state, "sync": sync_info()})
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
            self._json(400, {"error": f"저장하지 못했습니다: {exc}"})

    def log_message(self, format: str, *args: Any) -> None:
        return


def sync_info() -> dict[str, Any]:
    return {
        "status": "연동 중" if STATE_FILE.exists() else "준비됨",
        "updatedAt": datetime.fromtimestamp(STATE_FILE.stat().st_mtime).isoformat(timespec="seconds") if STATE_FILE.exists() else None,
        "detailFile": "data/attendance.csv",
        "summaryFile": "data/attendance_summary.csv",
        "excelFile": "data/attendance.xlsx",
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    load_state()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), AppHandler)
    print(f"출결 관리 프로그램: http://127.0.0.1:{PORT}")
    print(f"자동 연동 파일: {DETAIL_CSV}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
