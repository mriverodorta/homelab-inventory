# Systems Utilization Alignment Design

## Objective

Align each CPU, RAM, and storage utilization percentage with the left edge of
the hardware label above it while keeping every utilization bar anchored at the
same horizontal position.

## Layout

The utilization row uses a two-column grid:

- A fixed `4ch` percentage column, left aligned with the hardware label.
- A flexible bar column that consumes the remaining cell width.

The percentage column has no leading margin or padding. The existing gap
between the percentage and bar remains the only horizontal separation.

## Formatting

Percentages remain rounded to whole numbers. Single-digit values retain a
leading zero, so the visible forms are `00%` through `09%`, `10%` through
`99%`, and `100%`. Every value reserves four character cells, preventing the
bar from moving when the value changes.

## Responsive Behavior

The percentage never shrinks. The bar may shrink with the table column but
retains its existing minimum width, segmented markers, colors, and accessible
label. The hardware label above remains unchanged.

## Verification

Regression coverage must verify the formatting and stable four-character
layout for representative values `2%`, `20%`, and `100%`. Existing storage
warning and critical color thresholds remain unchanged.
