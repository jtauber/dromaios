[
  "cpu" "state" "register" "flag" "array" "latch" "source" "view" "action"
  "policy" "operands" "codes" "conditions" "family" "encoding" "for" "in"
  "with" "named" "except" "fetch" "operand" "apply" "when" "test" "return"
  "fault" "alignment" "read" "write" "if" "commit" "addresses"
  "execution" "memory" "port" "counter" "stopped" "word" "opcode" "advance"
  "on" "dispatch" "after" "failure" "retain" "reset" "retire" "interrupt"
  "accept" "always" "bytes" "acknowledge" "preserve" "interface" "snapshot" "unknown"
] @keyword
["little" "big" "none"] @constant

(identifier) @variable
(state_identifier) @property
(source_declaration name: (identifier) @function)
(action_declaration name: (identifier) @function)
(policy_declaration name: (identifier) @function)
(family_declaration name: (identifier) @function)
(call function: (identifier) @function)
(apply_statement name: (identifier) @function)
(source_read name: (identifier) @function)
(interface_declaration name: (identifier) @type)
(number) @number
(string) @string
(escape_sequence) @string.escape
(comment) @comment
["=" "<-"] @operator
["{" "}" "[" "]" "(" ")"] @punctuation.bracket
[":" "," "."] @punctuation.delimiter
