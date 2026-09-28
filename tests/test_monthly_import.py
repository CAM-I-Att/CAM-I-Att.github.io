import copy
import json
from io import BytesIO
from pathlib import Path
import unittest
from zipfile import ZipFile
from xml.sax.saxutils import escape

from monthly_import import parse_workbook, apply_preview
import server


def workbook(overrides=None):
    cells = {"B3":"성명/출사지", "C64":"성명", "C2":46270, "C3":"OT",
             "B4":"테스트", "C4":1, "C65":"테스트", "D65":1, "E65":1,
             "G65":0, "H65":0, "I65":1, "M65":46276, "N65":"사진 번개"}
    cells.update(overrides or {})
    output = BytesIO()
    ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    with ZipFile(output,"w") as z:
        z.writestr("xl/workbook.xml", f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="출결표" r:id="r1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
        tags = []
        for address, value in cells.items():
            if value is None:
                continue
            value_xml = f'<is><t>{escape(value)}</t></is>' if isinstance(value,str) else f'<v>{value}</v>'
            attr = ' t="inlineStr"' if isinstance(value,str) else ''
            tags.append(f'<c r="{address}"{attr}>{value_xml}</c>')
        z.writestr("xl/worksheets/sheet1.xml",f'<worksheet xmlns="{ns}"><sheetData><row>{"".join(tags)}</row></sheetData></worksheet>')
    return output.getvalue()


def parse(overrides=None):
    return parse_workbook(workbook(overrides),"9월.xlsx","2026-09","21기")


class MonthlyImportTests(unittest.TestCase):
    def setUp(self):
        self.state = {"rosterReady":True,"members":[{"id":"m1","name":"테스트"}], "events":[],"records":[]}

    def test_dates_and_fractional_credit(self):
        p = parse({"G65":1,"I65":1.5})
        self.assertEqual(p["errors"],[])
        self.assertEqual(p["events"][0]["date"],"2026-09-05")
        self.assertEqual(p["people"][0]["units"],1.5)

    def test_people_include_event_participation(self):
        p = parse({"C4":0})
        self.assertEqual([item["status"] for item in p["people"][0]["attendance"]], ["미참여"])
        self.assertEqual(p["people"][0]["attendance"][0]["name"], "OT")

    def test_waiting_for_roster_does_not_mutate(self):
        self.state["rosterReady"] = False
        before = copy.deepcopy(self.state)
        with self.assertRaisesRegex(ValueError,"입력 대기"):
            apply_preview(self.state,parse())
        self.assertEqual(self.state,before)

    def test_replace_month_and_keep_other_months(self):
        first = apply_preview(self.state,parse())
        first["monthlyReports"].append({**first["monthlyReports"][0],"month":"2026-08"})
        result = apply_preview(first,parse({"E65":0,"C4":0,"I65":0}))
        self.assertEqual(len(result["monthlyReports"]),2)
        self.assertEqual(next(r for r in result["monthlyReports"] if r["month"]=="2026-09")["units"],0)
        self.assertEqual(len(result["monthlySchedule"]),2)

    def test_ambiguous_identity_rejected(self):
        self.state["members"].append({"id":"m2","name":"테스트"})
        with self.assertRaisesRegex(ValueError,"동명이인"):
            apply_preview(self.state,parse())

    def test_unknown_and_missing_members_rejected(self):
        self.state["members"] = [{"id":"m2","name":"다른 회원"}]
        with self.assertRaisesRegex(ValueError,"미등록 회원"):
            apply_preview(self.state,parse())

    def test_zero_distinct_from_missing(self):
        self.assertEqual(parse({"C4":0,"E65":0,"I65":0})["errors"],[])
        self.assertTrue(any("빈칸" in e for e in parse({"C4":None})["errors"]))
        self.assertTrue(any("수식 결과" in e for e in parse({"I65":None})["errors"]))

    def test_mismatched_month_and_external_credit_rejected(self):
        self.assertTrue(parse({"C2":46300})["errors"])
        self.assertTrue(parse({"H65":1})["errors"])

    def test_summary_override_requires_review(self):
        p = parse({"E65":2,"I65":2})
        self.assertEqual(len(p["issues"]),1)
        with self.assertRaisesRegex(ValueError,"집계의 차이"):
            apply_preview(self.state,p)
        self.assertEqual(apply_preview(self.state,p,True)["monthlyReports"][0]["units"],2)

    def test_no_absence_or_fines_invented(self):
        result = apply_preview(self.state,parse({"C4":0,"E65":0,"I65":0}))
        self.assertEqual(result["records"],[])

    def test_term_reset_and_exact_half(self):
        self.state["monthlyReports"] = [
            {"memberId":"m1","month":f"2026-{m:02}","term":"20기" if m<9 else "21기","activities":2,"units":1 if m==9 else 0,"finalized":True}
            for m in [6,7,8,9]]
        stats = server.calculate_member_month(self.state,"m1","2026-09")
        self.assertEqual(stats["monthlyRate"],.5)
        self.assertEqual(stats["allRate"],.5)
        self.assertTrue(stats["monthlyPass"])
        row = next(r for r in server.summary_rows(self.state) if r[0]=="2026-09")
        self.assertEqual(row[15],0)

    def test_public_pending_hides_roster(self):
        self.state["rosterReady"] = False
        self.assertEqual(server.public_snapshot(self.state)["members"],[])

    def test_public_snapshot_keeps_event_participation(self):
        self.state["monthlyReports"] = [{"memberId":"m1", "month":"2026-09", "term":"21기", "activities":1, "units":1, "regularUnits":1, "lightningCount":0, "finalized":True, "attendance":[{"date":"2026-09-05", "name":"OT", "status":"참여", "units":1}]}]
        report = server.public_snapshot(self.state)["monthlyReports"][0]
        self.assertEqual(report["attendance"][0]["status"], "참여")
        self.assertEqual(report["lightningCount"], 0)

    def test_leave_member_is_matched_but_not_counted(self):
        self.state["members"][0].update(active=False, membershipStatus="휴학", rosterIncluded=True)
        self.state["members"].append({"id":"old", "name":"이전 회원", "active":False,"rosterIncluded":False})
        result = apply_preview(self.state,parse())
        self.assertEqual(result["monthlyReports"],[])
        public = server.public_snapshot(result)
        self.assertEqual(len(public["members"]),1)
        self.assertEqual(public["members"][0]["membershipStatus"],"휴학")
        self.assertEqual(server.summary_rows(result),[])

    def test_roster_status_survives_save_normalization(self):
        self.state["members"][0].update(active=False, membershipStatus="휴학", rosterIncluded=True)
        self.state["members"].append({"id":"old","name":"이전 회원","active":False,"membershipStatus":"이전 명단","rosterIncluded":False})
        cleaned = server.clean_state(self.state)
        self.assertEqual(cleaned["members"][0]["membershipStatus"],"휴학")
        self.assertFalse(cleaned["members"][1]["rosterIncluded"])


if __name__ == "__main__":
    unittest.main()
