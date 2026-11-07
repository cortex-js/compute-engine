# Issue Tracking

## Introduction

As the project has grown, the need to improve our issue tracking has become more
urgent.

We currently have three sources to report and track issues:

- The COMPUTE_ENGINE.md file, owned by our sister project Tycho
- GitHub issues, used to track issues reported by external users
- The ROADMAP file

Some of the challenges we have today:

- the content of COMPUTE_ENGINE.md mixes both reported issues, as well as advice
  on how to use the COMPUTE_ENGINE and adoption checklists
- The ROADMAP file includes both future features and functionality improvements
  as well as defects of existing features. It keeps growing as new defects are
  discovered, and it's hard to prioritize which items to work on.
- we do not have a clear process to review and make decisions on features or
  issues

## Proposal

### Issue priority

In general, both **Impact** and **Probability** are considered to classify the
priority of an issue.

- **High Impact**: data loss, security, privacy
- **Medium Impact**: unexpected behavior, incorrect result
- **Low Impact**: cosmetic

- **High probability**: the issue will be encountered by most user or triggered
  by a basic usage of a functionality. For example, a problem that occurs
  anytime a new document is created, or when a function is called with
  parameters that are in range and not a corner case (not NaN, ∞, `Missing`,
  etc...).
- **Medium probability**: the issue will be encountered by few users. It
  requires using features with non-default settings, or features with a rare
  usage, or calling a function with an unusual combination of parameters or some
  less common values (`NaN`, `Missing`, `Nothing`, etc...)
- **Low Probability**: the issue requires a contrived situation or a crafted  
  witness that a user is unlikely to encounter.

The priority of an issue goes from `P0` (highest priority) to `P4` (lowest
priority).

- P0: the highest priority rating. A release should not be published with known
  P0 issues.

  P0 includes issues affecting security, loss of data, breach, complete system
  outage or broken core functionality. A P0 issue has priority over any other
  issues or work in progress. A release is issued as soon as the issue is
  resolved.

  All High Impact issues are P0 by default, although arguments can be made to
  reduce their priority on a case-by-case basis.

  Some Low Impact issue can be P0, for example, the name of the product is
  mispelled on the landing page.

- P1: malfunction of a major feature requiring urgent response. The product
  remains usable for most users, but some users will be impacted for some tasks.

  Medium Impact / High Probability issues are P1 by default.

- P2: a feature does not work as expected, a computation returns an incorrect
  result for a non-edge case.

  Medium Impact / Medium Probability issues are P1 by default.

- P3: a functionality or feature does not work as expected, but getting the
  error condition requires some complicated steps or affect very few users.

  Medium Impact / Low Probability are P2 by default.

- P4: an issue that is unlikely to have any user impact. It might require
  setting up a crafted test case that users are unlikely to encounter. When
  triggered, the consequences are mild.

  Low Impact issues are P4 by default.

### Ledgers

The issues are tracked as follow:

- In a new COMPUTE_ENGINE_ISSUES.md file. The COMPUTE_ENGINE.md file no longer
  tracks open issues, but is instead a longer term record of how to use CE in
  Tycho. A new COMPUTE_ENGINE_CHECKLIST.md contains the list of step to be taken
  when adopting a new CE release, based on the fixes that are expected in that
  release.

- In a new ISSUES.md file. The file ROADMAP.md only contains future feature and
  workstreams, not issues.

- In GitHub for user-submitted issues

### Issue Tagging

Issues can have one or more of the following tags:

- `NeedsReview`: the issue needs to be reviewed and adjuticated by the Bug
  Review Board. The result may be to close the issue or change its priority.
- `Close`: the issue should be closed. It does not indicate that the issue does
  not exist, but that a decision was made at this time to not address it. The
  decision may be revisited later as more data is acquired.
- `Investigate`: more data is needed before the issue can be adjuticated. This
  may require trying to reproduce the issue, investigating a potential cause,
  and proposing options and cost to resolve it. Once the investigation is
  complete, the `Investigate` flag is removed and replaced by `NeedsReview`
- `InProgress` an issue that is being worked on.
- `NeedDesign`: an issue that needs some clarification and a round of design
  before it can be picked up.

## Issue Workflow

### Issue Creation

- When an issue is first created, a `NeedsReview` tag is set on it. The author
  of the issue may suggest a priority P0-P4 for it and include a recommendation
  on how to dispose of the issue, but the priority may be left blank as well. A
  potential `P0` issue should be raised to the owner immediately.

### Bug Review Board Review

When reviewing issues, collect the issues in the following order:

- Any `P0`
- Any Tycho Open Issues
- Any GitHub Open Issues
- Any `NeedsReview`, ordered by `P1`, then `P2`, `P3` and `P4`.
- Any `Investigate`
- Any `InProgress`

The Bug Review Board then reviews each issue and provide a disposition:

- remove any `NeedsReview`, including a response if needed
- adjust the priority
- add/remove `Investigate`, with comment if needed.

### Issue Resolution

When resolving a batch of issues, consider the following issues, in order:

- Any `P0` is first. While a `P0` is in progress, not other issues can be picked
  up: this avoid having to wait for any work to complete before publishing a new
  release.
- Any Tycho Open Issues
- Any `P1` issues with a `NeedDesign` tag
- Any issue with an `Investigate` tag, with a `P1` or `P2` priority
- Any issue that does not have a `NeedsReview`, `Close`, `InProgress`,
  `Investigate` or `NeedDesign` tag, first `P1`, then `P2`, then `P3`. `P4`
  issues are not considered until they get promoted.
- Any `P2` with a `NeedDesign` tag
- Any `P3` issue with a `Investigate` tag.
- Any `P3` with a `NeedDesign` tag

## Tooling

A dashboard webapp can be invoked by the Bug Review Board to get an overall view
of the status of the issues. It lists the issues as described in Issue Workflow,
and includes both a "Bug Review Board" view listing the issues according to the
Bug Review Board section, and a "Issue Backlog" as described in "Issue
Resolution"

The "BRB" view allows the priority and tags of each issue to be modified, and a
comment added.
