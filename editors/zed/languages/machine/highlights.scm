[
  "cpu" "memory" "end" "components" "map" "image"
  "ports" "in" "out" "reset" "reset-devices" "unmapped" "external" "sha256" "clock"
  "window" "read" "write" "discard" "offset" "when" "and"
] @keyword
(ram_declaration "ram" @keyword)

(cpu_model) @type
(storage_kind) @type
(device_kind) @type
(field_name) @property
(state_group name: (field_name) @keyword)
(component_name) @variable
(number) @number
(frequency) @number
(frequency_unit) @type
(digest) @string
(byte) @number
(boolean) @boolean
(named_value) @constant
(comment) @comment
"=" @operator
["{" "}" "[" "]"] @punctuation.bracket

"." @punctuation.delimiter
