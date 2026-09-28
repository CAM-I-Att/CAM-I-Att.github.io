"""Read the supplied CAM-I monthly template without executing workbook formulas.

The saved summary contains operator-approved lightning counts and OT exceptions.
Keep it separate from member identity and from event-level absence/fine records.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, timedelta
from io import BytesIO
from pathlib import PurePosixPath
from zipfile import ZipFile, BadZipFile
import hashlib
import math
import re
import unicodedata
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def normalized(value):
    return unicodedata.normalize("NFC", str(value or "")).strip()


def read_cells(content):
    try:
        with ZipFile(BytesIO(content)) as archive:
            if sum(i.file_size for i in archive.infolist()) > 30_000_000:
                raise ValueError("압축 해제 후 30MB 이하의 출결표를 선택하세요.")
            book = ET.fromstring(archive.read("xl/workbook.xml"))
            props = book.find("m:workbookPr", NS)
            epoch = date(1904, 1, 1) if props is not None and props.get("date1904") in ("1", "true") else date(1899, 12, 30)
            sheet = next((s for s in book.findall("m:sheets/m:sheet", NS) if s.get("name") == "출결표"), None)
            if sheet is None:
                raise ValueError("‘출결표’ 시트를 찾지 못했습니다.")
            relations = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            target = next(r.get("Target") for r in relations if r.get("Id") == sheet.get(f"{{{REL}}}id"))
            path = target.lstrip("/") if target.startswith("/") else str(PurePosixPath("xl") / target)
            strings = []
            if "xl/sharedStrings.xml" in archive.namelist():
                strings = ["".join(si.itertext()) for si in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
            cells = {}
            for cell in ET.fromstring(archive.read(path)).findall("m:sheetData/m:row/m:c", NS):
                value = cell.findtext("m:v", default="", namespaces=NS)
                if cell.get("t") == "s":
                    value = strings[int(value)]
                elif cell.get("t") == "inlineStr":
                    value = "".join(cell.find("m:is", NS).itertext())
                elif cell.get("t") == "e":
                    value = "#ERROR"
                cells[cell.get("r")] = value
            return cells, epoch
    except (BadZipFile, ET.ParseError, KeyError, StopIteration, IndexError) as exc:
        raise ValueError("읽을 수 없는 출결표입니다. Excel에서 .xlsx로 다시 저장하세요.") from exc


def column(number):
    result = ""
    while number:
        number, rem = divmod(number - 1, 26)
        result = chr(65 + rem) + result
    return result


def parse_workbook(content: bytes, filename: str, month: str, term: str):
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("대상 월을 YYYY-MM 형식으로 입력하세요.")
    date.fromisoformat(month + "-01")
    term = normalized(term)
    if not term or len(term) > 40:
        raise ValueError("활동기간(예: 21기)을 입력하세요.")
    cells, epoch = read_cells(content)
    if cells.get("B3") != "성명/출사지" or cells.get("C64") != "성명":
        raise ValueError("지원하는 월별 출결표 형식과 다릅니다. 성명/출사지 및 집계 표를 확인하세요.")
    issues, errors, events, people = [], [], [], []

    def numeric(address, optional=False):
        value = cells.get(address, "")
        if value == "" and optional:
            return None
        try:
            number = float(value)
            if not math.isfinite(number) or number < 0:
                raise ValueError()
            return number
        except (TypeError, ValueError):
            errors.append(f"{address}: 숫자 또는 저장된 수식 결과가 없습니다. Excel에서 재계산 후 저장하세요.")
            return None

    def event_date(address):
        value = cells.get(address, "")
        if not value:
            return None
        try:
            parsed = (epoch + timedelta(days=float(value))).isoformat()
        except (ValueError, OverflowError):
            try:
                parsed = date.fromisoformat(value[:10]).isoformat()
            except ValueError:
                errors.append(f"{address}: 행사 날짜를 읽을 수 없습니다.")
                return None
        return parsed

    regular_columns = []
    regular_events = []
    for c in range(3, 28):
        col = column(c)
        day = event_date(f"{col}2")
        if not day:
            continue
        if day[:7] != month:
            errors.append(f"{col}2: {day}는 선택한 {month}의 일정이 아닙니다. 월별 파일만 반영할 수 있습니다.")
        regular_columns.append(col)
        name = normalized(cells.get(f"{col}3"))
        if not name:
            errors.append(f"{col}3: 행사명이 없습니다.")
        event = {"date":day,"name":name,"type":"official","sourceCell":f"{col}2"}
        events.append(event)
        regular_events.append(event)
    for date_col, place_col, kind in [("M", "N", "photo"), ("AC", "AD", "external")]:
        for row in range(65, 116):
            day = event_date(f"{date_col}{row}")
            if not day:
                continue
            if day[:7] != month:
                errors.append(f"{date_col}{row}: 다른 달의 일정 {day}가 포함되어 있습니다.")
            events.append({"date":day,"name":normalized(cells.get(f"{place_col}{row}")) or "장소 미입력","type":kind,"sourceCell":f"{date_col}{row}"})
    if not regular_columns:
        errors.append("행사 날짜가 없습니다.")
    matrix = {}
    for row in range(4, 58):
        name = normalized(cells.get(f"B{row}"))
        if not name:
            continue
        if name in matrix:
            errors.append(f"B{row}: 동명이인 또는 중복 이름 {name}. 고유한 이름 연결이 필요합니다.")
        values = [numeric(f"{col}{row}", optional=True) for col in regular_columns]
        matrix[name] = {"units":sum(v for v in values if v is not None), "missing":any(v is None for v in values), "values":values}
    seen = set()
    for row in range(65, 116):
        name = normalized(cells.get(f"C{row}"))
        if not name:
            continue
        if name in seen:
            errors.append(f"C{row}: 중복 집계 이름 {name}.")
        seen.add(name)
        activities, regular, lightning, external, saved_rate = [numeric(f"{c}{row}") for c in ("D","E","G","H","I")]
        if any(v is None for v in (activities, regular, lightning, external, saved_rate)):
            continue
        if external:
            errors.append(f"{name}: 외부활동 {external:g}회의 인정 단위(대표활동 0.5회 / 공식행사 1회)를 확인해야 합니다.")
        units = regular + lightning * .5
        if not activities:
            errors.append(f"{name}: 전체 활동 횟수가 0입니다.")
        elif abs(units / activities - saved_rate) > .0001:
            errors.append(f"{name}: 저장된 출석률과 인정횟수 계산이 다릅니다.")
        if name not in matrix:
            errors.append(f"{name}: 행사별 출석 행이 없습니다.")
        elif matrix[name]["missing"]:
            errors.append(f"{name}: 행사별 출석에 빈칸이 있습니다. 0과 미입력을 구분해 주세요.")
        elif matrix[name]["units"] != regular:
            issues.append(f"{name}: 행사별 합계 {matrix[name]['units']:g}회 / 집계 참여횟수 {regular:g}회. 반영 시 집계 참여횟수를 사용합니다.")
        attendance = []
        if name in matrix:
            attendance = [
                {"date":event["date"], "name":event["name"], "status":"참여" if value > 0 else "미참여", "units":value}
                for event, value in zip(regular_events, matrix[name]["values"])
                if value is not None
            ]
        people.append({"name":name,"activities":activities,"regularUnits":regular,"lightningCount":lightning,"units":units,"sourceRow":row,"attendance":attendance})
    for name in matrix.keys() - seen:
        errors.append(f"{name}: 집계 표에 이름이 없습니다.")
    if not people:
        errors.append("회원별 집계가 없습니다.")
    return {"source":normalized(filename),"digest":hashlib.sha256(content).hexdigest(),"month":month,"term":term,"events":events,"people":people,"issues":issues,"errors":errors}


def match_members(preview, state):
    by_name = {}
    for member in state.get("members", []):
        if member.get("rosterIncluded", True):
            by_name.setdefault(normalized(member["name"]), []).append(member["id"])
    errors = list(preview["errors"])
    if state.get("rosterReady") is not True:
        errors.append("기본 회원 정보 입력 대기 중입니다. 회원 명단을 확정한 뒤 반영하세요.")
        return by_name, errors
    for person in preview["people"]:
        matches = by_name.get(person["name"], [])
        if len(matches) != 1:
            errors.append(f"{person['name']}: {'미등록 회원' if not matches else '동명이인'} — 회원 정보 연결이 필요합니다.")
    active_names = {normalized(m["name"]) for m in state.get("members", []) if m.get("active", True) and m.get("rosterIncluded", True)}
    for name in active_names - {p["name"] for p in preview["people"]}:
        errors.append(f"{name}: 출결표에 없는 활동 회원입니다. 적용 대상 명단을 확인하세요.")
    return by_name, errors


def apply_preview(state, preview, accept_summary=False):
    mapping, errors = match_members(preview, state)
    if errors:
        raise ValueError(" / ".join(errors))
    if preview["issues"] and not accept_summary:
        raise ValueError("행사별 값과 집계의 차이를 확인하고 집계 기준 반영을 선택하세요.")
    updated = deepcopy(state)
    # Month is the replacement key, preventing duplicates on re-upload.
    updated["monthlyReports"] = [r for r in state.get("monthlyReports", []) if r["month"] != preview["month"]]
    active_ids = {m["id"] for m in state["members"] if m.get("active", True) and m.get("rosterIncluded", True)}
    for person in preview["people"]:
        if mapping[person["name"]][0] not in active_ids:
            continue
        updated["monthlyReports"].append({**person,"memberId":mapping[person["name"]][0],"month":preview["month"],"term":preview["term"],"source":preview["source"],"finalized":True})
    updated["monthlySchedule"] = [e for e in state.get("monthlySchedule", []) if e["date"][:7] != preview["month"]] + preview["events"]
    return updated
