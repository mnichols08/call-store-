# Vendored code

Copied in, not edited. A fix goes upstream and is re-copied; this file records what was copied and from where.

| What | Where from | Commit |
| --- | --- | --- |
| `vendor/kit/store`, `notice`, `reports`, `staff/pages.js` | github.com/potomac-solutions/kit, `modules/` (version 0.8.1) | `fd196d83645005f45b6bd7b4c07b35a2afd91ac5` |
| `vendor/kit/staff/index.js` | github.com/potomac-solutions/kit, `modules/staff` (main, with PRs #21 invite rules and #22 phone hand-off) | `daee4086852212bfbc402e894d56c36d7b18217c` |
| `src/web/components/{text-field,select-field,action-button,status-badge,alert-banner,empty-state,stat-card}.zb` | github.com/zubra-js/zubra-ui, `components/` | `ba5737ea04d6079914283f94582172b1bdc2447d` |
| `public/zubra-ui-theme.css` | github.com/zubra-js/zubra-ui, `themes/default.css` | `ba5737ea04d6079914283f94582172b1bdc2447d` |

Why copies: the kit is private and not on npm, and Zubra UI has no tagged release. The same approach Potomac HQ uses.

Not taken from the kit, on purpose: `stages` (its steps are a straight line; a call parks and resumes, so its lifecycle is `src/domain/call.js`), `customers` (accounts for shoppers who sign themselves up; ours are records staff keep), `catalog`, `cart`, `checkout`, `reserve`, `tenancy`.

Zubra itself (`@zubra/server`, `@zubra/compiler`, `@zubra/runtime`) comes from npm at an exact version.
