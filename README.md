# TODA President Control Panel

Local-first management software for one TODA President to maintain tricycle
driver records, driver-specific complaint QR codes, fares, and imported
complaints.

This project is designed for a **single local operator**. It is not a cloud
multi-tenant system, a payment platform, or a public passenger account system.

## 1. Scope

### Included

- President-only login with a local MySQL-backed session.
- Driver and tricycle registry:
  - Add, view, edit, activate/inactivate, and archive records.
  - Driver name, body number, plate number, phone, address, license number,
    member-since date, and optional photo.
- Driver-specific QR codes.
  - Each QR opens the shared Google complaint form.
  - The driver's body number is prefilled automatically.
  - QR images are generated locally in the browser.
- Printable QR sheets for filtered drivers.
- Fare reference storage.
- Google Forms CSV import:
  - Header mapping for common Google Forms names.
  - Preview, validation, duplicate detection, and local complaint tracking.
- Complaint resolution status.
- Audit Log for important actions.
- Local database backup and restore scripts.
- Versioned, non-destructive database migrations.

### Explicitly excluded

- Online payment processing, e-wallets, receipts, or driver revenue reports.
- Passenger accounts or public application accounts.
- Multiple organizations, roles, or tenant switching.
- A live Google Forms API integration.
- Cloud database hosting.
- Cars, jeeps, buses, or non-tricycle vehicle types.

Google Forms still needs internet access when a passenger scans a QR code.
The control panel itself and previously imported records work locally.

## 2. Architecture

```text
React + Vite frontend (localhost:8443)
              |
              | HTTP requests with an HttpOnly session cookie
              v
Node.js + Express API (localhost:5000)
              |
              +--> MySQL database: toda
              |
              +--> Local driver photos: uploads\driver-photos\
              +--> Temporary CSV files: temp\
```

### Frontend

- Entry point: [`src/main.tsx`](./src/main.tsx)
- Main application: [`src/App.tsx`](./src/App.tsx)
- Styling: [`src/index.css`](./src/index.css)
- Responsibilities:
  - Render the login gate and application pages.
  - Call the API with `credentials: "include"`.
  - Generate QR images locally.
  - Preview photo and CSV selections before saving/importing.
  - Display registry, complaints, fares, and audit events.

### Backend

- Active API: [`server.js`](./server.js)
- The API validates requests, checks the session, writes records to MySQL,
  stores audit events, and serves local driver photos.
- Protected routes return JSON `401 Unauthorized` when no valid session exists.
- The root `server.js` is the active backend. [`legacy-backend/`](./legacy-backend)
  is archived compatibility code and must not be started for this application.

### Database

- Database name: `toda`
- Migrations: [`migrations/`](./migrations)
- Migration runner: [`scripts/migrate-database.js`](./scripts/migrate-database.js)
- Migrations are recorded in the `schema_migrations` table and run once in
  filename order.

Main tables:

| Table | Purpose |
|---|---|
| `toda_admin` | President username and bcrypt password hash |
| `tricycle_units` | Driver/tricycle registry records |
| `tricycle_complaints` | Imported complaint records |
| `fare_settings` | Local fare reference |
| `sessions` | MySQL-backed Express sessions |
| `login_attempts` | Persistent failed-login throttling |
| `audit_logs` | Important activity history |
| `schema_migrations` | Applied migration versions |

## 3. Requirements for a new computer

Install:

- Windows 10 or later.
- Node.js compatible with the project toolchain.
- `pnpm`.
- MySQL Server 9.x, MySQL 8.x, or a compatible local MySQL installation.
- Git, if the team is cloning the repository.

The MySQL service must be running on `127.0.0.1:3306`.

Check that MySQL is running in Administrator PowerShell:

```powershell
Get-Service | Where-Object {
  $_.Name -match "mysql|maria" -or $_.DisplayName -match "mysql|maria"
}
```

Start the service using the exact service name shown, for example:

```powershell
Start-Service MySQL80
```

Verify the server:

```powershell
& "C:\Program Files\MySQL\MySQL Server 9.5\bin\mysqladmin.exe" -u root ping
```

The expected response is:

```text
mysqld is alive
```

If MySQL is installed in another directory, adjust the executable path.

## 4. Easiest client installation (recommended)

For a local client installation, do not ask the client to manage two
terminals. Copy the project folder to the client computer, install Node.js,
pnpm, and MySQL once, then double-click [`setup-toda.bat`](./setup-toda.bat).

The setup script:

1. Creates the local `.env` file from `.env.example`.
2. Opens the file so the client's MySQL password and a new session secret can
   be entered locally.
3. Installs dependencies.
4. Applies safe database migrations.
5. Migrates any legacy driver photos.
6. Builds the frontend.

After setup, the client only needs to double-click
[`start-toda.bat`](./start-toda.bat). It starts MySQL, starts the API, opens
the browser, and serves the built frontend from the same local server at
`http://localhost:5000`. There is no separate Vite terminal for normal use.

The client should use [`backup.bat`](./backup.bat) or the documented backup
command regularly. Keep the project folder and the `uploads\` folder together.

## 5. First-time setup (manual alternative)

Open PowerShell and run:

```powershell
cd "C:\Users\<your-windows-user>\OneDrive\Desktop\Software engr"
pnpm install
Copy-Item .env.example .env
```

Open `.env` and set the local database values:

```dotenv
VITE_API_BASE_URL=http://localhost:5000
DB_USER=root
DB_PASSWORD=your-local-mysql-password
SESSION_SECRET=generate-a-long-random-secret
SESSION_COOKIE_SECURE=false
PORT=5000
```

`SESSION_SECRET` must be unique and random on every installation. Do not copy
the existing developer's `.env` file to another computer.

Apply the safe migrations:

```powershell
pnpm db:migrate
```

If the database contains older Base64 driver photos, migrate them once:

```powershell
pnpm photos:migrate
```

The migration command creates the `toda` database and required tables if needed.
It does not delete existing records.

## 6. Running the project manually

Use two terminals.

### Terminal 1: API

```powershell
cd "C:\Users\<your-windows-user>\OneDrive\Desktop\Software engr"
node server.js
```

The API listens on:

```text
http://127.0.0.1:5000
```

### Terminal 2: frontend

```powershell
cd "C:\Users\<your-windows-user>\OneDrive\Desktop\Software engr"
pnpm dev
```

Open:

```text
http://localhost:8443
```

Do not start `legacy-backend`. Do not run the old `01_init_schema.sql` after
real data exists.

## 7. Useful commands

```powershell
pnpm dev              # Start Vite development frontend
pnpm build            # Create a production frontend build in dist\
pnpm test             # Run API tests
pnpm db:migrate       # Apply missing database migrations
pnpm photos:migrate   # Move old Base64 photos to local files
pnpm backup:db        # Create a MySQL backup
pnpm restore:db       # Restore after explicit confirmation
pnpm format           # Format supported source files
```

Run authenticated tests by supplying the actual President password only for
the current terminal session:

```powershell
$env:TEST_PRESIDENT_PASSWORD="your-president-password"
pnpm test
Remove-Item Env:TEST_PRESIDENT_PASSWORD
```

The password is not stored in the test files or repository.

## 8. Database safety

Use migrations for every schema change:

```text
migrations/001_create_core_schema.sql
migrations/002_add_registry_details.sql
migrations/003_add_security_audit_tables.sql
migrations/004_add_driver_photo_paths.sql
```

`01_init_schema.sql` is historical only. It contains destructive database reset
logic and must not be rerun against a database containing real records.

Before major changes:

```powershell
pnpm backup:db
```

Restore only after confirming the selected backup and understanding that it
replaces the target database:

```powershell
pnpm restore:db
```

Keep these local and backed up separately:

- `.env`
- `backups\`
- `uploads\driver-photos\`
- The MySQL database itself

The current `pnpm backup:db` and `backup.bat` commands back up the MySQL
database only. They do **not** package the files under
`uploads\driver-photos\`. To make a complete backup, copy the entire
`uploads\driver-photos\` folder together with the generated SQL backup. A
database restore alone cannot restore photo files.

## 9. Security and privacy

- Passwords are stored as bcrypt hashes, not plaintext.
- Sessions are stored in MySQL and use an HttpOnly, SameSite cookie.
- Failed login attempts are throttled and stored in MySQL.
- Protected API routes require an authenticated session.
- State-changing requests reject unknown browser origins.
- Driver photos are limited to JPG, PNG, and WebP files up to 5 MB.
- CSV uploads are limited to 5 MB and temporary files are removed.
- Driver photos are stored locally under ignored `uploads\driver-photos\`.
- `.env` is ignored and must never be sent to a client or committed.
- Keep MySQL bound to localhost and do not expose port `3306` publicly.

For an HTTPS deployment, set:

```dotenv
SESSION_COOKIE_SECURE=true
```

Do not set it to `true` for the current HTTP localhost setup.

## 10. API overview

All routes below `/api` after login are protected unless stated otherwise.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Public database readiness check |
| POST | `/api/login` | Start President session |
| POST | `/api/logout` | End session |
| GET | `/api/session` | Check current session |
| POST | `/api/account/password` | Change President password |
| GET | `/api/dashboard/summary` | Read dashboard counts |
| GET | `/api/tricycles` | List active registry records |
| POST | `/api/tricycles` | Create a registry record |
| PATCH | `/api/tricycles/:id` | Edit/status/photo changes |
| DELETE | `/api/tricycles/:id` | Archive a registry record |
| GET | `/api/driver-photos/:filename` | Serve a validated local photo |
| GET | `/api/fare-settings` | Read fare reference |
| PUT | `/api/fare-settings` | Save fare reference |
| POST | `/api/complaints/import` | Import a complaint CSV |
| GET | `/api/complaints` | List complaints |
| PATCH | `/api/complaints/:id/resolve` | Toggle complaint resolution |
| GET | `/api/audit-logs` | Read recent audit events |

## 11. Short operator guide

### Start and stop

1. Double-click `start-toda.bat`.
2. Wait for the browser to open at `http://localhost:5000`.
3. Log in with the President account.
4. To stop the application, close the `TODA Control Panel` command window.

Start MySQL first if the script reports that the MySQL service could not be
started. Do not start `legacy-backend`.

### Manage drivers

1. Open **Registry**.
2. Use **Add driver** to enter the driver's required details.
3. Select a driver to view the profile, QR code, or printable information.
4. Use **Edit** to correct details or replace a photo.
5. Use **Archive** when the record should no longer be active. Archiving is
   preferred to deleting a record because it preserves history.
6. Refresh the browser after adding a photo and confirm that it still appears.

### Use QR codes

Each driver's QR code contains that driver's body number and opens the shared
Google complaint form. Print the individual QR code or a filtered QR sheet.
Scanning and submitting the Google Form requires internet access.

### Import and resolve complaints

1. Export responses from Google Forms as CSV.
2. Open **Complaint Sync** and select the CSV file.
3. Review the preview and import the valid rows.
4. Use the complaint list to mark a complaint resolved when it has been
   handled.
5. Re-importing the same file is safe because duplicate rows are detected.

### View the Audit Log

Open **Audit Log** to review recent logins and important changes such as driver
updates, fare changes, complaint imports, complaint resolution, and password
changes. If the log cannot load, confirm that the API window is running and
that MySQL is available.

### Change the password

Open **Settings**, change the President password, and store the new password
in the organization's approved password location. Do not put it in the
project folder, README, email, or chat.

### Back up and restore

Run `backup.bat` or:

```powershell
pnpm backup:db
```

Then copy both the generated SQL file in `backups\` and the
`uploads\driver-photos\` folder to protected backup storage. Keep backups
separate from the computer running the application.

Restore only with approval:

```powershell
restore.bat backups\toda-YYYYMMDD-HHMMSS.sql
```

The restore command asks for the exact confirmation word `RESTORE` and
replaces the database. After restoring the SQL file, restore the matching
`uploads\driver-photos\` folder as well.

## 12. Client/team handoff

### What to send

Send the project source files and folders, including:

- `src\`
- `server.js`
- `migrations\`
- `scripts\`
- `tests\`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `vite.config.ts`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- `README.md`

Do not send:

- `.env`
- `node_modules\`
- `dist\`
- `backups\` unless encrypted and intentionally shared
- `uploads\driver-photos\` unless the client has approved sharing those photos
- Database passwords or the President's real password

### What the team should do on their own PCs

1. Install the required tools.
2. Copy `.env.example` to `.env`.
3. Set their own local MySQL password and random session secret.
4. Start MySQL.
5. Run `pnpm install`.
6. Run `pnpm db:migrate`.
7. Restore an approved backup if they need existing records.
8. Run `pnpm photos:migrate` only if the backup contains old Base64 photos.
9. Start the API and frontend.
10. Test login, registry CRUD, QR scanning, CSV import, backups, and logout.

Each computer has its own local database unless you deliberately restore the
same backup. The system does not synchronize records between computers.

### How to deliver to a client later

For a local client installation:

1. Prepare a clean release folder.
2. Include the source, migration files, scripts, `.env.example`, and this README.
3. Install Node, pnpm, and MySQL on the client's computer.
4. Create the client's `.env` locally without receiving it through chat or email.
5. Set the President password through the approved setup process.
6. Run migrations and perform a backup/restore rehearsal.
7. Provide a short operator guide covering login, registry, QR, complaint import,
   backup, and logout.
8. Confirm who is responsible for backups, password recovery, and computer
   maintenance.

For a production-like deployment, build the frontend with `pnpm build`, serve
the `dist\` folder through the chosen local web server, run the API as a
managed service, use HTTPS, and set `SESSION_COOKIE_SECURE=true`.

## 13. Current implementation status

### Completed

- Local React/Vite frontend and Node/Express API.
- MySQL-backed migrations and sessions.
- President login, logout, password change, and session expiry.
- Login throttling and protected API routes.
- Driver CRUD, status changes, archiving, photos, profile view, and QR codes.
- Local QR generation and printable QR sheets.
- Fare reference panel.
- Complaint CSV import, preview, duplicate detection, and resolution tracking.
- Audit Log page and audit event storage.
- Local photo-file migration.
- PowerShell backup and restore scripts, with documented separate photo-folder
  backup handling.
- API regression tests, production dependency audit, and frontend build checks.

### Pending or recommended

- Run the full authenticated test suite on the machine containing the real
  President test password.
- Perform a final browser acceptance test after starting MySQL:
  login, logout, add/edit/archive driver, upload/reload photo, scan QR, import
  CSV, resolve complaint, change password, view Audit Log, and restore backup.
- Confirm the official municipality name, approved fare, body-number format,
  retention period, and required client fields.
- Decide whether the client needs printable driver ID cards in addition to QR
  sheets.
- Decide whether audit logs need export or long-term retention.
- Package the database and driver-photo folder into one backup artifact in a
  future maintenance update.
- Move photos to a managed file/object store only if the local MySQL/file
  arrangement becomes too large or needs centralized multi-computer access.
- Add HTTPS and secure-cookie deployment when the application leaves localhost.
- Define a tested password-reset procedure before handing the system to a client.

## 14. Final handoff checklist

- [ ] MySQL starts automatically or the client has a documented startup step.
- [ ] `.env` exists locally and is not included in shared files.
- [ ] `pnpm db:migrate` completes successfully.
- [ ] The President can log in and log out.
- [ ] A driver can be added, edited, viewed, archived, and reloaded.
- [ ] A driver photo remains after browser refresh.
- [ ] A driver QR opens the correct prefilled complaint form.
- [ ] A complaint CSV imports and duplicate rows are skipped.
- [ ] A complaint can be marked resolved.
- [ ] Audit Log shows a fresh login and later changes.
- [ ] `pnpm backup:db` creates a backup.
- [ ] The matching `uploads\driver-photos\` folder is copied with each backup.
- [ ] A disposable restore rehearsal succeeds.
- [ ] A restored photo folder is checked after the restore rehearsal.
- [ ] The client knows who owns backups, passwords, and future maintenance.
