// Each Markdown fence is parsed independently. Names, widths, encodings, and
// effects are validated by the chapter compiler, not by the editor grammar.
const commaSeparated = rule => seq(rule, repeat(seq(',', rule)));

module.exports = grammar({
  name: 'dromaios_cpu',
  extras: $ => [/\s/, $.comment],
  word: $ => $.identifier,

  rules: {
    source_file: $ => repeat(choice(
      $.cpu_declaration, $.state_declaration, $._state_field,
      $.source_declaration, $.action_declaration, $.policy_declaration,
      $.operands_declaration, $.codes_declaration, $.conditions_declaration,
      $.family_declaration, $.execution_declaration, $.interface_declaration,
    )),

    cpu_declaration: $ => seq('cpu', field('model', $.string)),
    state_declaration: $ => seq('state', '{', repeat($._state_field), '}'),
    _state_field: $ => choice($.register_declaration, $.array_declaration, $.flag_declaration),
    register_declaration: $ => seq('register', $._state_name, ':', $.number, optional($.field_mapping)),
    array_declaration: $ => seq('array', $._state_name, ':', $.number, '[', $.number, ']', optional($.field_mapping)),
    flag_declaration: $ => seq(choice('flag', 'latch'), $._state_name, optional($.field_mapping)),
    field_mapping: $ => seq('=', $.identifier),

    source_declaration: $ => seq(choice('source', 'view'), field('name', $.identifier), $.string, ':', $.number, $.body),
    action_declaration: $ => seq('action', field('name', $.identifier), $.string, optional($.parameters), optional(seq('using', 'memory')), $.body),
    policy_declaration: $ => seq('policy', field('name', $.identifier), $.string, $.parameters,
      '{', repeat($.flag_update), '}'),
    parameters: $ => seq('(', optional(commaSeparated($.parameter)), ')'),
    parameter: $ => seq($.identifier, ':', choice($.number, 'flag')),
    flag_update: $ => seq($._state_name, '=', $._expression),

    operands_declaration: $ => seq('operands', field('name', $.identifier), '{', repeat($.operand_entry), '}'),
    operand_entry: $ => seq($.number, $.string, '=', choice(
      seq('register', $._state_name), seq('pair', $._state_name, $._state_name), seq(choice('memory', 'value'), $.identifier),
    )),
    codes_declaration: $ => seq('codes', field('name', $.identifier), optional(seq(':', $.number)),
      '{', repeat($.code_entry), '}'),
    code_entry: $ => seq($.number, $.string, optional(seq('=', $.number))),
    conditions_declaration: $ => seq('conditions', field('name', $.identifier), '{', repeat($.condition_entry), '}'),
    condition_entry: $ => seq($.number, $.string, '=', 'flag', $._state_name, '=', $.number),

    family_declaration: $ => seq('family', field('name', $.identifier), choice(
      seq($._encoding, $.body),
      seq('{', repeat1($.encoding_declaration), repeat($._statement), '}'),
    )),
    encoding_declaration: $ => seq('encoding', $._encoding),
    _encoding: $ => seq(field('pattern', $.string),
      optional(seq('for', commaSeparated($.selector))),
      optional(seq('with', commaSeparated($.source_binding))),
      optional(seq('named', $.string)),
      optional(seq('except', commaSeparated($.string))),
    ),
    selector: $ => seq($.identifier, 'in', $.identifier, optional(seq('.', field('view', $.identifier)))),
    source_binding: $ => seq($.identifier, '=', $.identifier),

    body: $ => seq('{', repeat($._statement), '}'),
    _statement: $ => choice(
      $.capture, $.write, $.apply_statement, $.perform_statement, $.when_statement,
      $.return_statement, $.fault_statement, $.commit_statement, $.defer_statement,
    ),
    capture: $ => seq(field('name', $.identifier), '=', choice($._read, $._expression)),
    _read: $ => choice(
      'fetch', $.state_read, $.array_read, $.source_read, $.operand_read,
    ),
    state_read: $ => seq(choice('register', 'flag', 'latch'), $._state_name),
    array_read: $ => seq('array', $._state_name, '[', $._expression, ']'),
    source_read: $ => seq('source', field('name', $.identifier)),
    operand_read: $ => seq('operand', $.identifier),
    write: $ => seq(choice($._state_name, $.array_target, $.operand_target, $.memory_target), '<-', $._expression),
    array_target: $ => seq($._state_name, '[', optional($._expression), ']'),
    operand_target: $ => seq('operand', $.identifier),
    memory_target: $ => seq(choice('memory', 'port'), '(', $._expression, ')'),
    apply_statement: $ => seq(choice('apply', 'replace'), field('name', $.identifier), $.arguments),
    perform_statement: $ => seq('perform', field('name', $.identifier), $.arguments),
    when_statement: $ => seq('when', choice(seq('test', $.identifier), $._expression), $.body),
    return_statement: $ => seq('return', $._expression),
    fault_statement: $ => seq('fault', 'alignment', choice('read', 'write'),
      '(', $._expression, ')', 'if', $._expression),
    commit_statement: _ => seq('commit', 'addresses'),
    defer_statement: _ => seq('defer', 'irq'),
    _expression: $ => choice($.identifier, $.number, $.call),
    call: $ => seq(field('function', $.identifier), $.arguments),
    arguments: $ => seq('(', optional(commaSeparated($._expression)), ')'),

    execution_declaration: $ => seq('execution', '{', repeat(choice(
      $.memory_policy, $.counter_policy, $.stopped_policy, $.word_policy,
      $.opcode_policy, $.operand_policy, $.failure_policy, $.action_policy, $.retirement_policy, $.interrupt_policy,
    )), '}'),
    memory_policy: $ => seq('memory', $.number),
    counter_policy: $ => seq('counter', $._state_name, 'write', $.identifier),
    stopped_policy: $ => seq('stopped', choice('none', $._state_name)),
    word_policy: _ => seq('word', choice('little', 'big')),
    opcode_policy: _ => seq('opcode', 'advance', 'on', choice('dispatch', 'read')),
    operand_policy: _ => seq('operand', 'advance', 'after', 'read'),
    failure_policy: _ => seq('failure', 'retain'),
    action_policy: $ => seq(choice('reset', 'retire'), choice('none', seq('action', $.identifier))),
    retirement_policy: $ => seq('retire', 'irq', 'into', $._state_name),
    interrupt_policy: $ => seq('interrupt', optional('vectors'), '{', repeat(choice(
      $.vector_entry,
      $.accept_policy, $.bytes_policy, $.callback_policy, $.interrupt_counter_policy, $.unknown_policy,
    )), '}'),
    vector_entry: $ => seq('source', $.identifier, choice('always', seq('unless', 'flag', $._state_name)),
      'with', $.call),
    accept_policy: $ => seq('accept', choice('always',
      seq('when', $._state_name, optional(seq('unless', $._state_name)))), 'with', $.identifier),
    callback_policy: _ => seq('callback', 'validate', 'on', choice('offer', 'read')),
    bytes_policy: _ => seq('bytes', 'acknowledge'),
    interrupt_counter_policy: _ => seq('counter', choice('preserve', 'advance')),
    unknown_policy: _ => seq('unknown', 'retain'),
    interface_declaration: $ => seq('interface', field('name', $.identifier), $.string,
      '{', repeat($.snapshot_declaration), '}'),
    snapshot_declaration: $ => seq('snapshot', $.identifier, '=', $._state_name),

    // State symbols are syntactically distinct from captured values in queries.
    // Accept unknown/lowercase names so incomplete edits still retain structure.
    _state_name: $ => alias($.identifier, $.state_identifier),
    identifier: _ => /[A-Za-z][A-Za-z0-9_]*/,
    number: _ => token(choice(/[0-9]+/, /\$[0-9a-fA-F]+/)),
    string: $ => seq('"', repeat(choice($.string_content, $.escape_sequence)), '"'),
    // Keep // inside a string from winning over its next content segment.
    string_content: _ => token.immediate(prec(1, /[^"\\\r\n]+/)),
    escape_sequence: _ => token.immediate(seq('\\', choice(/["\\/bfnrt]/, /u[0-9a-fA-F]{4}/))),
    comment: _ => token(seq('//', /[^\r\n]*/)),
  },
});
