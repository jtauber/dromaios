"""Versioned CoCo guide publication is checked without distributing ROM images."""

import json
import re
import subprocess
import unittest

from coco_rom import coco_annotations
from machines import COCO


class CocoRomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cpu = json.loads(subprocess.run(["node", "site/coco-instructions.ts"], cwd=COCO.parents[3],
                                           check=True, capture_output=True, text=True).stdout)
        cls.source = COCO.read_text()
        cls.record = json.loads(re.search(r"```json\n(.*?)\n```", cls.source, re.S)[1])

    def check(self, record):
        return coco_annotations("```json\n" + json.dumps(record) + "\n```", self.cpu["romImages"], self.cpu)

    def test_both_roms_have_checked_guides_and_6809_instruction_shapes(self):
        guides = coco_annotations(self.source, self.cpu["romImages"], self.cpu)
        self.assertEqual(guides, self.record)
        self.assertEqual([step["address"] for step in guides["extended"]["walkthroughs"][0]["steps"]],
                         ["9361", "9374", "92C2", "92D9", "9377", "9386", "9388"])
        self.assertIn("10 CE 03 D7", [note["bytes"] for note in guides["firmware"]["notes"]])

    def test_wrong_identities_bounds_cross_references_and_instruction_lengths_fail(self):
        mutations = [
            lambda r: r.pop("firmware"),
            lambda r: r["extended"].update(sha256=r["firmware"]["sha256"]),
            lambda r: r["extended"]["regions"][0].update(end="A000"),
            lambda r: r["firmware"]["regions"][0].update(start="8000"),
            lambda r: r["extended"]["routines"][0].update(address="A027"),
            lambda r: r["extended"]["routines"][0].update(name="RESET"),
            lambda r: r["extended"]["labels"][0].update(address="7FFF", bytes=2),
            lambda r: r["extended"]["labels"][0].update(address="FF80", scope="hardware"),
            lambda r: r["extended"]["labels"][0].update(address="0088"),
            lambda r: r["extended"]["notes"][0].update(bytes="10 CE 03"),
            lambda r: r["extended"]["notes"][0].update(bytes="A7 87"),
            lambda r: r["extended"]["notes"][0].update(bytes="10 CE 03 D7 00"),
            lambda r: r["extended"]["notes"][0].update(address="9FFF"),
            lambda r: r["extended"]["walkthroughs"][0].update(id="reset-text"),
            lambda r: r["extended"]["walkthroughs"][0]["steps"][0].update(routine="RESET"),
            lambda r: r["extended"]["walkthroughs"][0]["steps"][0].update(address="9362"),
        ]
        for index, mutate in enumerate(mutations):
            record = json.loads(json.dumps(self.record)); mutate(record)
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.check(record)
        for source in ["", self.source + '\n```json\n{}\n```\n']:
            with self.assertRaises(ValueError):
                coco_annotations(source, self.cpu["romImages"], self.cpu)
