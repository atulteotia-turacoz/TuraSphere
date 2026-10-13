## Admin → Parameters — Total column and score groups (2026-10-13)

The table now matches the Excel. A **Total** column shows the group total in one merged cell for each score group, or the parameter's own max score when it has no group. A **TOTAL** row at the bottom shows the sum (50 for all standard parameters), and the subtitle shows "standard assessment is out of 50". The add/edit form has **Score Group** and **Group Total** fields. The category list now includes C.10 Practo Patient Influence, Medical registration number and Government organisation.

| File | Change |
|---|---|
| `admin/src/pages/ParametersPage.js` | `capOf` helper, `groupSpan` merged Total cell, TOTAL row, form fields `score_group` / `group_max_score` (Group Total is required when a group is set), 3 more categories. |
