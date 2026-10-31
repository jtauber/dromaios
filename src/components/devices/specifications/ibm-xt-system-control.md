# XT system control: check latches and NMI enable

The XT combines a write-only NMI-enable latch with RAM-parity and I/O-channel
check signals. This is board logic, not an AT CMOS index register or an 8042.
[IBM's Technical Reference][ibm], 1-10 and system-board sheets 2, 6, and 9,
connects PPI PB4/PB5 to the check enables and PC7/PC6 to the error indications.
Writing port `A0` captures data bit 7 as the NMI enable; the other data bits do
not select registers. Power-on reset clears the enable.

This definition models settled logical error inputs. A high PB4 or PB5 disables
and clears its check latch. With that control low, an asserted error sets the
latch; removing the error does not clear it. NMI is the enabled OR of those
latched errors. A low-to-high NMI transition records one pending offer. Further
sampling of a held high level cannot retrigger it. Clearing a check or disabling
NMI does not undo an already recorded edge. The board consumes that pending
offer after a successful CPU NMI entry; a deferred offer stays pending.

RAM bytes do not include parity bits in this model. The board supplies false
error inputs normally and exposes explicit inputs for diagnostics. Parity
calculation, sub-cycle pulses, electrical delay, and an 8087 error source are
outside this profile. Status reads and snapshots do not acknowledge an edge.

```device
device "ibm-xt-system-control"

state {
  register CONTROL: 8
  latch ENABLED
  latch PARITY_INPUT
  latch CHANNEL_INPUT
  latch PARITY_ERROR
  latch CHANNEL_ERROR
  latch NMI_LEVEL
  latch NMI_PENDING
}

action settle "Apply clear controls, retain errors, and capture a rising NMI" {
  control = register CONTROL
  parityInput = latch PARITY_INPUT
  channelInput = latch CHANNEL_INPUT
  parityError = latch PARITY_ERROR
  channelError = latch CHANNEL_ERROR
  enabled = latch ENABLED
  previous = latch NMI_LEVEL
  parity: flag = and(not(bit(control, 4)), or(parityError, parityInput))
  channel: flag = and(not(bit(control, 5)), or(channelError, channelInput))
  high: flag = and(enabled, or(parity, channel))
  PARITY_ERROR <- parity
  CHANNEL_ERROR <- channel
  NMI_LEVEL <- high
  when and(high, not(previous)) {
    NMI_PENDING <- 1
  }
}

action initialize "Choose a cleared board with released-high PPI control pins" {
  CONTROL <- u8($FF)
  ENABLED <- 0
  PARITY_INPUT <- 0
  CHANNEL_INPUT <- 0
  PARITY_ERROR <- 0
  CHANNEL_ERROR <- 0
  NMI_LEVEL <- 0
  NMI_PENDING <- 0
}

action setControl "Sample the PPI port-B outputs" (byte: 8) {
  CONTROL <- byte
  perform settle()
}

action setErrors "Apply logical RAM-parity and I/O-channel errors" (parity: flag, channel: flag) {
  PARITY_INPUT <- parity
  CHANNEL_INPUT <- channel
  perform settle()
}

source writeEnable "Capture only data bit 7 at the NMI mask port" (byte: 8): flag {
  ENABLED <- bit(byte, 7)
  perform settle()
  return 1
}

source status "PPI PC7/PC6 error indications, with other inputs clear" : 8 {
  parity = latch PARITY_ERROR
  channel = latch CHANNEL_ERROR
  return pack<8>(parity, channel, 0, 0, 0, 0, 0, 0)
}

source nmiPending "Observe a latched NMI offer" : flag {
  pending = latch NMI_PENDING
  return pending
}

action acknowledgeNmi "Consume an offer after completed CPU entry" {
  NMI_PENDING <- 0
}

source validState "Require settled clear controls, errors, and NMI level" : flag {
  control = register CONTROL
  parityInput = latch PARITY_INPUT
  channelInput = latch CHANNEL_INPUT
  parity = latch PARITY_ERROR
  channel = latch CHANNEL_ERROR
  enabled = latch ENABLED
  level = latch NMI_LEVEL
  parityValid: flag = and(not(and(bit(control, 4), parity)), or(bit(control, 4), or(not(parityInput), parity)))
  channelValid: flag = and(not(and(bit(control, 5), channel)), or(bit(control, 5), or(not(channelInput), channel)))
  return and(and(parityValid, channelValid), not(xor(level, and(enabled, or(parity, channel)))))
}

interface IbmXtSystemControl {
  size 1
  initialize initialize
  reset initialize
  validate validState
  input setControl
  input setErrors
  input acknowledgeNmi
  view status
  view nmiPending
  write 0 writeEnable
}
```

Reset is a whole-board initialization here: it clears errors and pending edges
and returns controls to the released PPI state. CPU-only reset leaves this
component alone. Snapshots include the input levels, retained errors, enable,
current NMI level, and pending edge. Restoring never manufactures a new edge.

[Tests](../../../../tests/components/devices/ibm-xt-system-control.test.ts)
check each clear/enable path, held inputs, pending edges, and restoration.

[ibm]: https://minuszerodegrees.net/manuals/IBM_5160_Technical_Reference_APR83.pdf
