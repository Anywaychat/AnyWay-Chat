# Governance

How decisions are made in AnyWay Chat.

## Roles

| Role | Who | What they do |
| --- | --- | --- |
| **Users and testers** | Anyone who uses the app, especially deaf, blind, non-speaking and older people | Report problems, suggest ideas, test changes. Their experience guides every decision |
| **Contributors** | Anyone who opens an issue or pull request | Improve the code, docs, signs, translations and design |
| **Maintainers** | The project founder and people they invite | Review and merge pull requests, plan the roadmap, keep the project safe and welcoming |

The project was started by the founder of AnyWay Chat, who is the lead maintainer today. Contributors who make regular, careful contributions can be invited to become maintainers.

## How decisions are made

1. **Small changes** (bug fixes, docs, small improvements): one maintainer reviews and merges.
2. **Bigger changes** (new features, design changes, new dependencies): start with an issue. Maintainers discuss it in the open and look for agreement. If there is no agreement, the lead maintainer decides and explains why.
3. **Accessibility comes first.** A change that makes the app harder to use for any way of talking is not merged, even if it helps others.
4. **Privacy comes first.** A change that sends camera, microphone or personal data off the device needs a clear reason and maintainer agreement.

## Pull request review

- Every pull request needs passing checks (typecheck, lint, tests, build) and one maintainer's approval.
- Maintainers aim to reply to new pull requests within a week.
- Pull requests that change how a mode works should be tested by someone who uses that mode, whenever possible.

## Changes to this document

Changes to governance are proposed as a pull request and stay open for at least one week for comments before being merged.
