"""Publication checks: source fidelity and navigation are part of the contract."""

from html.parser import HTMLParser
from pathlib import Path
import re
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET

from markdown import Markdown

from check import check_site
from diagrams import state_diagram
from rendering import CHAPTERS, REPOSITORY, ChapterRendering, chapter_link, github_slug
from machines import ALTAIR, APPLE2, COCO, MACHINES, media_record, rom_container_record
from lessons import BASIC_LESSONS
from lesson_rendering import basic_lesson_catalogue, lesson_markdown
from apple2_rom import APPLE2_ROM, rom_annotations, explorer_catalogue, dos_walkthroughs


class CpuBlocks(HTMLParser):
    def __init__(self, source, language="cpu"):
        super().__init__()
        self.language = language
        self.blocks, self.current = [], None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        if tag == "code" and dict(attrs).get("class") == f"language-{self.language}":
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag == "code" and self.current is not None:
            self.blocks.append("".join(self.current))
            self.current = None


class PublishingTests(unittest.TestCase):
    def test_rom_walkthrough_owns_versioned_stops_and_uses_cpu_instruction_names(self):
        catalogue = explorer_catalogue()
        self.assertEqual(len(catalogue["instructions"]), 151)
        layouts = {opcode: {key: value for key, value in info.items() if key in ("name", "length", "controlFlow", "branchCondition")}
                   for opcode, info in catalogue["instructions"].items()}
        self.assertIn("D ← 0", catalogue["instructions"]["216"]["calculations"])
        self.assertEqual(catalogue["instructions"]["32"]["accesses"], ["fetch", "fetch", "write", "write", "fetch"])
        self.assertEqual(layouts["16"], {"name": "BPL relative", "length": 2, "controlFlow": "conditional",
                                                       "branchCondition": {"flag": "n", "set": False}})
        self.assertEqual(layouts["32"], {"name": "JSR absolute", "length": 3, "controlFlow": "unconditional"})
        self.assertEqual(layouts["0"], {"name": "BRK", "length": 2, "controlFlow": "unconditional"})
        self.assertEqual(layouts["234"], {"name": "NOP", "length": 1, "controlFlow": "sequential"})
        source = APPLE2_ROM.read_text()
        self.assertEqual(chapter_link("../software/apple2p-rom.md#rom-walkthrough", APPLE2_ROM.parent.parent / "machines/apple2.md", "/demo/"),
                         "/demo/machines/apple-ii-plus/#rom-walkthrough")
        for broken in ["", source.replace(catalogue["sha256"], "0" * 64),
                       source.replace('"FC58"', '"FA62"'), source.replace('"FC58"', '"C058"'),
                       source.replace('"HOME"', '"RESET"')]:
            with self.assertRaises(ValueError):
                rom_annotations(broken, {"sha256": catalogue["sha256"]})

    def test_dos_walkthrough_stops_come_from_the_machine_chapter(self):
        source = APPLE2.read_text()
        complete, cut, binary, boot, demo, startup = dos_walkthroughs(source)
        sector_reads = lambda tour: [(e["track"], e["sector"], e["buffer"]) for step in tour["steps"]
                                     if "track" in (e := step["expect"])]
        common = [(17, 12, 0xb4bb), (12, 6, 0x9700)]
        self.assertEqual(sector_reads(complete), [*common, (12, 5, 0x9600)])
        self.assertEqual(sector_reads(cut), common)
        for tour, pc, byte_address in [(complete, "D715", 0x0805), (cut, "D6DE", 0x0802)]:
            listing = tour["steps"][-1]
            self.assertEqual((listing["address"], listing["expect"]["address"]), (pc, byte_address))
            self.assertIn("queue LIST", listing["prepare"])
        handoff = binary["steps"][-1]
        self.assertEqual(binary["file"], dict(name="BEACON", type="B", address=0x6000, length=300))
        self.assertEqual(handoff["expect"], dict(jumpFrom=0xa394, indirect=0xaa72, target=0x6000))
        self.assertIn("queue BRUN BEACON", handoff["prepare"])
        request, store, integer, floating = boot["steps"]
        self.assertTrue(boot["fromPowerOn"])
        self.assertEqual(request["expect"], dict(dosCommand="BLOAD INTBASIC,A$D000"))
        self.assertEqual(store["expect"], dict(bank="bank2", address=0xd000, value=0xa9))
        self.assertEqual(integer["expect"], floating["expect"])
        self.assertEqual((integer["space"], floating["space"]), ("lc-upper", "rom"))
        catalogue, token, screen, gr, first, mirror = demo["steps"]
        self.assertEqual(demo["file"], dict(name="COLOR DEMO", type="I", entry=0x11e51, length=1921))
        self.assertEqual(catalogue["expect"], dict(address=0xb50e, value=0x81, catalogueName="COLOR DEMO"))
        self.assertEqual(token["expect"], dict(kind="read", address=0x8e82, value=0x4e))
        self.assertEqual(screen["expect"], dict(page=1, textCell=[0, 0], before=0xc4, after=0xa0))
        self.assertEqual([s["address"] for s in demo["steps"]], ["ABB5", "E686", "FCA2", "E686", "F818", "F818"])
        self.assertEqual((token["space"], screen["space"]), ("lc-upper", "lc-upper"))
        self.assertIn("queue RUN COLOR DEMO", catalogue["prepare"])
        self.assertIn("without entering another command", token["prepare"])
        self.assertIn("WHICH WOULD YOU LIKE?", gr["prepare"])
        self.assertEqual(gr["expect"], dict(kind="read", address=0x92c4, value=0x4c))
        for step, point, address in [(first, [1, 3], 0x481), (mirror, [3, 1], 0x403)]:
            self.assertEqual(step["expect"], dict(page=1, loresPixel=point, before=0, after=1))
            self.assertEqual((step["inspect"], step["space"]), (address, "lc-upper"))
        self.assertTrue(startup["fromPowerOn"])
        self.assertEqual([(s["address"], s.get("space", "ram"), s["inspect"], s["expect"]) for s in startup["steps"]], [
            ("C600", "device", 0x0000, dict(jumpFrom=0xfad2, indirect=0, target=0xc600)),
            ("C6F8", "device", 0x0800, dict(firstSector=0, bootSectors=1, ramAt=0x0800, afterInstruction=0xc6f6)),
            ("0801", "ram", 0x0801, dict(jumpFrom=0xc6f8, target=0x0801)),
            ("C65C", "device", 0x0026, dict(jumpFrom=0x0836, indirect=0x003e, target=0xc65c,
                                           slotRead=dict(sectorId=12, buffer=0x3f00))),
            ("084A", "ram", 0x3600, dict(firstSector=0, bootSectors=10, ramAt=0x3600, afterInstruction=0x0848)),
            ("3700", "ram", 0x37e9, dict(jumpFrom=0x084a, indirect=0x08fd, target=0x3700)),
            ("37B5", "ram", 0x37e8, dict(requestAt=0x37e8, read=dict(track=2, sector=4, buffer=0x3500))),
            ("379C", "ram", 0x3500, dict(track=2, sector=4, buffer=0x3500)),
            ("3741", "ram", 0x1b00, dict(firstSector=10, bootSectors=27, ramAt=0x1b00, afterInstruction=0x373e)),
        ])
        for old, new in [("S0–S9 in RAM", "S0–S16 in RAM"), ("in RAM at $3600", "in RAM at $BF00"),
                         ("T0 S10–T2 S4", "T2 S10–T2 S4"), ("T0 S10–T2 S4", "T0 S10–T35 S4"),
                         ("ID 12 into", "ID 16 into")]:
            with self.assertRaisesRegex(ValueError, "Invalid observation"):
                dos_walkthroughs(source.replace(old, new))
        with self.assertRaisesRegex(ValueError, "outside the slot 6 ROM"):
            dos_walkthroughs(source.replace("$C600 in slot 6", "$C700 in slot 6"))
        with self.assertRaisesRegex(ValueError, "Invalid observation"):
            dos_walkthroughs(source.replace("JMP $0801 at", "JMP $0800 at"))
        with self.assertRaisesRegex(ValueError, "Invalid observation"):
            dos_walkthroughs(source.replace("T12 S5 →", "T12 S16 →"))

    def test_rom_details_notes_and_walkthroughs_have_checked_cross_references(self):
        record = json.loads(re.search(r"```json\n(.*?)\n```", APPLE2_ROM.read_text(), re.S)[1])
        firmware = {"sha256": record["sha256"]}
        self.assertEqual([tour["id"] for tour in rom_annotations(APPLE2_ROM.read_text(), firmware)["walkthroughs"]],
                         ["echo", "carriage-return", "scroll", "cursor-edit", "output-hook"])
        self.assertEqual(sum("details" in routine for routine in record["routines"]), 4)
        changes = [
            ("routines", lambda value: value[2]["details"].update(workspace=["KBD"])),
            ("routines", lambda value: value[2]["details"].update(related=["Missing"])),
            ("routines", lambda value: value[2]["details"].update(inputs="")),
            ("notes", lambda value: value.append(value[0])),
            ("notes", lambda value: value[0].update(address="C000")),
            ("notes", lambda value: value[0].update(bytes="6c 36 00")),
            ("notes", lambda value: value[0].update(bytes="6C 36 00 00")),
            ("notes", lambda value: value[0].update(text="")),
            ("walkthroughs", lambda value: value.append(value[0])),
            ("walkthroughs", lambda value: value[0].update(steps=[])),
            ("walkthroughs", lambda value: value[0]["steps"][0].update(address="C000")),
            ("walkthroughs", lambda value: value[0]["steps"][0].update(address="FA61")),
            ("walkthroughs", lambda value: value[0]["steps"][0].update(routine="Missing")),
            ("walkthroughs", lambda value: value[0]["steps"][0].update(prepare="")),
        ]
        for field, change in changes:
            broken = json.loads(json.dumps(record))
            change(broken[field])
            with self.subTest(field=field, value=broken[field]), self.assertRaises(ValueError):
                rom_annotations("```json\n" + json.dumps(broken) + "\n```", firmware)

    def test_basic_lessons_publish_the_same_inputs_as_the_checked_transcripts(self):
        for slug, chapter in basic_lesson_catalogue().items():
            with self.subTest(lesson=slug):
                source = BASIC_LESSONS / f"{slug}.md"
                output = lesson_markdown(source, "/demo/", chapter["sessions"]).convert(chapter["body"])
                inputs = [line for block in CpuBlocks(output, "basic").blocks for line in block.split("\n")]
                self.assertEqual(inputs, [turn["input"] for session in chapter["sessions"] for turn in session])
                self.assertNotIn("<!-- basic-session:", output)
        self.assertEqual(chapter_link("your-first-basic-program.md", BASIC_LESSONS / "a-program-that-asks-a-question.md", "/demo/"),
                         "/demo/learn/your-first-basic-program/")

    def test_rom_regions_bound_reference_lookup_without_inventing_routine_ranges(self):
        source = APPLE2_ROM.read_text()
        record = json.loads(re.search(r"```json\n(.*?)\n```", source, re.S)[1])
        firmware = {"sha256": record["sha256"]}
        self.assertEqual(rom_annotations(source, firmware)["regions"][-1],
                         {"start": "F800", "end": "FFFF", "name": "Monitor ROM"})
        for regions in [[], None, [{"start": "C000", "end": "FFFF", "name": "Devices"}],
                        [{"start": "FFFF", "end": "F800", "name": "Backwards"}],
                        [{"start": "D000", "end": "F800", "name": "First"}, {"start": "F800", "end": "FFFF", "name": "Overlap"}],
                        [{"start": "D000", "end": "F7FF", "name": "Entries outside region"}],
                        [{"start": "D000", "end": "FFFF", "name": ""}]]:
            with self.subTest(regions=regions), self.assertRaises(ValueError):
                rom_annotations("```json\n" + json.dumps({**record, "regions": regions}) + "\n```", firmware)

    def test_address_labels_keep_workspace_hardware_and_rom_scopes_distinct(self):
        record = json.loads(re.search(r"```json\n(.*?)\n```", APPLE2_ROM.read_text(), re.S)[1])
        firmware = {"sha256": record["sha256"]}
        labels = {label["name"]: label for label in record["labels"]}
        self.assertEqual(labels["KBD"]["address"], "C000")
        self.assertEqual(labels["INVFLG"]["address"], "0032")
        self.assertEqual(labels["FMT1"]["scope"], "rom")
        self.assertEqual(labels["BASL"]["bytes"], 2)
        invalid = [None, {}, [labels["KBD"], labels["KBD"]],
                   [{**labels["BASL"], "bytes": 3}],
                   [{**labels["BASL"], "bytes": True}],
                   [{**labels["BASL"], "bytes": 2.0}],
                   [{**labels["BASL"], "address": "BFFF"}],
                   [{**labels["KBD"], "bytes": 2}],
                   [{**labels["KBD"], "scope": "workspace"}],
                   [{**labels["INVFLG"], "scope": "rom"}],
                   [{**labels["FMT1"], "scope": "hardware"}],
                   [{**labels["KBD"], "scope": "device"}],
                   [{**labels["KBD"], "address": "c000"}],
                   [{**labels["KBD"], "name": "HOME"}],
                   [{**labels["KBD"], "description": ""}],
                   [{**labels["FMT1"], "address": "FC58"}]]
        for labels in invalid:
            with self.subTest(labels=labels), self.assertRaises(ValueError):
                rom_annotations("```json\n" + json.dumps({**record, "labels": labels}) + "\n```", firmware)

    def test_basic_replies_are_preserved_and_escaped_with_their_input(self):
        turns = [[{"input": 'PRINT "<script>&"', "output": "<script>&\n\nOK"}]]
        output = lesson_markdown(BASIC_LESSONS / "your-first-basic-program.md", "/", turns).convert("<!-- basic-session:0 -->")
        self.assertNotIn("<script>", output)
        self.assertEqual(CpuBlocks(output, "basic").blocks, ['PRINT "<script>&"'])
        self.assertIn("&lt;script&gt;&amp;\n\nOK</pre>", output)
        self.assertIn("Type, then Enter", output)
        self.assertIn("BASIC replies", output)

    def test_machine_guide_preserves_fences_and_owns_browser_media_identity(self):
        source = ALTAIR.read_text()
        markdown = Markdown(extensions=["fenced_code", ChapterRendering(ALTAIR, "/demo/", lambda *_: "")])
        output = markdown.convert(source)
        self.assertEqual(CpuBlocks(output, "machine").blocks, re.findall(r"^```machine\n(.*?)^```$", source, re.M | re.S))
        self.assertEqual(chapter_link("altair-basic.md#media-and-host-delivery", ALTAIR, "/demo/"),
                         f"/demo/{MACHINES[ALTAIR]}#media-and-host-delivery")
        self.assertEqual(media_record(source)["bytes"], 4352)
        for invalid in ("", source + '\n```json\n{}\n```', '```json\n{"bytes": -1, "sha256": "bad"}\n```'):
            with self.assertRaises(ValueError):
                media_record(invalid)

    def test_apple2_guide_publishes_machine_fences_and_container_identity(self):
        source = APPLE2.read_text()
        markdown = Markdown(extensions=["fenced_code", ChapterRendering(APPLE2, "/demo/", lambda *_: "")])
        output = markdown.convert(source)
        self.assertEqual(CpuBlocks(output, "machine").blocks, re.findall(r"^```machine\n(.*?)^```$", source, re.M | re.S))
        self.assertEqual(chapter_link("apple2.md#using-the-browser-machine", APPLE2, "/demo/"),
                         f"/demo/{MACHINES[APPLE2]}#using-the-browser-machine")
        self.assertEqual(rom_container_record(source)["offset"], 8192)
        for offset in (-1, 20480, True, 1.5):
            with self.assertRaises(ValueError):
                rom_container_record(source.replace('"offset": 8192', f'"offset": {json.dumps(offset)}'))
        self.assertEqual(rom_container_record(source)["bootstrap"]["offset"], 1536)
        self.assertEqual(rom_container_record(source)["disk"]["bytes"], 143360)
        for old, new in [('"offset": 1536', '"offset": 20400'), ('"bytes": 256', '"bytes": 255'),
                         ('"bytes": 143360', '"bytes": 8192')]:
            with self.assertRaises(ValueError):
                rom_container_record(source.replace(old, new))

    def test_coco_guide_preserves_machine_definitions_and_local_navigation(self):
        source = COCO.read_text()
        markdown = Markdown(extensions=["fenced_code", ChapterRendering(COCO, "/demo/", lambda *_: "")])
        output = markdown.convert(source)
        self.assertEqual(CpuBlocks(output, "machine").blocks, re.findall(r"^```machine\n(.*?)^```$", source, re.M | re.S))
        self.assertEqual(chapter_link("coco.md#using-the-laboratory", COCO, "/demo/"),
                         f"/demo/{MACHINES[COCO]}#using-the-laboratory")
        self.assertIn("5375b1caef9df815b781d9cd6df81ecdaddd2642b06a01adac521e40f1329751", output)

    def test_every_cpu_block_survives_highlighting_verbatim(self):
        for path in CHAPTERS.glob("*.md"):
            with self.subTest(cpu=path.stem):
                source = path.read_text()
                expected = re.findall(r"^```cpu\n(.*?)^```$", source, re.M | re.S)
                markdown = Markdown(extensions=["fenced_code", ChapterRendering(path, "/", lambda *_: "/diagram.svg")])
                self.assertEqual(CpuBlocks(markdown.convert(source)).blocks, expected)

    def test_links_keep_chapters_local_and_repo_material_on_github(self):
        source = CHAPTERS / "8008.md"
        self.assertEqual(chapter_link("8080.md#stored-state", source, "/demo/"), "/demo/cpus/8080/#stored-state")
        self.assertEqual(chapter_link("#reset", source, "/"), "#reset")
        self.assertEqual(chapter_link("https://example.com/manual.pdf", source, "/"), "https://example.com/manual.pdf")
        self.assertEqual(chapter_link("../../../../docs/cpus/coverage.md#8008", source, "/"), f"{REPOSITORY}/blob/main/docs/cpus/coverage.md#8008")
        with self.assertRaises(ValueError):
            chapter_link("missing.md", source, "/")

    def test_references_are_rewritten_and_headings_keep_github_anchors(self):
        markdown = Markdown(extensions=["toc", ChapterRendering(CHAPTERS / "8008.md", "/demo/", lambda *_: "")], extension_configs={"toc": {"slugify": github_slug}})
        output = markdown.convert("## The programmer's machine\n\nSee [the other chip][chip].\n\n[chip]: 8080.md#stored-state")
        self.assertIn('id="the-programmers-machine"', output)
        self.assertIn('href="/demo/cpus/8080/#stored-state"', output)

    def test_cpu_source_cannot_become_markup(self):
        markdown = Markdown(extensions=[ChapterRendering(CHAPTERS / "8008.md", "/", lambda *_: "")])
        output = markdown.convert('```cpu\n// <script>alert("&")</script>\n```')
        self.assertNotIn("<script>", output)
        self.assertEqual(CpuBlocks(output).blocks, ['// <script>alert("&")</script>\n'])

    def test_storage_map_uses_the_given_schema_including_nested_fields(self):
        diagram = ET.fromstring(state_diagram({
            "accumulator": {"kind": "unsigned", "bits": 12},
            "saved": {"kind": "array", "length": 3, "element": {"bits": 20}},
            "alternate": {"kind": "group", "fields": {"carry": {"kind": "flag"}}},
            "mode": {"kind": "named-choice", "values": ["ready", "waiting"]},
            "stopped": {"kind": "boolean"},
        }))
        labels = [node.get("label") for node in diagram.iter()]
        self.assertIn("accumulator", labels)
        self.assertIn("saved · 3 × 20 bits", labels)
        self.assertIn("alternate", labels)
        self.assertIn("carry", labels)
        self.assertIn("mode · ready / waiting", labels)
        self.assertIn("stopped", labels)
        self.assertIn("12-bit registers", [node.text for node in diagram.iter("text")])

    def test_local_link_audit_catches_missing_fragments_and_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            page = output / "index.html"
            page.write_text('<h1 id="heading">Title</h1><a href="/demo/#heading">Jump</a>')
            check_site(output, "/demo/")
            for bad in ('<a href="#absent">Missing</a>', '<img src="gone.svg">', '<a href="/">Wrong prefix</a>', '<b id="same"></b><i id="same"></i>'):
                with self.subTest(html=bad), self.assertRaises(ValueError):
                    page.write_text(bad)
                    check_site(output, "/demo/")


if __name__ == "__main__":
    unittest.main()
