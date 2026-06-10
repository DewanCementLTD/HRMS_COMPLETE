from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List
import time
from face_login import register_face, verify_face, face_status, delete_face, identify_face

app = FastAPI()

class RegisterReq(BaseModel):
    card_no1: str
    frames: List[str]
    created_at: str

class VerifyReq(BaseModel):
    card_no1: str
    frames: List[str]

@app.post("/face/register")
def register_api(req: RegisterReq):
    if len(req.frames) < 5:
        return JSONResponse({"body": {"status": "ERROR", "msg": "Not enough frames (min 5)"}})

    start = time.time()
    result = register_face(req.card_no1, req.frames, req.created_at)
    print(f"[REGISTER] card={req.card_no1} frames={len(req.frames)} time={time.time()-start:.2f}s")
    return JSONResponse(result)

@app.post("/face/verify")
def verify_api(req: VerifyReq):
    if len(req.frames) < 3:
        return JSONResponse({"body": {"is_match": False, "confidence": 0.0, "msg": "Not enough frames (min 3)"}})

    start = time.time()
    result = verify_face(req.card_no1, req.frames)
    print(f"[VERIFY] card={req.card_no1} frames={len(req.frames)} time={time.time()-start:.2f}s")
    return JSONResponse(result)

@app.get("/face/status/{card_no1}")
def status_api(card_no1: str):
    return JSONResponse(face_status(card_no1))

@app.delete("/face/delete/{card_no1}")
def delete_api(card_no1: str):
    return JSONResponse(delete_face(card_no1))

class IdentifyReq(BaseModel):
    frames: List[str]

@app.post("/face/identify")
def identify_api(req: IdentifyReq):
    if len(req.frames) < 5:
        return JSONResponse({"body": {"identified": False, "card_no": None, "emp_name": None, "confidence": 0.0, "message": "Not enough frames (min 5)"}})

    start = time.time()
    result = identify_face(req.frames)
    print(f"[IDENTIFY] frames={len(req.frames)} time={time.time()-start:.2f}s")
    return JSONResponse(result)
