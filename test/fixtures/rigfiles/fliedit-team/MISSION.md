---
title: "fliedit-team mission"
seat: orch-lead
---

# Mission: FliEdit overlay gaps

**Purpose**: close the overlay gaps David found, then add the viewer verbs. See the [brief](https://example.test/brief).

## Seats

| Seat | Folder | Branch | Work |
|---|---|---|---|
| orch-lead | `/work/fliedit` | `main` | slice, route, merge |
| dev-ui | `/work/fliedit-ui` | `team/ui` | overlays and *polish* |
| dev-qa | clean archive | n/a | every slice |

## Rules

1. One slice at a time: build, then QA, then review.
2. Builders run the full gate before handing off:
   - `npm run lint`
   - `npm test`
3. Nothing is pushed without David's go.

> Quality over speed. There is no deadline.

```bash
rig up fliedit-team/rig.yaml
```

---

Unsafe link kept as text: [click me](javascript:alert(1))
