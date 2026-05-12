"""
Client authentication router — persistent JSON file store on Render.
Users are stored in data/client_users.json (never committed to git).
Works across deployments because Render has a real persistent filesystem.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

# ── Store ────────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "..", "data")
USERS_FILE = os.path.join(DATA_DIR, "client_users.json")
_lock = threading.Lock()


def _read() -> dict:
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write(db: dict) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = USERS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    os.replace(tmp, USERS_FILE)


# ── Models ───────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    username: str
    passwordHash: str


class RegisterRequest(BaseModel):
    username: str
    passwordHash: str
    email: str = ""
    phone: str = ""
    emailVerified: bool = False


# ── Routes ───────────────────────────────────────────────────────────────────
class PrefsRequest(BaseModel):
    username: str
    passwordHash: str
    prefs: dict


@router.get("/api/client/prefs")
def client_prefs_get(username: str, passwordHash: str):
    u = username.strip().lower()
    with _lock:
        db = _read()
    rec = db.get(u)
    if rec is None:
        return JSONResponse(status_code=401, content={"error": "user_not_found"})
    if rec.get("passwordHash") != passwordHash.strip():
        return JSONResponse(status_code=401, content={"error": "wrong_password"})
    return {"ok": True, "prefs": rec.get("prefs", {})}


@router.put("/api/client/prefs")
def client_prefs_put(req: PrefsRequest):
    u = req.username.strip().lower()
    h = req.passwordHash.strip()
    with _lock:
        db = _read()
        rec = db.get(u)
        if rec is None:
            return JSONResponse(status_code=401, content={"error": "user_not_found"})
        if rec.get("passwordHash") != h:
            return JSONResponse(status_code=401, content={"error": "wrong_password"})
        rec["prefs"] = req.prefs
        rec["updatedAt"] = int(__import__("time").time() * 1000)
        db[u] = rec
        _write(db)
    return {"ok": True}


@router.post("/api/client/auth/login")
def client_auth_login(req: LoginRequest):
    u = req.username.strip().lower()
    h = req.passwordHash.strip()
    if not u or not h:
        return JSONResponse(status_code=400, content={"error": "missing_fields"})

    with _lock:
        db = _read()

    rec = db.get(u)
    if rec is None:
        return JSONResponse(status_code=401, content={"error": "user_not_found"})
    if rec.get("passwordHash") != h:
        return JSONResponse(status_code=401, content={"error": "wrong_password"})

    return {"ok": True}


@router.post("/api/client/auth/register")
def client_auth_register(req: RegisterRequest):
    u = req.username.strip().lower()
    h = req.passwordHash.strip()
    if not u or not h:
        return JSONResponse(status_code=400, content={"error": "missing_fields"})

    with _lock:
        db = _read()
        existing = db.get(u, {})
        db[u] = {
            "passwordHash": h,
            "email": req.email.strip() or existing.get("email", ""),
            "phone": req.phone.strip() or existing.get("phone", ""),
            "emailVerified": req.emailVerified or existing.get("emailVerified", False),
            "updatedAt": int(__import__("time").time() * 1000),
        }
        _write(db)

    return {"ok": True}
