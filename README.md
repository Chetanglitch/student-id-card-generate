# Student ID Card Portal

A local student ID card workflow with a Python HTTP API and SQLite persistence. The backend uses only Python's standard library; no package installation is required.

## Requirements
- Python 3.10 or newer (includes SQLite support)
- A modern browser

## Start the App

From this folder, run:

```powershell
python backend.py
```

Open `http://localhost:8000`. The server binds to localhost only. The SQLite database is created automatically at `student_cards.db` beside `backend.py`.

Optional PowerShell configuration before startup:

```powershell
$env:RCPIT_ADMIN_USERNAME = "admin"
$env:RCPIT_ADMIN_PASSWORD = "replace-with-a-private-password"
$env:RCPIT_DATABASE_PATH = "$PWD\student_cards.db"
python backend.py
```

If no environment variables are set, the local demo admin login is `admin` / `admin123`. Change these credentials before sharing the app. Existing browser records are imported into SQLite after admin login; records already in the database are not overwritten by the import.

## Backend Flow

- `POST /api/cards` stores a new application with Pending status.
- Admin login uses `POST /api/admin/login`; `GET /api/admin/cards` lists records.
- `POST /api/admin/cards/{id}/verify` verifies and signs a card.
- `POST /api/admin/cards/{id}/block` blocks a card. Blocked cards remain visible with Blocked status; `POST /api/admin/cards/{id}/unblock` restores their previous Pending or Verified status.
- Student login uses `POST /api/student/login` with the name on the card and its 9-digit PRN. Only Verified cards are accepted; Blocked cards cannot be downloaded.
- `GET /api/student/card` returns the logged-in student's verified card; `POST /api/student/logout` clears that session.
- `GET /api/health` reports server/database availability.

Admin and student sessions use HttpOnly, SameSite cookies and expire after eight hours. Sessions are held in memory and are cleared when the server restarts.

## Tests

Run the standard-library backend tests with:

```powershell
python -m unittest discover -s tests -v
```

The tests use temporary databases and cover submission, authorization, admin verification, student login/logout, invalid identifiers, database migration, and private-file routing.

## Data and Security

The `student_cards.db` file contains student personal data and uploaded photos. Keep it private and back it up securely. It is excluded from Git by `.gitignore`.

Name plus PRN is suitable only for a local/demo project, not strong identity verification for a public service. A deployed system should use institutional authentication, HTTPS, persistent session storage, and proper database backups.
