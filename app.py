from flask import Flask, request, jsonify, render_template
import psycopg
from psycopg.rows import dict_row
import os
from datetime import datetime, timedelta, timezone

app = Flask(__name__)

# Configuration
DEFAULT_COLOR = "#6366f1"
# Use pooled connection for app traffic
DATABASE_URL = os.getenv("POSTGRES_URL")
# Use direct connection for schema management
DIRECT_URL = os.getenv("POSTGRES_URL_NON_POOLING")


def get_db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def init_db():
    if not DIRECT_URL:
        # Log warning if DIRECT_URL is missing, but proceed if app is already initialized in DB
        print("Warning: DIRECT_URL not set. Schema initialization skipped.")
        return

    with psycopg.connect(DIRECT_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS subjects (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    color TEXT NOT NULL DEFAULT '{DEFAULT_COLOR}',
                    created_at TIMESTAMPTZ NOT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id SERIAL PRIMARY KEY,
                    subject_id INTEGER NOT NULL,
                    start_time TIMESTAMPTZ NOT NULL,
                    end_time TIMESTAMPTZ,
                    duration_seconds INTEGER DEFAULT 0,
                    notes TEXT DEFAULT '',
                    CONSTRAINT fk_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
                );
            """)
            conn.commit()

@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    # CSP allows 'unsafe-inline' to support existing inline styles and onclick handlers in index.html
    csp = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com;"
    )
    response.headers["Content-Security-Policy"] = csp
    return response


# ── Routes ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── Subjects ─────────────────────────────────────────────────────────────────

@app.route("/api/subjects", methods=["GET"])
def get_subjects():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM subjects ORDER BY name ASC")
            rows = cur.fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/subjects", methods=["POST"])
def add_subject():
    data = request.get_json()
    name = data.get("name", "").strip()
    color = data.get("color", DEFAULT_COLOR)
    if not name:
        return jsonify({"error": "Subject name is required"}), 400
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO subjects (name, color, created_at) VALUES (%s, %s, %s) RETURNING id",
                    (name, color, datetime.utcnow().isoformat()),
                )
                subject_id = cur.fetchone()["id"]
                conn.commit()
                cur.execute("SELECT * FROM subjects WHERE id = %s", (subject_id,))
                row = cur.fetchone()
        return jsonify(dict(row)), 201
    except psycopg.errors.UniqueViolation:
        return jsonify({"error": "Subject already exists"}), 409


@app.route("/api/subjects/<int:subject_id>", methods=["DELETE"])
def delete_subject(subject_id):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM subjects WHERE id = %s", (subject_id,))
            conn.commit()
    return jsonify({"message": "Deleted"}), 200


# ── Sessions ─────────────────────────────────────────────────────────────────

@app.route("/api/sessions/start", methods=["POST"])
def start_session():
    data = request.get_json()
    subject_id = data.get("subject_id")
    if not subject_id:
        return jsonify({"error": "subject_id is required"}), 400
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO sessions (subject_id, start_time) VALUES (%s, %s) RETURNING id",
                (subject_id, datetime.utcnow().isoformat()),
            )
            session_id = cur.fetchone()["id"]
            conn.commit()
            cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
            row = cur.fetchone()
    return jsonify(dict(row)), 201


@app.route("/api/sessions/<int:session_id>/stop", methods=["POST"])
def stop_session(session_id):
    data = request.get_json() or {}
    notes = data.get("notes", "")
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM sessions WHERE id = %s", (session_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Session not found"}), 404
            start = row["start_time"]
            end = datetime.now(timezone.utc)
            duration = int((end - start).total_seconds())
            cur.execute(
                "UPDATE sessions SET end_time = %s, duration_seconds = %s, notes = %s WHERE id = %s",
                (end, duration, notes, session_id),
            )
            conn.commit()
            cur.execute(
                """
                SELECT s.id, s.subject_id, s.start_time, s.end_time,
                       s.duration_seconds, s.notes, sub.name AS subject_name,
                       sub.color AS subject_color
                FROM sessions s
                JOIN subjects sub ON s.subject_id = sub.id
                WHERE s.id = %s
                """,
                (session_id,),
            )
            updated = cur.fetchone()
    return jsonify(dict(updated)), 200


@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    days = int(request.args.get("days", 7))
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.subject_id, s.start_time, s.end_time,
                       s.duration_seconds, s.notes,
                       sub.name AS subject_name, sub.color AS subject_color
                FROM sessions s
                JOIN subjects sub ON s.subject_id = sub.id
                WHERE s.end_time IS NOT NULL AND s.start_time >= %s
                ORDER BY s.start_time DESC
                """,
                (since,),
            )
            rows = cur.fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/sessions/<int:session_id>", methods=["DELETE"])
def delete_session(session_id):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE id = %s", (session_id,))
            conn.commit()
    return jsonify({"message": "Deleted"}), 200


# ── Weekly Stats ──────────────────────────────────────────────────────────────

@app.route("/api/stats/weekly", methods=["GET"])
def weekly_stats():
    since = (datetime.utcnow() - timedelta(days=7)).isoformat()
    with get_db() as conn:
        with conn.cursor() as cur:
            # Per-subject totals
            cur.execute(
                """
                SELECT sub.name, sub.color,
                       SUM(s.duration_seconds) AS total_seconds,
                       COUNT(s.id) AS session_count
                FROM sessions s
                JOIN subjects sub ON s.subject_id = sub.id
                WHERE s.end_time IS NOT NULL AND s.start_time >= %s
                GROUP BY sub.id
                ORDER BY total_seconds DESC
                """,
                (since,),
            )
            by_subject = cur.fetchall()

            # Per-day totals for the last 7 days
            cur.execute(
                """
                SELECT s.start_time::DATE AS day,
                       SUM(s.duration_seconds) AS total_seconds
                FROM sessions s
                WHERE s.end_time IS NOT NULL AND s.start_time >= %s
                GROUP BY day
                ORDER BY day ASC
                """,
                (since,),
            )
            by_day = cur.fetchall()

    return jsonify(
        {
            "by_subject": [dict(r) for r in by_subject],
            "by_day": [dict(r) for r in by_day],
        }
    )


if __name__ == "__main__":
    # Disable debug mode by default for security
    debug_mode = os.getenv("FLASK_DEBUG", "False").lower() == "true"
    app.run(debug=debug_mode, port=5000)
