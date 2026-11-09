import copy
import json
import re
import unittest

from apple2_software import ULTIMA_IV, ultima4_walkthroughs


class SoftwareWalkthroughTests(unittest.TestCase):
    def setUp(self):
        self.source = ULTIMA_IV.read_text()
        self.record = json.loads(re.search(r"^```json\n(.*?)^```$", self.source, re.M | re.S)[1])

    def test_tours_resolve_the_acceptance_stops_and_publish_both_memory_spaces(self):
        party, combat, magic, companions = ultima4_walkthroughs(self.source)
        self.assertEqual([t["id"] for t in (party, combat, magic, companions)],
                         ["ultima4-party", "ultima4-combat", "ultima4-magic", "ultima4-companions"])
        self.assertEqual([s["address"] for s in party["steps"]], ["40C0", "590E", "5959", "4047", "408D", "40C0"])
        self.assertEqual([s["address"] for s in combat["steps"]], ["6FB0", "708B", "71D7", "7A7E", "71D7", "40C0"])
        self.assertEqual(party["steps"][0]["bytes"], self.record["stops"]["command"]["bytes"])
        self.assertEqual(combat["steps"][3]["bytes"], self.record["combat"]["stops"]["attack"]["bytes"])
        self.assertEqual(combat["steps"][2]["when"], [{"address": 11, "bytes": [128]}])
        links = combat["steps"][2]["inspect"]
        self.assertEqual([link["address"] for link in links], [0xef00, 0xef40, 0xef80, 0xec18])
        self.assertTrue(all(link["space"] == "lc-upper" for link in links))
        self.assertEqual([s["address"] for s in magic["steps"]],
                         ["8825", "8868", "8904", "48BE", "4C1F", "4C27", "4C42", "4C45", "40C0"])
        self.assertEqual(magic["steps"][2]["when"],
                         [{"address": 0x8800, "bytes": [0x4c, 0x17, 0x88]}, {"address": 0x8a09, "bytes": [7]}])
        self.assertEqual([link["address"] for link in magic["steps"][0]["inspect"]], [0xed38, 0xed47, 0xec16])
        self.assertEqual([s["address"] for s in companions["steps"]],
                         ["1813", "8882", "8AFF", "8C02", "40C0", "71D7", "71D7", "40C0", "48BE", "4C1F", "4C27", "4C45", "40C0"])
        self.assertEqual(companions["steps"][6]["when"][-1], {"address": 0xd4, "bytes": [2]})
        self.assertEqual([link["address"] for link in companions["steps"][9]["inspect"]], [0xec36, 0xec18, 0xed47, 0xd4])
        # Changing a shared acceptance stop changes the published tour, without another address to maintain.
        self.record["stops"]["command"]["address"] = 0x4000
        self.record["magic"]["stops"]["healed"]["address"] = 0x4c44
        changed = ultima4_walkthroughs("```json\n" + json.dumps(self.record) + "\n```")
        self.assertEqual(changed[0]["steps"][0]["address"], "4000")
        self.assertEqual(changed[2]["steps"][7]["address"], "4C44")

    def test_bad_references_unbounded_runs_and_device_inspections_are_rejected(self):
        changes = [
            lambda r: r["walkthroughs"].append(copy.deepcopy(r["walkthroughs"][0])),
            lambda r: r["walkthroughs"][0].update(requires=[]),
            lambda r: r["walkthroughs"][0]["steps"][0].update(stop="stops.missing"),
            lambda r: r["walkthroughs"][0]["steps"][0].update(limit=0),
            lambda r: r["walkthroughs"][0]["steps"][0].update(limit=True),
            lambda r: r["walkthroughs"][0]["steps"][0].update(prepare=""),
            lambda r: r["walkthroughs"][0]["steps"][0].update(unrecognized="ignored?"),
            lambda r: r["walkthroughs"][0]["steps"][0]["inspect"][0].update(address=0xc010),
            lambda r: r["walkthroughs"][0]["steps"][0]["inspect"][0].update(space="rom"),
            lambda r: r["walkthroughs"][0]["steps"][0]["when"][0].update(address=0xc080),
            lambda r: r["stops"]["command"].update(bytes=[]),
            lambda r: r["stops"]["command"].update(bytes=[256]),
        ]
        for change in changes:
            with self.subTest(change=change):
                record = copy.deepcopy(self.record)
                change(record)
                with self.assertRaises(ValueError):
                    ultima4_walkthroughs("```json\n" + json.dumps(record) + "\n```")
