"""The BIOS guide is validated without bundling its external ROM image."""

import copy
import json
from pathlib import Path
import re
import subprocess
import unittest

from xt_rom import xt_annotations


class XtRomTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        cls.catalogue = json.loads(subprocess.run(["node", "site/xt-instructions.ts"], cwd=root,
                                                 check=True, capture_output=True, text=True).stdout)
        cls.source = (root / "src/machines/8088/pc-xt.md").read_text()
        cls.record = json.loads(re.search(r"```json\n(.*?)\n```", cls.source, re.S)[1])

    def test_chapter_owns_nine_exact_execution_stops_and_physical_annotations(self):
        self.assertEqual(xt_annotations(self.source, self.catalogue), self.record)
        steps = self.record["walkthroughs"][0]["steps"]
        self.assertEqual(len(steps), 9)
        self.assertEqual(steps[0]["execution"], "FFFF:0000")
        self.assertEqual(steps[-1]["address"], "FE0D7")

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
