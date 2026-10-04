# Security Policy

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Instead, report them privately through GitHub: [open a draft security advisory](https://github.com/mongj/mininet-web/security/advisories/new), or go to the repository's **Security** tab and click **Report a vulnerability**.

To help with triage, please include as much of the following as you can:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The affected commit, browser, and operating system
- Any suggested fix or mitigation

This project is maintained on a best-effort basis. You can expect an acknowledgement of your report, and updates in the advisory thread as it is investigated. Please give a reasonable amount of time for a fix to be released before disclosing the issue publicly. Reporters are credited in the published advisory unless they prefer to stay anonymous.

## Scope

Mininet Web is a static single-page app. It has no server-side entrypoint, API, or secrets: the Linux guest, Mininet, and Open vSwitch run inside a [v86](https://copy.sh/v86) emulator in the browser, and playground files stay in the browser.

Examples of issues that are in scope:

- Cross-site scripting or other script injection in the app
- Code in the guest or the playground escaping the emulator or the browser sandbox through this project's code
- Vulnerabilities in the build, vendoring, or deployment scripts in this repository

Examples of issues that are out of scope:

- Vulnerabilities in third-party components such as v86, Mininet, Open vSwitch, Alpine Linux, Monaco Editor, or basedpyright that are not caused by how this project uses them; please report those upstream
