# Systems Mobile Table Stickiness Design

## Problem

The Systems table keeps its Type and Name columns sticky during horizontal scrolling. This is useful on desktop, but those two columns consume most of a mobile viewport and obscure the operational columns the user is trying to inspect.

## Approved Behavior

- Type and Name remain sticky at viewport widths of 768 pixels and above.
- Below 768 pixels, Type and Name participate in normal table flow and scroll horizontally with every other column.
- The table remains a single horizontally scrollable surface on mobile.
- Existing column widths, ordering, visibility, resizing, virtualization, row selection, keyboard behavior, and responsive inspector behavior remain unchanged.

## Implementation

Apply sticky positioning through responsive CSS classes instead of unconditional inline `position: sticky` styles. Preserve each pinned column's horizontal offset so desktop positioning remains deterministic; the offset has no layout effect while the mobile column uses static positioning.

Use the existing Tailwind `md` breakpoint so the behavior is CSS-driven. Do not add viewport listeners, media-query hooks, or React state.

Apply the same responsive positioning to header and body cells. Preserve their existing opaque backgrounds so pinned desktop cells continue to cover horizontally scrolling content.

## Accessibility

The semantic table roles, keyboard navigation, focus restoration, and row activation behavior do not change. Mobile users retain access to every column through ordinary horizontal scrolling.

## Verification

- Add regression coverage proving Type and Name are only sticky from the `md` breakpoint upward.
- Verify both header and body cells use the same responsive behavior.
- Verify desktop offsets remain Type at zero and Name after the Type column width.
- Run lint, targeted tests, the complete test suite, and the production build.
- Check the Systems table at a mobile viewport and a desktop viewport for horizontal scrolling, alignment, selection backgrounds, and absence of overlap.

## Release Notes

Record this as a user-visible responsive Systems-table fix in the unreleased structured release notes and changelog.
