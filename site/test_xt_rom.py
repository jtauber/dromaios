"""The BIOS guide is validated without bundling its external ROM image."""

import copy
import json
from pathlib import Path
import re
import subprocess
import unittest

from xt_rom import ultima_walkthrough, xt_annotations


class XtRomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        cls.catalogue = json.loads(subprocess.run(["node", "site/xt-instructions.ts"], cwd=root,
                                                 check=True, capture_output=True, text=True).stdout)
        cls.source = (root / "src/machines/8088/pc-xt.md").read_text()
        cls.record = json.loads(re.search(r"```json\n(.*?)\n```", cls.source, re.S)[1])
        cls.ultima = (root / "docs/machines/pc-xt-ultima-v.md").read_text()

    def test_software_checkpoints_browse_ram_and_share_the_keyboard_poll(self):
        steps = ultima_walkthrough(self.ultima)["steps"]
        self.assertEqual([s["address"] for s in steps], ["13939", "0E45C", "150DE", "13966", "0E45C"])
        self.assertNotEqual(steps[1]["expect"], steps[-1]["expect"])
        self.assertTrue(all("routine" not in s for s in steps))
        for source in [self.ultima.replace("0C6F:7249", "C6F:7249"), self.ultima.replace('"partyRead": true', '"partyRead": false'),
                       self.ultima.replace('[13, 15, 15]', '[13, 15]')]:
            with self.assertRaises(ValueError):
                ultima_walkthrough(source)

    def test_dos_services_validate_arguments_buffers_and_return_contracts(self):
        services = self.record["dos"]["services"]
        self.assertEqual([s["function"] for s in services], ["09", "3C", "3D", "3E", "3F", "40", "4C", "4D"])
        for mutate in [lambda r: r["dos"]["services"].append(copy.deepcopy(services[0])),
                       lambda r: r["dos"]["services"][0].update(function="100"),
                       lambda r: r["dos"]["services"][1]["arguments"][0].update(register="PC"),
                       lambda r: r["dos"]["services"][4].pop("buffer"),
                       lambda r: r["dos"]["services"][4]["buffer"].update(length="00"),
                       lambda r: r["dos"]["services"][0]["buffer"].update(direction="output"),
                       lambda r: r["dos"]["errors"].update(unknown="Error")]:
            record = copy.deepcopy(self.record)
            mutate(record)
            with self.assertRaises(ValueError):
                xt_annotations("```json\n" + json.dumps(record) + "\n```", self.catalogue)

    def test_chapter_owns_nine_exact_execution_stops_and_physical_annotations(self):
        self.assertEqual(xt_annotations(self.source, self.catalogue), self.record)
        steps = self.record["walkthroughs"][0]["steps"]
        self.assertEqual(len(steps), 9)
        self.assertEqual(steps[0]["execution"], "FFFF:0000")
        self.assertEqual(steps[-1]["address"], "FE0D7")

    def test_chapter_owns_port_labels_irq_sources_and_keyboard_stops(self):
        self.assertEqual(self.record["io"]["irqs"][1], "XT keyboard")
        self.assertEqual(self.record["io"]["ports"][0]["address"], "0004")
        steps = self.record["walkthroughs"][1]["steps"]
        self.assertEqual([s["execution"] for s in steps],
                         ["F000:E987", "F000:E994", "F000:E99D", "F000:EA5C", "F000:EA66"])
        for mutate in [lambda r: r["io"]["irqs"].pop(),
                       lambda r: r["io"]["ports"][0].update(address="10000"),
                       lambda r: r["io"]["ports"][1].update(address="0004"),
                       lambda r: r["io"]["ports"][0].update(input=""),
                       lambda r: r["io"].update(unknown=True)]:
            record = copy.deepcopy(self.record)
            mutate(record)
            with self.assertRaises(ValueError):
                xt_annotations("```json\n" + json.dumps(record) + "\n```", self.catalogue)

    def test_dma_walkthrough_conditions_and_ram_links(self):
        steps = self.record["walkthroughs"][2]["steps"]
        self.assertEqual([s["event"]["address"] for s in steps if s.get("event", {}).get("kind") == "dma"], [0x7cff, 0x7dff])
        for extra in [{"event": {"kind": "dma", "address": -1}}, {"event": {"kind": "dma", "address": True}},
                      {"event": {"kind": "output", "port": 0x3f5, "value": 256}}, {"memory": "FFFFF"}]:
            record = copy.deepcopy(self.record)
            record["walkthroughs"][2]["steps"][2].update(extra)
            with self.assertRaises(ValueError):
                xt_annotations("```json\n" + json.dumps(record) + "\n```", self.catalogue)

    def test_hello_checkpoints_validate_load_layout_guards_and_inspector_links(self):
        steps = self.record["walkthroughs"][3]["steps"]
        self.assertEqual(len(steps), 8)
        self.assertEqual(steps[0]["event"], {"kind": "dma", "address": 0xb5cf})
        self.assertEqual(steps[2]["execution"], "022F:62F4")
        self.assertEqual(steps[-1]["expect"]["screen"]["lastLine"], "A>")
        self.assertTrue(all(step["file"] == "HELLO.COM" for step in steps))
        for extra in [{"file": "OTHER.COM"}, {"expect": {}},
                      {"expect": {"bytes": {"address": "9FFFF", "value": "00 00"}}},
                      {"expect": {"bytes": {"address": "0C6B0", "value": "BA"}, "registers": {"ax": "10000"}}},
                      {"expect": {"bytes": {"address": "0C6B0", "value": "BA"}, "screen": {"contains": "Hello"}}},
                      {"execution": "022F:0000"}]:
            record = copy.deepcopy(self.record)
            record["walkthroughs"][3]["steps"][1].update(extra)
            with self.assertRaises(ValueError):
                xt_annotations("```json\n" + json.dumps(record) + "\n```", self.catalogue)

    def test_rejects_stale_identity_outside_addresses_bad_references_and_inconsistent_segments(self):
        mutations = [
            lambda r: r.update(sha256="0" * 64),
            lambda r: r["regions"][0].update(start="FDFFF"),
            lambda r: r["routines"][0].update(address="FFFF"),
            lambda r: r["notes"][0].update(address="FFFFF"),
            lambda r: r["labels"][0].update(scope="hardware"),
            lambda r: r["walkthroughs"][0]["steps"][0].update(execution="FFFF:0001"),
            lambda r: r["walkthroughs"][0]["steps"][0].update(execution="ffff:0000"),
            lambda r: r["walkthroughs"][0]["steps"][0].pop("execution"),
            lambda r: r["walkthroughs"][0]["steps"][0].update(routine="missing"),
        ]
        for index, mutate in enumerate(mutations):
            record = copy.deepcopy(self.record)
            mutate(record)
            with self.subTest(index=index), self.assertRaises(ValueError):
                xt_annotations("```json\n" + json.dumps(record) + "\n```", self.catalogue)
        for source in ["", self.source + "\n```json\n{}\n```\n"]:
            with self.assertRaises(ValueError):
                xt_annotations(source, self.catalogue)
