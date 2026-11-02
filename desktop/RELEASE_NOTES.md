# DocuTeach 0.1.0 (Windows)

First desktop build: the DocuTeach editor in its own window, with the mock assistant. No installer, no network, no Python or Node needed.

- Unzip `DocuTeach-0.1.0-win64.zip` and run `DocuTeach\DocuTeach.exe`.
- Your lessons are saved as plain files in `%APPDATA%\DocuTeach\data`.
- If Microsoft WebView2 is missing, DocuTeach opens in your default browser instead.

**Unsigned exe.** Windows may show "Windows protected your PC": click "More info", then "Run anyway". Some antivirus tools may flag PyInstaller programs falsely. Check the zip against `SHA256SUMS.txt`: `certutil -hashfile DocuTeach-0.1.0-win64.zip SHA256`.

Licence: MIT. Bundled libraries are listed in `THIRD_PARTY_NOTICES.txt`.
