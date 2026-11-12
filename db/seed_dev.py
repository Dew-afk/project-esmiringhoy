"""One-time dev seed for the `aismering` database.

Creates (skipping anything that already exists):
  - institutions: Demo University, Test Institution
  - accounts for all four roles with DEV-ONLY passwords (printed once)
  - a proctoring policy, an in-progress exam, roster + consent for the
    demo student

Run from db/:   python seed_dev.py
Safe to re-run: existing rows are skipped, passwords are NOT reset.
Never run against production.
"""
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import security  # noqa: E402

# dev-only credentials — throwaway, never reuse
PASSWORDS = {
    "admin@demo.edu": "AdminDev123!",
    "proctor@demo.edu": "ProctorDev123!",
    "reviewer@demo.edu": "ReviewerDev123!",
    "student@demo.edu": "StudentDev123!",
}

ACCOUNTS = [
    # email, role, full_name, extra fields
    ("admin@demo.edu", "admin", "Demo Admin", {}),
    ("proctor@demo.edu", "instructor", "Demo Proctor",
     {"staff_id": "S-001", "department": "Computer Science"}),
    ("reviewer@demo.edu", "appeals_reviewer", "Demo Reviewer", {}),
    ("student@demo.edu", "student", "Demo Student", {"roster_id": "R-0001"}),
]


def main() -> None:
    env = {}
    for line in open(".env", encoding="utf-8"):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    url = env["DATABASE_URL"]
    assert url.rstrip("/").endswith("/aismering"), \
        "seed_dev.py only targets the aismering dev database"

    with psycopg.connect(url) as conn:
        inst = {}
        for name in ("Demo University", "Test Institution"):
            row = conn.execute(
                "INSERT INTO institutions (name) VALUES (%s) "
                "ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name "
                "RETURNING id", (name,)).fetchone()
            inst[name] = row[0]

        users = {}
        for email, role, full_name, extra in ACCOUNTS:
            cols = ["email", "password_hash", "full_name", "role",
                    "auth_provider", "approval_status"]
            vals = [email, security.hash_password(PASSWORDS[email]),
                    full_name, role, "password", "approved"]
            for k, v in extra.items():
                cols.append(k)
                vals.append(v)
            placeholders = ", ".join(["%s"] * len(vals))
            row = conn.execute(
                f"INSERT INTO user_accounts ({', '.join(cols)}) "
                f"VALUES ({placeholders}) ON CONFLICT (email) DO NOTHING "
                f"RETURNING id", vals).fetchone()
            if row is None:  # already existed
                row = conn.execute(
                    "SELECT id FROM user_accounts WHERE email = %s",
                    (email,)).fetchone()
            users[email] = row[0]
            conn.execute(
                "INSERT INTO user_tenants (user_id, institution_id) "
                "VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (row[0], inst["Demo University"]))

        # student consent (institution-wide)
        conn.execute(
            """INSERT INTO consents (user_id, exam_id, status, granted_at)
               SELECT %s, NULL, 'granted', now()
               WHERE NOT EXISTS (
                 SELECT 1 FROM consents WHERE user_id = %s)""",
            (users["student@demo.edu"], users["student@demo.edu"]))

        # policy + in-progress exam in Demo University
        pol = conn.execute(
            """INSERT INTO proctoring_policies (institution_id, name, version, config)
               VALUES (%s, 'demo policy', 'pose_v2', '{}'::jsonb)
               ON CONFLICT (institution_id, name, version) DO NOTHING
               RETURNING id""", (inst["Demo University"],)).fetchone()
        if pol is None:
            pol = conn.execute(
                """SELECT id FROM proctoring_policies
                   WHERE institution_id = %s AND name = 'demo policy'
                     AND version = 'pose_v2'""",
                (inst["Demo University"],)).fetchone()
        exam = conn.execute(
            """INSERT INTO exams
                 (institution_id, name, window_start, window_end,
                  duration_minutes, lifecycle, policy_id)
               VALUES (%s, 'Demo Midterm', now() - interval '1 hour',
                       now() + interval '23 hours', 120, 'in_progress', %s)
               ON CONFLICT DO NOTHING RETURNING id""",
            (inst["Demo University"], pol[0])).fetchone()
        if exam is None:
            exam = conn.execute(
                "SELECT id FROM exams WHERE name = 'Demo Midterm'").fetchone()
        conn.execute(
            """INSERT INTO roster_assignments (exam_id, student_id)
               VALUES (%s, %s) ON CONFLICT DO NOTHING""",
            (exam[0], users["student@demo.edu"]))
        conn.commit()

    print("seeded. dev logins (Demo University):")
    for email in PASSWORDS:
        print(f"  {email}  /  {PASSWORDS[email]}")
    print("\nnotes:")
    print("  - admin must pick 'Demo University' at sign-in")
    print("  - student is rostered on 'Demo Midterm' (in_progress) with consent granted")
    print("  - re-running skips existing rows; it will NOT reset passwords")


if __name__ == "__main__":
    main()
