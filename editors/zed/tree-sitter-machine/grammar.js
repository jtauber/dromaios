// This grammar describes syntax for editing. CPU state descriptions and the
// TypeScript machine parser remain responsible for semantic validation.
module.exports = grammar({
  name: 'dromaios_machine',

  extras: $ => [/\s/, $.comment],

  rules: {
    source_file: $ => repeat(choice(
      $.ram_declaration,
      $.cpu_declaration,
      $.memory_block,
      $.end_declaration,
      $.components_block,
      $.memory_connection,
      $.map_block,
      $.image_block,
      $.ports_block,
      $.reset_block,
    )),

    ram_declaration: $ => seq('ram', field('size', $.number)),
    cpu_declaration: $ => seq('cpu', field('model', $.cpu_model), $.state_block),
    // Model names are identifiers even when their spelling contains only digits.
    cpu_model: _ => /[a-zA-Z0-9_]+/,
    state_block: $ => seq('{', repeat(choice($.assignment, $.state_group)), '}'),
    state_group: $ => seq(field('name', $.field_name), $.state_block),
    assignment: $ => seq(field('name', $.field_name), '=', field('value', choice(
      $.number, $.boolean, $.named_value, $.number_array,
    ))),
    field_name: _ => /[a-zA-Z_][a-zA-Z0-9_]*/,
    number_array: $ => seq('[', repeat($.number), ']'),
    boolean: _ => choice('true', 'false'),
    // Named values must contain a non-hex letter (or underscore), making them
    // distinct from bare numbers without splitting false or fault into fa + ... .
    number: _ => token(choice(
      /0[xX][0-9a-fA-F]+/,
      /\$[0-9a-fA-F]+/,
      /[0-9][0-9a-fA-F]*[hH]/,
      /[0-9a-fA-F]+/,
    )),
    named_value: _ => token(choice(
      /[g-zG-Z_][a-zA-Z0-9_]*/,
      /[a-fA-F][a-fA-F0-9]*[g-zG-Z_][a-zA-Z0-9_]*/,
    )),

    memory_block: $ => seq('memory', field('address', $.number), $.byte_block),
    byte_block: $ => seq('{', repeat(choice($.byte, $.invalid_byte)), '}'),
    byte: _ => /[0-9a-fA-F]{2}/,
    // Keep malformed byte atoms whole instead of colouring FF00 as two bytes.
    // The application parser reports the error; editing can continue past it.
    invalid_byte: _ => /[^\s{}=\[\]/]+/,
    end_declaration: $ => seq('end', field('address', $.number)),

    components_block: $ => seq('components', '{', repeat($.component_declaration), '}'),
    component_declaration: $ => seq(field('name', $.component_name), '=', choice(
      seq(field('kind', $.storage_kind), field('size', $.number)),
      field('kind', $.device_kind),
    )),
    storage_kind: _ => choice('ram', 'rom'),
    device_kind: _ => choice('byte-input', 'byte-output'),
    component_name: _ => /[a-z][a-z0-9_]*/,
    memory_connection: $ => seq('memory', '=', $.component_name),
    map_block: $ => seq('map', field('size', $.number), '{', repeat($.map_entry), '}'),
    map_entry: $ => seq(field('address', $.number), '=', $.component_name),
    image_block: $ => seq('image', $.component_name, field('address', $.number), $.byte_block),
    ports_block: $ => seq('ports', '{', repeat($.port_binding), '}'),
    port_binding: $ => seq(
      field('direction', choice('in', 'out')), field('port', $.number), '=',
      $.component_name, field('address', $.number),
    ),
    reset_block: $ => seq(choice('reset', 'reset-devices'), '{', repeat($.component_name), '}'),

    comment: _ => token(seq('//', /[^\r\n]*/)),
  },
});
