[
  "cpu" "state" "bank" "group" "register" "flag" "array" "latch" "choice" "source" "view" "action" "perform" "exchange"
  "policy" "operands" "pair" "codes" "conditions" "family" "page" "encoding" "for" "in"
  "with" "named" "except" "fetch" "operand" "apply" "replace" "when" "test" "return"
  "segmented" "segment" "shift" "record" "address" "prefixes" "limit" "repeat" "ignore" "pending" "vector" "sampling" "restore"
  "target" "devices" "sample" "boundary" "report" "send" "escape"
  "choose" "else" "iterate" "step" "next" "divide" "reject" "signed" "unsigned"
  "program" "fault" "alignment" "read" "write" "if" "commit" "addresses" "defer" "irq" "intr" "all" "into" "notify" "reti"
  "execution" "memory" "port" "counter" "stopped" "word" "opcode" "advance"
  "on" "dispatch" "decode" "then" "external" "after" "failure" "retain" "reset" "retire" "interrupt"
  "accept" "always" "unless" "bytes" "acknowledge" "preserve" "interface" "snapshot" "unknown"
  "callback" "validate" "offer" "using" "entries" "offers" "enter" "select" "supplied" "vectors" "as" "match" "case" "otherwise" "resume"
] @keyword
["little" "big" "none" "waiting" "unsupported"] @constant

(identifier) @variable
(state_identifier) @property
(source_declaration name: (identifier) @function)
(action_declaration name: (identifier) @function)
(policy_declaration name: (identifier) @function)
(family_declaration name: (identifier) @function)
(call function: (identifier) @function)
(apply_statement name: (identifier) @function)
(perform_statement name: (identifier) @function)
(source_read name: (identifier) @function)
(interface_declaration name: (identifier) @type)
(number) @number
(string) @string
(escape_sequence) @string.escape
(comment) @comment
["=" "<-"] @operator
["{" "}" "[" "]" "(" ")"] @punctuation.bracket
[":" "," "."] @punctuation.delimiter
