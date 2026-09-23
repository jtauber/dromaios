"""Draw the compiler's stored-state schema with Sauvignon, without CPU tables."""

from collections import defaultdict
import xml.etree.ElementTree as ET


def state_diagram(state, width=720):
    """Group fields by storage type, retaining nested banks and exact field names.

    This is a map of emulator storage, not a claim about chip layout, register
    aliases, physical buses, or reset values.
    """
    root = ET.Element("diagram", {"width": str(width), "padding": "20", "theme": "light", "background": "#f7f5ef"})
    column = ET.SubElement(root, "column", {"gap": "18"})

    def fields(parent, schema):
        categories = defaultdict(list)
        for name, field in schema.items():
            kind = field["kind"]
            if kind == "group":
                categories[("group", name)].append((name, field))
            else:
                key = f'{field["bits"]}-bit registers' if kind == "unsigned" else {
                    "array": "Register arrays", "flag": "Flags", "boolean": "Control latches",
                    "choice": "Control choices", "named-choice": "Control choices",
                }[kind]
                categories[("fields", key)].append((name, field))
        for (kind, label), entries in categories.items():
            if kind == "group":
                group = ET.SubElement(parent, "contains", {"label": label, "layout": "column", "gap": "14", "padding": "14", "fill": "#edeae1", "stroke": "#c7c4b9", "color": "#243b37"})
                fields(group, entries[0][1]["fields"])
                continue
            ET.SubElement(parent, "text", {"color": "#596760", "font-size": "13"}).text = label
            row = ET.SubElement(parent, "row", {"wrap": "true", "width": str(width - 80), "gap": "8"})
            for name, field in entries:
                value = name
                if field["kind"] == "array":
                    value += f' · {field["length"]} × {field["element"]["bits"]} bits'
                elif field["kind"] in ("choice", "named-choice"):
                    value += " · " + " / ".join(map(str, field["values"]))
                ET.SubElement(row, "rect", {"label": value, "padding": "10", "fill": "#fffefa", "stroke": "#b5bdb2", "color": "#243b37", "font-family": "monospace", "font-size": "13", "rx": "3"})
    fields(column, state)
    return ET.tostring(root, encoding="unicode")
