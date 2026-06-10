import os
import cv2
import faiss
import base64
import numpy as np
from insightface.app import FaceAnalysis
from threading import Lock
import oracledb

# ******** ENV
os.environ['INSIGHTFACE_HOME'] = r'C:/Users/Administrator/.insightface/models'

# ******** INSIGHTFACE
face_app = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))

# ******** ORACLE
def get_db_connection():
    return oracledb.connect(
        user="hrms",
        password="oracle123",
        dsn="localhost:1521/orcl"
    )

# ******** FAISS GLOBAL
faiss_lock = Lock()
index = None
labels = []

# ******** LOAD FAISS FROM DB
def load_faiss_from_db():
    global index, labels

    conn = None
    cursor = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT EMPCODE, EMBEDDING_BLOB
            FROM EMP_FACE_EMBEDDINGS
            WHERE IS_ACTIVE = 'Y'
        """)

        vecs = []
        new_labels = []

        for empcode, blob in cursor:
            emb = np.frombuffer(blob.read(), dtype=np.float32)
            vecs.append(emb)
            new_labels.append(empcode)

        if vecs:
            vecs = np.array(vecs).astype("float32")
            index = faiss.IndexFlatIP(512)
            index.add(vecs)
        else:
            index = None

        labels = new_labels
        print(f"[FAISS] Loaded {len(labels)} embeddings")

    except Exception as e:
        print("FAISS LOAD ERROR:", e)
        index = None
        labels = []
    finally:
        if cursor:
            try: cursor.close()
            except: pass
        if conn:
            try: conn.close()
            except: pass

# Load at startup
load_faiss_from_db()

# ******** HELPERS
def decode_base64_image(b64_str):
    try:
        img_bytes = base64.b64decode(b64_str)
        nparr = np.frombuffer(img_bytes, np.uint8)
        return cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    except Exception as e:
        print("DECODE ERROR:", e)
        return None


def extract_embedding(img):
    if img is None:
        return None

    try:
        faces = face_app.get(img)
        print(f"[DEBUG] Faces detected: {len(faces)}")

        if len(faces) != 1:
            return None

        face = faces[0]
        print(f"[DEBUG] det_score: {face.det_score}")

        if face.det_score < 0.35:
            return None

        emb = face.embedding
        emb = emb / np.linalg.norm(emb)

        return emb

    except Exception as e:
        print("EMBEDDING ERROR:", e)
        return None


def is_registered_in_db(card_no):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT COUNT(*)
            FROM EMP_FACE_EMBEDDINGS
            WHERE EMPCODE = :empcode AND IS_ACTIVE = 'Y'
        """, {"empcode": card_no})

        count = cursor.fetchone()[0]
        return {"is_registered": count > 0}

    except Exception as e:
        print("DB ERROR:", e)
        return {"is_registered": False}
    finally:
        try:
            cursor.close()
            conn.close()
        except:
            pass


# ******** REGISTER
def register_face(card_no1, b64_images, created_at):
    global index

    if len(b64_images) < 3:
        return {"body": {"status": "ERROR", "msg": "Need more frames"}}

    if is_registered_in_db(card_no1)["is_registered"]:
        return {"body": {"status": "SUCCESS", "already_registered": True}}

    embeddings = []

    for b64 in b64_images:
        img = decode_base64_image(b64)
        emb = extract_embedding(img)

        if emb is not None:
            embeddings.append(emb)

        # 🚀 STOP EARLY (performance boost)
        if len(embeddings) >= 4:
            break

    if len(embeddings) < 2:
        return {"body": {"status": "ERROR", "msg": "Face not clear, try again"}}

    embeddings = np.array(embeddings)

    centroid = np.mean(embeddings, axis=0)
    centroid = centroid / np.linalg.norm(centroid)

    sims = np.dot(embeddings, centroid)

    print(f"[DEBUG] Similarities: {sims}")

    if np.mean(sims) < 0.55:
        return {"body": {"status": "ERROR", "msg": "Unstable face capture"}}

    # Use centroid as the single stored embedding (table allows one row per EMPCODE)
    emb = centroid.astype("float32").reshape(1, -1)

    print("Embedding shape:", emb.shape)

    # 🔍 Duplicate check — reject if this face matches another employee
    with faiss_lock:
        if index is not None:
            D, I = index.search(emb, 1)
            if D[0][0] >= 0.75:
                existing = labels[I[0][0]]
                if existing != card_no1:
                    return {"body": {"status": "ERROR", "msg": f"Face already exists: {existing}"}}

    emb_bytes = emb.tobytes()
    emb_clob = base64.b64encode(emb_bytes).decode('utf-8')

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO EMP_FACE_EMBEDDINGS
            (EMPCODE, EMBEDDING_BLOB, EMBEDDING_CLOB, EMBEDDING_DIM, CREATED_AT, IS_ACTIVE)
            VALUES (:empcode, :emb_blob, :emb_clob, 512, SYSTIMESTAMP, 'Y')
        """, {
            "empcode": card_no1,
            "emb_blob": emb_bytes,
            "emb_clob": emb_clob
        })

        conn.commit()

        # ➕ Add to FAISS
        with faiss_lock:
            if index is None:
                index = faiss.IndexFlatIP(512)
                index.add(emb)
            else:
                index.add(emb)
            labels.append(card_no1)

    except Exception as e:
        print("DB ERROR:", e)
        return {"body": {"status": "ERROR", "msg": "Database error"}}
    finally:
        try:
            cursor.close()
            conn.close()
        except:
            pass

    return {"body": {"status": "SUCCESS", "already_registered": False}}


# ******** VERIFY
def verify_face(card_no1, b64_images):

    if index is None or index.ntotal == 0:
        print("[VERIFY] FAISS index is empty — no registered faces")
        return {"body": {"is_match": False, "confidence": 0.0, "msg": "No registered faces"}}

    similarities = []

    for b64 in b64_images:
        img = decode_base64_image(b64)
        emb = extract_embedding(img)

        if emb is not None:
            emb = emb.astype("float32").reshape(1, -1)

            D, I = index.search(emb, 1)
            idx = int(I[0][0])

            # FAISS returns -1 when the index is empty or search fails
            if idx < 0 or idx >= len(labels):
                continue

            sim = float(D[0][0])
            matched_emp = labels[idx]

            print(f"[VERIFY] Match: {matched_emp}, Similarity: {sim:.4f}")

            if matched_emp == card_no1:
                similarities.append(sim)

        # 🚀 STOP EARLY after 3 matching frames
        if len(similarities) >= 3:
            break

    if not similarities:
        return {"body": {"is_match": False, "confidence": 0.0}}

    final_similarity = max(similarities)
    print(f"[VERIFY] card={card_no1} best_sim={final_similarity:.4f} matching_frames={len(similarities)}")

    if final_similarity >= 0.45:
        return {"body": {"is_match": True, "confidence": final_similarity}}

    return {"body": {"is_match": False, "confidence": final_similarity}}


# ******** STATUS
def face_status(card_no1):
    return {"body": is_registered_in_db(card_no1)}


# ******** DELETE
def delete_face(card_no1):

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute("""
            DELETE FROM EMP_FACE_EMBEDDINGS
            WHERE EMPCODE = :empcode
        """, {"empcode": card_no1})

        conn.commit()

    except Exception as e:
        print("DELETE ERROR:", e)
        return {"body": {"status": "ERROR"}}
    finally:
        try:
            cursor.close()
            conn.close()
        except:
            pass

    # Reload FAISS
    with faiss_lock:
        load_faiss_from_db()

    return {"body": {"status": "SUCCESS"}}


# ******** IDENTIFY (1:N search — no card_no, find best match)
def identify_face(b64_images):
    """1:N face search: identify who this person is from all registered faces."""

    if index is None or len(labels) == 0:
        return {"body": {
            "identified": False, "card_no": None, "emp_name": None,
            "confidence": 0.0, "message": "No registered faces in system"
        }}

    embeddings = []

    for b64 in b64_images:
        img = decode_base64_image(b64)
        emb = extract_embedding(img)
        if emb is not None:
            embeddings.append(emb.astype("float32").reshape(1, -1))
        if len(embeddings) >= 5:
            break

    if not embeddings:
        return {"body": {
            "identified": False, "card_no": None, "emp_name": None,
            "confidence": 0.0, "message": "No face detected in frames"
        }}

    # Score each embedding against FAISS, keep per-label best
    vote_scores = {}  # card_no -> max similarity
    for emb in embeddings:
        with faiss_lock:
            D, I = index.search(emb, 1)
        idx = int(I[0][0])
        if idx < 0 or idx >= len(labels):
            continue
        sim = float(D[0][0])
        matched = labels[idx]
        if matched not in vote_scores or sim > vote_scores[matched]:
            vote_scores[matched] = sim

    if not vote_scores:
        return {"body": {
            "identified": False, "card_no": None, "emp_name": None,
            "confidence": 0.0, "message": "No match found"
        }}

    best_card = max(vote_scores, key=vote_scores.get)
    best_sim = vote_scores[best_card]

    print(f"[IDENTIFY] best_match={best_card} similarity={best_sim:.4f}")

    if best_sim < 0.50:
        return {"body": {
            "identified": False, "card_no": None, "emp_name": None,
            "confidence": best_sim, "message": "Face not recognized (low confidence)"
        }}

    # Look up emp_name from Oracle
    emp_name = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT e.EMP_NAME
            FROM EMPLOYEE e
            WHERE TO_CHAR(e.CARD_NO) = :empcode
               OR TO_CHAR(e.CARD_NO) = :empcode_int
        """, {
            "empcode": best_card,
            "empcode_int": best_card.split(".")[0] if "." in best_card else best_card
        })
        row = cursor.fetchone()
        if row:
            emp_name = row[0]
    except Exception as e:
        print("IDENTIFY DB ERROR:", e)
    finally:
        try:
            cursor.close()
            conn.close()
        except:
            pass

    return {"body": {
        "identified": True,
        "card_no": best_card,
        "emp_name": emp_name or best_card,
        "confidence": best_sim,
        "message": f"Face identified as {emp_name or best_card}"
    }}