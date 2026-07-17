# Google Drive export setup

Lumen's reviewed-image upload path uses Chrome Identity and the narrow Google Drive `drive.file` scope. It cannot read a user's existing Drive files and does not upload anything until the user presses **Export to Drive** from a reviewed image.

## One-time publisher setup

1. Upload the extension package as a draft item in the Chrome Web Store dashboard.
2. Copy the item's public key into the source manifest as the `key` value so unpacked and published builds retain the same extension ID.
3. In Google Cloud, enable the Google Drive API for the Lumen project.
4. Create an OAuth client with application type **Chrome Extension** and enter the Chrome Web Store extension ID.
5. Set `LUMEN_GOOGLE_DRIVE_CLIENT_ID` to that client ID when running the package command.

The package builder injects this publisher-owned value only into the staged extension manifest:

```sh
LUMEN_GOOGLE_DRIVE_CLIENT_ID="000000000000-example.apps.googleusercontent.com" npm run package:extension
```

The source manifest intentionally contains no fake client ID. Without the environment value, local capture and review continue to work and the Drive control explains that publisher setup is still required.

## User consent and deletion

- Lumen requests the optional `identity` permission and Google API origin only after the user chooses to connect Drive.
- The OAuth scope is `https://www.googleapis.com/auth/drive.file`, which limits Lumen to files created or explicitly opened with Lumen.
- Disconnect removes the cached Chrome token and the optional permissions from the extension.
- Files already exported belong to the user's Drive and are not silently deleted when Lumen disconnects or is uninstalled.
