from flask import Flask, request, jsonify, render_template
import sqlite3
import os
from datetime import datetime, timedelta

app = Flask(__name__)

# Configuration
DEFAULT_COLOR = "#6366f1"
DB_PATH = os.getenv(
    "DATABASE_URL",
    os.path.join(os.path.dirname(__file__), "study_tracker.db")
)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript(f"""
            CREATE TABLE IF NOT EXISTS subjects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '{DEFAULT_COLOR}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject_id INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT,
                duration_seconds INTEGER DEFAULT 0,
                notes TEXT DEFAULT '',
                FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
            );
        """)
        conn.commit()

# IMPORTANT: Create tables when Vercel imports app.py
init_db()

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
        rows = conn.execute(
            "SELECT * FROM subjects ORDER BY name ASC"
        ).fetchall()
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
            cursor = conn.execute(
                "INSERT INTO subjects (name, color, created_at) VALUES (?, ?, ?)",
                (name, color, datetime.utcnow().isoformat()),
            )
            conn.commit()
            subject_id = cursor.lastrowid
            row = conn.execute(
                "SELECT * FROM subjects WHERE id = ?", (subject_id,)
            ).fetchone()
        return jsonify(dict(row)), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "Subject already exists"}), 409


@app.route("/api/subjects/<int:subject_id>", methods=["DELETE"])
def delete_subject(subject_id):
    with get_db() as conn:
        conn.execute("DELETE FROM subjects WHERE id = ?", (subject_id,))
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
        cursor = conn.execute(
            "INSERT INTO sessions (subject_id, start_time) VALUES (?, ?)",
            (subject_id, datetime.utcnow().isoformat()),
        )
        conn.commit()
        session_id = cursor.lastrowid
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
    return jsonify(dict(row)), 201


@app.route("/api/sessions/<int:session_id>/stop", methods=["POST"])
def stop_session(session_id):
    data = request.get_json() or {}
    notes = data.get("notes", "")
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if not row:
            return jsonify({"error": "Session not found"}), 404
        start = datetime.fromisoformat(row["start_time"])
        end = datetime.utcnow()
        duration = int((end - start).total_seconds())
        conn.execute(
            "UPDATE sessions SET end_time = ?, duration_seconds = ?, notes = ? WHERE id = ?",
            (end.isoformat(), duration, notes, session_id),
        )
        conn.commit()
        updated = conn.execute(
            """
            SELECT s.id, s.subject_id, s.start_time, s.end_time,
                   s.duration_seconds, s.notes, sub.name AS subject_name,
                   sub.color AS subject_color
            FROM sessions s
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.id = ?
            """,
            (session_id,),
        ).fetchone()
    return jsonify(dict(updated)), 200


@app.route("/api/sessions", methods=["GET"])
def get_sessions():
    days = int(request.args.get("days", 7))
    since = (datetime.utcnow() - timedelta(days=days)).isoformat()
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT s.id, s.subject_id, s.start_time, s.end_time,
                   s.duration_seconds, s.notes,
                   sub.name AS subject_name, sub.color AS subject_color
            FROM sessions s
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.end_time IS NOT NULL AND s.start_time >= ?
            ORDER BY s.start_time DESC
            """,
            (since,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/sessions/<int:session_id>", methods=["DELETE"])
def delete_session(session_id):
    with get_db() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
    return jsonify({"message": "Deleted"}), 200


# ── Weekly Stats ──────────────────────────────────────────────────────────────

@app.route("/api/stats/weekly", methods=["GET"])
def weekly_stats():
    since = (datetime.utcnow() - timedelta(days=7)).isoformat()
    with get_db() as conn:
        # Per-subject totals
        by_subject = conn.execute(
            """
            SELECT sub.name, sub.color,
                   SUM(s.duration_seconds) AS total_seconds,
                   COUNT(s.id) AS session_count
            FROM sessions s
            JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.end_time IS NOT NULL AND s.start_time >= ?
            GROUP BY sub.id
            ORDER BY total_seconds DESC
            """,
            (since,),
        ).fetchall()

        # Per-day totals for the last 7 days
        by_day = conn.execute(
            """
            SELECT DATE(s.start_time) AS day,
                   SUM(s.duration_seconds) AS total_seconds
            FROM sessions s
            WHERE s.end_time IS NOT NULL AND s.start_time >= ?
            GROUP BY day
            ORDER BY day ASC
            """,
            (since,),
        ).fetchall()

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
