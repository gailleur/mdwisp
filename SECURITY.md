# Security policy

mdwisp exists to open untrusted Markdown safely. Anything that lets a
document execute code, read files outside its own directory, or make a
network request is a security bug.

## What counts

- Script execution from document content (HTML, SVG, data URIs, Mermaid,
  KaTeX) despite sanitisation or the Content Security Policy.
- Reading or writing paths outside the opened document's directory.
- Any network request made by the app, for any reason. mdwisp is designed
  to make none.
- Crashes or hangs caused by crafted input are welcome too, at lower
  priority.

## Reporting

Use GitHub's private vulnerability reporting on this repository
("Security" tab, "Report a vulnerability"). Please do not open a public
issue for anything exploitable. Include the Markdown that triggers the
problem and the platform you saw it on.

You will get an acknowledgement within a week. Fixes ship as a normal
release; the advisory is published once a fixed version is available.

## Supported versions

Only the latest release is supported.
