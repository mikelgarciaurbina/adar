# Security policy

Adar runs git on your machine with your credentials, so security reports are taken seriously.

## Supported versions

Only the latest release receives fixes. The in-app updater (*Adar → Check for Updates…*) keeps installations current.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub Security Advisories](https://github.com/mikelgarciaurbina/adar/security/advisories/new) with:

- a description of the issue and its impact,
- steps to reproduce (a minimal repository or proof of concept if possible),
- the Adar, macOS and git versions involved.

You should get an answer within a few days. Once a fix is released, the advisory is published and you are credited
unless you prefer otherwise.

## Scope

Examples of issues we want to hear about: command or argument injection into git, path traversal when writing files,
leaking credentials (askpass, logs, toasts), the renderer escaping its sandbox, the dev HTTP bridge
(`npm run web`) being reachable by other sites or hosts, or the updater installing something that is not an official
release.
