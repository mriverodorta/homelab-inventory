# Inspector Metadata Empty Actions Design

## Goal

Make empty metadata sections actionable from the inventory inspector without
duplicating metadata-management UI. Remove the Custom fields explanatory copy
that references Registry catalog content.

## Behavior

The inspector Metadata tab keeps its existing Tags and Custom fields sections.

- Remove the sentence `Installation-defined data that stays outside Registry
  catalog content.` from the Custom fields section.
- When no active tags are available, render the existing empty-state message
  with a `New tag` button.
- When no active custom field applies to the selected inventory item type,
  render the existing empty-state message with a `New custom field` button.
- The Custom fields action is contextual. It remains available when other
  custom fields exist installation-wide but none apply to the selected type.
- Creation actions are shown only to users with
  `inventory.metadata.manage`. Read-only users retain the informative empty
  state without an unusable control.
- Existing tags and applicable custom fields continue to render exactly as
  they do today.

## Settings Navigation

The application will own an explicit Settings destination containing:

- the Settings category, and
- the Inventory metadata subtab (`fields` or `tags`).

The destination flows from the application through the existing inspector
metadata context. Selecting an empty-state action will:

1. retain the selected inventory item and open inspector state;
2. open the existing Settings dialog;
3. select the `Inventory metadata` category; and
4. select the requested `Custom fields` or `Tags` subtab.

Closing Settings returns the user to the still-open inspector. The action does
not open a second metadata-management implementation and does not create a
field or tag until the user chooses the existing Settings creation control.

The Settings dialog and Inventory metadata tabs will accept controlled request
props and reconcile their local selection whenever a new destination is
requested. Normal Settings entry continues to use its existing default
category and tab.

## Component Boundaries

- `App` owns the requested Settings destination and opens the dialog.
- Settings prop construction carries the destination without coupling Settings
  to inspector state.
- `SettingsDialog` selects the requested category.
- `InventoryMetadataSettings` selects the requested metadata subtab.
- `InspectorInventoryMetadataContext` exposes a narrow
  `onOpenSettings(tab)` callback.
- `InventoryItemMetadataEditor` passes the callback and permission state to
  `InventoryMetadataForm`.
- `InventoryMetadataForm` owns only the empty-state presentation and invokes
  the supplied action.

No global browser events, URL parameters, or duplicate dialogs are introduced.
Existing shadcn `Button`, `Dialog`, and `Tabs` components remain unchanged.

## Accessibility And Layout

- Use text-and-icon shadcn buttons because these are explicit creation
  commands.
- Keep the actions inside their respective dashed empty-state regions.
- Button labels are `New tag` and `New custom field`.
- Buttons remain keyboard accessible and use their visible labels as accessible
  names.
- Empty states wrap vertically on narrow inspector widths without horizontal
  overflow.

## Tests

Automated coverage will prove:

1. the removed Registry sentence is absent;
2. an empty active-tag collection shows `New tag` for authorized users;
3. no applicable custom fields shows `New custom field`, including when fields
   exist for other inventory types;
4. read-only users do not receive creation actions;
5. each action requests the correct Settings category and metadata subtab;
6. Settings reconciles a new requested destination when reopened; and
7. existing populated metadata controls are unchanged.

Browser verification will exercise both empty actions in the local candidate,
confirm the correct Settings tabs open, close Settings back to the selected
inspector, and check desktop and narrow inspector layouts for overflow.

## Release Notes

This is a user-visible metadata workflow improvement. Add it to the structured
unreleased release notes and the `Unreleased` changelog section without bumping
the application version.
