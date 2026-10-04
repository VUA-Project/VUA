VUA Windows preview

Extract the entire ZIP into a writable folder, then run VUA.exe. Keep the resources,
locales and other companion files together. Node.js, Rust and the source repository
are not needed to run this package. Supported preview architecture: Windows x64.

This unsigned development preview packages the current application. It is not the
completed first-play release. The guided desktop/PICO installation and play routes
are still being implemented. Product acceptance is tracked in the N sequence:
https://github.com/VUA-Project/VUA/blob/main/docs/development-outline.md

Application data is stored separately in %APPDATA%\VUA. To update, close VUA and
extract a new ZIP into a different folder. The new copy uses the same data directory.
To remove the app, close it and delete the extracted program folder. Keep the data
directory to retain settings and records; remove it separately only when no longer
needed. Back up data before experimenting with preview builds.

Licenses: resources\notices contains VUA's license and third-party summary. Electron
and Chromium notices accompany the runtime. A complete per-build dependency/license
review and signing decision are required before a public binary release.

VUA connects to independently installed Steam, SteamVR, VRChat and PICO Connect;
their installers, licenses and accounts remain with their respective publishers.
