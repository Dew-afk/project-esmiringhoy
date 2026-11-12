"""Integrated live proctoring demo server.

Per frame from the browser (JPEG over WebSocket):
  - YOLO (train-4 best.pt): phone/person boxes + events
        phone box          -> unauthorized_object (high)
        2+ person boxes    -> second_person (critical)
  - MediaPipe FaceLandmarker: yaw/pitch/roll/gaze_h with a live 10 s baseline
        from policy.yaml, then head_pose_deviation / gaze_deviation (medium)

Replies with boxes + calibration state + newly finished events, and persists
every event to events/<session>.jsonl in the same EventsFlags shape as
pose/wrap.py. Tuning = edit policy.yaml, restart the server.

Session binding (Phase 2.2/2.3): when the client connects with
?session=<session_token> (from POST /api/sessions/start on the backend),
the cookie is forwarded to the backend's ws-validate endpoint; on success
the session id is the real exam_sessions row and every finished event is
POSTed to /api/sessions/{token}/events for events_flags + risk_scores.
Without a valid session the server falls back to the legacy live_<ts>
id and JSONL-only persistence — the JSONL file is always written either
way. The response's "db"/"persisted" fields report what actually happened;
a failed save is never reported as stored.

Run:  python webcam_demo.py   →  open http://localhost:8000
"""
import asyncio
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import uvicorn
import yaml
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision
from ultralytics import YOLO

from pose.extract import matrix_to_euler_deg
from pose.gaze_utils import compute_gaze_vector, iris_gaze_h
from pose.live_monitor import LivePoseMonitor

ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "runs" / "detect" / "train-4" / "weights" / "best.pt"
TASK_PATH = ROOT / "pose" / "face_landmarker.task"
POLICY_PATH = ROOT / "policy.yaml"
EVENTS_DIR = ROOT / "events"
BACKEND = "http://127.0.0.1:8001"


def model_imgsz(model_path: Path, fallback: int = 640) -> int:
    """imgsz the model was trained at, from the run's args.yaml (fallback 640)."""
    try:
        cfg = yaml.safe_load((model_path.parents[1] / "args.yaml").read_text(encoding="utf-8"))
        return int(cfg["imgsz"])
    except Exception:
        return fallback


IMGSZ = model_imgsz(MODEL_PATH)

app = FastAPI(title="Live Proctoring Demo")
model = YOLO(str(MODEL_PATH))  # GPU

landmarker = vision.FaceLandmarker.create_from_options(  # CPU (XNNPACK)
    vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(TASK_PATH)),
        running_mode=vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
)

policy = yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8"))
CATALOG = policy["event_catalog"]
MIN_DUR = float(policy["pose"]["min_dur_s"])
MERGE_GAP = float(policy["pose"]["merge_gap_s"])
POLICY_REF = policy["policy_version"]
CONF_PHONE = float(policy["yolo"]["conf_phone"])
CONF_PERSON = float(policy["yolo"]["conf_person"])
CONF_MIN = min(CONF_PHONE, CONF_PERSON)

YOLO_EVENT_TYPES = {"unauthorized_object", "second_person"}


class BooleanEventMonitor:
    """Debounced event for a boolean condition (phone present, 2+ persons)."""

    def __init__(self, event_type: str, severity: str):
        self.event_type = event_type
        self.severity = severity
        self._start = None
        self._last = None

    def update(self, active: bool, t_s: float, conf: float | None = None) -> list[dict]:
        if active:
            if self._start is None:
                self._start = t_s
            self._last = t_s
            return []
        if self._start is not None and t_s - self._last > MERGE_GAP:
            start, end = self._start, self._last
            self._start = None
            self._last = None
            if end - start >= MIN_DUR:
                ev = {"event_type": self.event_type, "severity": self.severity,
                      "start_s": round(start, 3), "end_s": round(end, 3),
                      "duration_s": round(end - start, 3)}
                if conf is not None:
                    ev["conf"] = round(conf, 3)
                return [ev]
        return []


@app.get("/")
async def index() -> HTMLResponse:
    return HTMLResponse((ROOT / "webcam.html").read_text(encoding="utf-8"))


def _backend_call(method: str, path: str, cookie: str, payload: dict | None = None):
    """One synchronous call to the auth backend; raises on any failure."""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{BACKEND}{path}", method=method, data=data,
        headers={"Content-Type": "application/json", "Cookie": cookie})
    with urllib.request.urlopen(req, timeout=3) as res:
        return json.loads(res.read())


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    session_start = time.time()

    # --- session binding: ?session=<token> + forwarded auth cookie -------
    # The backend decides ownership; a bad/absent session falls back to the
    # legacy live_<ts> JSONL-only mode. Client-supplied ids are never trusted.
    qs = dict(p.split("=", 1) for p in
              websocket.scope.get("query_string", b"").decode().split("&")
              if "=" in p)
    session_token = qs.get("session")
    cookie = websocket.headers.get("cookie", "")
    bound = None
    if session_token:
        try:
            bound = await asyncio.to_thread(
                _backend_call, "GET",
                f"/api/sessions/ws-validate?session_token={session_token}",
                cookie)
        except Exception:
            bound = None

    if bound:
        session_id = bound["session_id"]          # exam_sessions UUID
        contract_session = bound["session_token"]  # what events_flags.session_id stores
        db_state = {"mode": "bound", "persisted": 0, "down": False}
    else:
        session_id = f"live_{time.strftime('%Y%m%d_%H%M%S')}"
        contract_session = session_id
        db_state = {"mode": "fallback", "persisted": 0, "down": False}

    pose_mon = LivePoseMonitor(policy)
    phone_mon = BooleanEventMonitor("unauthorized_object", CATALOG["unauthorized_object"])
    person_mon = BooleanEventMonitor("second_person", CATALOG["second_person"])
    counter = 0
    log_path = EVENTS_DIR / f"{session_id}.jsonl"

    def record(event: dict) -> None:
        nonlocal counter
        counter += 1
        event.update({
            "event_id": f"{session_id}-{counter:04d}",
            "session_id": contract_session,
            "detector": "yolo11n" if event["event_type"] in YOLO_EVENT_TYPES else "pose_mediapipe",
            "policy_ref": POLICY_REF,
        })
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
        if bound and not db_state["down"]:
            try:
                _backend_call("POST",
                              f"/api/sessions/{contract_session}/events",
                              cookie, event)
                db_state["persisted"] += 1
            except Exception:
                # honest reporting: the JSONL copy exists, the DB row does not
                db_state["down"] = True

    def db_status() -> str:
        if db_state["mode"] == "fallback":
            return "fallback"
        return "down" if db_state["down"] else "bound"

    try:
        while True:
            frame_bytes = await websocket.receive_bytes()
            t_s = time.time() - session_start
            t0 = time.perf_counter()
            try:
                frame = cv2.imdecode(np.frombuffer(frame_bytes, np.uint8), cv2.IMREAD_COLOR)

                # --- YOLO: boxes + object/person events ---
                results = model.predict(frame, conf=CONF_MIN, imgsz=IMGSZ, verbose=False)
                boxes, n_phone, n_person = [], 0, 0
                phone_confs, person_confs = [], []
                for r in results:
                    for box in r.boxes:
                        conf = float(box.conf[0])
                        label = r.names[int(box.cls[0])]
                        # per-class confidence floors from policy.yaml
                        if (label == "phone" and conf < CONF_PHONE) or (
                                label == "person" and conf < CONF_PERSON):
                            continue
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        n_phone += label == "phone"
                        n_person += label == "person"
                        if label == "phone":
                            phone_confs.append(conf)
                        elif label == "person":
                            person_confs.append(conf)
                        boxes.append({"x1": x1, "y1": y1, "x2": x2, "y2": y2,
                                      "conf": conf, "label": label})

                # --- Pose: features + deviation events ---
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB,
                                    data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                res = landmarker.detect(mp_image)
                if res.face_landmarks:
                    yaw, pitch, roll = matrix_to_euler_deg(res.facial_transformation_matrixes[0])
                    # iris channel: the thresholds in policy.yaml were tuned on it
                    gaze_h = iris_gaze_h(res.face_landmarks[0])
                    face = 1
                    # baseline-relative head angles: neutral tilt must not drag
                    # the gaze ray (a resting pitch ~8deg used to flip up/down)
                    base_y = pose_mon.base_yaw if pose_mon.base_yaw is not None else yaw
                    base_p = pose_mon.base_pitch if pose_mon.base_pitch is not None else pitch
                    yaw_dev = (yaw - base_y + 180.0) % 360.0 - 180.0
                    pitch_dev = pitch - base_p
                    gaze_vec = compute_gaze_vector(res.face_landmarks[0], yaw_dev, pitch_dev)
                else:
                    yaw = pitch = roll = gaze_h = 0.0
                    face = 0
                    gaze_vec = None

                events = pose_mon.update(yaw, pitch, roll, gaze_h, face, t_s)
                # confidence on YOLO events = the triggering box's score
                # (max phone conf; second-highest person conf = the intruder)
                phone_conf = max(phone_confs) if phone_confs else None
                person_conf = (sorted(person_confs)[-2]
                               if len(person_confs) >= 2 else None)
                events += phone_mon.update(n_phone >= 1, t_s, conf=phone_conf)
                events += person_mon.update(n_person >= 2, t_s, conf=person_conf)
                for ev in events:
                    record(ev)

                ms = (time.perf_counter() - t0) * 1000
                await websocket.send_json({
                    "boxes": boxes,
                    "gaze": gaze_vec,
                    "ms": round(ms, 1),
                    "state": "live" if pose_mon.calibrated else "calibrating",
                    "seconds_remaining": round(pose_mon.seconds_remaining(t_s), 1),
                    "events": events,
                    "db": db_status(),
                    "persisted": db_state["persisted"],
                })
            except cv2.error:
                await websocket.send_json({"boxes": [], "ms": 0.0, "state": "calibrating",
                                           "seconds_remaining": pose_mon.seconds_remaining(t_s),
                                           "events": [], "db": db_status(),
                                           "persisted": db_state["persisted"]})
    except WebSocketDisconnect:
        for ev in pose_mon.close_session():
            record(ev)
    finally:
        EVENTS_DIR.mkdir(parents=True, exist_ok=True)


if __name__ == "__main__":
    # Guard required on Windows: multiprocessing spawn re-imports this module.
    uvicorn.run(app, host="127.0.0.1", port=8000)
