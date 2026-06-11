# Moodle Courses

An [Obsidian](https://obsidian.md) plugin that lets you browse your RWTH Aachen
Moodle courses and their documents in a sidebar tree, and download files
straight into your vault.

> **Note:** This plugin is built specifically for the RWTH Aachen Moodle
> instance (`moodle.rwth-aachen.de`) and its Shibboleth single sign-on flow.

## Features

- **Course sidebar** – browse all the courses you are enrolled in as a
  collapsible tree of sections, activities, and files.
- **RWTH SSO login** – authenticates through the RWTH single sign-on flow,
  including two-factor authentication (TOTP).
- **Automatic or manual 2FA** – store your TOTP secret to generate codes
  automatically, or leave it empty to be prompted for a code on each login.
- **Download into your vault** – click a file to download it directly into your
  Obsidian vault.
- **Map folders** – assign any course, section, or Moodle folder to a vault
  folder; files downloaded from it (and anything nested, unless it has its own
  mapping) land there automatically.
- **Hide and rename courses** – hide courses you don't care about (with a toggle
  to show them again) and give courses custom display names via the right-click
  menu.
- **Refresh** – reload the course list and contents on demand.

## Installation

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the
   [latest release](https://github.com/koproductions-code/obsidian_moodle/releases).
2. Copy them into your vault under
   `<Vault>/.obsidian/plugins/moodle-courses/`.
3. Reload Obsidian and enable **Moodle Courses** under
   **Settings → Community plugins**.

### From source

```bash
git clone https://github.com/koproductions-code/obsidian_moodle.git
cd obsidian_moodle
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into
`<Vault>/.obsidian/plugins/moodle-courses/`.

## Setup

1. Open **Settings → Moodle Courses**.
2. Fill in your **RWTH SSO credentials**:
   - **Username** – your RWTH single sign-on username (e.g. `ab123456`).
   - **Password** – your RWTH password.
   - **TOTP serial number** – the serial of your TOTP token, found at
     [idm.rwth-aachen.de/selfservice/MFATokenManager](https://idm.rwth-aachen.de/selfservice/MFATokenManager).
   - **TOTP secret** *(optional)* – if set, login codes are generated
     automatically. Leave it empty to enter a code manually each time.
3. Click **Login**. Once connected, the settings page shows
   *Connected to moodle.rwth-aachen.de*.

You can disconnect at any time with the **Disconnect** button, which clears the
stored session.

## Usage

- Click the **graduation cap** ribbon icon, or run **Open courses sidebar** from
  the command palette, to open the course tree.
- Run **Login to RWTH Moodle** from the command palette to authenticate without
  opening the sidebar.
- In the sidebar:
  - Expand a course to load its sections and files.
  - Click a file to download it into your vault.
  - Hover a course, section, or folder and click the **📁** button to map it to
    a vault folder — downloads from it then go there instead of next to the
    active note. The most specific mapping wins (folder over section over
    course). Manage or remove mappings under **Settings → Moodle Courses →
    Download folders**.
  - Use the eye toggle in the header to show or hide hidden courses.
  - Use the refresh button to reload courses and contents.
  - Right-click a course name to rename or hide it.

## Privacy

Your credentials and session token are stored locally in the plugin's settings
data inside your vault. The plugin communicates **only** with
`moodle.rwth-aachen.de` (and the RWTH SSO endpoints required for login). No data
is sent anywhere else and there is no telemetry.

The SSO authentication flow is adapted from the
[syncmymoodle](https://github.com/Romern/syncmymoodle) project.

## Development

```bash
npm install      # install dependencies
npm run dev      # build in watch mode
npm run build    # production build (type-check + bundle)
npm run lint     # run ESLint
```

Source lives in `src/`:

| File             | Responsibility                                  |
| ---------------- | ----------------------------------------------- |
| `main.ts`        | Plugin lifecycle, commands, ribbon icon, login  |
| `settings.ts`    | Settings interface, defaults, and settings tab  |
| `RWTHAuth.ts`    | RWTH Shibboleth SSO authentication flow         |
| `MoodleApi.ts`   | Moodle web-service API calls and file downloads |
| `MoodleView.ts`  | The sidebar view                                |
| `MoodleTree.ts`  | Rendering the course/section/file tree          |
| `TotpModal.ts`   | Prompt for a TOTP code                          |
| `totp.ts`        | TOTP code generation                            |
| `httpClient.ts`  | HTTP client with cookie handling                |

## License

See [LICENSE](LICENSE).
